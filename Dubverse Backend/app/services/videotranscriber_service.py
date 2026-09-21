"""
VideoTranscriber.ai OpenAPI integration — primary provider for the Summary
panel's whole-video notes + chapter cards.

Their API is async and task-based:
    POST /transcriptions {source_url, features.chapters}  -> request_id
    GET  /transcriptions/{request_id}                     -> status
    GET  /transcriptions/{request_id}/result              -> transcript+chapters

The media must be a PUBLIC URL — we hand them the same PUBLIC_BASE_URL media
route Sync Labs uses, with the caller's JWT travelling as ?access_token=.

Billing: transcribe 1 quota/min + chapters 1 quota/min, so a task is created
once per job and reused across presets — vt_task.json holds the request id.

Never raises into the route — every failure degrades to a status dict so the
caller can fall back to the Claude path.
"""

import json
import logging
import os
from typing import Any, Dict, List, Optional

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

DEFAULT_BASE_URL = "https://videotranscriber.ai/openapi/v1"


def is_configured() -> bool:
    s = get_settings()
    return bool(s.VT_API_KEY.strip() and s.PUBLIC_BASE_URL.strip())


def _headers() -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {get_settings().VT_API_KEY.strip()}",
        "Content-Type": "application/json",
    }


def _base() -> str:
    return (os.getenv("VT_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")


def _task_state_path(job_id: str) -> str:
    return os.path.join(get_settings().DUBBED_DIR, job_id, "vt_task.json")


def load_task_state(job_id: str) -> Optional[Dict[str, Any]]:
    path = _task_state_path(job_id)
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            state = json.load(f)
        return state if state.get("request_id") else None
    except Exception:
        return None


def _save_task_state(job_id: str, state: Dict[str, Any]) -> None:
    path = _task_state_path(job_id)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def create_task(job_id: str, source_url: str) -> Dict[str, Any]:
    """Submit the job video for transcription + chapters.

    Idempotent per job: reuses a live task from vt_task.json when one exists
    so re-polls and preset switches never double-bill.
    """
    existing = load_task_state(job_id)
    if existing and existing.get("status") not in ("failed", "cancelled"):
        return {"status": "ok", "request_id": existing["request_id"], "reused": True}

    payload = {
        "source_url": source_url,
        "language": "auto",
        "speaker_diarization": True,
        "features": {"chapters": True},
    }
    try:
        resp = httpx.post(
            f"{_base()}/transcriptions",
            json=payload,
            headers={**_headers(), "Idempotency-Key": f"dubmaster-{job_id}"},
            timeout=30,
        )
    except Exception as e:
        logger.warning(f"[VT] job={job_id} create request failed: {e}")
        return {"status": "error", "reason": str(e)}

    if resp.status_code not in (200, 201, 202):
        logger.warning(f"[VT] job={job_id} create failed: {resp.status_code} {resp.text[:200]}")
        reason = f"http_{resp.status_code}"
        try:
            reason = resp.json().get("error", {}).get("code") or reason
        except Exception:
            pass
        return {"status": "error", "reason": reason}

    data = resp.json()
    request_id = data.get("request_id")
    if not request_id:
        return {"status": "error", "reason": "no_request_id"}

    _save_task_state(job_id, {"request_id": request_id, "status": data.get("status", "queued")})
    return {"status": "ok", "request_id": request_id, "retry_after": data.get("retry_after", 5)}


def get_task_status(job_id: str, request_id: str) -> Dict[str, Any]:
    try:
        resp = httpx.get(
            f"{_base()}/transcriptions/{request_id}",
            headers=_headers(),
            timeout=20,
        )
    except Exception as e:
        logger.warning(f"[VT] job={job_id} status request failed: {e}")
        return {"status": "error", "reason": str(e)}

    if resp.status_code != 200:
        reason = f"http_{resp.status_code}"
        try:
            reason = resp.json().get("error", {}).get("code") or reason
        except Exception:
            pass
        return {"status": "error", "reason": reason,
                "terminal": resp.status_code in (400, 401, 402, 403, 404, 409)}

    data = resp.json()
    state = load_task_state(job_id) or {}
    state.update({"request_id": request_id, "status": data.get("status")})
    _save_task_state(job_id, state)
    return {"status": "ok", "task": data}


def get_task_result(job_id: str, request_id: str) -> Dict[str, Any]:
    try:
        resp = httpx.get(
            f"{_base()}/transcriptions/{request_id}/result",
            headers=_headers(),
            timeout=30,
        )
    except Exception as e:
        logger.warning(f"[VT] job={job_id} result request failed: {e}")
        return {"status": "error", "reason": str(e)}

    if resp.status_code != 200:
        return {"status": "error", "reason": f"http_{resp.status_code}"}
    return {"status": "ok", "result": resp.json()}


def map_result(result: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize a VT result into the pieces the video-notes route needs.

    Returns:
        segments: VT transcript mapped to our segment shape {start, end, text,
                  speaker} so the Claude preset layer can summarize over their
                  (usually cleaner) ASR instead of ours.
        chapters: our VideoChapter shape {title, start, end, summary}.
    """
    # Schema tolerance: docs pin down content, not field names — accept the
    # common variants rather than dying on a rename.
    def _dig(obj: Any, *keys: str) -> Any:
        for k in keys:
            if isinstance(obj, dict) and obj.get(k) is not None:
                return obj[k]
        return None

    def _secs(v: Any) -> Optional[float]:
        if isinstance(v, (int, float)):
            # ms timestamps arrive > duration scale — treat big values as ms
            return float(v) / 1000.0 if float(v) > 36000 else float(v)
        return None

    inner = result.get("result") if isinstance(result.get("result"), dict) else result
    transcript = _dig(inner, "transcript") or {}
    raw_segments = _dig(transcript, "segments", "utterances", "items") or []
    segments: List[Dict[str, Any]] = []
    for seg in raw_segments:
        text = (seg.get("text") or seg.get("transcript") or "").strip()
        if not text:
            continue
        segments.append({
            "start": _secs(_dig(seg, "start", "start_time", "start_seconds")) or 0.0,
            "end": _secs(_dig(seg, "end", "end_time", "end_seconds")) or 0.0,
            "text": text,
            "speaker": seg.get("speaker") or seg.get("speaker_label"),
        })

    raw_chapters = _dig(inner, "chapters")
    if isinstance(raw_chapters, dict):
        raw_chapters = raw_chapters.get("chapters") or raw_chapters.get("items") or []
    chapters: List[Dict[str, Any]] = []
    for c in raw_chapters or []:
        title = str(c.get("title") or c.get("heading") or "").strip()
        summary = str(c.get("summary") or c.get("description") or "").strip()
        if not title and not summary:
            continue
        chapters.append({
            "title": title,
            "start": _secs(_dig(c, "start", "start_time", "start_seconds")),
            "end": _secs(_dig(c, "end", "end_time", "end_seconds")),
            "summary": summary,
        })

    return {
        "segments": segments,
        "chapters": chapters,
        "language": _dig(transcript, "language", "detected_language"),
        "duration": _secs(_dig(transcript, "duration", "duration_seconds")),
    }
