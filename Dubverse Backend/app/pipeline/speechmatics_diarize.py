"""
Speechmatics diarization for Cantonese/Mandarin jobs.

Confirmed 2026-09-08 against the Ip Man 2 test clip: pyannote (via
diarize_audio.py) and Deepgram's own diarization (both utterance- and
word-level) all collapsed a real two-speaker exchange -- a countryman's
continuous speech with a brief "thank you" interjection from Ip Man -- into
one speaker label. Speechmatics exposes a tunable speaker_sensitivity knob
neither pyannote's clustering nor Deepgram's diarization offers, and showed
genuine speaker alternation in the same window during manual testing.

We use Speechmatics ONLY for its diarization signal (speaker + word
timing). Its own transcribed text is discarded -- a same-audio comparison
found Deepgram's Cantonese transcription noticeably more accurate than
Speechmatics' on this content. This module returns the same
{"status", "segments": [{"speaker", "start", "end"}]} shape that
diarize_audio() (pyannote) already returns, so it feeds into the exact same
downstream reconciliation path (handler.py's _assign_and_split_segments /
_split_segment_by_diarization) without any change there.
"""

import json
import logging
import os
import time
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_BASE_URL = "https://eu1.asr.api.speechmatics.com/v2"

# Speechmatics language codes differ from Deepgram's -- yue is Cantonese,
# cmn is Mandarin (Deepgram uses zh/zh-HK/zh-CN style codes for the same).
_LANG_MAP = {
    "yue": "yue", "zh-yue": "yue", "yue-hk": "yue", "zh-hk": "yue",
    "zh": "cmn", "cmn": "cmn", "zho": "cmn", "zh-cn": "cmn", "zh-tw": "cmn",
}


def _get_api_key() -> Optional[str]:
    key = (os.getenv("SPEECHMATICS_API_KEY") or "").strip()
    if not key:
        logger.warning("[SPEECHMATICS-DIARIZE] No SPEECHMATICS_API_KEY set — skipping")
        return None
    return key


def _map_language(source_language: Optional[str]) -> str:
    lang = (source_language or "").lower().strip().replace("_", "-")
    return _LANG_MAP.get(lang, "yue")


def diarize_with_speechmatics(
    audio_path: str,
    job_id: Optional[str] = None,
    source_language: Optional[str] = None,
    poll_timeout_sec: Optional[float] = None,
) -> Dict[str, Any]:
    """Run Speechmatics batch diarization and return pyannote-shaped turns.

    Never raises -- diarization failure here is handled the same way
    pyannote's failure already is upstream (caller falls back).
    """
    import requests

    api_key = _get_api_key()
    if not api_key:
        return {"status": "skipped", "reason": "no_api_key", "segments": []}

    if not audio_path or not os.path.exists(str(audio_path)):
        return {"status": "skipped", "reason": "no_audio", "segments": []}

    language = _map_language(source_language)
    sensitivity = float(os.getenv("SPEECHMATICS_SPEAKER_SENSITIVITY", "0.6"))
    timeout_sec = poll_timeout_sec or float(os.getenv("SPEECHMATICS_POLL_TIMEOUT_SEC", "600"))

    config = {
        "type": "transcription",
        "transcription_config": {
            "language": language,
            "operating_point": "enhanced",
            "diarization": "speaker",
            "speaker_diarization_config": {
                "speaker_sensitivity": sensitivity,
            },
        },
    }
    headers = {"Authorization": f"Bearer {api_key}"}

    try:
        with open(str(audio_path), "rb") as f:
            resp = requests.post(
                f"{_BASE_URL}/jobs/",
                headers=headers,
                files={"data_file": f},
                data={"config": json.dumps(config)},
                timeout=120,
            )
        resp.raise_for_status()
        sm_job_id = resp.json()["id"]
        logger.info(f"[SPEECHMATICS-DIARIZE] job={job_id} submitted sm_job={sm_job_id} language={language}")
    except Exception as e:
        logger.error(f"[SPEECHMATICS-DIARIZE] job={job_id} submit failed: {e}")
        return {"status": "skipped", "reason": "submit_failed", "segments": []}

    status = None
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        try:
            r = requests.get(f"{_BASE_URL}/jobs/{sm_job_id}", headers=headers, timeout=30)
            r.raise_for_status()
            status = r.json()["job"]["status"]
        except Exception as e:
            logger.warning(f"[SPEECHMATICS-DIARIZE] job={job_id} poll error: {e}")
            time.sleep(5)
            continue
        if status in ("done", "rejected"):
            break
        time.sleep(5)

    if status != "done":
        logger.error(f"[SPEECHMATICS-DIARIZE] job={job_id} sm_job={sm_job_id} did not complete: status={status}")
        return {"status": "skipped", "reason": f"job_status_{status}", "segments": []}

    try:
        r = requests.get(
            f"{_BASE_URL}/jobs/{sm_job_id}/transcript",
            headers=headers,
            params={"format": "json-v2"},
            timeout=60,
        )
        r.raise_for_status()
        transcript = r.json()
    except Exception as e:
        logger.error(f"[SPEECHMATICS-DIARIZE] job={job_id} transcript fetch failed: {e}")
        return {"status": "skipped", "reason": "transcript_fetch_failed", "segments": []}

    results = transcript.get("results", [])

    # Merge consecutive same-speaker word items into turns -- same shape
    # pyannote's diarize_audio() returns.
    turns: List[Dict[str, Any]] = []
    for item in results:
        if item.get("type") != "word":
            continue
        alt = (item.get("alternatives") or [{}])[0]
        speaker = alt.get("speaker")
        if speaker is None:
            continue
        start = float(item.get("start_time", 0.0))
        end = float(item.get("end_time", start))
        if turns and turns[-1]["speaker"] == speaker and start <= turns[-1]["end"] + 0.25:
            turns[-1]["end"] = max(turns[-1]["end"], end)
        else:
            turns.append({"speaker": speaker, "start": round(start, 3), "end": round(end, 3)})

    unique_speakers = sorted(set(t["speaker"] for t in turns))
    logger.info(
        f"[SPEECHMATICS-DIARIZE] job={job_id} complete: {len(turns)} turns, "
        f"{len(unique_speakers)} speakers: {unique_speakers}"
    )

    return {"status": "ok", "segments": turns}
