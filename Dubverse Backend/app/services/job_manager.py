from typing import Dict
from datetime import datetime
import asyncio
import logging
import json
from pathlib import Path

from app.models import Job, JobStatus

logger = logging.getLogger(__name__)


async def _upsert_job(job) -> None:
    """Fire-and-forget upsert of job state to Supabase. Never raises."""
    try:
        from app.services.supabase_client import supabase
        payload = {
            "job_id": job.job_id,
            "user_id": job.user_id,
            "status": job.status.value,
            "progress": job.progress,
            "current_stage": job.current_stage,
            "runpod_job_id": job.runpod_job_id,
            "video_filename": job.video_filename,
            "video_path": job.video_path,
            "video_duration": job.video_duration,
            "video_size": job.video_size,
            "expected_speakers": job.expected_speakers,
            "source_language": job.source_language,
            "total_chunks": job.total_chunks,
            "processed_chunks": job.processed_chunks,
            "chunks": [c.model_dump() for c in job.chunks],
            "speaker_genders": job.speaker_genders,
            "voice_mapping": job.voice_mapping,
            "transcript_language": job.transcript.language if job.transcript else None,
            "transcript_duration": job.transcript.duration if job.transcript else None,
            "transcript_text": job.transcript.text if job.transcript else None,
            "speaker_profiles": job.transcript.speaker_profiles if job.transcript else None,
            "dubbed_video_url": job.dubbed_video_url,
            "tts_engine": job.tts_engine,
            "segment_tts_engines": job.segment_tts_engines,
            "dubbing_engine": job.dubbing_engine,
            "error_message": job.error_message,
            "created_at": job.created_at.isoformat(),
            "updated_at": job.updated_at.isoformat(),
            "completed_at": job.completed_at.isoformat() if job.completed_at else None,
        }
        supabase.table("jobs").upsert(payload).execute()
    except Exception as exc:
        logger.warning(f"Job {job.job_id}: Supabase upsert failed: {exc}")


async def _upsert_job_speakers(
    job_id: str,
    speaker_genders: dict,
    voice_mapping: dict | None,
) -> None:
    """Fire-and-forget upsert of speaker rows to Supabase. Never raises."""
    try:
        from app.services.supabase_client import upsert_job_speakers
        await upsert_job_speakers(job_id, speaker_genders, voice_mapping)
    except Exception as exc:
        logger.warning(f"Job {job_id}: job_speakers upsert failed: {exc}")


class JobManager:
    def __init__(self):
        self._jobs: Dict[str, Job] = {}
        self._deleted_ids: set[str] = set()
        self._lock = asyncio.Lock()

    def is_deleted(self, job_id: str) -> bool:
        return job_id in self._deleted_ids
    
    async def create_job(
        self,
        job_id: str,
        video_filename: str,
        video_path: str,
        video_size: int,
        user_id: str = ""
    ) -> Job:
        async with self._lock:
            job = Job(
                job_id=job_id,
                user_id=user_id,
                status=JobStatus.PENDING,
                progress=0,
                video_filename=video_filename,
                video_path=video_path,
                video_size=video_size,
                created_at=datetime.now(),
                updated_at=datetime.now(),
            )
            self._jobs[job_id] = job
            logger.info(f"Created job {job_id} for file {video_filename}")
            asyncio.create_task(_upsert_job(job))
            return job
    
    async def get_job(self, job_id: str) -> Job:
        async with self._lock:
            return self._jobs.get(job_id)
    
    async def update_job_status(
        self,
        job_id: str,
        status: JobStatus,
        progress: int = None,
        current_stage: str = None,
        error_message: str = None
    ):
        async with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                logger.error(f"Job {job_id} not found")
                return
            
            job.status = status
            if progress is not None:
                job.progress = progress
            if current_stage:
                job.current_stage = current_stage
            if error_message:
                job.error_message = error_message
            
            job.updated_at = datetime.now()
            
            if status == JobStatus.COMPLETED:
                job.completed_at = datetime.now()
                job.progress = 100

            asyncio.create_task(_upsert_job(job))
            logger.info(f"Job {job_id} updated: status={status}, progress={progress}%")
    
    async def update_job_chunks(self, job_id: str, chunks: list):
        async with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.chunks = chunks
                job.total_chunks = len(chunks)
                job.updated_at = datetime.now()
                asyncio.create_task(_upsert_job(job))
    
    async def update_chunk_processed(self, job_id: str):
        async with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.processed_chunks += 1
                job.updated_at = datetime.now()
                asyncio.create_task(_upsert_job(job))
    
    async def update_job_transcript(self, job_id: str, transcript):
        async with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.transcript = transcript
                job.updated_at = datetime.now()
                asyncio.create_task(_upsert_job(job))
                logger.info(f"Job {job_id} transcript updated with {len(transcript.segments) if transcript else 0} segments")

                if transcript:
                    try:
                        output_dir = Path("data/transcripts")
                        output_dir.mkdir(parents=True, exist_ok=True)
                        output_path = output_dir / f"{job_id}.json"

                        payload = {
                            "job_id": job_id,
                            "language": getattr(transcript, "language", None),
                            "duration": getattr(transcript, "duration", None),
                            "text": getattr(transcript, "text", None),
                            "segments": [
                                {
                                    "text": getattr(seg, "text", ""),
                                    "start": getattr(seg, "start", 0),
                                    "end": getattr(seg, "end", 0),
                                    "speaker": getattr(seg, "speaker", None),
                                }
                                for seg in (getattr(transcript, "segments", None) or [])
                            ],
                        }

                        with open(output_path, "w", encoding="utf-8") as f:
                            json.dump(payload, f, indent=2, ensure_ascii=False)
                    except Exception as exc:
                        logger.warning(f"Job {job_id}: failed to persist transcript to disk: {exc}")
    
    async def update_job_speaker_genders(self, job_id: str, speaker_genders: dict):
        async with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.speaker_genders = speaker_genders
                job.updated_at = datetime.now()
                asyncio.create_task(_upsert_job(job))
                asyncio.create_task(
                    _upsert_job_speakers(job_id, speaker_genders, job.voice_mapping)
                )
                logger.info(f"Job {job_id} speaker genders updated: {speaker_genders}")

    async def update_job_dubbing_result(
        self,
        job_id: str,
        dubbed_video_url: str,
        tts_engine: str = None,
        segment_tts_engines: list | None = None,
    ):
        async with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.dubbed_video_url = dubbed_video_url
                job.tts_engine = tts_engine
                if segment_tts_engines is not None:
                    job.segment_tts_engines = segment_tts_engines
                job.updated_at = datetime.now()
                asyncio.create_task(_upsert_job(job))
                logger.info(f"Job {job_id} dubbing result updated: url={dubbed_video_url}, engine={tts_engine}")

    async def delete_job(self, job_id: str) -> bool:
        async with self._lock:
            self._deleted_ids.add(job_id)
            if job_id in self._jobs:
                del self._jobs[job_id]
                logger.info(f"Deleted job {job_id}")
                return True
            logger.info(f"Marked job {job_id} as deleted (was not in memory)")
            return True
    
    async def list_jobs(self, user_id: str = "") -> list[Job]:
        async with self._lock:
            return [j for j in self._jobs.values() if j.user_id == user_id]


job_manager = JobManager()
