"""Render metering: included monthly minutes + prepaid credit wallet.

One paid plan (Pro, 30 min/month included) and a free tier (3 min/month).
Pro REPLACES free — it does not stack. Anyone may deposit into the wallet
($10 minimum) and render at $2.50/min once included minutes are gone. Wallet
credit never expires. Only the Make Movie render is metered; every other
feature is free for every user.

All arithmetic is in SECONDS; a render is billed ceil(video_duration). The
first render of a job is charged and stamped on jobs.billed_seconds; later
renders of the same job are free — the review/correct loop is the product.

The ledger lives in Postgres and every mutation goes through a SECURITY
DEFINER RPC (supabase/migrations/20260912_user_quota.sql) so a debit is
atomic: two Make Movie clicks racing each other cannot both pass a check
and both render on one balance.

Unlike usage_service, this module FAILS CLOSED. A paid render must not be
given away because the ledger was unreachable — a Supabase outage produces
QuotaUnavailable (-> HTTP 503), not a free movie. Read-only helpers still
degrade gracefully so the UI can render.
"""

from __future__ import annotations

import logging
import math
import os
import re
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# --- Pricing constants -------------------------------------------------------
CENTS_PER_MINUTE = 250          # $2.50 / min
MIN_DEPOSIT_CENTS = 1000        # $10
FREE_INCLUDED_SECONDS = 180     # 3 min / month
PRO_INCLUDED_SECONDS = 1800     # 30 min / month
LOW_BALANCE_SECONDS = 300       # UI warns under 5 min total

TIER_FREE = "free"
TIER_PRO = "pro"

LIPSYNC_MARKUP = 1.25           # vendor cost + 25% platform fee

# Accounts that are never billed — owner/tester ids running the system end to
# end (rebuilds, exports, lip-sync) without paying themselves. Comma-separated
# Supabase user ids via BILLING_BYPASS_USER_IDS. The ledger is untouched for
# these callers: no debit rows, no refund rows, nothing to reconcile.
_BYPASS_USER_IDS = {
    u.strip() for u in os.environ.get("BILLING_BYPASS_USER_IDS", "").split(",")
    if u.strip()
}


def is_billing_bypassed(user_id: str) -> bool:
    return bool(user_id) and user_id in _BYPASS_USER_IDS


class QuotaExceeded(Exception):
    """Included minutes and wallet together cannot cover the render."""

    def __init__(self, needed_seconds: int, shortfall_seconds: int):
        self.needed_seconds = needed_seconds
        self.shortfall_seconds = shortfall_seconds
        self.shortfall_cents = cents_for_seconds(shortfall_seconds)
        super().__init__(
            f"need {needed_seconds}s, short by {shortfall_seconds}s "
            f"(${self.shortfall_cents / 100:.2f})"
        )


class QuotaUnavailable(Exception):
    """The ledger could not be reached or the RPC is missing. Fail closed."""


# --- Pure math ---------------------------------------------------------------

def seconds_for(duration_seconds: Optional[float]) -> int:
    """Billable seconds for a video: ceil, minimum 1."""
    if not duration_seconds or duration_seconds <= 0:
        return 0
    return max(1, math.ceil(duration_seconds))


def seconds_for_cents(cents: int) -> int:
    """Wallet seconds a deposit buys. 1000c -> 240s (4 min)."""
    return int(math.floor(max(0, cents) * 60.0 / CENTS_PER_MINUTE))


def cents_for_seconds(seconds: int) -> int:
    """Cost of `seconds` at the wallet rate, rounded up to the cent."""
    return int(math.ceil(max(0, seconds) * CENTS_PER_MINUTE / 60.0))


def included_seconds_for(tier: str) -> int:
    return PRO_INCLUDED_SECONDS if tier == TIER_PRO else FREE_INCLUDED_SECONDS


def seconds_for_lipsync(duration_seconds: float, cost_per_second_usd: float) -> int:
    """Wallet-equivalent seconds for a lip-sync pass.

    The vendor bills in USD (duration x rate); the wallet holds seconds at
    CENTS_PER_MINUTE, so the USD price (with platform markup) is converted to
    its second-equivalent. Synclabs at $0.05/s lands at 1.5s billed per
    video-second. Rounds UP — a charge must never under-bill.
    """
    cents = max(0.0, duration_seconds) * max(0.0, cost_per_second_usd) * LIPSYNC_MARKUP * 100.0
    return int(math.ceil(cents * 60.0 / CENTS_PER_MINUTE))


# --- Tier ----------------------------------------------------------------------

