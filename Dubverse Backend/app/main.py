from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging
import os
import sys

# Load .env into os.environ before anything else so os.getenv() calls
# (e.g. RUNPOD_API_KEY, PROCESSING_MODE) pick up the values.
# pydantic_settings reads .env for the Settings model but does NOT
# populate os.environ — dotenv.load_dotenv() fills that gap.
try:
    from dotenv import load_dotenv as _load_dotenv
    _load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"), override=False)
except ImportError:
    pass

# Ensure ffmpeg/ffprobe are on PATH when running outside Docker
_FFMPEG_BIN = r"C:\ffmpeg\bin"
if os.path.isdir(_FFMPEG_BIN) and _FFMPEG_BIN not in os.environ.get("PATH", ""):
    os.environ["PATH"] = _FFMPEG_BIN + os.pathsep + os.environ.get("PATH", "")

from app.config import get_settings
from app.api import routes
from app.storage.manager import setup_storage_dirs

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


async def _load_jobs_from_db() -> None:
    """Load recent jobs from Supabase into the in-memory
    job store on startup. Logs a warning and continues
    if Supabase is unavailable. Never raises."""
    try:
        from app.services.supabase_client import supabase
        from app.services.job_manager import job_manager
        from app.models import Job, JobStatus, VideoChunk, Transcript
        from datetime import datetime

        def _parse_dt(val):
            if not val:
                return None
            if isinstance(val, datetime):
                return val
            return datetime.fromisoformat(str(val).replace("Z", "+00:00"))

        response = (
            supabase.table("jobs")
            .select("*")
            .order("updated_at", desc=True)
            .limit(200)
            .execute()
        )
        rows = response.data or []
        loaded = 0
        for row in rows:
            try:
                chunks_data = row.get("chunks") or []
                chunks = [VideoChunk(**c) for c in chunks_data]

                transcript = None
                if row.get("transcript_language") or row.get("transcript_text"):
                    transcript = Transcript(
                        language=row.get("transcript_language") or "en",
                        duration=row.get("transcript_duration") or 0.0,
                        text=row.get("transcript_text") or "",
                        segments=[],
                        speaker_profiles=row.get("speaker_profiles"),
                    )

                job = Job(
                    job_id=row["job_id"],
                    user_id=row.get("user_id", ""),
                    status=JobStatus(row.get("status", "pending")),
                    progress=row.get("progress", 0),
                    current_stage=row.get("current_stage"),
                    runpod_job_id=row.get("runpod_job_id"),
                    video_filename=row.get("video_filename", ""),
                    video_path=row.get("video_path", ""),
                    video_duration=row.get("video_duration"),
                    video_size=row.get("video_size", 0),
                    expected_speakers=row.get("expected_speakers", 2),
                    source_language=row.get("source_language"),
                    chunks=chunks,
                    total_chunks=row.get("total_chunks", 0),
                    processed_chunks=row.get("processed_chunks", 0),
                    transcript=transcript,
                    speaker_genders=row.get("speaker_genders"),
                    voice_mapping=row.get("voice_mapping"),
                    dubbed_video_url=row.get("dubbed_video_url"),
                    tts_engine=row.get("tts_engine"),
                    segment_tts_engines=row.get("segment_tts_engines"),
                    dubbing_engine=row.get("dubbing_engine"),
                    error_message=row.get("error_message"),
                    created_at=_parse_dt(row.get("created_at")) or datetime.now(),
                    updated_at=_parse_dt(row.get("updated_at")) or datetime.now(),
                    completed_at=_parse_dt(row.get("completed_at")),
                )
                job_manager._jobs[job.job_id] = job
                loaded += 1
            except Exception as exc:
                logger.warning(
                    f"Startup: failed to load job "
                    f"{row.get('job_id')}: {exc}"
                )

        logger.info(f"Startup: loaded {loaded} jobs from Supabase")
    except Exception as exc:
        logger.warning(
            f"Startup: Supabase job load failed — "
            f"continuing without persisted jobs: {exc}"
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    logger.info(f"Starting {settings.APP_NAME} v{settings.APP_VERSION}")
    
    setup_storage_dirs()
    logger.info("Storage directories initialized")

    await _load_jobs_from_db()
    logger.info("Persisted jobs loaded from Supabase")

    yield
    
    logger.info("Shutting down application")


app = FastAPI(
    title="Dubverse Backend API",
    description="AI-powered video dubbing platform backend",
    version="1.0.0",
    lifespan=lifespan
)

settings = get_settings()

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(routes.router, prefix="/api")


@app.get("/")
async def root():
    return {
        "service": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "status": "operational"
    }


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": settings.APP_NAME
    }


@app.get("/debug/runtime")
async def debug_runtime():
    return {
        "python_executable": sys.executable,
        "python_version": sys.version,
        "prefix": sys.prefix,
        "cwd": os.getcwd(),
    }
