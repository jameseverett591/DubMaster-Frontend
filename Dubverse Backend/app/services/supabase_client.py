import hashlib
import logging
import os
import threading
import time

from fastapi import HTTPException
from supabase import create_client, Client

logger = logging.getLogger(__name__)

_SUPABASE_URL = os.environ.get("SUPABASE_URL")
_SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY")
_SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not _SUPABASE_URL:
    raise RuntimeError("SUPABASE_URL environment variable is not set")
if not _SUPABASE_ANON_KEY:
    raise RuntimeError("SUPABASE_ANON_KEY environment variable is not set")

supabase: Client = create_client(_SUPABASE_URL, _SUPABASE_ANON_KEY)
if not _SUPABASE_SERVICE_ROLE_KEY:
    logger.warning("SUPABASE_SERVICE_ROLE_KEY not set — segment writes will fail RLS")
supabase_writer: Client = (
    create_client(_SUPABASE_URL, _SUPABASE_SERVICE_ROLE_KEY)
    if _SUPABASE_SERVICE_ROLE_KEY
    else supabase
)


# Verified tokens, cached briefly. Every guarded route calls verify_jwt, and
# some call it twice (route dependency + an inline check inside the handler),
# so an uncached implementation costs two Supabase round trips on hot paths
# like segment regenerate. 60s is short enough that a revoked session stops
# working almost immediately, long enough to collapse the duplicate calls.
#
# Only SUCCESSES are cached. Caching failures would let one bad request pin a
# 401 for a token that has since become valid.
_JWT_TTL_SECONDS = 60
_jwt_cache: "dict[str, tuple[float, str]]" = {}
_jwt_cache_lock = threading.Lock()


def verify_jwt(token: str) -> str:
    """Validate a Supabase JWT and return the verified user_id.

    Raises HTTPException(401) if the token is missing, invalid, or expired.
    """
    if not token:
        raise HTTPException(status_code=401, detail="Missing authentication token")

    now = time.time()
    key = hashlib.sha256(token.encode("utf-8")).hexdigest()  # don't hold raw tokens in memory
    with _jwt_cache_lock:
        hit = _jwt_cache.get(key)
        if hit and hit[0] > now:
            return hit[1]

    try:
        response = supabase.auth.get_user(token)
        if not response or not response.user:
            raise HTTPException(status_code=401, detail="Invalid or expired token")
        user_id = str(response.user.id)
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning(f"JWT verification failed: {exc}")
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    with _jwt_cache_lock:
        _jwt_cache[key] = (now + _JWT_TTL_SECONDS, user_id)
        if len(_jwt_cache) > 2048:   # bounded; drop whatever has already expired
            for k, (exp, _) in list(_jwt_cache.items()):
                if exp <= now:
                    _jwt_cache.pop(k, None)
    return user_id


async def upsert_segments(job_id: str, segments: list) -> None:
    """Upsert all segments for a job to Supabase. Never raises.

    `sequence` stores each segment's stable `transcript_index`, not its current
    array position. Splits can insert a segment anywhere in the array while
    giving it a fresh, unrelated transcript_index (see sync_segments in
    routes.py), so array position drifts from transcript_index over a job's
    life. Every other segment lookup (regenerate_segment, reset_segment,
    commit_segment_timing) matches by transcript_index — sequence must mean
    the same thing, or updates silently land on the wrong Supabase row.
    """
    try:
        if os.environ.get("PERSIST_JOBS", "1") != "1":
            return
        rows = []
        for i, seg in enumerate(segments):
            rows.append({
                "job_id": job_id,
                "sequence": seg.get("transcript_index", i),
                "speaker": seg.get("speaker", "speaker-1"),
                "start_time": seg.get("start", 0.0),
                "end_time": seg.get("end", 0.0),
                "source_text": seg.get("text", ""),
                "translated_text": seg.get("translated_text"),
                "adapted_text": seg.get("adapted_text"),
                "adaptation_variant": seg.get("adaptation_variant"),
                "emotion_tag": seg.get("emotion"),
                "tts_audio_path": seg.get("tts_audio_path"),
                "is_locked": seg.get("locked", False),
                "confidence": seg.get("confidence"),
                "confidence_tier": seg.get("confidence_tier"),
                "flags": seg.get("flags", []),
                "flag_status": seg.get("flag_status", "unreviewed"),
                "correction_type": seg.get("correction_type"),
            })
        if rows:
            supabase_writer.table("segments").upsert(
                rows,
                on_conflict="job_id,sequence"
            ).execute()
    except Exception as exc:
        logger.warning(f"Job {job_id}: segments upsert failed: {exc}")


async def upsert_job_speakers(
    job_id: str,
    speaker_genders: dict,
    voice_mapping: dict | None
) -> None:
    """Upsert speaker rows for a job to Supabase. Never raises."""
    try:
        if os.environ.get("PERSIST_JOBS", "1") != "1":
            return
        rows = []
        for label, gender in (speaker_genders or {}).items():
            rows.append({
                "job_id": job_id,
                "speaker_label": label,
                "gender": gender,
                "voice_id": (voice_mapping or {}).get(label),
            })
        if rows:
            supabase_writer.table("job_speakers").upsert(
                rows,
                on_conflict="job_id,speaker_label"
            ).execute()
    except Exception as exc:
        logger.warning(f"Job {job_id}: job_speakers upsert failed: {exc}")


async def sync_committed_segments_to_disk(
    job_id: str,
    segments_path: str,
    dubbed_dir: str,
) -> bool:
    """Read committed segment fields from Supabase and merge them
    into the on-disk segments.json before a rebuild runs.

    Returns True if at least one committed segment was applied,
    False if nothing was updated (caller can still proceed with
    existing segments.json as fallback).
    """
    try:
        import json, os
        response = (
            supabase.table("segments")
            .select(
                "sequence, committed_audio_url, committed_start_time, "
                "committed_end_time, committed_adapted_text, "
                "committed_voice_id, committed_speed, committed_emotion, "
                "rpt_dirty"
            )
            .eq("job_id", job_id)
            .execute()
        )
        rows = response.data or []
        if not rows:
            return False

        if not os.path.exists(segments_path):
            return False

        with open(segments_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        segments = data.get("segments", [])
        applied = 0

        for row in rows:
            idx = row.get("sequence")
            if idx is None:
                continue
            # sequence == transcript_index (a stable id), not array position —
            # match by field, not raw list index. See upsert_segments docstring.
            seg = next((s for s in segments if s.get("transcript_index") == idx), None)
            if seg is None:
                continue

            # Audio path — convert URL to local disk path
            committed_url = row.get("committed_audio_url")
            if committed_url:
                filename = committed_url.split("/")[-1]
                local_path = os.path.join(dubbed_dir, job_id, filename)
                if os.path.exists(local_path):
                    seg["path"] = local_path
                    applied += 1

            # Timing — apply committed values if present
            if row.get("committed_start_time") is not None:
                seg["start"] = row["committed_start_time"]
            if row.get("committed_end_time") is not None:
                seg["end"] = row["committed_end_time"]

            # Text
            if row.get("committed_adapted_text"):
                seg["text"] = row["committed_adapted_text"]

        data["segments"] = segments
        data["rpt_synced_at"] = __import__("datetime").datetime.utcnow().isoformat() + "Z"

        with open(segments_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

        logger.info(
            f"Job {job_id}: synced {applied} committed segments "
            f"from Supabase to disk before rebuild"
        )
        return applied > 0

    except Exception as exc:
        logger.warning(f"Job {job_id}: Supabase segment sync failed: {exc}")
        return False
