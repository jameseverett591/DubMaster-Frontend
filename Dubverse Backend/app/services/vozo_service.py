"""
Vozo AI dubbing and lip-sync service.

Full-pipeline alternative to the DubMaster pipeline.  Vozo handles
transcription, translation, dubbing, and rendering in a single API call.

Lip-sync is also available as a standalone feature (alternative to Sync.Labs).
"""

import asyncio
import logging
import os
from typing import Optional

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

VOZO_API_BASE = "https://api.vozo.ai/v1"
POLL_INTERVAL_SEC = 15
MAX_POLL_ATTEMPTS = 120  # 30 minutes max

# Map Vozo status -> (JobStatus value, progress %, stage message)
VOZO_STATUS_MAP = {
    "queuing":        ("processing",    10, "Queued on Vozo AI"),
    "preprocessing":  ("processing",    20, "Vozo: Preprocessing video"),
    "transcribing":   ("transcribing",  35, "Vozo: Transcribing audio"),
    "translating":    ("translating",   55, "Vozo: Translating dialogue"),
    "dubbing":        ("synthesizing",  70, "Vozo: Generating dubbed audio"),
    "rendering":      ("reassembling",  85, "Vozo: Rendering final video"),
    "done":           ("completed",    100, "Vozo dubbing complete"),
    "failed":         ("failed",         0, "Vozo dubbing failed"),
}


