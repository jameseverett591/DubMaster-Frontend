import logging
import os

from fastapi import HTTPException
from supabase import create_client, Client

logger = logging.getLogger(__name__)

_SUPABASE_URL = os.environ.get("SUPABASE_URL")
_SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY")

if not _SUPABASE_URL:
    raise RuntimeError("SUPABASE_URL environment variable is not set")
if not _SUPABASE_ANON_KEY:
    raise RuntimeError("SUPABASE_ANON_KEY environment variable is not set")

supabase: Client = create_client(_SUPABASE_URL, _SUPABASE_ANON_KEY)


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
            supabase.table("segments").upsert(
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
        rows = []
        for label, gender in (speaker_genders or {}).items():
            rows.append({
                "job_id": job_id,
                "speaker_label": label,
                "gender": gender,
                "voice_id": (voice_mapping or {}).get(label),
            })
        if rows:
            supabase.table("job_speakers").upsert(
                rows,
                on_conflict="job_id,speaker_label"
            ).execute()
    except Exception as exc:
        logger.warning(f"Job {job_id}: job_speakers upsert failed: {exc}")
