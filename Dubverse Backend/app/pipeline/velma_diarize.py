"""
Velma (Modulate) conversation intelligence service.
Uses the velma-2-batch endpoint which returns diarized transcription + speaker roles,
emotion, accent, deepfake scores, scene summary, topics, and per-speaker sentiment.
"""
import json
import os
import logging
import uuid
import requests

logger = logging.getLogger(__name__)

VELMA_BATCH_URL = "https://platform.modulate.ai/api/velma-2-batch"

# ── Film dubbing BatchConfig ─────────────────────────────────────────────────
# Conversation type and participant roles for scripted film/TV dialogue.
# Custom behaviors are intentionally omitted — they require iterative tuning
# and will be added in a dedicated session.

_FILM_CONVERSATION_TYPE_UUID = "09ad66af-f9c2-4462-a2f9-350c41cfb908"
_ROLE_AUTHORITY_UUID         = "3375959c-e221-47ab-bc9c-b6c22eecdcde"
_ROLE_CHALLENGER_UUID        = "5663029e-0075-4208-a666-5dcf7556fb2d"
_ROLE_NARRATOR_UUID          = "e537984d-87c0-4eb6-9af4-5f7fb1b87844"
_ROLE_SUPPORTING_UUID        = "97b15267-3b6f-4068-bfa2-6bd8f3a01c9e"

FILM_DUBBING_CONFIG = {
    "conversation_types": [
        {
            "conversation_type_uuid": _FILM_CONVERSATION_TYPE_UUID,
            "name": "Film Dialogue",
            "short_description": "Scripted dialogue from a film or television show.",
            "detailed_description": (
                "A dramatic scene with multiple characters speaking scripted lines. "
                "Characters have distinct roles, emotional arcs, and interpersonal relationships. "
                "Dialogue may include formal speech, challenges, humor, conflict, exposition, "
                "and dramatic tension. Tone varies by genre — martial arts, drama, comedy, thriller. "
                "Speakers take turns; overlapping speech is rare in scripted content."
            ),
        }
    ],
    "participant_roles": [
        {
            "participant_role_uuid": _ROLE_AUTHORITY_UUID,
            "name": "Authority Figure",
            "short_description": "A master, teacher, elder, leader, or senior character.",
            "detailed_description": (
                "Speaks with calm confidence, dignity, and restraint. "
                "Often uses formal, humble, or measured language. "
                "May give instructions, offer wisdom, or respond to challenges with composure. "
                "In martial arts films, this is typically the sifu, master, or senior practitioner."
            ),
            "applies_to_conversation_type_uuids": [_FILM_CONVERSATION_TYPE_UUID],
        },
        {
            "participant_role_uuid": _ROLE_CHALLENGER_UUID,
            "name": "Challenger",
            "short_description": "Someone testing, confronting, or provoking another character.",
            "detailed_description": (
                "Speaks with confidence, aggression, or condescension. "
                "May issue challenges, make demands, taunt, or question another character's ability. "
                "Tone ranges from respectful rivalry to open hostility. "
                "In martial arts films, this is typically the opponent or visiting fighter."
            ),
            "applies_to_conversation_type_uuids": [_FILM_CONVERSATION_TYPE_UUID],
        },
        {
            "participant_role_uuid": _ROLE_NARRATOR_UUID,
            "name": "Narrator",
            "short_description": "A voice providing exposition or context outside the scene.",
            "detailed_description": (
                "Speaks in third person or provides background information. "
                "Not a character in the scene. Tone is neutral and informational."
            ),
            "applies_to_conversation_type_uuids": [_FILM_CONVERSATION_TYPE_UUID],
        },
        {
            "participant_role_uuid": _ROLE_SUPPORTING_UUID,
            "name": "Supporting Character",
            "short_description": "A secondary character — friend, family member, bystander, or ally.",
            "detailed_description": (
                "Speaks with varying tone depending on relationship to main characters. "
                "May offer advice, express concern, provide comic relief, or react to events. "
                "Not the primary driver of the scene's conflict."
            ),
            "applies_to_conversation_type_uuids": [_FILM_CONVERSATION_TYPE_UUID],
        },
    ],
    "behaviors": [],
    "stt": {
        "speaker_diarization": True,
        "emotion_signal": True,
        "accent_signal": True,
        "deepfake_signal": True,
    },
    "produce_topics": True,
    "produce_topic_sentiments": True,
    "produce_summary": True,
}


