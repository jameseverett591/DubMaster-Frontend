"""
Tencent Cloud ASR client for Cantonese speech recognition.

Uses Tencent's SaaS ASR API which excels at:
  - Noisy real-world audio (fight scenes, SFX, crowds)
  - Short Cantonese interjections (好啊, 喂, 哎呀)
  - Tonal disambiguation under compression artifacts
  - Overlapping speech recovery

Environment variables:
  TENCENT_SECRET_ID   — Tencent Cloud SecretId
  TENCENT_SECRET_KEY  — Tencent Cloud SecretKey
  TENCENT_ASR_APPID   — (optional) AppId for the ASR service
"""

import base64
import hashlib
import hmac
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

# Tencent Cloud ASR endpoint
_ASR_ENDPOINT = "asr.tencentcloudapi.com"
_ASR_SERVICE = "asr"
_ASR_VERSION = "2019-06-14"
_ASR_REGION = "ap-guangzhou"  # Best for Cantonese


def _get_credentials() -> Optional[tuple]:
    """Return (secret_id, secret_key) or None if not configured."""
    secret_id = os.getenv("TENCENT_SECRET_ID", "").strip()
    secret_key = os.getenv("TENCENT_SECRET_KEY", "").strip()
    if not secret_id or not secret_key:
        return None
    return secret_id, secret_key


def _sign_request(
    secret_id: str,
    secret_key: str,
    action: str,
    payload: str,
    timestamp: int,
) -> dict:
    """
    Generate Tencent Cloud API v3 (TC3-HMAC-SHA256) authorization headers.
    """
    date = datetime.fromtimestamp(timestamp, tz=timezone.utc).strftime("%Y-%m-%d")
    content_type = "application/json"
    host = _ASR_ENDPOINT

    # Step 1: Canonical request
    canonical_headers = f"content-type:{content_type}\nhost:{host}\n"
    signed_headers = "content-type;host"
    payload_hash = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    canonical_request = (
        f"POST\n/\n\n{canonical_headers}\n{signed_headers}\n{payload_hash}"
    )

    # Step 2: String to sign
    credential_scope = f"{date}/{_ASR_SERVICE}/tc3_request"
    hashed_canonical = hashlib.sha256(canonical_request.encode("utf-8")).hexdigest()
    string_to_sign = f"TC3-HMAC-SHA256\n{timestamp}\n{credential_scope}\n{hashed_canonical}"

    # Step 3: Signing key
    def _hmac_sha256(key: bytes, msg: str) -> bytes:
        return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()

    secret_date = _hmac_sha256(("TC3" + secret_key).encode("utf-8"), date)
    secret_service = _hmac_sha256(secret_date, _ASR_SERVICE)
    secret_signing = _hmac_sha256(secret_service, "tc3_request")
    signature = hmac.new(
        secret_signing, string_to_sign.encode("utf-8"), hashlib.sha256
    ).hexdigest()

    # Step 4: Authorization header
    authorization = (
        f"TC3-HMAC-SHA256 "
        f"Credential={secret_id}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, "
        f"Signature={signature}"
    )

    return {
        "Authorization": authorization,
        "Content-Type": content_type,
        "Host": host,
        "X-TC-Action": action,
        "X-TC-Timestamp": str(timestamp),
        "X-TC-Version": _ASR_VERSION,
        "X-TC-Region": _ASR_REGION,
    }


def _call_tencent_api(action: str, params: dict) -> dict:
    """Make a signed request to Tencent Cloud ASR API."""
    creds = _get_credentials()
    if creds is None:
        raise RuntimeError("TENCENT_SECRET_ID / TENCENT_SECRET_KEY not set")

    secret_id, secret_key = creds
    payload = json.dumps(params)
    timestamp = int(time.time())
    headers = _sign_request(secret_id, secret_key, action, payload, timestamp)

    url = f"https://{_ASR_ENDPOINT}"
    with httpx.Client(timeout=300) as client:
        resp = client.post(url, content=payload, headers=headers)
        resp.raise_for_status()
        return resp.json()


