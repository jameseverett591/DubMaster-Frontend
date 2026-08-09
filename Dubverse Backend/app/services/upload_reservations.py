"""Minute reservations for direct-to-R2 uploads.

A reservation is taken at PRESIGN time, before any bytes move, so a customer
cannot push 50GB and only then discover they cannot afford it. The real
duration is not known until the object is in R2 and ffprobe has read it, so the
reservation is provisional and reconciled at completion.

    pending   -> reserved, upload in flight
    active    -> completed and verified; ownership passes to job.minutes_charged
    abandoned -> released by explicit abort, or by the staleness sweep
    rejected  -> verification failed; released and the object deleted

The client's claimed duration is untrusted, but lying is self-defeating: the
size cap is duration-scaled (see config.upload_size_cap), so understating
duration to reserve fewer minutes also shrinks the file size permitted. The two
constraints bound each other, which is why there is no separate anti-fraud
check here.

Minutes and bytes are reclaimed on different clocks, deliberately. Quota is
released after STALE_AFTER_HOURS (24h) because holding someone's allowance for
a week because their laptop slept is unacceptable. The bytes can wait for the
R2 lifecycle rule (7 days) to abort the multipart upload.

Like usage_service, everything here is best-effort and never raises: accounting
must not be able to fail an upload. Every failure mode is biased toward the
customer — see release() for the one case where that bias costs us.

Nothing calls this module yet. It is wired up in the presign endpoints.
"""

import logging
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from app.services import usage_service

logger = logging.getLogger(__name__)

# Quota release deadline. The R2 lifecycle rule that aborts the underlying
# multipart upload runs at 7 days; this is deliberately much shorter.
STALE_AFTER_HOURS = 24

# Age at which /health starts reporting "degraded". Comfortably past the sweep
# deadline, so a single slow sweep does not raise a false alarm — this fires
# only when sweeping has genuinely stopped happening.
DEGRADED_AFTER_HOURS = 48

# 64MB: a 50GB upload is ~800 parts, well under S3's 10,000-part limit, and a
# failed part costs at most 64MB of re-transfer. Smaller parts mean more round
# trips; larger ones make a flaky connection expensive.
PART_SIZE = 64 * 1024 * 1024

# Matches STALE_AFTER_HOURS: a URL should not outlive the reservation it
# belongs to. Resuming past this needs fresh URLs from /upload/presign-parts.
PRESIGN_TTL_SECONDS = 24 * 3600

_TABLE = "upload_reservations"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _table():
    from app.services.supabase_client import supabase_writer
    return supabase_writer.table(_TABLE)


def _get(job_id: str) -> Optional[Dict[str, Any]]:
    try:
        res = _table().select("*").eq("job_id", job_id).limit(1).execute()
        return res.data[0] if res.data else None
    except Exception as e:
        logger.error(f"[RESERVE] read FAILED for {job_id}: {e}", exc_info=True)
        return None


def _claim_pending(job_id: str, new_state: str) -> Optional[Dict[str, Any]]:
    """Move a reservation out of 'pending', returning the row if we won.

    The state change is conditional on the row still being 'pending' and is a
    single statement, so two concurrent releases cannot both succeed. This is
    the same guard job_manager uses when it clears minutes_charged before
    refunding: transition first, act second, so a repeat finds nothing to do.
    """
    try:
        res = (
            _table()
            .update({"state": new_state, "updated_at": _now().isoformat()})
            .eq("job_id", job_id)
            .eq("state", "pending")
            .execute()
        )
        return res.data[0] if res.data else None
    except Exception as e:
        logger.error(f"[RESERVE] claim FAILED for {job_id}: {e}", exc_info=True)
        return None


def _set_state(job_id: str, state: str, **fields) -> None:
    try:
        payload = {"state": state, "updated_at": _now().isoformat()}
        payload.update(fields)
        _table().update(payload).eq("job_id", job_id).execute()
    except Exception as e:
        logger.error(f"[RESERVE] state->{state} FAILED for {job_id}: {e}", exc_info=True)


# ---------------------------------------------------------------------------
# R2
# ---------------------------------------------------------------------------

