"""Monthly dubbing-minute accounting against Supabase `usage`.

Minutes are RESERVED when a job is accepted and REFUNDED if it ends in FAILED
or CANCELLED — the user gets that time back. Reserving up front is what stops a
job starting that the pool can't cover; refunding is what stops our own
infrastructure failures costing the customer minutes.

The row is per user per month (`month` is the first of the month), matching what
the dashboard already reads.

Every function here is best-effort and never raises: a dub must not fail because
accounting hiccuped. The trade-off is deliberate — under-billing on an outage is
cheaper than a failed delivery.
"""

import logging
import math
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)


def _current_month() -> str:
    """First of the current month, as the `usage` table keys it."""
    now = datetime.now(timezone.utc)
    return f"{now.year:04d}-{now.month:02d}-01"


def minutes_for(duration_seconds: float) -> int:
    """Billable minutes for a video, rounded UP.

    Whole minutes, because fractional-minute accounting invites rounding
    arguments and every competitor bills this way.
    """
    if not duration_seconds or duration_seconds <= 0:
        return 0
    return max(1, math.ceil(duration_seconds / 60.0))


def _fetch_row(user_id: str, month: str):
    from app.services.supabase_client import supabase_writer
    res = supabase_writer.table("usage") \
        .select("id, minutes_used") \
        .eq("user_id", user_id) \
        .eq("month", month) \
        .limit(1) \
        .execute()
    return res.data[0] if res.data else None


def get_used_minutes(user_id: str) -> int:
    """Minutes consumed this month. 0 when there's no row or the read fails."""
    try:
        row = _fetch_row(user_id, _current_month())
        return int(row["minutes_used"]) if row else 0
    except Exception as e:
        logger.warning(f"[USAGE] read failed for {user_id}: {e}")
        return 0


def adjust(user_id: str, delta_minutes: int) -> bool:
    """Add (or, with a negative delta, return) minutes for the current month.

    Creates the month's row if it doesn't exist yet — a user can dub before
    any subscription webhook has initialised one. Never lets the total go
    below zero, so a double refund can't mint minutes.
    """
    # A missing user_id is a FAILURE, not a no-op success. Returning True here
    # meant a refund to an ownerless job reported success while crediting
    # nobody, and the caller cleared the claim on the strength of it.
    if not user_id:
        logger.error(f"[USAGE] adjust({delta_minutes}) with no user_id — nobody to credit")
        return False
    if not delta_minutes:
        return True
    month = _current_month()
    try:
        from app.services.supabase_client import supabase_writer
        row = _fetch_row(user_id, month)
        if row is None:
            new_total = max(0, delta_minutes)
            supabase_writer.table("usage").insert({
                "user_id": user_id, "month": month, "minutes_used": new_total,
            }).execute()
        else:
            new_total = max(0, int(row["minutes_used"]) + delta_minutes)
            supabase_writer.table("usage").update({
                "minutes_used": new_total,
            }).eq("id", row["id"]).execute()
        verb = "reserved" if delta_minutes > 0 else "refunded"
        logger.info(
            f"[USAGE] {verb} {abs(delta_minutes)} min for {user_id} "
            f"({month}: now {new_total})"
        )
        return True
    except Exception as e:
        logger.warning(f"[USAGE] adjust({delta_minutes}) failed for {user_id}: {e}")
        return False
