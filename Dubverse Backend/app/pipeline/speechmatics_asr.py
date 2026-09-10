"""
Speechmatics batch ASR for Cantonese and Mandarin.

Speechmatics is the PRIMARY ASR engine for Chinese languages, doing both
transcription AND speaker diarization in a single API call.  It exposes a
tunable ``speaker_sensitivity`` knob that neither Deepgram nor pyannote
offers — confirmed against the Ip Man 2 test clip to separate brief
interjections from a dominant speaker where every other diarizer collapsed
them into one speaker.

Fallback order:
  1. Speechmatics (this module) — primary
  2. Deepgram                     — fallback if Speechmatics fails
  3. Whisper Large                — final fallback

Speechmatics language codes:
  - Cantonese:  yue
  - Mandarin:   cmn

API workflow (batch, async):
  1. POST /v2/jobs/ with audio file + config (multipart form)
  2. Poll GET /v2/jobs/{id} until status == "done"
  3. GET /v2/jobs/{id}/transcript?format=json-v2
  4. Parse results[] into segments grouped by speaker

Environment variables:
  SPEECHMATICS_API_KEY             — Required. API key from Speechmatics portal.
  SPEECHMATICS_SPEAKER_SENSITIVITY — 0.0–1.0 (default: "0.6"). Higher = more speakers.
  SPEECHMATICS_PREFER_CURRENT_SPEAKER — "1"/"0" (default: "1"). Reduces false switches.
  SPEECHMATICS_POLL_TIMEOUT_SEC    — Max wait for job completion (default: "600").
  SPEECHMATICS_BASE_URL            — API base (default: "https://eu1.asr.api.speechmatics.com/v2").
"""

import json
import logging
import os
import time
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_DEFAULT_BASE_URL = "https://eu1.asr.api.speechmatics.com/v2"

# Speechmatics language codes:
#   yue = Cantonese
#   cmn = Mandarin
_LANG_MAP = {
    "yue": "yue",
    "zh-yue": "yue",
    "yue-hk": "yue",
    "zh-hk": "yue",
    "zh": "cmn",
    "cmn": "cmn",
    "zho": "cmn",
    "zh-cn": "cmn",
    "zh-tw": "cmn",
}


def _get_api_key() -> Optional[str]:
    key = (os.getenv("SPEECHMATICS_API_KEY") or "").strip()
    if not key:
        logger.warning("[SPEECHMATICS] No SPEECHMATICS_API_KEY set — skipping")
        return None
    return key


def _map_language(source_language: Optional[str]) -> str:
    lang = (source_language or "").lower().strip().replace("_", "-")
    return _LANG_MAP.get(lang, "yue")


