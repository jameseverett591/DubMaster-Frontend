import asyncio
import logging
import os
from pathlib import Path
from typing import Optional

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

SYNCLABS_API_BASE = "https://api.sync.so"
# sync.so v2 models: sync-3 | lipsync-2 | lipsync-2-pro | lipsync-1.9.0-beta | react-1
# (sync-1.6.0 was retired with the old flat {audioUrl, videoUrl} payload).
SYNCLABS_MODEL = "lipsync-2"
POLL_INTERVAL_SEC = 10
MAX_POLL_ATTEMPTS = 60  # 10 minutes max — default for a single whole-film job


class LipSyncService:
    def __init__(self):
        self.api_key = settings.SYNCLABS_API_KEY
        self.public_base_url = settings.PUBLIC_BASE_URL.rstrip("/")

    @property
    def enabled(self) -> bool:
        return bool(self.api_key and self.public_base_url)

    async def lipsync_video(
        self,
        job_id: str,
        video_path: str,
        audio_path: str,
        output_path: str,
        media_qs: str = "",
        video_url: str = "",
        audio_url: str = "",
        sync_job_id: str = "",
        on_submitted=None,
        max_poll_seconds: int = 0,
    ) -> dict:
        """
        Send the original video + dubbed audio to Sync.Labs, wait for the
        lip-synced result, and write it to output_path.

        Returns a result dict: {"status": "completed"|"failed"|"skipped",
        "output_path": str|None, "vendor_attempted": bool}.

        vendor_attempted is the billing signal: False only when Sync.Labs
        never ran the job (submit failed, or REJECTED before PROCESSING).
        Once PROCESSING is observed — or any non-REJECTED terminal state —
        the vendor consumed the attempt and the caller keeps the charge.

        Resumable: `on_submitted(sync_job_id)` fires (awaited if async) the
        moment the vendor accepts the job, before polling, so a caller can
        persist the id. Passing `sync_job_id` skips submission and polls that
        existing generation instead — how a run survives a backend restart
        without submitting (and paying for) the same range twice.
        `max_poll_seconds` widens the poll window past the 10-minute default
        for long chunks. The result carries `sync_job_id`, plus `resumable`:
        True while the saved id can still yield output (timeout or a
        completed-but-undownloaded render), False once the vendor job is
        dead or the output is in hand — the caller's cue to drop its state.
        """
        _skipped = {"status": "skipped", "output_path": None,
                    "vendor_attempted": False, "resumable": False}
        if not self.enabled:
            logger.info("[LIPSYNC] Skipped: SYNCLABS_API_KEY or PUBLIC_BASE_URL not set")
            return _skipped

        if sync_job_id:
            return await self._resume_job(job_id, sync_job_id, output_path, max_poll_seconds)

        audio_filename = Path(audio_path).name if audio_path else ""
        # Media routes require auth; vendors can't send headers, so the
        # credential travels as a scoped ?media_token= minted by the caller —
        # job-scoped and expiring, unlike the user's JWT. Scoped (per-range)
        # calls pass ready-made URLs for cut subclips.
        qs = media_qs
        video_url = video_url or f"{self.public_base_url}/api/media/{job_id}/video{qs}"
        audio_url = audio_url or f"{self.public_base_url}/api/media/{job_id}/audio/{audio_filename}{qs}"

        # Never log the credential-bearing URL — even a scoped token would
        # let anyone with log access fetch this job's media until expiry.
        logger.info(f"[LIPSYNC] Job {job_id}: videoUrl={video_url.split('?')[0]}{' (+token)' if qs else ''}")
        logger.info(f"[LIPSYNC] Job {job_id}: audioUrl={audio_url.split('?')[0]}{' (+token)' if qs else ''}")

        submitted = False
        try:
            sync_job_id, vendor_error = await self._create_job(video_url, audio_url)
            if not sync_job_id:
                return {"status": "failed", "output_path": None,
                        "vendor_attempted": False, "resumable": False,
                        "vendor_error": vendor_error}
            submitted = True

            logger.info(f"[LIPSYNC] Job {job_id}: Sync.Labs job created id={sync_job_id}")
            if on_submitted:
                _r = on_submitted(sync_job_id)
                if asyncio.iscoroutine(_r):
                    await _r

            output_url, attempted, resumable = await self._poll_job(job_id, sync_job_id, max_poll_seconds)
            if not output_url:
                return {"status": "failed", "output_path": None,
                        "vendor_attempted": attempted, "sync_job_id": sync_job_id,
                        "resumable": resumable}

            logger.info(f"[LIPSYNC] Job {job_id}: downloading lip-synced video")
            ok = await self._download_result(output_url, output_path)
            return {
                "status": "completed" if ok else "failed",
                "output_path": output_path if ok else None,
                # The render finished vendor-side; a failed download still
                # consumed the attempt — and the same generation id can
                # recover it, so it stays resumable.
                "vendor_attempted": True,
                "sync_job_id": sync_job_id,
                "resumable": not ok,
            }

        except Exception as exc:
            logger.error(f"[LIPSYNC] Job {job_id}: unexpected error: {exc}")
            # submitted stays True once the vendor accepted the job — an error
            # during polling/download after submission still consumed the
            # attempt, so the caller must not refund the charge. The job may
            # still be alive vendor-side, so it stays resumable.
            return {"status": "failed", "output_path": None,
                    "vendor_attempted": submitted, "sync_job_id": sync_job_id or None,
                    "resumable": submitted}

    async def _resume_job(self, job_id: str, sync_job_id: str, output_path: str,
                          max_poll_seconds: int) -> dict:
        """Poll + download a generation that was already submitted (restart
        recovery). The vendor already accepted it, so it is always 'attempted'
        unless it comes back REJECTED before ever processing."""
        try:
            logger.info(f"[LIPSYNC] Job {job_id}: RESUMING Sync.Labs job id={sync_job_id} (no resubmit)")
            output_url, attempted, resumable = await self._poll_job(job_id, sync_job_id, max_poll_seconds)
            if not output_url:
                return {"status": "failed", "output_path": None,
                        "vendor_attempted": attempted, "sync_job_id": sync_job_id,
                        "resumable": resumable}
            ok = await self._download_result(output_url, output_path)
            return {"status": "completed" if ok else "failed",
                    "output_path": output_path if ok else None,
                    "vendor_attempted": True, "sync_job_id": sync_job_id,
                    "resumable": not ok}
        except Exception as exc:
            logger.error(f"[LIPSYNC] Job {job_id}: resume error: {exc}")
            return {"status": "failed", "output_path": None,
                    "vendor_attempted": True, "sync_job_id": sync_job_id,
                    "resumable": True}

    async def _create_job(self, video_url: str, audio_url: str) -> Optional[str]:
        headers = {
            "x-api-key": self.api_key,
            "Content-Type": "application/json",
        }
        # v2 shape: inputs are typed objects, not flat *Url fields. The video
        # and audio must match duration; cut_off trims an overlong tail rather
        # than the default bounce, which would loop the picture to fit audio.
        # active_speaker_detection keeps lip edits on whoever is actually
        # talking — the multi-face case LipDub's API doesn't handle.
        payload = {
            "model": SYNCLABS_MODEL,
            "input": [
                {"type": "video", "url": video_url},
                {"type": "audio", "url": audio_url},
            ],
            "options": {
                "sync_mode": "cut_off",
                "active_speaker_detection": {"auto_detect": True},
            },
        }
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{SYNCLABS_API_BASE}/v2/generate",
                json=payload,
                headers=headers,
            )

        if resp.status_code not in (200, 201):
            # Surface the vendor's own message — a 402 here means the Sync.Labs
            # ACCOUNT is suspended for failed payment, not that we sent a bad
            # request. The caller needs that distinction to bill correctly and
            # to tell the user why lip sync never ran.
            detail = resp.text[:300]
            try:
                _j = resp.json()
                detail = _j.get("message") or _j.get("error") or detail
            except Exception:
                pass
            logger.error(
                f"[LIPSYNC] Create job failed: HTTP {resp.status_code} — {detail}"
            )
            return None, f"Sync.Labs rejected the job (HTTP {resp.status_code}): {detail}"

        return resp.json().get("id"), None

    async def _poll_job(self, job_id: str, sync_job_id: str, max_poll_seconds: int = 0) -> tuple:
        """Poll until a terminal state. Returns (output_url, vendor_attempted, resumable).

        vendor_attempted flips True the moment PROCESSING is observed and on
        any terminal state except a first-seen REJECTED — a clean rejection
        before processing is the one case the vendor never billed for.

        resumable is True while the saved sync_job_id can still yield output:
        a poll timeout (vendor still running) or a COMPLETED generation.
        False only on a dead terminal state (FAILED/REJECTED)."""
        headers = {"x-api-key": self.api_key}
        url = f"{SYNCLABS_API_BASE}/v2/generate/{sync_job_id}"
        attempted = False
        max_attempts = (max(1, int(max_poll_seconds // POLL_INTERVAL_SEC))
                        if max_poll_seconds else MAX_POLL_ATTEMPTS)

        for attempt in range(1, max_attempts + 1):
            await asyncio.sleep(POLL_INTERVAL_SEC)

            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    resp = await client.get(url, headers=headers)
            except Exception as exc:
                logger.warning(f"[LIPSYNC] Job {job_id}: poll {attempt} request error: {exc}")
                continue

            if resp.status_code != 200:
                logger.warning(
                    f"[LIPSYNC] Job {job_id}: poll {attempt} got HTTP {resp.status_code}"
                )
                continue

            try:
                data = resp.json()
            except Exception as exc:
                logger.warning(f"[LIPSYNC] Job {job_id}: poll {attempt} bad JSON: {exc}")
                continue
            status = data.get("status", "UNKNOWN")
            logger.info(
                f"[LIPSYNC] Job {job_id}: poll {attempt}/{max_attempts} status={status}"
            )

            if status == "PROCESSING":
                attempted = True
            elif status == "COMPLETED":
                return data.get("outputUrl"), True, True
            elif status in ("FAILED", "REJECTED"):
                logger.error(
                    f"[LIPSYNC] Job {job_id}: Sync.Labs reported {status} — "
                    f"{data.get('errorCode')}: {data.get('error')}"
                )
                return None, attempted or status == "FAILED", False

        logger.error(
            f"[LIPSYNC] Job {job_id}: timed out after {max_attempts * POLL_INTERVAL_SEC}s — "
            f"generation {sync_job_id} may still be running vendor-side"
        )
        # Ambiguous: never saw PROCESSING but the job may be queued vendor-side.
        # Treat as attempted — refunding on a poll timeout would give away a
        # render the vendor may still complete — and resumable, so the caller
        # keeps the id and the next attempt re-polls it instead of paying
        # for a second generation.
        return None, True, True

    async def _download_result(self, url: str, output_path: str) -> bool:
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        try:
            async with httpx.AsyncClient(timeout=300, follow_redirects=True) as client:
                async with client.stream("GET", url) as resp:
                    if resp.status_code != 200:
                        logger.error(f"[LIPSYNC] Download failed: HTTP {resp.status_code}")
                        return False
                    with open(output_path, "wb") as f:
                        async for chunk in resp.aiter_bytes(chunk_size=8192):
                            f.write(chunk)

            size = os.path.getsize(output_path) if os.path.exists(output_path) else 0
            logger.info(f"[LIPSYNC] Downloaded {size:,} bytes → {output_path}")
            return size > 0

        except Exception as exc:
            logger.error(f"[LIPSYNC] Download error: {exc}")
            return False


lipsync_service = LipSyncService()
