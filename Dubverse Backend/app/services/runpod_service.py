import os
import time
import json
import logging
from typing import Dict, Any, Optional, List

import httpx

logger = logging.getLogger(__name__)

RUNPOD_API_BASE = "https://api.runpod.ai/v2"


class RunPodService:

    def __init__(self):
        self.api_key = os.getenv("RUNPOD_API_KEY", "")
        self.endpoint_id = os.getenv("RUNPOD_ENDPOINT_ID", "")

    def _submit_timeout_sec(self) -> float:
        try:
            return float(os.getenv("RUNPOD_SUBMIT_TIMEOUT_SEC", "120"))
        except Exception:
            return 120.0

    def _status_timeout_sec(self) -> float:
        try:
            return float(os.getenv("RUNPOD_STATUS_TIMEOUT_SEC", "30"))
        except Exception:
            return 30.0

    def _queue_timeout_sec(self) -> int:
        """Max seconds to allow a job to remain IN_QUEUE before failing."""
        try:
            return int(os.getenv("RUNPOD_QUEUE_TIMEOUT_SEC", "600"))
        except Exception:
            return 600

    def _max_retries(self) -> int:
        try:
            return int(os.getenv("RUNPOD_HTTP_MAX_RETRIES", "3"))
        except Exception:
            return 3

    def _retry_backoff_sec(self, attempt: int) -> float:
        try:
            base = float(os.getenv("RUNPOD_HTTP_RETRY_BACKOFF_SEC", "2"))
        except Exception:
            base = 2.0
        return base * (2 ** max(0, attempt - 1))

    async def _request_with_retries(
        self,
        method: str,
        url: str,
        *,
        timeout: float,
        json_payload: Optional[dict] = None,
    ) -> httpx.Response:
        last_exc: Exception | None = None
        max_retries = max(1, self._max_retries())
        for attempt in range(1, max_retries + 1):
            try:
                async with httpx.AsyncClient(timeout=timeout) as client:
                    if method.upper() == "POST":
                        resp = await client.post(url, json=json_payload, headers=self._headers())
                    else:
                        resp = await client.get(url, headers=self._headers())
                resp.raise_for_status()
                return resp
            except (httpx.TimeoutException, httpx.NetworkError, httpx.HTTPStatusError) as exc:
                last_exc = exc
                if attempt >= max_retries:
                    break
                sleep_sec = self._retry_backoff_sec(attempt)
                logger.warning(f"[RUNPOD] Request failed (attempt {attempt}/{max_retries}): {exc}; retrying in {sleep_sec:.1f}s")
                await _async_sleep(sleep_sec)
        assert last_exc is not None
        raise last_exc

    def is_available(self) -> bool:
        return bool(self.api_key and self.endpoint_id)

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    async def submit_job(
        self,
        file_url: str,
        job_id: str,
        language: str = "",
        min_speakers: int = 1,
        max_speakers: int = 5,
        steps: Optional[List[str]] = None,
        env_vars: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        if not self.is_available():
            raise RuntimeError("RunPod not configured: RUNPOD_API_KEY or RUNPOD_ENDPOINT_ID missing")

        if steps is None:
            steps = ["separate", "transcribe", "diarize"]

        payload = {
            "input": {
                "file_url": file_url,
                "job_id": job_id,
                "language": language,
                "min_speakers": min_speakers,
                "max_speakers": max_speakers,
                "steps": steps,
                "env_vars": env_vars or {},
            }
        }

        url = f"{RUNPOD_API_BASE}/{self.endpoint_id}/run"
        logger.info(f"[RUNPOD] Submitting job {job_id} to {url}")

        resp = await self._request_with_retries(
            "POST",
            url,
            timeout=self._submit_timeout_sec(),
            json_payload=payload,
        )
        data = resp.json()

        runpod_job_id = data.get("id")
        logger.info(f"[RUNPOD] Job submitted: runpod_id={runpod_job_id}, status={data.get('status')}")
        return data

    async def check_status(self, runpod_job_id: str) -> Dict[str, Any]:
        url = f"{RUNPOD_API_BASE}/{self.endpoint_id}/status/{runpod_job_id}"

        resp = await self._request_with_retries(
            "GET",
            url,
            timeout=self._status_timeout_sec(),
        )
        return resp.json()

    async def cancel_job(self, runpod_job_id: str) -> Dict[str, Any]:
        """Attempt to cancel a RunPod serverless job."""
        if not self.is_available():
            raise RuntimeError("RunPod not configured: RUNPOD_API_KEY or RUNPOD_ENDPOINT_ID missing")

        url = f"{RUNPOD_API_BASE}/{self.endpoint_id}/cancel/{runpod_job_id}"
        logger.info(f"[RUNPOD] Cancelling job {runpod_job_id} via {url}")

        resp = await self._request_with_retries(
            "POST",
            url,
            timeout=self._submit_timeout_sec(),
            json_payload={},
        )
        return resp.json()

    async def poll_until_complete(
        self,
        runpod_job_id: str,
        timeout: int = 600,
        interval: int = 5,
        progress_callback=None,
        timing_callback=None,
    ) -> Dict[str, Any]:
        """`timing_callback(execution_seconds, queue_seconds)` fires once on
        completion. Kept as a callback rather than folded into the return value
        so the GPU worker's output contract stays untouched."""
        start = time.time()
        last_status = None
        queue_timeout = max(0, self._queue_timeout_sec())

        while time.time() - start < timeout:
            result = await self.check_status(runpod_job_id)
            status = result.get("status")

            if status != last_status:
                logger.info(f"[RUNPOD] Job {runpod_job_id}: {status}")
                last_status = status

            if queue_timeout and status == "IN_QUEUE":
                elapsed = time.time() - start
                if elapsed >= queue_timeout:
                    raise TimeoutError(
                        f"RunPod job {runpod_job_id} stuck IN_QUEUE for {int(elapsed)}s (queue_timeout={queue_timeout}s). "
                        "This usually indicates no GPU workers available / endpoint throttling."
                    )

            if status == "COMPLETED":
                # RunPod reports both in ms. Captured because they are the only
                # real source of GPU cost per job — billing is per millisecond
                # of execution, so without this any cost-per-source-minute
                # figure is a guess. delayTime is queue wait and is NOT billed.
                exec_ms = result.get("executionTime")
                delay_ms = result.get("delayTime") or 0
                if exec_ms is not None:
                    logger.info(
                        f"[RUNPOD-COST] job {runpod_job_id} execution={exec_ms / 1000:.1f}s "
                        f"queue={delay_ms / 1000:.1f}s"
                    )
                    if timing_callback:
                        try:
                            import asyncio as _asyncio
                            if _asyncio.iscoroutinefunction(timing_callback):
                                await timing_callback(exec_ms / 1000.0, delay_ms / 1000.0)
                            else:
                                timing_callback(exec_ms / 1000.0, delay_ms / 1000.0)
                        except Exception as e:
                            # Cost accounting must never fail a completed dub.
                            logger.warning(f"[RUNPOD-COST] timing_callback failed: {e}")
                return result.get("output", {})

            if status == "FAILED":
                error = result.get("output", {}).get("error", result.get("error", "Unknown error"))
                raise RuntimeError(f"RunPod job failed: {error}")

            if status == "CANCELLED":
                raise RuntimeError("RunPod job was cancelled")

            # Provide progress updates while queued or in progress.
            # This avoids the UI appearing stuck at ~15% during RunPod queue wait.
            if progress_callback and status in {"IN_QUEUE", "IN_PROGRESS"}:
                elapsed = time.time() - start
                if status == "IN_QUEUE":
                    # Slow ramp 1 -> 14 while waiting for a worker.
                    # The API layer can treat <15 as "queued" and avoid
                    # marking GPU stages as started/completed prematurely.
                    pct = min(14, max(1, int(1 + (elapsed / max(timeout, 1)) * 13)))
                else:
                    # Once running, ramp 50 -> 90 based on elapsed time.
                    pct = min(90, int(50 + (elapsed / max(timeout, 1)) * 40))
                import asyncio
                if asyncio.iscoroutinefunction(progress_callback):
                    await progress_callback(pct)
                else:
                    progress_callback(pct)

            await _async_sleep(interval)

        raise TimeoutError(f"RunPod job {runpod_job_id} timed out after {timeout}s")

    async def run_gpu_pipeline(
        self,
        file_url: str,
        job_id: str,
        language: str = "",
        min_speakers: int = 1,
        max_speakers: int = 5,
        steps: Optional[List[str]] = None,
        timeout: int = 600,
        progress_callback=None,
        env_vars: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        submit_result = await self.submit_job(
            file_url=file_url,
            job_id=job_id,
            language=language,
            min_speakers=min_speakers,
            max_speakers=max_speakers,
            steps=steps,
            env_vars=env_vars,
        )

        runpod_job_id = submit_result.get("id")
        if not runpod_job_id:
            raise RuntimeError(f"RunPod did not return a job ID: {submit_result}")

        return await self.poll_until_complete(
            runpod_job_id=runpod_job_id,
            timeout=timeout,
            progress_callback=progress_callback,
        )

    async def get_endpoint_health(self) -> Dict[str, Any]:
        if not self.is_available():
            return {"status": "not_configured"}

        url = f"{RUNPOD_API_BASE}/{self.endpoint_id}/health"
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(url, headers=self._headers())
                resp.raise_for_status()
                return resp.json()
        except Exception as e:
            return {"status": "error", "message": str(e)}


async def _async_sleep(seconds: float):
    import asyncio
    await asyncio.sleep(seconds)


runpod_service = RunPodService()
