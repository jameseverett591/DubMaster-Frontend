from pydantic_settings import BaseSettings
from pydantic import field_validator
from functools import lru_cache


class Settings(BaseSettings):
    APP_NAME: str = "Dubverse Backend"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = True

    @field_validator("DEBUG", mode="before")
    @classmethod
    def _coerce_debug(cls, v):
        if isinstance(v, str) and v.lower() not in ("true", "false", "1", "0", "yes", "no"):
            return v.lower() not in ("release", "production", "prod")
        return v
    
    # Wildcard origins let any site on the internet drive this API, and paired
    # with allow_credentials=True browsers reject the combination anyway — so
    # "*" was never doing what it looked like it was doing. Override per
    # environment via the CORS_ORIGINS env var (comma-separated).
    CORS_ORIGINS: list[str] = ["http://localhost:3001", "http://localhost:3000"]
    
    UPLOAD_DIR: str = "data/uploads"
    CHUNKS_DIR: str = "data/chunks"
    PROCESSED_DIR: str = "data/processed"
    OUTPUT_DIR: str = "data/output"
    DUBBED_DIR: str = "data/dubbed"
    SEPARATED_DIR: str = "data/separated"
    PROJECTS_DIR: str = "data/projects"
    
    MAX_UPLOAD_SIZE: int = 5 * 1024 * 1024 * 1024
    ALLOWED_VIDEO_FORMATS: list[str] = [".mp4", ".mov", ".avi", ".mkv", ".webm"]

    # Upload size is capped against DURATION, not resolution. Resolution is a
    # proxy for the real cost driver — bytes stored — and gets it wrong in both
    # directions: a 50GB ProRes 1080p master would pass a 1080p ceiling, while
    # a modest 4K H.265 film would fail it. Duration is already probed on both
    # sides, so this needs no new detection.
    #
    # 500 MB/min admits 4K H.265 (~375 MB/min) and rejects uncompressed
    # masters (ProRes 422 HQ is ~1.65 GB/min). A starting default, meant to be
    # tuned once real customer uploads show what they actually look like.
    UPLOAD_BUDGET_MB_PER_MIN: int = 500
    # Floor so short clips are not squeezed by a strictly proportional budget;
    # ceiling so no single file can dominate storage regardless of length.
    UPLOAD_SIZE_FLOOR: int = 2 * 1024 * 1024 * 1024
    UPLOAD_SIZE_CEILING: int = 50 * 1024 * 1024 * 1024
    CHUNK_DURATION_SECONDS: int = 300
    CHUNK_OVERLAP_SECONDS: int = 2
    
    CLEANUP_AFTER_HOURS: int = 24
    
    HF_TOKEN: str = ""
    ELEVENLABS_API_KEY: str = ""
    FISH_AUDIO_API_KEY: str = ""
    DEEPL_API_KEY: str = ""
    SYNCLABS_API_KEY: str = ""
    PUBLIC_BASE_URL: str = ""  # e.g. https://your-server.com — needed for Sync.Labs media access

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


def upload_size_cap(duration_seconds: float) -> int:
    """Bytes permitted for a video of this length.

    Judges file size against how much video there is, rather than against what
    pixel grid it claims. A bloated 12GB five-minute clip is rejected; a
    legitimate two-hour feature is not.

    A zero or unknown duration falls back to the floor: without a duration
    there is nothing to scale against, and the floor is the safe end to be
    wrong on — the server re-checks with ffprobe once the object exists.
    """
    s = get_settings()
    if not duration_seconds or duration_seconds <= 0:
        return s.UPLOAD_SIZE_FLOOR
    budget = (duration_seconds / 60.0) * s.UPLOAD_BUDGET_MB_PER_MIN * 1024 * 1024
    return int(min(max(budget, s.UPLOAD_SIZE_FLOOR), s.UPLOAD_SIZE_CEILING))