def transcribe_with_tencent(
    audio_path: str,
    language: str = "yue",
    job_id: str | None = None,
) -> Dict[str, Any]:
    """
    Transcribe audio using Tencent Cloud ASR.

    Supports Cantonese (yue), Mandarin (zh), English (en).
    Returns segments with timestamps and confidence scores.

    This function NEVER raises — returns status="skipped" on failure.
    """
    creds = _get_credentials()
    if creds is None:
        logger.info("[TENCENT-ASR] Skipping — credentials not configured")
        return {
            "status": "skipped",
            "reason": "credentials_not_configured",
            "segments": [],
        }

    if not os.path.exists(audio_path):
        logger.warning(f"[TENCENT-ASR] Audio file not found: {audio_path}")
        return {
            "status": "skipped",
            "reason": "audio_not_found",
            "segments": [],
        }

    try:
        # Read and base64-encode the audio file
        with open(audio_path, "rb") as f:
            audio_data = f.read()

        audio_b64 = base64.b64encode(audio_data).decode("utf-8")
        file_size = len(audio_data)

        # Map language codes to Tencent's engine type
        # 16k_zh      = Mandarin
        # 16k_zh_dialect = Cantonese / dialects
        # 16k_en      = English
        engine_map = {
            "yue": "16k_zh_dialect",
            "zh": "16k_zh",
            "cmn": "16k_zh",
            "en": "16k_en",
        }
        engine_type = engine_map.get(language, "16k_zh_dialect")

        logger.info(
            f"[TENCENT-ASR] Sending {file_size // 1024}KB audio, "
            f"engine={engine_type}, job={job_id}"
        )

        # CreateRecTask — async recognition for files > 1 min
        params = {
            "EngineModelType": engine_type,
            "ChannelNum": 1,
            "ResTextFormat": 3,  # Word-level timestamps
            "SourceType": 1,     # Inline audio data
            "Data": audio_b64,
            "DataLen": file_size,
            "ConvertNumMode": 0,
            "FilterDirty": 0,
            "FilterPunc": 0,
            "SpeakerDiarization": 1,  # Enable speaker diarization
            "SpeakerNumber": 3,       # Expected speakers
        }

        # Step 1: Create recognition task
        result = _call_tencent_api("CreateRecTask", params)
        response = result.get("Response", {})

        if "Error" in response:
            error = response["Error"]
            logger.error(
                f"[TENCENT-ASR] API error: {error.get('Code')}: {error.get('Message')}"
            )
            return {
                "status": "skipped",
                "reason": "api_error",
                "error_message": f"{error.get('Code')}: {error.get('Message')}",
                "segments": [],
            }

        task_id = response.get("Data", {}).get("TaskId")
        if not task_id:
            logger.error("[TENCENT-ASR] No TaskId in response")
            return {
                "status": "skipped",
                "reason": "no_task_id",
                "segments": [],
            }

        logger.info(f"[TENCENT-ASR] Task created: {task_id}")

        # Step 2: Poll for completion
        max_polls = 120  # 10 minutes at 5s intervals
        for poll in range(max_polls):
            time.sleep(5)
            poll_result = _call_tencent_api(
                "DescribeTaskStatus", {"TaskId": task_id}
            )
            poll_response = poll_result.get("Response", {})

            if "Error" in poll_response:
                error = poll_response["Error"]
                logger.error(f"[TENCENT-ASR] Poll error: {error}")
                continue

            task_data = poll_response.get("Data", {})
            status = task_data.get("StatusStr", "")

            if status == "success":
                logger.info(
                    f"[TENCENT-ASR] Task {task_id} completed after {(poll + 1) * 5}s"
                )
                return _parse_tencent_result(task_data, job_id)
            elif status == "failed":
                logger.error(
                    f"[TENCENT-ASR] Task {task_id} failed: "
                    f"{task_data.get('ErrorMsg', 'unknown')}"
                )
                return {
                    "status": "skipped",
                    "reason": "task_failed",
                    "error_message": task_data.get("ErrorMsg", "unknown"),
                    "segments": [],
                }

            if poll % 6 == 0:
                logger.info(
                    f"[TENCENT-ASR] Waiting... status={status}, "
                    f"elapsed={(poll + 1) * 5}s"
                )

        logger.error(f"[TENCENT-ASR] Task {task_id} timed out after 10 minutes")
        return {
            "status": "skipped",
            "reason": "timeout",
            "segments": [],
        }

    except Exception as e:
        logger.error(
            f"[TENCENT-ASR] Failed: {type(e).__name__}: {e}", exc_info=True
        )
        return {
            "status": "skipped",
            "reason": "exception",
            "error_message": str(e),
            "segments": [],
        }


def _parse_tencent_result(
    task_data: dict, job_id: str | None = None
) -> Dict[str, Any]:
    """Parse Tencent ASR result into our standard segment format."""
    result_text = task_data.get("Result", "")
    result_detail = task_data.get("ResultDetail", [])

    segments: List[Dict[str, Any]] = []

    if result_detail:
        # Word-level results available
        for sentence in result_detail:
            text = sentence.get("FinalSentence", "").strip()
            if not text:
                continue

            # Timestamps are in milliseconds
            start_ms = sentence.get("StartMs", 0)
            end_ms = sentence.get("EndMs", 0)
            speaker = sentence.get("SpeakerId", 0)
            confidence = sentence.get("WordsResultDetail", [])

            # Calculate average confidence from word details
            avg_conf = 0.0
            if confidence:
                confs = [w.get("Confidence", 0) for w in confidence]
                avg_conf = sum(confs) / len(confs) if confs else 0.0

            segments.append({
                "start": round(start_ms / 1000.0, 3),
                "end": round(end_ms / 1000.0, 3),
                "text": text,
                "confidence": round(avg_conf, 4),
                "speaker_id": speaker,
                "source": "tencent",
            })
    elif result_text:
        # Fallback: just the full text, no timestamps
        segments.append({
            "start": 0.0,
            "end": 0.0,
            "text": result_text.strip(),
            "confidence": 0.0,
            "source": "tencent",
        })

    logger.info(
        f"[TENCENT-ASR] Parsed {len(segments)} segments for job={job_id}"
    )

    return {
        "status": "ok",
        "segments": segments,
        "full_text": result_text,
    }
