"""
ScreenApp AI Video Analyzer — upload + multimodal analysis.
https://screenapp.io/help/api-documentation

Flow:
  1. POST /files/upload/{teamId}/{folderId}/url  → get pre-signed URL + fileId
  2. PUT  <pre-signed URL>                       → upload the actual file
  3. POST /files/upload/{teamId}/{folderId}/finalize → finalize upload
  4. POST /files/{fileId}/ask/multimodal          → AI analysis

Returns None on any error — QC analysis degrades gracefully without ScreenApp.
"""

import os
import logging
import time
from pathlib import Path
from typing import Optional, Dict, Any

import httpx

logger = logging.getLogger(__name__)

SCREENAPP_BASE_URL = "https://api.screenapp.io/v2"
SCREENAPP_UPLOAD_TIMEOUT = 600   # 10 min for large video uploads
SCREENAPP_ANALYSIS_TIMEOUT = 300  # 5 min for AI analysis
SCREENAPP_POLL_INTERVAL = 5.0
SCREENAPP_MAX_POLLS = 60


def _get_config() -> Dict[str, str]:
    return {
        "api_key": os.getenv("SCREENAPP_API_KEY", "").strip(),
        "team_id": os.getenv("SCREENAPP_TEAM_ID", "").strip(),
        "folder_id": os.getenv("SCREENAPP_FOLDER_ID", "").strip(),
    }


def _headers(api_key: str) -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


def is_enabled() -> bool:
    """Check if ScreenApp integration is configured and enabled."""
    if os.getenv("SCREENAPP_ENABLED", "1") != "1":
        return False
    cfg = _get_config()
    return bool(cfg["api_key"] and cfg["team_id"])


def _upload_video(
    client: httpx.Client,
    headers: Dict[str, str],
    team_id: str,
    folder_id: str,
    video: Path,
) -> Optional[str]:
    """
    Upload a video file to ScreenApp via pre-signed URL.
    Returns the fileId on success, None on failure.
    """
    content_type = "video/mp4"

    # Step 1: Request pre-signed upload URL
    logger.info(f"[SCREENAPP] Requesting upload URL for {video.name}")
    resp = client.post(
        f"{SCREENAPP_BASE_URL}/files/upload/{team_id}/{folder_id}/url",
        headers=headers,
        json={
            "files": [
                {
                    "contentType": content_type,
                    "name": video.name,
                }
            ]
        },
    )
    if resp.status_code != 200:
        logger.warning(f"[SCREENAPP] Upload URL request failed: {resp.status_code} {resp.text[:300]}")
        return None

    data = resp.json()
    # Response may vary — try common shapes
    files_data = data.get("data", data.get("files", [data]))
    if isinstance(files_data, list) and len(files_data) > 0:
        file_entry = files_data[0]
    elif isinstance(files_data, dict):
        file_entry = files_data
    else:
        logger.warning(f"[SCREENAPP] Unexpected upload URL response: {data}")
        return None

    upload_url = file_entry.get("uploadUrl", file_entry.get("url", ""))
    file_id = file_entry.get("fileId", file_entry.get("id", ""))

    if not upload_url:
        logger.warning(f"[SCREENAPP] No upload URL in response: {data}")
        return None

    # Step 2: PUT the actual file to the pre-signed URL
    file_size_mb = video.stat().st_size / 1024 / 1024
    logger.info(f"[SCREENAPP] Uploading {video.name} ({file_size_mb:.1f} MB) to pre-signed URL")
    with open(video, "rb") as f:
        put_resp = client.put(
            upload_url,
            content=f.read(),
            headers={"Content-Type": content_type},
            timeout=SCREENAPP_UPLOAD_TIMEOUT,
        )
    if put_resp.status_code not in (200, 201, 204):
        logger.warning(f"[SCREENAPP] File upload failed: {put_resp.status_code} {put_resp.text[:300]}")
        return None

    # Step 3: Finalize the upload
    logger.info(f"[SCREENAPP] Finalizing upload for fileId={file_id}")
    fin_resp = client.post(
        f"{SCREENAPP_BASE_URL}/files/upload/{team_id}/{folder_id}/finalize",
        headers=headers,
        json={
            "file": {
                "fileId": file_id,
                "contentType": content_type,
                "name": video.stem,
                "description": f"Dubverse analysis: {video.name}",
            }
        },
    )
    if fin_resp.status_code != 200:
        logger.warning(f"[SCREENAPP] Finalize failed: {fin_resp.status_code} {fin_resp.text[:300]}")
        # The file may still be usable even if finalize returns non-200
        if not file_id:
            return None

    # Try to extract fileId from finalize response if we didn't get one earlier
    if not file_id:
        fin_data = fin_resp.json()
        file_id = (
            fin_data.get("fileId")
            or fin_data.get("id")
            or (fin_data.get("data", {}) or {}).get("fileId", "")
        )

    if not file_id:
        logger.warning("[SCREENAPP] Could not determine fileId after upload")
        return None

    logger.info(f"[SCREENAPP] Upload complete: fileId={file_id}")
    return file_id


