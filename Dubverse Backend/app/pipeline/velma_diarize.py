"""
Velma (Modulate) diarization service — replaces pyannote for speaker detection.
Uses the velma-2-batch STT endpoint which returns transcription + speaker labels
in a single API call.
"""
import os
import logging
import requests

logger = logging.getLogger(__name__)

VELMA_BATCH_URL = "https://modulate-developer-apis.com/api/velma-2-stt-batch"

def velma_diarize(audio_path: str, job_id: str, num_speakers: int = 0) -> dict:
    """
    Send audio to Velma batch STT and return diarized segments in DubMaster format.

    Args:
        audio_path: Path to audio file (WAV, MP3, etc.)
        job_id: Job ID for logging
        num_speakers: Expected number of speakers (0 = auto-detect)

    Returns:
        {"status": "ok", "segments": [...], "transcript": str} on success
        {"status": "skipped", "reason": "velma_failed", "error_message": str} on failure
    """
    api_key = os.getenv("MODULATE_API_KEY", "").strip()
    if not api_key:
        logger.warning(f"[VELMA] Job {job_id}: MODULATE_API_KEY not set — skipping")
        return {"status": "skipped", "reason": "no_api_key", "error_message": "MODULATE_API_KEY not configured"}

    if not os.path.exists(audio_path):
        logger.warning(f"[VELMA] Job {job_id}: audio file not found: {audio_path}")
        return {"status": "skipped", "reason": "file_not_found", "error_message": f"Audio file not found: {audio_path}"}

    try:
        logger.info(f"[VELMA] Job {job_id}: sending {audio_path} to Velma batch STT")

        with open(audio_path, "rb") as f:
            response = requests.post(
                VELMA_BATCH_URL,
                headers={"X-API-Key": api_key},
                files={"upload_file": f},
                timeout=300,
            )

        if response.status_code != 200:
            logger.error(f"[VELMA] Job {job_id}: API error {response.status_code}: {response.text[:200]}")
            return {
                "status": "skipped",
                "reason": "velma_api_error",
                "error_message": f"HTTP {response.status_code}: {response.text[:200]}"
            }

        data = response.json()
        utterances = data.get("utterances", [])

        if not utterances:
            logger.warning(f"[VELMA] Job {job_id}: no utterances returned")
            return {"status": "skipped", "reason": "no_utterances", "error_message": "Velma returned no utterances"}

        # Convert Velma utterances to DubMaster segment format
        segments = []
        for utt in utterances:
            speaker_num = utt.get("speaker", 1)
            segments.append({
                "start": utt.get("start_ms", 0) / 1000.0,
                "end": (utt.get("start_ms", 0) + utt.get("duration_ms", 0)) / 1000.0,
                "speaker": f"speaker-{speaker_num}",
                "text": utt.get("text", "").strip(),
            })

        unique_speakers = len(set(s["speaker"] for s in segments))
        logger.info(f"[VELMA] Job {job_id}: {len(segments)} segments, {unique_speakers} speakers detected")

        return {
            "status": "ok",
            "segments": segments,
            "transcript": data.get("text", ""),
            "duration_ms": data.get("duration_ms", 0),
            "unique_speakers": unique_speakers,
        }

    except requests.Timeout:
        logger.error(f"[VELMA] Job {job_id}: request timed out after 300s")
        return {"status": "skipped", "reason": "timeout", "error_message": "Velma API request timed out"}
    except Exception as e:
        logger.error(f"[VELMA] Job {job_id}: unexpected error: {e}", exc_info=True)
        return {"status": "skipped", "reason": "velma_failed", "error_message": str(e)}