def _r2_config() -> Optional[Tuple[str, str, str, str]]:
    bucket  = os.getenv("R2_BUCKET_NAME", "")
    key_id  = os.getenv("R2_ACCESS_KEY_ID", "")
    secret  = os.getenv("R2_SECRET_ACCESS_KEY", "")
    account = os.getenv("R2_ACCOUNT_ID", "")
    if not (bucket and key_id and secret and account):
        return None
    return bucket, key_id, secret, account


def _r2_client():
    cfg = _r2_config()
    if cfg is None:
        return None, None
    bucket, key_id, secret, account = cfg
    import boto3
    from botocore.config import Config
    return boto3.client(
        "s3",
        endpoint_url=f"https://{account}.r2.cloudflarestorage.com",
        aws_access_key_id=key_id,
        aws_secret_access_key=secret,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    ), bucket


def object_key_for(job_id: str, filename: str) -> str:
    """The R2 key for a job's source video.

    Must stay identical to the key built by _get_runpod_file_url in routes.py
    while both exist, or the GPU handoff will point at nothing.
    """
    safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", Path(filename).name)
    return f"{job_id}/{safe_name}"


def abort_multipart(upload_id: str, object_key: str) -> bool:
    """Abort an incomplete multipart upload, discarding its parts.

    Best-effort. The R2 lifecycle rule is the backstop if this fails, which is
    exactly why the lifecycle rule is not optional.
    """
    s3, bucket = _r2_client()
    if s3 is None:
        logger.error(
            f"[RESERVE] cannot abort {object_key}: R2 is not configured — "
            f"parts will bill until the lifecycle rule expires them"
        )
        return False
    try:
        s3.abort_multipart_upload(Bucket=bucket, Key=object_key, UploadId=upload_id)
        logger.info(f"[RESERVE] aborted multipart {upload_id} ({object_key})")
        return True
    except Exception as e:
        logger.error(
            f"[RESERVE] ABORT FAILED for {object_key}: {e} — parts keep billing "
            f"until the 7-day lifecycle rule",
            exc_info=True,
        )
        return False


def create_multipart(object_key: str, content_type: str = "video/mp4") -> Optional[str]:
    """Start a multipart upload. Returns the UploadId, or None on failure.

    The caller MUST already hold a reservation row before calling this — see
    create(). R2 cannot reliably enumerate multipart uploads, so anything
    created without a durable record is invisible until the lifecycle rule
    expires it.
    """
    s3, bucket = _r2_client()
    if s3 is None:
        logger.error("[RESERVE] cannot create multipart: R2 is not configured")
        return None
    try:
        r = s3.create_multipart_upload(
            Bucket=bucket, Key=object_key, ContentType=content_type
        )
        logger.info(f"[RESERVE] multipart created for {object_key}")
        return r["UploadId"]
    except Exception as e:
        logger.error(f"[RESERVE] create_multipart FAILED for {object_key}: {e}",
                     exc_info=True)
        return None


def presign_parts(
    object_key: str, upload_id: str, part_numbers: List[int]
) -> Optional[List[Dict[str, Any]]]:
    """Signed PUT URLs for the given part numbers, or None if signing fails.

    Reissuable: presigned URLs expire after PRESIGN_TTL_SECONDS, and a resume
    the next day needs fresh ones for an upload that is still perfectly valid
    in R2.
    """
    s3, bucket = _r2_client()
    if s3 is None:
        logger.error("[RESERVE] cannot presign parts: R2 is not configured")
        return None
    try:
        return [
            {
                "part_number": n,
                "url": s3.generate_presigned_url(
                    "upload_part",
                    Params={"Bucket": bucket, "Key": object_key,
                            "UploadId": upload_id, "PartNumber": n},
                    ExpiresIn=PRESIGN_TTL_SECONDS,
                ),
            }
            for n in part_numbers
        ]
    except Exception as e:
        logger.error(f"[RESERVE] presign_parts FAILED for {object_key}: {e}",
                     exc_info=True)
        return None


