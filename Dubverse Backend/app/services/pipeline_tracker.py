"""
PipelineTracker – real-time per-stage status tracking for DubMaster pipelines.

Usage in routes.py:
    from app.services.pipeline_tracker import pipeline_tracker

    pipeline_tracker.init_pipeline(job_id, "analysis")
    pipeline_tracker.start_stage(job_id, "extract_audio")
    pipeline_tracker.complete_stage(job_id, "extract_audio", "16kHz mono WAV, 120.0s duration")
    pipeline_tracker.fail_stage(job_id, "transcribe", "Whisper model not found")
"""

import time
from typing import Dict, Optional


class PipelineTracker:
    """Tracks per-stage status and timing for each job's pipeline."""

    PIPELINE_STAGES = {
        "analysis": [
            {"id": "upload",        "name": "Upload",               "description": "Video file upload and validation"},
            {"id": "chunk",         "name": "Chunking",             "description": "Split video into processable chunks"},
            {"id": "extract_audio", "name": "Extract Audio",        "description": "FFmpeg extract audio track (16kHz mono WAV)"},
            {"id": "separate",      "name": "Source Separation",    "description": "Demucs htdemucs vocal/accompaniment split"},
            {"id": "transcribe",    "name": "Transcription",        "description": "Whisper large-v3 / Paraformer speech-to-text"},
            {"id": "diarize",       "name": "Speaker Diarization",  "description": "pyannote 3.1 speaker identification"},
            {"id": "classify",      "name": "Voice Classification", "description": "Pitch-based gender/age detection per speaker"},
        ],
        "dubbing": [
            {"id": "translate",  "name": "Translation",     "description": "DeepL / Claude / GPT-4 translation cascade"},
            {"id": "synthesize", "name": "Voice Synthesis",  "description": "ElevenLabs / Fish Audio TTS generation"},
            {"id": "align",      "name": "Time Alignment",   "description": "Match dubbed audio timing to original"},
            {"id": "mix",        "name": "Audio Mixing",      "description": "FFmpeg remix dubbed vocals + background"},
            {"id": "render",     "name": "Final Render",      "description": "Encode dubbed video (H.264/H.265)"},
        ],
        "gpu": [
            {"id": "download",   "name": "Download Video",     "description": "Download video from source to GPU worker"},
            {"id": "extract",    "name": "Extract Audio",       "description": "FFmpeg audio extraction on GPU"},
            {"id": "separate",   "name": "Source Separation",   "description": "Demucs htdemucs on GPU"},
            {"id": "transcribe", "name": "Transcription",       "description": "Whisper/Paraformer on GPU"},
            {"id": "diarize",    "name": "Speaker Diarization", "description": "pyannote on GPU"},
        ],
    }

    def __init__(self):
        self._pipelines: Dict[str, dict] = {}

    def init_pipeline(self, job_id: str, pipeline_type: str = "analysis"):
        stages = self.PIPELINE_STAGES.get(pipeline_type, self.PIPELINE_STAGES["analysis"])
        self._pipelines[job_id] = {
            "type": pipeline_type,
            "started_at": time.time(),
            "stages": {
                s["id"]: {
                    **s,
                    "status": "pending",
                    "started_at": None,
                    "completed_at": None,
                    "duration_ms": None,
                    "output_summary": None,
                    "error": None,
                }
                for s in stages
            },
            "stage_order": [s["id"] for s in stages],
        }

    def start_stage(self, job_id: str, stage_id: str):
        p = self._pipelines.get(job_id)
        if not p or stage_id not in p["stages"]:
            return
        p["stages"][stage_id]["status"] = "active"
        p["stages"][stage_id]["started_at"] = time.time()

    def complete_stage(self, job_id: str, stage_id: str, output_summary: str = None):
        p = self._pipelines.get(job_id)
        if not p or stage_id not in p["stages"]:
            return
        stage = p["stages"][stage_id]
        stage["status"] = "completed"
        stage["completed_at"] = time.time()
        if stage["started_at"]:
            stage["duration_ms"] = round((stage["completed_at"] - stage["started_at"]) * 1000)
        if output_summary:
            stage["output_summary"] = output_summary

    def fail_stage(self, job_id: str, stage_id: str, error: str):
        p = self._pipelines.get(job_id)
        if not p or stage_id not in p["stages"]:
            return
        stage = p["stages"][stage_id]
        stage["status"] = "failed"
        stage["completed_at"] = time.time()
        if stage["started_at"]:
            stage["duration_ms"] = round((stage["completed_at"] - stage["started_at"]) * 1000)
        stage["error"] = error

    def skip_stage(self, job_id: str, stage_id: str, reason: str = None):
        p = self._pipelines.get(job_id)
        if not p or stage_id not in p["stages"]:
            return
        p["stages"][stage_id]["status"] = "skipped"
        p["stages"][stage_id]["output_summary"] = reason or "Skipped"

    def get_pipeline(self, job_id: str) -> Optional[dict]:
        p = self._pipelines.get(job_id)
        if not p:
            return None
        total_elapsed = round((time.time() - p["started_at"]) * 1000)
        ordered_stages = [p["stages"][sid] for sid in p["stage_order"] if sid in p["stages"]]
        active_stage = next((s for s in ordered_stages if s["status"] == "active"), None)
        completed = sum(1 for s in ordered_stages if s["status"] == "completed")
        failed = sum(1 for s in ordered_stages if s["status"] == "failed")
        return {
            "type": p["type"],
            "total_elapsed_ms": total_elapsed,
            "stages": ordered_stages,
            "active_stage": active_stage["id"] if active_stage else None,
            "completed_stages": completed,
            "failed_stages": failed,
            "total_stages": len(ordered_stages),
        }

    def cleanup(self, job_id: str):
        self._pipelines.pop(job_id, None)


# Singleton
pipeline_tracker = PipelineTracker()
