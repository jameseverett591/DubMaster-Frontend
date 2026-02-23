from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    APP_NAME: str = "Dubverse Backend"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = True
    
    CORS_ORIGINS: list[str] = ["*"]
    
    UPLOAD_DIR: str = "data/uploads"
    CHUNKS_DIR: str = "data/chunks"
    PROCESSED_DIR: str = "data/processed"
    OUTPUT_DIR: str = "data/output"
    DUBBED_DIR: str = "data/dubbed"
    
    MAX_UPLOAD_SIZE: int = 5 * 1024 * 1024 * 1024
    ALLOWED_VIDEO_FORMATS: list[str] = [".mp4", ".mov", ".avi", ".mkv", ".webm"]
    CHUNK_DURATION_SECONDS: int = 300
    CHUNK_OVERLAP_SECONDS: int = 2
    
    CLEANUP_AFTER_HOURS: int = 24
    
    HF_TOKEN: str = ""
    ELEVENLABS_API_KEY: str = ""
    DEEPL_API_KEY: str = ""
    SYNCLABS_API_KEY: str = ""
    PUBLIC_BASE_URL: str = ""  # e.g. https://your-server.com — needed for Sync.Labs media access

    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
