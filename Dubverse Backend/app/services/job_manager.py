from typing import Dict
from datetime import datetime
import asyncio
import logging

from app.models import Job, JobStatus

logger = logging.getLogger(__name__)


class JobManager:
    def __init__(self):
        self._jobs: Dict[str, Job] = {}
        self._lock = asyncio.Lock()
    
    async def create_job(
        self,
        job_id: str,
        video_filename: str,
        video_path: str,
        video_size: int
    ) -> Job:
        async with self._lock:
            job = Job(
                job_id=job_id,
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
            
            logger.info(f"Job {job_id} updated: status={status}, progress={progress}%")
    
    async def update_job_chunks(self, job_id: str, chunks: list):
        async with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.chunks = chunks
                job.total_chunks = len(chunks)
                job.updated_at = datetime.now()
    
    async def update_chunk_processed(self, job_id: str):
        async with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.processed_chunks += 1
                job.updated_at = datetime.now()
    
    async def update_job_transcript(self, job_id: str, transcript):
        async with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.transcript = transcript
                job.updated_at = datetime.now()
                logger.info(f"Job {job_id} transcript updated with {len(transcript.segments) if transcript else 0} segments")
    
    async def update_job_speaker_genders(self, job_id: str, speaker_genders: dict):
        async with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.speaker_genders = speaker_genders
                job.updated_at = datetime.now()
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
                logger.info(f"Job {job_id} dubbing result updated: url={dubbed_video_url}, engine={tts_engine}")

    async def delete_job(self, job_id: str) -> bool:
        async with self._lock:
            if job_id in self._jobs:
                del self._jobs[job_id]
                logger.info(f"Deleted job {job_id}")
                return True
            return False
    
    async def list_jobs(self) -> list[Job]:
        async with self._lock:
            return list(self._jobs.values())


job_manager = JobManager()