class VozoService:
    """Async Vozo AI service for full-pipeline dubbing and lip-sync."""

    def __init__(self):
        self.api_key = settings.VOZO_API_KEY or os.getenv("VOZO_API_KEY", "")
        self.public_base_url = (settings.PUBLIC_BASE_URL or "").rstrip("/")

        if not self.api_key:
            logger.info("VOZO_API_KEY not set; Vozo AI unavailable.")

    @property
    def enabled(self) -> bool:
        """Vozo dubbing requires API key + PUBLIC_BASE_URL (for media access)."""
        vozo_on = os.getenv("VOZO_ENABLED", str(settings.VOZO_ENABLED)).lower() in ("true", "1", "yes")
        return bool(vozo_on and self.api_key and self.public_base_url)

    @property
    def lipsync_enabled(self) -> bool:
        """Vozo lip-sync only requires API key (takes URLs directly)."""
        vozo_on = os.getenv("VOZO_ENABLED", str(settings.VOZO_ENABLED)).lower() in ("true", "1", "yes")
        return bool(vozo_on and self.api_key)

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    # ── Full-pipeline dubbing ──────────────────────────────────────────

    async def start_dub(
        self,
        job_id: str,
        video_url: str,
        source_language: str,
        target_language: str,
        user_prompt: Optional[str] = None,
    ) -> Optional[str]:
        """Submit a translate+dub job to Vozo. Returns task_id or None."""
        if not self.enabled:
            logger.error("[VOZO] Service not enabled")
            return None

        payload = {
            "media_type": "video",
            "media_url": video_url,
            "source_language": source_language if source_language != "auto" else "auto",
            "target_language": target_language,
            "export_type": "video",
        }
        if user_prompt:
            payload["user_prompt"] = user_prompt

        logger.info(f"[VOZO] Job {job_id}: submitting dub, target={target_language}, url={video_url}")

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    f"{VOZO_API_BASE}/media/translate",
                    json=payload,
                    headers=self._headers(),
                )

            if resp.status_code not in (200, 201):
                logger.error(f"[VOZO] Submit failed: HTTP {resp.status_code} - {resp.text[:500]}")
                return None

            task_id = resp.json().get("task_id")
            logger.info(f"[VOZO] Job {job_id}: Vozo task created id={task_id}")
            return task_id

        except Exception as exc:
            logger.error(f"[VOZO] Job {job_id}: submit error: {exc}")
            return None

    async def poll_dub_status(self, task_id: str) -> dict:
        """Poll Vozo for translation/dub task status."""
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    f"{VOZO_API_BASE}/media/translate/{task_id}",
                    headers=self._headers(),
                )
            if resp.status_code != 200:
                logger.warning(f"[VOZO] Poll {task_id}: HTTP {resp.status_code}")
                return {"status": "unknown"}
            return resp.json()
        except Exception as exc:
            logger.warning(f"[VOZO] Poll {task_id}: error: {exc}")
            return {"status": "unknown"}

    async def download_result(self, url: str, output_path: str) -> bool:
        """Download a Vozo result file to disk."""
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        try:
            async with httpx.AsyncClient(timeout=300, follow_redirects=True) as client:
                async with client.stream("GET", url) as resp:
                    if resp.status_code != 200:
                        logger.error(f"[VOZO] Download failed: HTTP {resp.status_code}")
                        return False
                    with open(output_path, "wb") as f:
                        async for chunk in resp.aiter_bytes(chunk_size=8192):
                            f.write(chunk)

            size = os.path.getsize(output_path) if os.path.exists(output_path) else 0
            logger.info(f"[VOZO] Downloaded {size:,} bytes -> {output_path}")
            return size > 0
        except Exception as exc:
            logger.error(f"[VOZO] Download error: {exc}")
            return False

    # ── Lip sync ───────────────────────────────────────────────────────

    async def start_lipsync(
        self,
        video_url: str,
        audio_url: str,
        model: str = "standard_v1",
    ) -> Optional[str]:
        """Submit a lip-sync job. Returns task_id or None."""
        payload = {
            "reference_file_url": video_url,
            "audio_url": audio_url,
            "model": model,
            "reference_file_type": "video",
        }
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    f"{VOZO_API_BASE}/video_generation",
                    json=payload,
                    headers=self._headers(),
                )
            if resp.status_code not in (200, 201):
                logger.error(f"[VOZO-LIPSYNC] Submit failed: HTTP {resp.status_code} - {resp.text[:300]}")
                return None
            return resp.json().get("task_id")
        except Exception as exc:
            logger.error(f"[VOZO-LIPSYNC] Submit error: {exc}")
            return None

    async def poll_lipsync_status(self, task_id: str) -> dict:
        """Poll lip-sync job status."""
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    f"{VOZO_API_BASE}/video_generation/{task_id}",
                    headers=self._headers(),
                )
            if resp.status_code != 200:
                return {"status": "unknown"}
            return resp.json()
        except Exception as exc:
            logger.warning(f"[VOZO-LIPSYNC] Poll error: {exc}")
            return {"status": "unknown"}

    async def lipsync_video(
        self,
        job_id: str,
        video_url: str,
        audio_url: str,
        output_path: str,
        model: str = "standard_v1",
    ) -> bool:
        """Full lip-sync flow: submit, poll, download. Returns True on success."""
        task_id = await self.start_lipsync(video_url, audio_url, model)
        if not task_id:
            return False

        logger.info(f"[VOZO-LIPSYNC] Job {job_id}: task created id={task_id}")

        for attempt in range(1, MAX_POLL_ATTEMPTS + 1):
            await asyncio.sleep(POLL_INTERVAL_SEC)
            data = await self.poll_lipsync_status(task_id)
            status = data.get("status", "unknown")
            logger.info(f"[VOZO-LIPSYNC] Job {job_id}: poll {attempt}/{MAX_POLL_ATTEMPTS} status={status}")

            if status in ("done", "completed"):
                video_result_url = data.get("video_url")
                if video_result_url:
                    return await self.download_result(video_result_url, output_path)
                return False
            elif status == "failed":
                logger.error(f"[VOZO-LIPSYNC] Job {job_id}: Vozo reported failure")
                return False

        logger.error(f"[VOZO-LIPSYNC] Job {job_id}: timed out")
        return False


# Module-level singleton
vozo_service = VozoService()
