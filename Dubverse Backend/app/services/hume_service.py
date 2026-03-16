"""
Hume AI Expression Measurement — prosody/emotion analysis for dubbed audio.

Uses the Hume Batch API to analyze emotional expression in speech.
Returns None on any error — QC analysis degrades gracefully without Hume.
"""

import json
import logging
import os
import time
from pathlib import Path
from typing import Optional, Dict, Any, List

import httpx

logger = logging.getLogger(__name__)

HUME_API_BASE = "https://api.hume.ai/v0/batch/jobs"
HUME_POLL_INTERVAL = 5.0
HUME_MAX_POLLS = 120  # 10 minutes max
HUME_TIMEOUT = 60  # per-request timeout


def _get_api_key() -> Optional[str]:
    key = os.getenv("HUME_API_KEY", "").strip()
    return key if key else None


def is_enabled() -> bool:
    """Check if Hume AI integration is configured and enabled."""
    if os.getenv("HUME_ENABLED", "1") != "1":
        return False
    return _get_api_key() is not None


def analyze_prosody(audio_path: str) -> Optional[Dict[str, Any]]:
    """
    Submit audio to Hume Batch API with prosody model and return results.

    Args:
        audio_path: Path to audio/video file

    Returns:
        Raw Hume results dict with per-segment emotions, or None on error.
    """
    api_key = _get_api_key()
    if not api_key:
        logger.info("[HUME] No API key configured, skipping")
        return None

    audio = Path(audio_path)
    if not audio.exists():
        logger.warning(f"[HUME] Audio not found: {audio_path}")
        return None

    try:
        headers = {
            "X-Hume-Api-Key": api_key,
        }

        with httpx.Client(timeout=HUME_TIMEOUT) as client:
            # Submit batch job with prosody model
            logger.info(f"[HUME] Submitting {audio.name} for prosody analysis")
            with open(audio, "rb") as f:
                response = client.post(
                    HUME_API_BASE,
                    headers=headers,
                    data={
                        "json": json.dumps({
                            "models": {
                                "prosody": {}
                            }
                        })
                    },
                    files={"file": (audio.name, f, "audio/mpeg")},
                )

            if response.status_code not in (200, 201, 202):
                logger.warning(
                    f"[HUME] Submit returned {response.status_code}: "
                    f"{response.text[:300]}"
                )
                return None

            job_data = response.json()
            job_id = job_data.get("job_id")
            if not job_id:
                logger.warning("[HUME] No job_id in response")
                return None

            logger.info(f"[HUME] Job submitted: {job_id}")

            # Poll for completion
            return _poll_job(client, headers, job_id)

    except httpx.TimeoutException:
        logger.warning(f"[HUME] Timeout for {audio.name}")
        return None
    except Exception as e:
        logger.warning(f"[HUME] Error analyzing {audio.name}: {e}")
        return None


def _poll_job(
    client: httpx.Client,
    headers: dict,
    job_id: str,
) -> Optional[Dict[str, Any]]:
    """Poll Hume batch job until completion."""
    for i in range(HUME_MAX_POLLS):
        time.sleep(HUME_POLL_INTERVAL)
        try:
            resp = client.get(f"{HUME_API_BASE}/{job_id}", headers=headers)
            if resp.status_code != 200:
                logger.warning(f"[HUME] Poll returned {resp.status_code}")
                continue

            data = resp.json()
            state = data.get("state", {})
            status = state.get("status", "")

            if status == "COMPLETED":
                logger.info(f"[HUME] Job completed after {(i+1)*HUME_POLL_INTERVAL:.0f}s")
                return _fetch_predictions(client, headers, job_id)
            elif status in ("FAILED", "ERROR"):
                msg = state.get("message", "unknown error")
                logger.warning(f"[HUME] Job failed: {msg}")
                return None
            # QUEUED, IN_PROGRESS — keep polling

        except Exception as e:
            logger.warning(f"[HUME] Poll error: {e}")
            continue

    logger.warning(f"[HUME] Timed out after {HUME_MAX_POLLS * HUME_POLL_INTERVAL:.0f}s")
    return None