def velma_diarize(audio_path: str, job_id: str, num_speakers: int = 0) -> dict:
    """
    Send audio to Velma batch conversation intelligence and return diarized
    segments plus scene context in DubMaster format.

    Args:
        audio_path: Path to audio file (WAV, MP3, etc.)
        job_id: Job ID for logging
        num_speakers: Expected number of speakers (0 = auto-detect)

    Returns on success:
        {
            "status": "ok",
            "segments": [...],           # per-utterance with speaker/emotion/accent
            "transcript": str,           # full transcript text
            "duration_ms": int,
            "unique_speakers": int,
            "summary": str | None,       # scene summary from Velma
            "topics": [str, ...],        # extracted topics
            "topic_sentiments": [...],   # per-speaker sentiment per topic
            "role_picks": [...],         # per-speaker role assignments
        }
    Returns on failure:
        {"status": "skipped", "reason": str, "error_message": str}
    """
    api_key = os.getenv("MODULATE_API_KEY", "").strip()
    if not api_key:
        logger.warning(f"[VELMA] Job {job_id}: MODULATE_API_KEY not set — skipping")
        return {"status": "skipped", "reason": "no_api_key", "error_message": "MODULATE_API_KEY not configured"}

    if not os.path.exists(audio_path):
        logger.warning(f"[VELMA] Job {job_id}: audio file not found: {audio_path}")
        return {"status": "skipped", "reason": "file_not_found", "error_message": f"Audio file not found: {audio_path}"}

    try:
        logger.info(f"[VELMA] Job {job_id}: sending {audio_path} to Velma batch (full config)")

        config_json = json.dumps(FILM_DUBBING_CONFIG)

        with open(audio_path, "rb") as f:
            response = requests.post(
                VELMA_BATCH_URL,
                headers={"X-API-Key": api_key},
                files={"upload_file": f},
                data={"config": config_json},
                timeout=600,
            )

        if response.status_code != 200:
            logger.error(f"[VELMA] Job {job_id}: API error {response.status_code}: {response.text[:500]}")
            return {
                "status": "skipped",
                "reason": "velma_api_error",
                "error_message": f"HTTP {response.status_code}: {response.text[:200]}"
            }

        data = response.json()

        # ── Parse clips (the new response format for transcribed segments) ────
        clips = data.get("clips", [])
        if not clips:
            # Fallback: try old "utterances" key in case endpoint returns legacy format
            clips = data.get("utterances", [])

        if not clips:
            logger.warning(f"[VELMA] Job {job_id}: no clips/utterances returned")
            return {"status": "skipped", "reason": "no_utterances", "error_message": "Velma returned no clips"}

        segments = []
        full_text_parts = []
        for clip in clips:
            text = (clip.get("text") or "").strip()
            if text:
                full_text_parts.append(text)

            speaker_label = clip.get("speaker_label") or clip.get("speaker") or "Speaker_1"
            # Normalize "Speaker_1" → "speaker-1" for DubMaster compatibility
            if isinstance(speaker_label, str) and speaker_label.startswith("Speaker_"):
                try:
                    speaker_num = int(speaker_label.split("_")[1])
                    speaker_label = f"speaker-{speaker_num}"
                except (IndexError, ValueError):
                    speaker_label = "speaker-1"
            elif isinstance(speaker_label, int):
                speaker_label = f"speaker-{speaker_label}"

            start_ms = clip.get("start_ms", 0)
            duration_ms = clip.get("duration_ms", 0)
            segments.append({
                "start": start_ms / 1000.0,
                "end": (start_ms + duration_ms) / 1000.0,
                "speaker": speaker_label,
                "text": text,
                "emotion": clip.get("emotion"),
                "accent": clip.get("accent"),
                "deepfake_score": clip.get("deepfake_score"),
                "language": clip.get("language"),
            })

        unique_speakers = len(set(s["speaker"] for s in segments))

        # ── Extract scene context outputs ────────────────────────────────────
        summary = data.get("summary")
        topics = data.get("topics", [])
        topic_sentiments = data.get("topic_sentiments", [])
        role_picks = data.get("participant_role_picks", [])

        logger.info(
            f"[VELMA] Job {job_id}: {len(segments)} segments, {unique_speakers} speakers | "
            f"summary={'yes' if summary else 'no'}, "
            f"topics={len(topics)}, "
            f"roles={len(role_picks)}, "
            f"sentiments={len(topic_sentiments)}"
        )
        if summary:
            logger.info(f"[VELMA] Job {job_id} summary: {summary[:200]}")
        if topics:
            logger.info(f"[VELMA] Job {job_id} topics: {topics}")
        if role_picks:
            for rp in role_picks:
                logger.info(
                    f"[VELMA] Job {job_id} role: {rp.get('speaker_label')} → "
                    f"{rp.get('name')} (confidence={rp.get('confidence', '?')})"
                )

        # Log emotion distribution for diagnostics
        emotion_dist = {}
        for s in segments:
            e = s.get("emotion") or "null"
            emotion_dist[e] = emotion_dist.get(e, 0) + 1
        logger.info(f"[VELMA] Job {job_id} emotion distribution: {emotion_dist}")

        return {
            "status": "ok",
            "segments": segments,
            "transcript": " ".join(full_text_parts),
            "duration_ms": data.get("duration_ms", 0),
            "unique_speakers": unique_speakers,
            "summary": summary,
            "topics": topics,
            "topic_sentiments": topic_sentiments,
            "role_picks": role_picks,
        }

    except requests.Timeout:
        logger.error(f"[VELMA] Job {job_id}: request timed out after 600s")
        return {"status": "skipped", "reason": "timeout", "error_message": "Velma API request timed out"}
    except Exception as e:
        logger.error(f"[VELMA] Job {job_id}: unexpected error: {e}", exc_info=True)
        return {"status": "skipped", "reason": "velma_failed", "error_message": str(e)}
