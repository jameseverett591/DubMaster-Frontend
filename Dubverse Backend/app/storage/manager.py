import os
from pathlib import Path
from typing import Optional
import shutil
from datetime import datetime, timedelta
import logging

from app.config import get_settings

logger = logging.getLogger(__name__)


def setup_storage_dirs():
    settings = get_settings()
    
    dirs = [
        settings.UPLOAD_DIR,
        settings.CHUNKS_DIR,
        settings.PROCESSED_DIR,
        settings.OUTPUT_DIR,
    ]
    
    for dir_path in dirs:
        Path(dir_path).mkdir(parents=True, exist_ok=True)
        logger.info(f"Storage directory ensured: {dir_path}")


class StorageManager:
    def __init__(self):
        self.settings = get_settings()
    
    def get_upload_path(self, job_id: str, filename: str) -> str:
        job_dir = Path(self.settings.UPLOAD_DIR) / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        return str(job_dir / filename)
    
    def get_chunks_dir(self, job_id: str) -> str:
        chunks_dir = Path(self.settings.CHUNKS_DIR) / job_id
        chunks_dir.mkdir(parents=True, exist_ok=True)
        return str(chunks_dir)
    
    def get_chunk_path(self, job_id: str, chunk_id: str) -> str:
        chunks_dir = self.get_chunks_dir(job_id)
        return str(Path(chunks_dir) / f"{chunk_id}.mp4")
    
    def get_audio_path(self, job_id: str, chunk_id: str = None) -> str:
        if chunk_id:
            audio_dir = Path(self.settings.PROCESSED_DIR) / job_id / "audio"
            audio_dir.mkdir(parents=True, exist_ok=True)
            return str(audio_dir / f"{chunk_id}.wav")
        else:
            audio_dir = Path(self.settings.PROCESSED_DIR) / job_id / "audio"
            audio_dir.mkdir(parents=True, exist_ok=True)
            return str(audio_dir / "full_audio.wav")
    
    def get_output_path(self, job_id: str, filename: str) -> str:
        output_dir = Path(self.settings.OUTPUT_DIR) / job_id
        output_dir.mkdir(parents=True, exist_ok=True)
        return str(output_dir / filename)
    
    def delete_job_files(self, job_id: str) -> bool:
        try:
            dirs_to_delete = [
                Path(self.settings.UPLOAD_DIR) / job_id,
                Path(self.settings.CHUNKS_DIR) / job_id,
                Path(self.settings.PROCESSED_DIR) / job_id,
                Path(self.settings.OUTPUT_DIR) / job_id,
            ]
            
            for dir_path in dirs_to_delete:
                if dir_path.exists():
                    shutil.rmtree(dir_path)
                    logger.info(f"Deleted directory: {dir_path}")
            
            return True
        except Exception as e:
            logger.error(f"Failed to delete job files for {job_id}: {e}")
            return False
    
    def cleanup_old_files(self):
        settings = self.settings
        cutoff_time = datetime.now() - timedelta(hours=settings.CLEANUP_AFTER_HOURS)
        
        base_dirs = [
            settings.UPLOAD_DIR,
            settings.CHUNKS_DIR,
            settings.PROCESSED_DIR,
            settings.OUTPUT_DIR,
        ]
        
        for base_dir in base_dirs:
            base_path = Path(base_dir)
            if not base_path.exists():
                continue
            
            for job_dir in base_path.iterdir():
                if not job_dir.is_dir():
                    continue
                
                mod_time = datetime.fromtimestamp(job_dir.stat().st_mtime)
                if mod_time < cutoff_time:
                    try:
                        shutil.rmtree(job_dir)
                        logger.info(f"Cleaned up old directory: {job_dir}")
                    except Exception as e:
                        logger.error(f"Failed to cleanup {job_dir}: {e}")
    
    def get_file_size(self, file_path: str) -> int:
        return os.path.getsize(file_path)
    
    def file_exists(self, file_path: str) -> bool:
        return os.path.exists(file_path)