def _fetch_predictions(
    client: httpx.Client,
    headers: dict,
    job_id: str,
) -> Optional[Dict[str, Any]]:
    """Fetch prediction results for a completed job."""
    try:
        resp = client.get(
            f"{HUME_API_BASE}/{job_id}/predictions",
            headers=headers,
        )
        if resp.status_code != 200:
            logger.warning(f"[HUME] Predictions returned {resp.status_code}")
            return None
        return resp.json()
    except Exception as e:
        logger.warning(f"[HUME] Error fetching predictions: {e}")
        return None


def compute_emotion_scores(results: Dict[str, Any]) -> Dict[str, Any]:
    """
    Compute emotion variance and intensity from Hume prosody results.

    Args:
        results: Raw Hume predictions response

    Returns:
        {
            "emotion_variance": 0-100 (higher = more natural/varied),
            "emotion_intensity": 0-100 (higher = stronger emotional peaks),
            "top_emotions": [{"name": str, "score": float}, ...],
            "segment_count": int,
        }
    """
    try:
        # Navigate Hume response structure:
        # results -> [file] -> results -> predictions -> [segments] -> models -> prosody -> grouped_predictions -> [groups] -> predictions -> [frames] -> emotions
        all_segment_emotions: List[Dict[str, float]] = []

        files = results if isinstance(results, list) else results.get("results", results)
        if not isinstance(files, list):
            files = [files]

        for file_result in files:
            predictions = file_result.get("results", {}).get("predictions", [])
            for pred in predictions:
                prosody = pred.get("models", {}).get("prosody", {})
                grouped = prosody.get("grouped_predictions", [])
                for group in grouped:
                    for frame in group.get("predictions", []):
                        emotions = frame.get("emotions", [])
                        if emotions:
                            emo_dict = {e["name"]: e["score"] for e in emotions}
                            all_segment_emotions.append(emo_dict)

        if not all_segment_emotions:
            return {
                "emotion_variance": 0,
                "emotion_intensity": 0,
                "top_emotions": [],
                "segment_count": 0,
            }

        # Get all emotion names
        all_names = set()
        for seg in all_segment_emotions:
            all_names.update(seg.keys())

        # Compute per-emotion stats across segments
        emotion_means: Dict[str, float] = {}
        emotion_stds: Dict[str, float] = {}
        for name in all_names:
            values = [seg.get(name, 0.0) for seg in all_segment_emotions]
            mean = sum(values) / len(values)
            emotion_means[name] = mean
            variance = sum((v - mean) ** 2 for v in values) / len(values)
            emotion_stds[name] = variance ** 0.5

        # Top 5 emotions by mean score
        sorted_emotions = sorted(emotion_means.items(), key=lambda x: x[1], reverse=True)
        top_5 = sorted_emotions[:5]

        # Emotion variance: std dev of top-5 emotions across segments
        # Higher variance = more varied/natural speech
        top_5_names = [e[0] for e in top_5]
        top_5_stds = [emotion_stds[n] for n in top_5_names]
        avg_std = sum(top_5_stds) / len(top_5_stds) if top_5_stds else 0

        # Scale to 0-100. Typical std dev range is 0.0 to 0.3
        emotion_variance = min(100, round(avg_std * 333))

        # Emotion intensity: average peak score across segments
        peak_scores = []
        for seg in all_segment_emotions:
            if seg:
                peak_scores.append(max(seg.values()))
        avg_peak = sum(peak_scores) / len(peak_scores) if peak_scores else 0

        # Scale to 0-100. Typical peak range is 0.1 to 0.8
        emotion_intensity = min(100, round(avg_peak * 125))

        return {
            "emotion_variance": emotion_variance,
            "emotion_intensity": emotion_intensity,
            "top_emotions": [
                {"name": name, "score": round(score, 4)}
                for name, score in top_5
            ],
            "segment_count": len(all_segment_emotions),
        }

    except Exception as e:
        logger.warning(f"[HUME] Error computing emotion scores: {e}")
        return {
            "emotion_variance": 0,
            "emotion_intensity": 0,
            "top_emotions": [],
            "segment_count": 0,
        }
