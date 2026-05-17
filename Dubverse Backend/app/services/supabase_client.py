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
