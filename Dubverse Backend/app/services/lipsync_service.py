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
SYNCLABS_MODEL = "sync-1.6.0"
POLL_INTERVAL_SEC = 10
MAX_POLL_ATTEMPTS = 60  # 10 minutes max


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
    ) -> bool:
        """
        Send the original video + dubbed audio to Sync.Labs, wait for the
        lip-synced result, and write it to output_path.

        Returns True on success, False on any failure (caller falls back to
        the already-dubbed video without lip sync).
        """
        if not self.enabled:
            logger.info("[LIPSYNC] Skipped: SYNCLABS_API_KEY or PUBLIC_BASE_URL not set")
            return False

        audio_filename = Path(audio_path).name
        video_url = f"{self.public_base_url}/api/media/{job_id}/video"
        audio_url = f"{self.public_base_url}/api/media/{job_id}/audio/{audio_filename}"

        logger.info(f"[LIPSYNC] Job {job_id}: videoUrl={video_url}")
        logger.info(f"[LIPSYNC] Job {job_id}: audioUrl={audio_url}")

        try:
            sync_job_id = await self._create_job(video_url, audio_url)
            if not sync_job_id:
                return False

            logger.info(f"[LIPSYNC] Job {job_id}: Sync.Labs job created id={sync_job_id}")

            output_url = await self._poll_job(job_id, sync_job_id)
            if not output_url:
                return False

            logger.info(f"[LIPSYNC] Job {job_id}: downloading lip-synced video")
            return await self._download_result(output_url, output_path)

        except Exception as exc:
            logger.error(f"[LIPSYNC] Job {job_id}: unexpected error: {exc}")
            return False

    async def _create_job(self, video_url: str, audio_url: str) -> Optional[str]:
        headers = {
            "x-api-key": self.api_key,
            "Content-Type": "application/json",
        }
        payload = {
            "audioUrl": audio_url,
            "videoUrl": video_url,
            "model": SYNCLABS_MODEL,
        }
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{SYNCLABS_API_BASE}/v2/generate",
                json=payload,
                headers=headers,
            )

        if resp.status_code not in (200, 201):
            logger.error(
                f"[LIPSYNC] Create job failed: HTTP {resp.status_code} — {resp.text[:300]}"
            )
            return None

        return resp.json().get("id")

    async def _poll_job(self, job_id: str, sync_job_id: str) -> Optional[str]:
        headers = {"x-api-key": self.api_key}
        url = f"{SYNCLABS_API_BASE}/v2/generate/{sync_job_id}"

        for attempt in range(1, MAX_POLL_ATTEMPTS + 1):
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

            data = resp.json()
            status = data.get("status", "UNKNOWN")
            logger.info(
                f"[LIPSYNC] Job {job_id}: poll {attempt}/{MAX_POLL_ATTEMPTS} status={status}"
            )

            if status == "COMPLETED":
                return data.get("outputUrl")
            elif status == "FAILED":
                logger.error(f"[LIPSYNC] Job {job_id}: Sync.Labs reported FAILED — {data}")
                return None

        logger.error(
            f"[LIPSYNC] Job {job_id}: timed out after {MAX_POLL_ATTEMPTS * POLL_INTERVAL_SEC}s"
        )
        return None

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