def transcribe_with_speechmatics(
    extract_result: Dict[str, Any],
    audio_path: Optional[str] = None,
    source_language: Optional[str] = None,
    job_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Transcribe audio using Speechmatics batch API with diarization.

    Returns a dict with ``status`` and ``segments`` compatible with the
    Cantonese pipeline.  Each segment has:
        start, end, text, speaker, confidence, source, words

    Speechmatics speaker labels (S1, S2, ...) are mapped to
    speaker-1, speaker-2, etc.
    """
    import requests

    api_key = _get_api_key()
    if not api_key:
        return {"status": "skipped", "reason": "no_api_key", "segments": []}

    # Resolve the audio file path.
    if not audio_path or not os.path.exists(str(audio_path)):
        audio_path = _write_temp_wav(extract_result)
        if not audio_path:
            return {"status": "skipped", "reason": "no_audio", "segments": []}

    language = _map_language(source_language)
    sensitivity = float(os.getenv("SPEECHMATICS_SPEAKER_SENSITIVITY", "0.6"))
    prefer_current = os.getenv("SPEECHMATICS_PREFER_CURRENT_SPEAKER", "1") == "1"
    timeout_sec = float(os.getenv("SPEECHMATICS_POLL_TIMEOUT_SEC", "600"))
    base_url = os.getenv("SPEECHMATICS_BASE_URL", _DEFAULT_BASE_URL).rstrip("/")

    config = {
        "type": "transcription",
        "transcription_config": {
            "language": language,
            "operating_point": "enhanced",
            "diarization": "speaker",
            "speaker_diarization_config": {
                "speaker_sensitivity": sensitivity,
                "prefer_current_speaker": prefer_current,
            },
        },
    }
    headers = {"Authorization": f"Bearer {api_key}"}

    logger.info(
        f"[SPEECHMATICS] job={job_id} language={language} "
        f"sensitivity={sensitivity} audio={audio_path}"
    )

    # ── Submit job ──────────────────────────────────────────────────────
    try:
        with open(str(audio_path), "rb") as f:
            resp = requests.post(
                f"{base_url}/jobs/",
                headers=headers,
                files={"data_file": f},
                data={"config": json.dumps(config)},
                timeout=120,
            )
        resp.raise_for_status()
        sm_job_id = resp.json()["id"]
        logger.info(f"[SPEECHMATICS] job={job_id} submitted sm_job={sm_job_id}")
    except Exception as e:
        logger.error(f"[SPEECHMATICS] job={job_id} submit failed: {e}")
        return {"status": "skipped", "reason": "submit_failed", "segments": []}

    # ── Poll for completion ─────────────────────────────────────────────
    status = None
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        try:
            r = requests.get(f"{base_url}/jobs/{sm_job_id}", headers=headers, timeout=30)
            r.raise_for_status()
            status = r.json()["job"]["status"]
        except Exception as e:
            logger.warning(f"[SPEECHMATICS] job={job_id} poll error: {e}")
            time.sleep(5)
            continue
        if status in ("done", "rejected"):
            break
        time.sleep(5)

    if status != "done":
        logger.error(
            f"[SPEECHMATICS] job={job_id} sm_job={sm_job_id} "
            f"did not complete: status={status}"
        )
        return {"status": "skipped", "reason": f"job_status_{status}", "segments": []}

    # ── Fetch transcript ─────────────────────────────────────────────────
    try:
        r = requests.get(
            f"{base_url}/jobs/{sm_job_id}/transcript",
            headers=headers,
            params={"format": "json-v2"},
            timeout=60,
        )
        r.raise_for_status()
        transcript = r.json()
    except Exception as e:
        logger.error(f"[SPEECHMATICS] job={job_id} transcript fetch failed: {e}")
        return {"status": "skipped", "reason": "transcript_fetch_failed", "segments": []}

    # ── Parse results into segments ─────────────────────────────────────
    # Speechmatics json-v2: results[] with type="word" or "punctuation".
    # Each word has alternatives[0].content, .speaker, .confidence,
    # start_time, end_time.
    # Group consecutive same-speaker words into segments.
    results = transcript.get("results", [])

    segments: List[Dict[str, Any]] = []
    current_words: List[Dict[str, Any]] = []
    current_speaker: Optional[str] = None
    current_start: float = 0.0
    current_end: float = 0.0

    # Map Speechmatics speaker labels (S1, S2, ...) to speaker-1, speaker-2, ...
    speaker_map: Dict[str, str] = {}

    def _get_speaker_label(sm_speaker: str) -> str:
        """Map S1 -> speaker-1, S2 -> speaker-2, etc."""
        if sm_speaker not in speaker_map:
            # Extract number from "S1", "S2", etc.
            num = 1
            if sm_speaker.startswith("S") and sm_speaker[1:].isdigit():
                num = int(sm_speaker[1:])
            speaker_map[sm_speaker] = f"speaker-{num}"
        return speaker_map[sm_speaker]

    for item in results:
        item_type = item.get("type", "")
        alt = (item.get("alternatives") or [{}])[0]
        content = alt.get("content", "")
        speaker = alt.get("speaker", "UU")
        confidence = float(alt.get("confidence", 0.0))
        start = float(item.get("start_time", 0.0))
        end = float(item.get("end_time", start))

        if item_type == "word" and content:
            # New speaker turn?
            if current_speaker is not None and speaker != current_speaker:
                # Flush current segment
                if current_words:
                    segments.append(_build_segment(
                        current_words, current_speaker, current_start, current_end,
                        speaker_map, _get_speaker_label,
                    ))
                    current_words = []
                current_speaker = speaker
                current_start = start

            if not current_words:
                current_speaker = speaker
                current_start = start
            current_words.append({
                "word": content,
                "start": round(start, 3),
                "end": round(end, 3),
                "confidence": confidence,
                "speaker": speaker,
            })
            current_end = end

        elif item_type == "punctuation" and current_words:
            # Append punctuation to the last word's text
            # Speechmatics separates punctuation as its own item
            current_words[-1]["word"] += content

    # Flush final segment
    if current_words:
        segments.append(_build_segment(
            current_words, current_speaker, current_start, current_end,
            speaker_map, _get_speaker_label,
        ))

    logger.info(
        f"[SPEECHMATICS] job={job_id} produced {len(segments)} segments, "
        f"speakers={sorted(set(s['speaker'] for s in segments))}"
    )

    return {"status": "ok", "segments": segments}


def _build_segment(
    words: List[Dict[str, Any]],
    speaker_raw: str,
    start: float,
    end: float,
    speaker_map: Dict[str, str],
    label_fn,
) -> Dict[str, Any]:
    """Build a segment dict from a list of same-speaker words."""
    text = "".join(w["word"] for w in words).strip()
    confidences = [w["confidence"] for w in words if w.get("confidence") is not None]
    avg_confidence = sum(confidences) / len(confidences) if confidences else 0.0
    speaker = label_fn(speaker_raw)

    return {
        "start": round(start, 3),
        "end": round(end, 3),
        "text": text,
        "speaker": speaker,
        "confidence": round(avg_confidence, 4),
        "source": "speechmatics",
        "words": words,
    }


def _write_temp_wav(extract_result: Dict[str, Any]) -> Optional[str]:
    """Write the audio tensor from extract_result to a temp WAV file."""
    import tempfile
    try:
        import soundfile as sf
        import numpy as np

        audio = extract_result["audio"]
        sample_rate = extract_result["sample_rate"]
        waveform = audio.squeeze().cpu().numpy()

        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        sf.write(tmp.name, waveform, sample_rate)
        tmp.close()
        return tmp.name
    except Exception as e:
        logger.error(f"[SPEECHMATICS] Failed to write temp WAV: {e}")
        return None