def complete_multipart(
    object_key: str, upload_id: str, parts: List[Dict[str, Any]]
) -> bool:
    """Assemble the uploaded parts into the final object."""
    s3, bucket = _r2_client()
    if s3 is None:
        logger.error("[RESERVE] cannot complete multipart: R2 is not configured")
        return False
    try:
        ordered = sorted(parts, key=lambda p: int(p["part_number"]))
        s3.complete_multipart_upload(
            Bucket=bucket, Key=object_key, UploadId=upload_id,
            MultipartUpload={"Parts": [
                {"PartNumber": int(p["part_number"]), "ETag": p["etag"]}
                for p in ordered
            ]},
        )
        logger.info(f"[RESERVE] multipart completed for {object_key}")
        return True
    except Exception as e:
        # Not fatal to the reservation: the upload stays pending and can be
        # retried or swept. Loud because a customer just spent their bandwidth.
        logger.error(f"[RESERVE] complete_multipart FAILED for {object_key}: {e}",
                     exc_info=True)
        return False


def presign_get(object_key: str, ttl: int = 3600) -> Optional[str]:
    """A signed read URL. Used so ffprobe can read the header over https
    without the backend downloading the object."""
    s3, bucket = _r2_client()
    if s3 is None:
        logger.error("[RESERVE] cannot presign GET: R2 is not configured")
        return None
    try:
        return s3.generate_presigned_url(
            "get_object", Params={"Bucket": bucket, "Key": object_key}, ExpiresIn=ttl
        )
    except Exception as e:
        logger.error(f"[RESERVE] presign_get FAILED for {object_key}: {e}",
                     exc_info=True)
        return None


def delete_object(object_key: str) -> bool:
    """Remove a completed object — used when verification rejects an upload."""
    s3, bucket = _r2_client()
    if s3 is None:
        logger.error(f"[RESERVE] cannot delete {object_key}: R2 is not configured")
        return False
    try:
        s3.delete_object(Bucket=bucket, Key=object_key)
        logger.info(f"[RESERVE] deleted object {object_key}")
        return True
    except Exception as e:
        logger.error(f"[RESERVE] delete_object FAILED for {object_key}: {e} — "
                     f"object retained and billing", exc_info=True)
        return False


