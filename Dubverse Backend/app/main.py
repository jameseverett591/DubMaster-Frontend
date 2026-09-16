from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import asyncio
import logging
import os
import re
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


class _RedactTokensFilter(logging.Filter):
    """Scrub credentials from log records before any handler writes them.

    Media routes authenticate with ?access_token=<JWT>, because a <video> or
    <audio> element — and an external lip-sync vendor — cannot send an
    Authorization header. uvicorn's access log records the full path with its
    query string, so every media request wrote the user's live Supabase JWT to
    the log verbatim. Anyone with log access could replay it against every
    protected route until it expired.

    Redaction happens on the record rather than per call site, so it also
    covers any future log line that happens to include such a URL.
    """

    _PATTERN = re.compile(r"((?:access|refresh)_token=)[^&\s\"']+", re.IGNORECASE)
    # A token logged WITHOUT its name — logger.info("token %s", tok), or a
    # structured field — carries no "access_token=" for the pattern above to
    # anchor on. Supabase access tokens are JWTs, so match that shape directly:
    # three base64url parts, the first two starting with "eyJ" ('{"' encoded).
    _JWT = re.compile(r"eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}")
    _TOKEN_KEYS = frozenset({"access_token", "refresh_token"})

    def _scrub(self, value):
        """Recursively clean strings, tuples, lists and dicts.

        A dict is also checked by KEY: a structured field named access_token
        has a bare token as its value, which neither pattern can recognise as
        belonging to a credential by content alone.
        """
        if isinstance(value, str):
            return self._JWT.sub("REDACTED", self._PATTERN.sub(r"\1REDACTED", value))
        if isinstance(value, dict):
            return {
                k: "REDACTED" if str(k).lower() in self._TOKEN_KEYS else self._scrub(v)
                for k, v in value.items()
            }
        if isinstance(value, tuple):
            return tuple(self._scrub(v) for v in value)
        if isinstance(value, list):
            return [self._scrub(v) for v in value]
        return value

    def filter(self, record: logging.LogRecord) -> bool:
        """Redact credentials from a record's message and arguments in place.

        Runs before formatting, so both halves have to be cleaned: the message
        template, and the arguments interpolated into it, which is where
        uvicorn's access log carries the request path. Always returns True —
        this filter exists to sanitise records, never to suppress them.
        """
        record.msg = self._scrub(record.msg)
        if isinstance(record.args, (tuple, dict)):
            record.args = self._scrub(record.args)
        return True  # never drop the record, only clean it


_redact_tokens = _RedactTokensFilter()
# uvicorn.access does not propagate to root, so it needs its own filter. The
# root handlers get one too, for anything logged through the normal loggers.
for _name in ("uvicorn.access", "uvicorn.error", "uvicorn"):
    logging.getLogger(_name).addFilter(_redact_tokens)
for _handler in logging.getLogger().handlers:
    _handler.addFilter(_redact_tokens)


async def _load_jobs_from_db() -> None:
    """Load recent jobs from Supabase into the in-memory
    job store on startup. Logs a warning and continues
    if Supabase is unavailable. Never raises."""
    try:
        # service_role, not anon: RLS on `jobs` blocks the anon client
        # entirely, so this loader silently restored nothing on every restart
        # and logged "loaded 0 jobs" — indistinguishable from there being no
        # jobs. _upsert_job already writes with supabase_writer; the read has
        # to match it or persistence is write-only.
        from app.services.supabase_client import supabase_writer as supabase
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
                    # `or ""` not a dict default: the default only applies when
                    # the key is ABSENT, and these rows carry an explicit NULL.
                    # Job.user_id is a required str, so None raises
                    # ValidationError and the row is swallowed by the except
                    # below — silently dropping exactly the jobs we just fixed.
                    user_id=row.get("user_id") or "",
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
                    traits_mapping=row.get("traits_mapping"),
                    character_profiles=row.get("character_profiles"),
                    dubbing_style=row.get("dubbing_style") or "natural",
                    localized_aliases=row.get("localized_aliases"),
                    dubbed_video_url=row.get("dubbed_video_url"),
                    tts_engine=row.get("tts_engine"),
                    segment_tts_engines=row.get("segment_tts_engines"),
                    dubbing_engine=row.get("dubbing_engine"),
                    error_message=row.get("error_message"),
                    # Without this, a job reloaded after a restart has no
                    # record of what it was charged, and update_job_status
                    # skips the refund entirely.
                    minutes_charged=row.get("minutes_charged"),
                    # Same for the Make Movie charge: forgotten, a re-render
                    # after restart bills the customer a second time.
                    billed_seconds=row.get("billed_seconds"),
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

    # Retention sweep. Runs once at startup and then daily, so expiry does not
    # depend on a user happening to visit a page — a customer who never returns
    # is exactly the case where their film must not sit on our disks forever.
    async def _retention_loop():
        from app.api.routes import _sweep_purgeable_jobs, PURGE_RETENTION_DAYS
        while True:
            try:
                purged = await asyncio.to_thread(_sweep_purgeable_jobs)
                if purged:
                    logger.info(
                        f"[RETENTION] swept {purged} job(s) past the "
                        f"{PURGE_RETENTION_DAYS}-day window"
                    )
            except Exception as exc:
                # Never let a sweep failure take down the app — it retries
                # tomorrow, and a crash loop here would stop the API entirely.
                logger.error(f"[RETENTION] sweep failed: {exc}", exc_info=True)
            await asyncio.sleep(24 * 60 * 60)

    _retention_task = asyncio.create_task(_retention_loop())

    yield

    _retention_task.cancel()
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
    """Liveness plus a small set of degradation signals.

    Deliberately returns 200 even when degraded. A non-200 marks the container
    unhealthy to Docker's healthcheck, which can trigger restarts — turning a
    quota-accounting problem into an outage. Degradation belongs in the body,
    where an uptime monitor can alert on it without the orchestrator acting.

    stale_reservations is here rather than in a log line because a log line is
    only ever seen by someone already reading logs.
    """
    checks = {}
    status = "healthy"

    try:
        from app.services.upload_reservations import stale_count, DEGRADED_AFTER_HOURS
        stale = await asyncio.to_thread(stale_count)
        checks["stale_reservations"] = stale
        # Old pending rows mean the sweep has stopped running entirely — both
        # the lazy path on presign and any scheduled path. An unreadable table
        # is degraded too: it means the alarm itself is blind, which is worse
        # than a backlog it can still see.
        if stale.get("error") or stale.get("oldest_hours", 0) > DEGRADED_AFTER_HOURS:
            status = "degraded"
    except Exception as e:
        # A health check must not fail because a check failed.
        checks["stale_reservations"] = {"error": str(e)}

    return {
        "status": status,
        "service": settings.APP_NAME,
        "checks": checks,
    }


@app.get("/debug/runtime")
async def debug_runtime():
    return {
        "python_executable": sys.executable,
        "python_version": sys.version,
        "prefix": sys.prefix,
        "cwd": os.getcwd(),
    }
