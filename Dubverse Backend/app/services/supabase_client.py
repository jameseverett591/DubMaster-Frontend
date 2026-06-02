import logging
import os

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


def verify_jwt(token: str) -> str:
    """Validate a Supabase JWT and return the verified user_id.

    Raises HTTPException(401) if the token is missing, invalid, or expired.
    """
    if not token:
        raise HTTPException(status_code=401, detail="Missing authentication token")
    try:
        response = supabase.auth.get_user(token)
        if not response or not response.user:
            raise HTTPException(status_code=401, detail="Invalid or expired token")
        return str(response.user.id)
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning(f"JWT verification failed: {exc}")
        raise HTTPException(status_code=401, detail="Invalid or expired token")


async def upsert_segments(job_id: str, segments: list) -> None:
    """Upsert all segments for a job to Supabase. Never raises."""
    try:
        if os.environ.get("PERSIST_JOBS", "1") != "1":
            return
        rows = []
        for i, seg in enumerate(segments):
            rows.append({
                "job_id": job_id,
                "sequence": i,
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
            if idx is None or idx >= len(segments):
                continue
            seg = segments[idx]

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