def tier_for(user_id: str, strict: bool = False) -> str:
    """'pro' when the user has an active/trialing subscription, else 'free'.

    During the migration off the three legacy tiers, ANY active subscription
    counts as Pro — a Basic/Premium subscriber whose product was archived is
    still paying, and there is only one paid tier to map them to.

    strict=True (billing paths): a failed lookup raises QuotaUnavailable
    instead of returning 'free' — debiting a Pro user at free-tier rates on a
    flaky read burns their paid wallet for what their plan included.
    """
    try:
        from app.services.supabase_client import supabase_writer
        res = (
            supabase_writer.table("subscriptions")
            .select("plan_type")
            .eq("user_id", user_id)
            .in_("status", ["active", "trialing"])
            .limit(1)
            .execute()
        )
        return TIER_PRO if res.data else TIER_FREE
    except Exception as e:
        if strict:
            raise QuotaUnavailable(f"tier lookup failed: {e}") from e
        # Read failure: the safe direction for the CUSTOMER is pro (more
        # included minutes); the safe direction for US is free. Choose free —
        # the wallet still works, so a paying user is never fully blocked,
        # and get_balance flags the degraded read.
        logger.warning(f"[QUOTA] tier lookup failed for {user_id}: {e}")
        return TIER_FREE


# --- RPC plumbing ---------------------------------------------------------------

_SHORTFALL_RE = re.compile(r"need (\d+) more seconds")


def _rpc(name: str, params: Dict[str, Any]):
    from app.services.supabase_client import supabase_writer
    return supabase_writer.rpc(name, params).execute()


def _first(res) -> Dict[str, Any]:
    data = res.data
    if isinstance(data, list):
        return data[0] if data else {}
    return data or {}


# --- Public API -----------------------------------------------------------------

def get_balance(user_id: str) -> Dict[str, Any]:
    """Balance for the UI. Never raises; a failed read returns zeros with
    `available: False` so the widget can say so instead of showing 0 min."""
    if is_billing_bypassed(user_id):
        return {
            # Report the REAL tier — usePlan reads tier off this response and a
            # synthetic value would strip Pro from a bypassed Pro account.
            "tier": tier_for(user_id), "included_seconds": 0,
            "included_remaining_seconds": 10 ** 9,
            "credit_balance_seconds": 0, "credit_balance_cents": 0,
            "total_remaining_seconds": 10 ** 9,
            "low_balance": False, "period_start": None,
            "rate_cents_per_minute": CENTS_PER_MINUTE,
            "min_deposit_cents": MIN_DEPOSIT_CENTS,
            "bypassed": True, "available": True,
        }
    tier = tier_for(user_id)
    try:
        row = _first(_rpc("quota_touch", {"p_user_id": user_id, "p_tier": tier}))
    except Exception as e:
        logger.warning(f"[QUOTA] balance read failed for {user_id}: {e}")
        return {
            "available": False, "tier": tier,
            "included_seconds": included_seconds_for(tier), "included_used_seconds": 0,
            "included_remaining_seconds": 0, "credit_balance_seconds": 0,
            "credit_balance_cents": 0, "total_remaining_seconds": 0,
            "low_balance": True, "period_start": None,
        }
    cap = included_seconds_for(tier)
    used = int(row.get("included_seconds_used") or 0)
    remaining = max(0, cap - used)
    credit = int(row.get("credit_balance_seconds") or 0)
    return {
        "available": True,
        "tier": tier,
        "included_seconds": cap,
        "included_used_seconds": used,
        "included_remaining_seconds": remaining,
        "credit_balance_seconds": credit,
        "credit_balance_cents": cents_for_seconds(credit),
        "total_remaining_seconds": remaining + credit,
        "low_balance": (remaining + credit) < LOW_BALANCE_SECONDS,
        "period_start": row.get("period_start"),
        "rate_cents_per_minute": CENTS_PER_MINUTE,
        "min_deposit_cents": MIN_DEPOSIT_CENTS,
    }


def check_quota(user_id: str, estimated_seconds: int) -> Dict[str, Any]:
    """Pre-flight for the Make Movie confirmation. Read-only.

    Returns the split the render WOULD take and whether it can proceed. The
    authoritative decision is deduct_quota — this is for showing the user
    the cost before they commit.
    """
    bal = get_balance(user_id)
    need = int(estimated_seconds or 0)
    from_included = min(need, bal["included_remaining_seconds"])
    from_credit = need - from_included
    shortfall = max(0, from_credit - bal["credit_balance_seconds"])
    return {
        "ok": bal["available"] and shortfall == 0,
        "ledger_available": bal["available"],
        "needed_seconds": need,
        "from_included_seconds": from_included,
        "from_credit_seconds": from_credit,
        "from_credit_cents": cents_for_seconds(from_credit),
        "shortfall_seconds": shortfall,
        "shortfall_cents": cents_for_seconds(shortfall),
        "balance": bal,
    }


