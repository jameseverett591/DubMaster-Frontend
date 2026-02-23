import subprocess
import json
from pathlib import Path
from typing import Optional, List, Dict
import logging

from app.models import VideoChunk, JobStatus
from app.config import get_settings
from app.storage.manager import StorageManager

logger = logging.getLogger(__name__)


class VideoChunker:
    def __init__(self):
        self.settings = get_settings()
        self.storage = StorageManager()
    
    def get_video_duration(self, video_path: str) -> Optional[float]:
        try:
            cmd = [
                "ffprobe",
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "json",
                video_path
            ]
            
            result = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                check=True
            )
            
            data = json.loads(result.stdout)
            duration = float(data["format"]["duration"])
            logger.info(f"Video duration: {duration}s")
            return duration
            
        except Exception as e:
            logger.error(f"Failed to get video duration: {e}")
            return None
    
    def chunk_video(
        self,
        job_id: str,
        video_path: str,
        chunk_duration: int = None
    ) -> List[VideoChunk]:
        if chunk_duration is None:
            chunk_duration = self.settings.CHUNK_DURATION_SECONDS
        
        total_duration = self.get_video_duration(video_path)
        if not total_duration:
            logger.error("Could not determine video duration")
            return []
        
        chunks: List[VideoChunk] = []
        chunks_dir = self.storage.get_chunks_dir(job_id)
        
        current_time = 0.0
        sequence = 0
        
        while current_time < total_duration:
            chunk_id = f"chunk_{sequence:04d}"
            chunk_path = self.storage.get_chunk_path(job_id, chunk_id)
            
            start_time = max(0, current_time - self.settings.CHUNK_OVERLAP_SECONDS)
            end_time = min(current_time + chunk_duration, total_duration)
            duration = end_time - start_time
            
            success = self._extract_chunk(
                video_path,
                chunk_path,
                start_time,
                duration
            )
            
            if success:
                chunk = VideoChunk(
                    chunk_id=chunk_id,
                    sequence=sequence,
                    start_time=start_time,
                    end_time=end_time,
                    duration=duration,
                    chunk_path=chunk_path,
                    status=JobStatus.PENDING
                )
                chunks.append(chunk)
                logger.info(f"Created chunk {chunk_id}: {start_time}s - {end_time}s")
            else:
                logger.error(f"Failed to create chunk {chunk_id}")
            
            current_time += chunk_duration
            sequence += 1
        
        logger.info(f"Created {len(chunks)} chunks for job {job_id}")
        return chunks
    
    def _extract_chunk(
        self,
        input_path: str,
        output_path: str,
        start_time: float,
        duration: float
    ) -> bool:
        try:
            cmd = [
                "ffmpeg",
                "-y",
                "-ss", str(start_time),
                "-i", input_path,
                "-t", str(duration),
                "-c", "copy",
                "-avoid_negative_ts", "make_zero",
                output_path
            ]
            
            result = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                check=True
            )
            
            return True
            
        except subprocess.CalledProcessError as e:
            logger.error(f"FFmpeg chunking failed: {e.stderr}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error during chunking: {e}")
            return False
