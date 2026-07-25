"""
Velma (Modulate) conversation intelligence service.

Two parallel calls per job:
  1. velma-2-batch (Triage) — diarized transcript + scene context (roles, summary, topics)
  2. velma-2-stt-batch (STT) — same audio with emotion_signal=true for per-utterance emotions

Triage provides the authoritative speaker assignments and scene metadata.
STT provides the emotion labels (Triage ignores emotion_signal in its config).
Emotions are merged onto Triage segments by closest start_ms match (±300ms).
"""
import json
import os
import logging
import concurrent.futures
import requests

logger = logging.getLogger(__name__)

VELMA_BATCH_URL = "https://platform.modulate.ai/api/velma-2-batch"
VELMA_STT_URL   = "https://platform.modulate.ai/api/velma-2-stt-batch"

# ── Film dubbing BatchConfig ─────────────────────────────────────────────────
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
        "accent_signal": True,
        "deepfake_signal": True,
    },
    "produce_topics": True,
    "produce_topic_sentiments": True,
    "produce_summary": True,
}


def _call_triage(audio_path: str, api_key: str, job_id: str) -> dict:
    """Call velma-2-batch (Triage) for transcript + scene context."""
    config_json = json.dumps(FILM_DUBBING_CONFIG)
    with open(audio_path, "rb") as f:
        resp = requests.post(
            VELMA_BATCH_URL,
            headers={"X-API-Key": api_key},
            files={"upload_file": f},
            data={"config": config_json},
            timeout=600,
        )
    if resp.status_code != 200:
        raise RuntimeError(f"Triage HTTP {resp.status_code}: {resp.text[:200]}")
    return resp.json()


def _call_stt_emotions(audio_path: str, api_key: str, job_id: str) -> dict:
    """Call velma-2-stt-batch with emotion_signal=true for per-utterance emotion labels."""
    try:
        with open(audio_path, "rb") as f:
            resp = requests.post(
                VELMA_STT_URL,
                headers={"X-API-Key": api_key},
                files={"upload_file": ("audio.wav", f, "audio/wav")},
                data={
                    "speaker_diarization": "true",
                    "emotion_signal": "true",
                    "accent_signal": "true",
                },
                timeout=300,
            )
        if resp.status_code == 200:
            return resp.json()
        logger.warning(f"[VELMA-STT] Job {job_id}: HTTP {resp.status_code} — emotions unavailable")
        return {}
    except Exception as exc:
        logger.warning(f"[VELMA-STT] Job {job_id}: emotion call failed ({exc}) — continuing without emotions")
        return {}


def _build_emotion_index(stt_data: dict) -> dict:
    """Build {start_ms: emotion_label} from the STT response for fast merging."""
    utts = stt_data.get("utterances", stt_data.get("clips", []))
    index = {}
    for utt in utts:
        emotion = utt.get("emotion")
        if emotion:
            index[int(utt.get("start_ms", 0))] = emotion
    return index


def _merge_emotion(seg_start_ms: int, emotion_index: dict, tolerance_ms: int = 300) -> str | None:
    """Return the emotion label from the STT index closest to seg_start_ms, or None."""
    if not emotion_index:
        return None
    closest = min(emotion_index.keys(), key=lambda ms: abs(ms - seg_start_ms))
    if abs(closest - seg_start_ms) <= tolerance_ms:
        return emotion_index[closest]
    return None