def deduct_quota(user_id: str, actual_seconds: int, job_id: str, kind: str = "render") -> Dict[str, Any]:
    """Atomically debit a render or lip-sync pass. Raises QuotaExceeded /
    QuotaUnavailable. `kind` lands on the ledger row ('render'|'lipsync') so
    billing history is readable without parsing job_id."""
    if not user_id:
        raise QuotaUnavailable("no user_id to bill")
    need = int(actual_seconds or 0)
    if need <= 0:
        return {"included_seconds": 0, "credit_seconds": 0}
    if is_billing_bypassed(user_id):
        logger.info(f"[QUOTA] {user_id} job={job_id}: bypassed account — {kind} {need}s not debited")
        return {"included_seconds": 0, "credit_seconds": 0,
                "tier": "bypassed", "billed_seconds": need, "bypassed": True}
    # strict: a Pro user misread as free would burn paid wallet seconds for
    # what their subscription included. No debit on an unknown tier.
    tier = tier_for(user_id, strict=True)
    try:
        row = _first(_rpc("quota_deduct", {
            "p_user_id": user_id, "p_tier": tier,
            "p_seconds": need, "p_job_id": job_id,
            "p_kind": kind,
        }))
    except Exception as e:
        msg = str(e)
        if "quota_exceeded" in msg:
            m = _SHORTFALL_RE.search(msg)
            short = int(m.group(1)) if m else need
            logger.info(f"[QUOTA] {user_id} job={job_id}: exceeded, short {short}s")
            raise QuotaExceeded(need, short) from e
        logger.error(f"[QUOTA] deduct failed for {user_id} job={job_id}: {e}")
        raise QuotaUnavailable(msg) from e
    if row.get("already_billed"):
        logger.info(
            f"[QUOTA] {user_id} job={job_id}: {kind} already debited "
            f"({row.get('included_seconds', 0)}s incl + {row.get('credit_seconds', 0)}s wallet) — no double charge"
        )
    else:
        logger.info(
            f"[QUOTA] {user_id} job={job_id}: -{row.get('included_seconds', 0)}s included, "
            f"-{row.get('credit_seconds', 0)}s wallet (tier={tier})"
        )
    return {**row, "tier": tier, "billed_seconds": need}


def refund_quota(user_id: str, job_id: str) -> Dict[str, Any]:
    """Reverse a job's render charge (render failed after debit). Idempotent.
    Best-effort: a failed refund is logged loudly, not raised — the render
    already failed, and a second exception hides the first."""
    if not user_id:
        return {"included_seconds": 0, "credit_seconds": 0}
    try:
        row = _first(_rpc("quota_refund", {"p_user_id": user_id, "p_job_id": job_id}))
        logger.info(
            f"[QUOTA] {user_id} job={job_id}: refunded {row.get('included_seconds', 0)}s "
            f"included, {row.get('credit_seconds', 0)}s wallet"
        )
        return row
    except Exception as e:
        logger.error(f"[QUOTA] REFUND FAILED for {user_id} job={job_id}: {e} — manual credit needed")
        return {"included_seconds": 0, "credit_seconds": 0, "error": str(e)}


def add_credits(user_id: str, amount_cents: int, stripe_payment_id: Optional[str],
                allow_below_min: bool = False) -> Dict[str, Any]:
    """Wallet top-up from a completed Stripe payment. Returns credited_seconds.
    Idempotent on stripe_payment_id. Raises QuotaUnavailable on failure so the
    webhook returns non-2xx and Stripe retries.

    allow_below_min: the user-facing deposit floor is $10, but the lip-sync
    shortfall checkout charges EXACTLY what's owed — often under $10 — and
    crediting less than Stripe collected would strand paid money."""
    if amount_cents < MIN_DEPOSIT_CENTS and not allow_below_min:
        raise ValueError(f"deposit {amount_cents}c is below the ${MIN_DEPOSIT_CENTS / 100:.0f} minimum")
    tier = tier_for(user_id)
    try:
        row = _first(_rpc("quota_add_credits", {
            "p_user_id": user_id, "p_tier": tier,
            "p_amount_cents": int(amount_cents), "p_stripe_payment_id": stripe_payment_id,
            "p_allow_below_min": bool(allow_below_min),
        }))
    except Exception as e:
        logger.error(f"[QUOTA] add_credits failed for {user_id} ({amount_cents}c): {e}")
        raise QuotaUnavailable(str(e)) from e
    verb = "already applied" if row.get("already_applied") else "credited"
    logger.info(
        f"[QUOTA] {user_id}: {verb} {row.get('credited_seconds', 0)}s for {amount_cents}c "
        f"(payment={stripe_payment_id}); wallet now {row.get('credit_remaining', 0)}s"
    )
    return {**row, "credited_minutes": round(int(row.get("credited_seconds") or 0) / 60, 2)}
