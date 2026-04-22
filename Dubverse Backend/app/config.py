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
    PROJECTS_DIR: str = "data/projects"
    
    MAX_UPLOAD_SIZE: int = 5 * 1024 * 1024 * 1024
    ALLOWED_VIDEO_FORMATS: list[str] = [".mp4", ".mov", ".avi", ".mkv", ".webm"]
    CHUNK_DURATION_SECONDS: int = 300
    CHUNK_OVERLAP_SECONDS: int = 2
    
    CLEANUP_AFTER_HOURS: int = 24
    
    HF_TOKEN: str = ""
    ELEVENLABS_API_KEY: str = ""
    FISH_AUDIO_API_KEY: str = ""
    DEEPL_API_KEY: str = ""
    SYNCLABS_API_KEY: str = ""
    PUBLIC_BASE_URL: str = ""  # e.g. https://your-server.com — needed for Sync.Labs media access

    # Hume AI (emotion/prosody analysis)
    HUME_API_KEY: str = ""

    # Azure Speech (pronunciation assessment)
    AZURE_SPEECH_KEY: str = ""
    AZURE_SPEECH_REGION: str = ""

    # Azure OpenAI (translation quality evaluation)
    AZURE_OPENAI_ENDPOINT: str = ""
    AZURE_OPENAI_KEY: str = ""
    AZURE_OPENAI_DEPLOYMENT: str = ""

    # ScreenApp (AI video analysis)
    SCREENAPP_API_KEY: str = ""
    SCREENAPP_TEAM_ID: str = ""
    SCREENAPP_FOLDER_ID: str = ""

    # TTS Provider: "elevenlabs" or "fish-audio"
    TTS_PROVIDER: str = "elevenlabs"

    # Vozo AI (full-pipeline cloud dubbing)
    VOZO_API_KEY: str = ""
    VOZO_ENABLED: bool = False

    # Lip-sync provider: "synclabs", "vozo", or "none"
    LIPSYNC_PROVIDER: str = "synclabs"

    # Dubbing pipeline tuning
    DUBBING_MAX_SPEEDUP: float = 1.8
    VAD_TWO_PASS: bool = True
    VAD_GAP_THRESHOLD: float = 5.0

    # QC Stack
    GEMINI_API_KEY: str = ""       # Gemini 2.5 Pro for holistic video+audio QC
    ANTHROPIC_API_KEY: str = ""    # Claude for QC report synthesis

    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