def velma_diarize(audio_path: str, job_id: str, num_speakers: int = 0) -> dict:
    """
    Send audio to Velma and return diarized segments with emotions + scene context.

    Runs two API calls in parallel:
    - Triage (velma-2-batch): authoritative speaker diarization + scene context
    - STT (velma-2-stt-batch): emotion labels per utterance

    Returns on success:
        {
            "status": "ok",
            "segments": [...],           # per-utterance with speaker/emotion/accent
            "transcript": str,
            "duration_ms": int,
            "unique_speakers": int,
            "summary": str | None,
            "topics": [str, ...],
            "topic_sentiments": [...],
            "role_picks": [...],
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
        logger.info(f"[VELMA] Job {job_id}: running Triage + STT-emotion in parallel")

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            triage_future = pool.submit(_call_triage, audio_path, api_key, job_id)
            stt_future    = pool.submit(_call_stt_emotions, audio_path, api_key, job_id)
            triage_data = triage_future.result()  # raises on HTTP error
            stt_data    = stt_future.result()     # never raises — returns {} on failure

        emotion_index = _build_emotion_index(stt_data)
        logger.info(f"[VELMA] Job {job_id}: STT emotion index built — {len(emotion_index)} labeled utterances")

        # ── Parse Triage clips ───────────────────────────────────────────────
        clips = triage_data.get("clips", triage_data.get("utterances", []))
        if not clips:
            logger.warning(f"[VELMA] Job {job_id}: no clips/utterances returned from Triage")
            return {"status": "skipped", "reason": "no_utterances", "error_message": "Velma returned no clips"}

        segments = []
        full_text_parts = []

        # Number speakers by the order each is first HEARD (first = speaker-1),
        # NOT by the service's cluster id. That id has no relation to who speaks
        # first, so mapping Speaker_2 -> speaker-2 kept landing the numbers on the
        # wrong person. Build the map from clips sorted by start time.
        def _raw_speaker(c):
            return str(c.get("speaker_label") or c.get("speaker") or "Speaker_1")

        appearance_map: dict = {}
        for c in sorted(clips, key=lambda c: c.get("start_ms", 0)):
            raw = _raw_speaker(c)
            if raw not in appearance_map:
                appearance_map[raw] = f"speaker-{len(appearance_map) + 1}"

        for clip in clips:
            text = (clip.get("text") or "").strip()
            if text:
                full_text_parts.append(text)

            speaker_label = appearance_map.get(_raw_speaker(clip), "speaker-1")

            start_ms   = clip.get("start_ms", 0)
            duration_ms = clip.get("duration_ms", 0)

            # Triage emotion is null — get from STT emotion index
            emotion = clip.get("emotion") or _merge_emotion(start_ms, emotion_index)

            segments.append({
                "start": start_ms / 1000.0,
                "end": (start_ms + duration_ms) / 1000.0,
                "speaker": speaker_label,
                "text": text,
                "emotion": emotion,
                "accent": clip.get("accent"),
                "deepfake_score": clip.get("deepfake_score"),
                "language": clip.get("language"),
            })

        unique_speakers = len(set(s["speaker"] for s in segments))

        # ── Scene context from Triage ────────────────────────────────────────
        summary          = triage_data.get("summary")
        topics           = triage_data.get("topics", [])
        topic_sentiments = triage_data.get("topic_sentiments", [])
        role_picks       = triage_data.get("participant_role_picks", [])
        # Keep character/role names attached to the renumbered speakers.
        for rp in role_picks:
            raw = str(rp.get("speaker_label") or "")
            if raw in appearance_map:
                rp["speaker_label"] = appearance_map[raw]

        logger.info(
            f"[VELMA] Job {job_id}: {len(segments)} segments, {unique_speakers} speakers | "
            f"summary={'yes' if summary else 'no'}, topics={len(topics)}, roles={len(role_picks)}"
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

        emotion_dist = {}
        for s in segments:
            e = s.get("emotion") or "null"
            emotion_dist[e] = emotion_dist.get(e, 0) + 1
        logger.info(f"[VELMA] Job {job_id} emotion distribution: {emotion_dist}")

        return {
            "status": "ok",
            "segments": segments,
            "transcript": " ".join(full_text_parts),
            "duration_ms": triage_data.get("duration_ms", 0),
            "unique_speakers": unique_speakers,
            "summary": summary,
            "topics": topics,
            "topic_sentiments": topic_sentiments,
            "role_picks": role_picks,
        }

    except requests.Timeout:
        logger.error(f"[VELMA] Job {job_id}: Triage request timed out")
        return {"status": "skipped", "reason": "timeout", "error_message": "Velma API request timed out"}
    except Exception as exc:
        logger.error(f"[VELMA] Job {job_id}: unexpected error: {exc}", exc_info=True)
        return {"status": "skipped", "reason": "velma_failed", "error_message": str(exc)}