def _ask_multimodal(
    client: httpx.Client,
    headers: Dict[str, str],
    file_id: str,
    prompt: str,
) -> Optional[Dict[str, Any]]:
    """
    Ask a multimodal question about an uploaded file.
    Returns the analysis result or None.
    """
    logger.info(f"[SCREENAPP] Asking multimodal analysis for fileId={file_id}")
    resp = client.post(
        f"{SCREENAPP_BASE_URL}/files/{file_id}/ask/multimodal",
        headers=headers,
        json={"promptText": prompt},
        timeout=SCREENAPP_ANALYSIS_TIMEOUT,
    )

    if resp.status_code == 200:
        result = resp.json()
        logger.info(f"[SCREENAPP] Analysis complete for fileId={file_id}")
        return result
    elif resp.status_code == 202:
        # Async — poll for results
        result_url = resp.json().get("result_url", resp.json().get("url", ""))
        if result_url:
            return _poll_for_results(client, headers, result_url)
        logger.warning("[SCREENAPP] 202 but no result_url in response")
        return None
    elif resp.status_code == 403:
        logger.warning("[SCREENAPP] AI usage limit exceeded (403)")
        return None
    else:
        logger.warning(f"[SCREENAPP] Analysis failed: {resp.status_code} {resp.text[:300]}")
        return None


def _poll_for_results(
    client: httpx.Client,
    headers: Dict[str, str],
    result_url: str,
) -> Optional[Dict[str, Any]]:
    """Poll for async analysis results."""
    for i in range(SCREENAPP_MAX_POLLS):
        time.sleep(SCREENAPP_POLL_INTERVAL)
        try:
            resp = client.get(result_url, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                status = data.get("status", "")
                if status in ("completed", "done", "ready"):
                    logger.info(f"[SCREENAPP] Results ready after {(i+1)*SCREENAPP_POLL_INTERVAL:.0f}s")
                    return data
                if status in ("failed", "error"):
                    logger.warning(f"[SCREENAPP] Analysis failed: {data.get('error', 'unknown')}")
                    return None
            elif resp.status_code == 202:
                continue
            else:
                logger.warning(f"[SCREENAPP] Poll returned {resp.status_code}")
                return None
        except Exception as e:
            logger.warning(f"[SCREENAPP] Poll error: {e}")
            return None
    logger.warning(f"[SCREENAPP] Timed out after {SCREENAPP_MAX_POLLS * SCREENAPP_POLL_INTERVAL:.0f}s")
    return None


def analyze_video(
    video_path: str,
    summary_length: str = "detailed",
    include_timestamps: bool = True,
) -> Optional[Dict[str, Any]]:
    """
    Upload a video to ScreenApp and get AI analysis results.

    Args:
        video_path: Path to the video file (mp4)
        summary_length: "short", "medium", or "detailed"
        include_timestamps: Whether to request timestamped segments

    Returns:
        Structured dict with analysis results, or None on any error.
    """
    cfg = _get_config()
    if not cfg["api_key"] or not cfg["team_id"]:
        logger.info("[SCREENAPP] No API key or team ID configured, skipping")
        return None

    if not cfg["folder_id"]:
        logger.warning(
            "[SCREENAPP] No SCREENAPP_FOLDER_ID configured. "
            "Set it in .env — get the folder ID from your ScreenApp dashboard."
        )
        return None

    video = Path(video_path)
    if not video.exists():
        logger.warning(f"[SCREENAPP] Video not found: {video_path}")
        return None

    try:
        hdrs = _headers(cfg["api_key"])

        with httpx.Client(timeout=SCREENAPP_UPLOAD_TIMEOUT) as client:
            # Upload the video
            file_id = _upload_video(
                client, hdrs, cfg["team_id"], cfg["folder_id"], video
            )
            if not file_id:
                return None

            # Build analysis prompt
            detail_map = {
                "short": "briefly",
                "medium": "with moderate detail",
                "detailed": "in thorough detail",
            }
            detail = detail_map.get(summary_length, "in thorough detail")
            ts_instruction = (
                " Include timestamps for each key moment."
                if include_timestamps
                else ""
            )
            prompt = (
                f"Analyze this video {detail}. "
                f"Provide: 1) A summary of the content, "
                f"2) Key moments and topics discussed, "
                f"3) Speaker identification if multiple speakers, "
                f"4) Audio quality assessment, "
                f"5) Any notable issues with audio sync or clarity."
                f"{ts_instruction}"
            )

            # Run multimodal analysis
            result = _ask_multimodal(client, hdrs, file_id, prompt)
            if result is None:
                return None

            return _normalize_result(result)

    except httpx.TimeoutException:
        logger.warning(f"[SCREENAPP] Timeout for {video.name}")
        return None
    except Exception as e:
        logger.warning(f"[SCREENAPP] Error analyzing {video.name}: {e}")
        return None


def _normalize_result(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize ScreenApp response into a consistent structure."""
    # The /ask/multimodal response may have different shapes
    answer = raw.get("answer", raw.get("response", raw.get("text", "")))
    return {
        "summary": answer if isinstance(answer, str) else raw.get("summary", ""),
        "segments": raw.get("segments", []),
        "speakers": raw.get("speakers", []),
        "key_moments": raw.get("key_moments", raw.get("highlights", [])),
        "confidence_scores": raw.get("confidence_scores", []),
        "language": raw.get("language", ""),
        "duration": raw.get("duration", 0),
        "raw": raw,
    }