def part_count(size_bytes: int) -> int:
    return max(1, -(-int(size_bytes) // PART_SIZE))   # ceil division


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------

def create(
    user_id: str,
    job_id: str,
    upload_id: Optional[str],
    object_key: str,
    claimed_seconds: float,
) -> Optional[int]:
    """Hold minutes for an upload about to start.

    `upload_id` may be None: the row is written BEFORE the multipart exists,
    then filled in by set_upload_id().

    That ordering is not tidiness. R2's ListMultipartUploads does not reliably
    enumerate our uploads — verified: a real upload with a real 5MB part did
    not appear in the listing — so an upload created before its row exists is
    permanently undiscoverable, reclaimable only by the 7-day lifecycle rule.
    A row with a null upload_id is findable and cleanable; an unrecorded
    upload is not.

    Returns the number of minutes held, or None if the hold could not be taken
    — in which case the caller MUST refuse to issue presigned URLs.

    Ordering is deliberate. The row is written with reserved=True BEFORE
    usage_service.adjust runs. A crash between the two leads to an
    over-release later (see release()). The opposite ordering would strand
    minutes with no release path at all, which is unrecoverable without manual
    intervention. Given a choice between losing a little money and locking a
    customer out of their own allowance, lose the money.
    """
    minutes = usage_service.minutes_for(claimed_seconds)
    try:
        _table().insert({
            "job_id": job_id,
            "user_id": user_id,
            "upload_id": upload_id,
            "object_key": object_key,
            "claimed_seconds": float(claimed_seconds or 0),
            "minutes_reserved": minutes,
            "reserved": True,
            "state": "pending",
        }).execute()
    except Exception as e:
        logger.error(f"[RESERVE] insert FAILED for {job_id}: {e}", exc_info=True)
        return None

    if not usage_service.adjust(user_id, minutes):
        # The charge did not land, so nothing is actually held. Take the row
        # out of 'pending' so the sweeper never tries to release it.
        _set_state(job_id, "abandoned")
        logger.error(f"[RESERVE] {job_id}: CHARGE FAILED, reservation dropped")
        return None

    logger.info(f"[RESERVE] {job_id}: held {minutes} min for {user_id}")
    return minutes


def set_upload_id(job_id: str, upload_id: str) -> bool:
    """Attach the multipart id to an existing reservation.

    Returns False if the write did not land — in which case the caller holds a
    multipart upload it can no longer reference, and must abort it rather than
    leave something only the lifecycle rule can reclaim.
    """
    try:
        res = (
            _table()
            .update({"upload_id": upload_id, "updated_at": _now().isoformat()})
            .eq("job_id", job_id)
            .execute()
        )
        if not res.data:
            logger.error(f"[RESERVE] {job_id}: set_upload_id matched no row")
            return False
        return True
    except Exception as e:
        logger.error(f"[RESERVE] set_upload_id FAILED for {job_id}: {e}", exc_info=True)
        return False


def release(job_id: str, reason: str) -> bool:
    """Return held minutes. Idempotent; safe to call from any path.

    ACCEPTED COST, NOT A SELF-CORRECTING STATE
    ------------------------------------------
    If the process died between the row insert and usage_service.adjust in
    create(), this returns minutes that were never actually charged.
    usage_service.adjust floors at zero, so a customer's usage cannot go
    negative — but that month's total ends up permanently lower than it should
    be, in the customer's favour.

    Nothing reconciles that later. It is a small, real cost we absorb. It is
    accepted because the alternative ordering fails by stranding minutes
    permanently, and an occasional under-charge is much cheaper than a customer
    locked out of an allowance they paid for.
    """
    row = _claim_pending(job_id, "abandoned")
    if row is None:
        return False   # already settled, or never existed

    minutes = int(row.get("minutes_reserved") or 0)
    if not row.get("reserved"):
        return True    # nothing was ever charged, nothing to give back

    if usage_service.adjust(row["user_id"], -minutes):
        logger.info(f"[RESERVE] {job_id}: released {minutes} min ({reason})")
        return True

    # The credit did not land. Put the row back to 'pending' so the sweep
    # retries it, rather than leaving it 'abandoned' with the minutes still
    # taken and nothing recording that they are owed. Same reasoning as the
    # refund path in job_manager: a failed return must stay claimable.
    _set_state(job_id, "pending")
    logger.error(
        f"[RESERVE] {job_id}: RELEASE FAILED, {minutes} min still held from "
        f"{row.get('user_id') or '<no owner>'} — left pending for retry"
    )
    return False


def reconcile(
    job_id: str,
    real_seconds: float,
    remaining_minutes: int,
) -> Tuple[str, int]:
    """Settle a completed upload against its real, ffprobe'd duration.

    Returns:
        ("ok", minutes_charged)        reservation is now 'active'
        ("already_settled", minutes)   a previous call settled it
        ("insufficient", shortfall)    caller must reject and delete the object
        ("settle_failed", abs(delta))  the credit/charge did not land
        ("missing", 0)                 no reservation row (nothing to settle)

    The outcomes exist because the claimed duration is a guess. Short claims
    are the interesting case: the customer has already spent their own
    bandwidth by this point, so rejecting here is correct but should be rare —
    the client probes duration locally before asking for a presign.

    Safe to call twice. The pending -> active transition is conditional, so a
    client retrying after a timeout settles once. Affordability is checked
    BEFORE the transition, so a rejected upload stays 'pending' and can be
    retried or swept rather than being stranded in 'active'.
    """
    row = _get(job_id)
    if row is None:
        return ("missing", 0)
    if row.get("state") != "pending":
        return ("already_settled", int(row.get("minutes_reserved") or 0))

    real = usage_service.minutes_for(real_seconds)
    held = int(row.get("minutes_reserved") or 0)
    delta = real - held
    if delta > 0 and delta > remaining_minutes:
        return ("insufficient", delta - remaining_minutes)

    claimed = _claim_pending(job_id, "active")
    if claimed is None:
        return ("already_settled", real)   # lost a concurrent race

    if delta and not usage_service.adjust(row["user_id"], delta):
        # The settlement did not land, so this reservation is NOT settled.
        # Put it back to pending rather than leaving it 'active' with the
        # wrong number of minutes taken.
        _set_state(job_id, "pending")
        logger.error(
            f"[RESERVE] {job_id}: SETTLE FAILED for delta {delta:+d} min — "
            f"left pending, not marked active"
        )
        return ("settle_failed", abs(delta))

    _set_state(job_id, "active", minutes_reserved=real)
    logger.info(f"[RESERVE] {job_id}: settled at {real} min (held {held})")
    return ("ok", real)


def reject(job_id: str, reason: str) -> None:
    """Verification failed. Release the hold and mark the row rejected.

    Separate from release() only so the state reads truthfully afterwards —
    'rejected' and 'abandoned' fail for different reasons and a support query
    should be able to tell them apart.
    """
    row = _claim_pending(job_id, "rejected")
    if row is None:
        return
    minutes = int(row.get("minutes_reserved") or 0)
    if not row.get("reserved"):
        return

    if usage_service.adjust(row["user_id"], -minutes):
        logger.info(f"[RESERVE] {job_id}: rejected and released ({reason})")
        return

    # Same as release(): a credit that did not land must stay claimable.
    _set_state(job_id, "pending")
    logger.error(
        f"[RESERVE] {job_id}: REJECT RELEASE FAILED, {minutes} min still held "
        f"from {row.get('user_id') or '<no owner>'} — left pending for retry"
    )


# ---------------------------------------------------------------------------
# Sweeping
# ---------------------------------------------------------------------------

def _stale_rows(hours: int) -> Optional[List[Dict[str, Any]]]:
    """Pending reservations older than `hours`.

    Returns None on a FAILED READ, distinct from [] for "none found". The
    difference matters: if this swallowed errors and returned [], a dropped or
    renamed table would make /health report a clean "0 pending" forever — an
    alarm that reads all-clear precisely when it has stopped working.
    """
    cutoff = (_now() - timedelta(hours=hours)).isoformat()
    try:
        res = (
            _table()
            .select("*")
            .eq("state", "pending")
            .lt("created_at", cutoff)
            .execute()
        )
        return res.data or []
    except Exception as e:
        logger.error(f"[RESERVE] stale query FAILED: {e}", exc_info=True)
        return None


def sweep_stale() -> int:
    """Release reservations whose uploads never completed. Returns the count.

    Called lazily from the presign endpoint rather than only from a scheduler.
    Stale rows accumulate only because uploads happen, so the endpoint that
    creates the problem also clears it, and the common case is
    self-maintaining. A scheduler that silently stops is precisely the failure
    this avoids depending on.

    It also unblocks the customer who needs it most: someone whose allowance is
    tied up by their own orphaned reservation frees it with their next attempt.
    """
    rows = _stale_rows(STALE_AFTER_HOURS)
    if rows is None:
        return 0    # read failed; /health reports it, do not pretend success
    swept = 0
    for row in rows:
        # Abort first: releasing minutes while the parts remain would leave
        # storage billing with nothing left pointing at it.
        if row.get("upload_id") and row.get("object_key"):
            abort_multipart(row["upload_id"], row["object_key"])
        else:
            # Crashed between the row insert and create_multipart. Nothing
            # exists in R2 to abort; calling abort with a null id would log a
            # spurious ABORT FAILED and mask real ones.
            logger.info(
                f"[RESERVE] {row['job_id']}: no upload_id — releasing minutes only"
            )
        if release(row["job_id"], f"stale >{STALE_AFTER_HOURS}h"):
            swept += 1
    if swept:
        logger.info(f"[RESERVE] swept {swept} stale reservation(s)")
    return swept


def stale_count() -> Dict[str, Any]:
    """Staleness summary for /health.

    Surfaced there rather than logged because a log line is only useful to
    someone already reading logs. Anything older than DEGRADED_AFTER_HOURS
    means the sweep is not running at all — by then both the lazy path and any
    scheduled path have failed.
    """
    rows = _stale_rows(0)   # every pending row, any age
    if rows is None:
        # Cannot read the table at all. Reported as an error rather than as
        # zero so a missing table degrades loudly instead of looking healthy.
        return {"error": "reservation table unreadable"}
    if not rows:
        return {"pending": 0, "stale": 0, "oldest_hours": 0}

    now = _now()
    ages = []
    for r in rows:
        try:
            created = datetime.fromisoformat(str(r["created_at"]).replace("Z", "+00:00"))
            ages.append((now - created).total_seconds() / 3600.0)
        except Exception:
            continue

    oldest = max(ages) if ages else 0.0
    return {
        "pending": len(rows),
        "stale": sum(1 for a in ages if a > STALE_AFTER_HOURS),
        "oldest_hours": round(oldest, 1),
    }
