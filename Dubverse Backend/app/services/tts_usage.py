"""Per-job TTS accounting — what a dub actually costs to produce.

GPU cost is knowable from RunPod's executionTime. TTS is not: it is spread
across three vendors with different units (Fish bills characters, Respeecher
and ElevenLabs bill audio time), and it accumulates every time a segment is
regenerated. Without this, cost per job is a guess, and the iteration tail —
the thing that makes this product different from a one-shot dubber — is
invisible.

Written to ``<job_dir>/tts_usage.json`` rather than kept in memory so it
survives a restart and can be read back per job.

Not a billing ledger: it records consumption, it does not enforce anything.
"""

import json
import logging
import os
import threading
from typing import Dict, Optional

logger = logging.getLogger(__name__)

# One lock for all jobs. Writes are tiny and infrequent (one per TTS call),
# and a per-job lock map would need its own cleanup.
_lock = threading.Lock()

_EMPTY = {"calls": 0, "characters": 0, "audio_seconds": 0.0, "api_requests": 0}


def _path(job_dir: str) -> str:
    return os.path.join(job_dir, "tts_usage.json")


def record(
    job_dir: str,
    engine: str,
    *,
    characters: int = 0,
    audio_seconds: float = 0.0,
    api_requests: int = 1,
    regeneration: bool = False,
) -> None:
    """Add one TTS call to a job's tally.

    ``api_requests`` is what the vendor actually charged for, which is not
    always one: a Respeecher race of three takes is three billable requests
    that produce a single segment.

    ``regeneration`` separates the first pass from everything after it — the
    split that decides whether editing can be bundled or has to be metered.
    """
    if not job_dir:
        return
    try:
        with _lock:
            os.makedirs(job_dir, exist_ok=True)
            p = _path(job_dir)
            data: Dict = {}
            if os.path.exists(p):
                try:
                    with open(p, "r", encoding="utf-8") as f:
                        data = json.load(f)
                except Exception:
                    data = {}   # corrupt tally is not worth failing a dub over

            bucket = "regeneration" if regeneration else "initial"
            section = data.setdefault(bucket, {})
            e = section.setdefault(engine, dict(_EMPTY))
            e["calls"] += 1
            e["characters"] += int(characters)
            e["audio_seconds"] += float(audio_seconds)
            e["api_requests"] += int(api_requests)

            with open(p, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
    except Exception as e:
        # Accounting must never break synthesis.
        logger.warning(f"[TTS-USAGE] record failed for {job_dir}: {e}")


def record_lipsync(
    job_dir: str,
    provider: str,
    *,
    video_seconds: float,
    succeeded: bool,
) -> None:
    """Record one lip-sync pass.

    Kept in its own bucket rather than folded in with the TTS engines: lip-sync
    is billed by the minute of VIDEO (not of speech), by a different vendor, at
    a different rate — the market prices it at 2-3x audio-only. Pricing it as a
    separate currency only works if it's measured as one.

    Failures are recorded too. A failed pass still costs vendor time, and a
    provider that fails often is a cost you cannot see if only successes count.
    """
    if not job_dir:
        return
    try:
        with _lock:
            os.makedirs(job_dir, exist_ok=True)
            p = _path(job_dir)
            data: Dict = {}
            if os.path.exists(p):
                try:
                    with open(p, "r", encoding="utf-8") as f:
                        data = json.load(f)
                except Exception:
                    data = {}

            section = data.setdefault("lipsync", {})
            e = section.setdefault(provider, {
                "calls": 0, "failed": 0, "video_seconds": 0.0,
            })
            e["calls"] += 1
            if not succeeded:
                e["failed"] += 1
            e["video_seconds"] += float(video_seconds or 0.0)

            with open(p, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
        logger.info(
            f"[LIPSYNC-USAGE] {provider}: {video_seconds:.1f}s video "
            f"({'ok' if succeeded else 'FAILED'})"
        )
    except Exception as e:
        logger.warning(f"[LIPSYNC-USAGE] record failed for {job_dir}: {e}")


def summary(job_dir: str) -> Optional[Dict]:
    """The recorded tally for a job, or None if nothing was recorded."""
    p = _path(job_dir)
    if not os.path.exists(p):
        return None
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None
