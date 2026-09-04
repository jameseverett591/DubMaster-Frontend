from typing import Optional, Dict, List, Any
from pydantic import BaseModel, Field
import fastapi
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks, Request, Body, Depends
from fastapi.responses import JSONResponse, FileResponse, Response
import uuid
import os
import json as _json
from datetime import datetime, timedelta
from pathlib import Path
import logging
import asyncio
import torchaudio
import re
import hashlib
import traceback
import subprocess
import tempfile
import time

from app.models import (
    UploadResponse,
    StatusResponse,
    ChunkManifest,
    JobStatus,
    DubRequest,
    DubResponse,
    AdaptRequest,
    AdaptResponse,
    Transcript,
    TranscriptSegment,
    WordAlignment,
    RegenerateRequest,
)
from app.config import get_settings, upload_size_cap
from app.storage.manager import StorageManager
from app.services.job_manager import job_manager
from app.services import usage_service
from app.services import tts_usage
from app.services.supabase_client import verify_jwt
from app.services import upload_reservations
from app.pipeline.chunk_video import VideoChunker
from app.pipeline.extract_audio import extract_audio
from app.pipeline.diarize_audio import diarize_audio
from app.pipeline.transcribe_audio import transcribe_audio
from app.pipeline.velma_diarize import velma_diarize
from app.pipeline.classify_speakers import classify_speakers
from app.services.dubbing_service import dubbing_service, atomic_write_json
from app.services.lipsync_service import lipsync_service
from app.services.transcription_service import transcription_service
from app.services.elevenlabs_tts import elevenlabs_tts
from app.services.fish_audio_tts import fish_audio_tts
from app.services.respeecher_service import respeecher_tts
from app.services.vozo_service import vozo_service, VOZO_STATUS_MAP, POLL_INTERVAL_SEC, MAX_POLL_ATTEMPTS
from app.utils.language import normalize_language_code

logger = logging.getLogger(__name__)
router = APIRouter()

settings = get_settings()
storage = StorageManager()


def _projects_base_dir() -> Path:
    return Path(settings.PROJECTS_DIR)


def _safe_copytree(src: Path, dst: Path):
    import shutil
    if not src.exists():
        return
    if src.is_file():
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        return
    dst.mkdir(parents=True, exist_ok=True)
    for item in src.iterdir():
        target = dst / item.name
        if item.is_dir():
            _safe_copytree(item, target)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item, target)


chunker = VideoChunker()


def _find_uploaded_video(job_id: str) -> tuple[str, str] | None:
    # First check upload directory
    upload_dir = Path(settings.UPLOAD_DIR) / job_id
    if upload_dir.exists():
        files = [p for p in upload_dir.iterdir() if p.is_file()]
        if files:
            for file_path in files:
                if file_path.suffix.lower() in settings.ALLOWED_VIDEO_FORMATS:
                    return file_path.name, str(file_path)
            # Fallback: pick the first file if no known extension matches.
            fallback = files[0]
            return fallback.name, str(fallback)

    # Second check project directory for video files
    project_dir = Path(settings.PROJECTS_DIR) / job_id
    if project_dir.exists():
        video_dir = project_dir / "video"
        if video_dir.exists():
            files = [p for p in video_dir.iterdir() if p.is_file()]
            if files:
                for file_path in files:
                    if file_path.suffix.lower() in settings.ALLOWED_VIDEO_FORMATS:
                        return file_path.name, str(file_path)
                # Fallback: pick the first file if no known extension matches.
                fallback = files[0]
                return fallback.name, str(fallback)

    return None


def _seg_dict_to_model(seg: dict) -> TranscriptSegment:
    """Build a TranscriptSegment preserving all fields the pipeline wrote."""
    words_raw = seg.get("words")
    words = (
        [WordAlignment(word=w["word"], start=w["start"], end=w["end"],
                        confidence=w.get("confidence", 0.5))
         for w in words_raw]
        if words_raw else None
    )
    return TranscriptSegment(
        text=seg.get("text", ""),
        start=seg.get("start", 0),
        end=seg.get("end", 0),
        speaker=seg.get("speaker", "speaker-1"),
        confidence=seg.get("confidence"),
        confidence_tier=seg.get("confidence_tier"),
        words=words,
        velma_emotion=seg.get("velma_emotion"),
        velma_accent=seg.get("velma_accent"),
        velma_deepfake_score=seg.get("velma_deepfake_score"),
    )


def _load_transcript_from_disk(job_id: str) -> Transcript | None:
    # First check standard transcripts directory
    transcript_path = Path("data/transcripts") / f"{job_id}.json"
    if not transcript_path.exists():
        # Fallback to project directory
        transcript_path = Path(settings.PROJECTS_DIR) / job_id / "transcript.json"
        if not transcript_path.exists():
            return None

    try:
        import json

        with open(transcript_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        segments = [
            _seg_dict_to_model(seg)
            for seg in data.get("segments", [])
        ]

        return Transcript(
            language=data.get("language", "en"),
            duration=data.get("duration", 0.0),
            text=data.get("text", ""),
            segments=segments,
        )
    except Exception as exc:
        logger.error(f"Failed to load transcript for {job_id}: {exc}")
        return None


def _owner_from_project(job_id: str) -> str:
    """Recover a job's owner from its saved project.json.

    A rehydrated job is rebuilt from disk, and create_job's user_id defaulted
    to "". _upsert_job coerces that to NULL, and jobs.user_id is NOT NULL, so
    every upsert for a rehydrated job failed with 23502 — silently, because the
    upsert is fire-and-forget and only logs at WARNING. The jobs table was
    empty as a result, which in turn meant minutes_charged never persisted and
    a failed job could not be refunded after a restart.

    The owner was never actually lost: project.json carries user_id, written
    when the project was saved. Reading it back is the whole fix.

    Returns "" when there is no readable project.json. A job with no provable
    owner keeps today's behaviour rather than being assigned a guessed one —
    inventing an owner would be a worse bug than having none.

    Fallback: every job has an upload_reservations row written at presign
    time (before any bytes move), so jobs that were never saved as projects
    can still recover their owner from there. Without this, transcribed-only
    jobs rehydrated with user_id="" fail every Supabase upsert with 23502
    because jobs.user_id is NOT NULL.
    """
    try:
        meta = _projects_base_dir() / job_id / "project.json"
        with open(meta, "r", encoding="utf-8") as f:
            _uid = str(_json.load(f).get("user_id") or "")
            if _uid:
                return _uid
    except Exception:
        pass
    try:
        from app.services import upload_reservations as _ur
        row = _ur._get(job_id)
        if row and row.get("user_id"):
            return str(row["user_id"])
    except Exception:
        pass
    return ""


async def _rehydrate_job(job_id: str):
    if os.getenv("REHYDRATE_JOBS", "0") != "1":
        return None

    existing = await job_manager.get_job(job_id)
    if existing:
        return existing

    if job_manager.is_deleted(job_id):
        return None

    video_info = _find_uploaded_video(job_id)
    if not video_info:
        # R2-uploaded jobs have no local video file. Recover what we can from
        # upload_reservations (object_key → filename) so the editor can still
        # load the transcript and dubbed audio. video_path stays empty — a
        # re-dub will need to re-fetch from R2, but loading/editing existing
        # work does not.
        try:
            from app.services import upload_reservations as _ur
            _row = _ur._get(job_id)
        except Exception:
            _row = None
        if not _row or not _row.get("object_key"):
            return None
        _obj_key = _row["object_key"]
        # object_key is "{job_id}/{safe_filename}" — extract the filename part.
        video_name = _obj_key.split("/", 1)[1] if "/" in _obj_key else _obj_key
        video_path = ""
        video_size = 0
    else:
        video_name, video_path = video_info
        video_size = os.path.getsize(video_path)

    await job_manager.create_job(
        job_id=job_id,
        video_filename=video_name,
        video_path=video_path,
        video_size=video_size,
        # Without this the job is created ownerless, and every subsequent
        # upsert violates the NOT NULL constraint on jobs.user_id.
        user_id=_owner_from_project(job_id),
    )

    transcript = _load_transcript_from_disk(job_id)
    if transcript:
        await job_manager.update_job_transcript(job_id, transcript)
        await job_manager.update_job_status(
            job_id,
            JobStatus.COMPLETED,
            progress=100,
            current_stage="Video processing complete (rehydrated)",
        )
        job = await job_manager.get_job(job_id)
        if job and transcript.duration:
            job.video_duration = transcript.duration

        # Restore voice_mapping / traits_mapping — see _persist_job_metadata_field.
        # These used to be in-memory only and silently reverted to null on every
        # rehydration; without restoring them here, a fresh backend process would
        # keep forgetting the user's voice/traits assignments indefinitely.
        if job:
            dubbed_dir_for_meta = os.path.join(settings.DUBBED_DIR, job_id)
            segments_meta_path = os.path.join(dubbed_dir_for_meta, "segments.json")
            if os.path.exists(segments_meta_path):
                try:
                    with open(segments_meta_path, "r", encoding="utf-8") as f:
                        meta = _json.load(f)
                    # "in meta", not a truthy check: an explicitly-persisted {} (e.g.
                    # Clear All Voices) must be restored as empty, not treated as absent.
                    if "voice_mapping" in meta:
                        job.voice_mapping = meta["voice_mapping"]
                    if "traits_mapping" in meta:
                        job.traits_mapping = meta["traits_mapping"]
                except Exception as e:
                    logger.warning(f"Job {job_id}: failed to restore voice/traits mapping: {e}")

        # Restore dubbed video URL if a dubbed file exists on disk
        # Check both standard dubbed directory and project directory
        dubbed_dir = os.path.join(settings.DUBBED_DIR, job_id)
        project_dubbed_dir = os.path.join(settings.PROJECTS_DIR, job_id, "dubbed")

        dubbed_files = []
        if os.path.isdir(dubbed_dir):
            import glob as _glob
            dubbed_files = _glob.glob(os.path.join(dubbed_dir, "dubbed_*.mp4"))
        if not dubbed_files and os.path.isdir(project_dubbed_dir):
            import glob as _glob
            dubbed_files = _glob.glob(os.path.join(project_dubbed_dir, "dubbed_*.mp4"))

        if dubbed_files:
            # Extract language from filename: dubbed_en.mp4 -> en
            fname = os.path.basename(dubbed_files[0])
            lang = fname.replace("dubbed_", "").replace(".mp4", "")
            dubbed_url = f"/api/download/{job_id}/{lang}"
            await job_manager.update_job_dubbing_result(job_id, dubbed_url)
            logger.info(f"Rehydrated dubbed video URL for {job_id}: {dubbed_url}")
    else:
        await job_manager.update_job_status(
            job_id,
            JobStatus.PROCESSING,
            progress=50,
            current_stage="Recovered job; transcript unavailable",
        )
        job = await job_manager.get_job(job_id)
        if job:
            job.error_message = "Transcript not found. Reupload to reprocess."

    return await job_manager.get_job(job_id)


async def _get_or_rehydrate_job(job_id: str):
    job = await job_manager.get_job(job_id)
    if job:
        return job
    return await _rehydrate_job(job_id)


# ---------------------------------------------------------------------------
# Request guards.
#
# Defined here, above the first @router decorator, because decorators run at
# import time: a dependencies=[Depends(_dep_auth)] below a later definition
# raises NameError before the app can start.
# ---------------------------------------------------------------------------
def _caller(request: Request) -> str:
    """The verified user behind a request.

    Accepts the token from the Authorization header OR an `access_token` query
    param. The query param is not laziness: media is loaded by <video src> and
    <audio src>, which cannot carry custom headers, so a header-only rule would
    force those endpoints to stay public. Same verification either way.

    Tokens in query strings do land in access logs and browser history. The
    durable fix is short-lived signed media URLs; this is the step that closes
    the hole without breaking playback.
    """
    token = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    if not token:
        token = request.query_params.get("access_token", "").strip()
    return verify_jwt(token)


async def _require_job(job_id: str, caller: str):
    """Fetch a job the caller is allowed to see, or 404.

    404 rather than 403 for someone else's job: a 403 would confirm the id
    exists, which is itself a disclosure. Mirrors save_project.

    Jobs with no user_id predate ownership and stay readable by any
    authenticated caller — the same accommodation the projects endpoints make.
    Tighten to a hard deny once every job row has an owner.
    """
    job = await _get_or_rehydrate_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if getattr(job, "user_id", None) and job.user_id != caller:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


def _require_internal(request: Request) -> None:
    """Server-to-server auth for the RunPod worker. No user context exists on
    these calls, so a user JWT is the wrong instrument."""
    expected = os.environ.get("INTERNAL_API_SECRET", "")
    if not expected:
        raise HTTPException(status_code=503, detail="INTERNAL_API_SECRET not configured")
    if request.headers.get("X-Internal-Secret", "") != expected:
        raise HTTPException(status_code=401, detail="Invalid internal secret")


_ADMIN_USER_IDS = {u.strip() for u in os.environ.get("ADMIN_USER_IDS", "").split(",") if u.strip()}


def _require_admin(request: Request) -> str:
    """Operator-only endpoints: destructive cleanup and global server config."""
    user_id = _caller(request)
    if user_id not in _ADMIN_USER_IDS:
        raise HTTPException(status_code=403, detail="Admin only")
    return user_id


# --- Route guards -----------------------------------------------------------
# Applied via `dependencies=[Depends(...)]` on the decorator rather than by
# editing 50 handler bodies. FastAPI resolves `job_id` from the path for
# _dep_job_access, so ownership is enforced without the handler knowing.
# Routes that carry job_id in the BODY (/dub, /adapt, /render, /translate-only)
# cannot use this and check ownership inline instead.

async def _dep_auth(request: Request) -> str:
    """Authenticated caller required. No resource ownership implied."""
    return _caller(request)


async def _dep_job_access(job_id: str, request: Request):
    """Authenticated caller who owns `job_id`."""
    return await _require_job(job_id, _caller(request))


async def _dep_admin(request: Request) -> str:
    return _require_admin(request)


async def _dep_internal(request: Request) -> None:
    _require_internal(request)




def _assign_speakers_from_diarization(raw_segments, diarization_segments, *_, **__):
    if not diarization_segments:
        return None

    diarization_sorted = sorted(diarization_segments, key=lambda x: x.get("start", 0))

    speaker_map = {}
    for seg in diarization_sorted:
        speaker = seg.get("speaker")
        if speaker and speaker not in speaker_map:
            speaker_map[speaker] = f"speaker-{len(speaker_map) + 1}"

    unique_speakers = len(speaker_map)

    # ── Split single-blob transcripts using diarization timestamps ──
    # ONLY split when ASR returns exactly 1 segment (a true blob).
    # When Whisper produces multiple segments with timestamps, use
    # the standard speaker-assignment path instead (preserves text).
    if len(raw_segments) == 1 and unique_speakers >= 2:
        logger.info(
            f"[DIARIZE-SPLIT] Transcript has {len(raw_segments)} segment(s) but "
            f"diarization found {unique_speakers} speakers — splitting by diarization turns"
        )
        split_segments = []
        blob_text = " ".join((s.get("text") or "").strip() for s in raw_segments).strip()
        blob_tokens = [t for t in blob_text.split() if t]
        total_dur = 0.0
        dia_kept = []
        for dia in diarization_sorted:
            dia_start = dia.get("start", 0.0)
            dia_end = dia.get("end", 0.0)
            dia_speaker = speaker_map.get(dia.get("speaker"), "speaker-1")
            duration = dia_end - dia_start
            # Skip very short turns (< 0.3s) — likely noise
            if duration < 0.3:
                continue
            dia_kept.append({"start": dia_start, "end": dia_end, "speaker": dia_speaker, "dur": duration})
            total_dur += max(0.0, float(duration))

        if dia_kept:
            idx = 0
            n_tokens = len(blob_tokens)
            for j, dk in enumerate(dia_kept):
                if n_tokens <= 0:
                    seg_text = blob_text if (j == 0 and blob_text) else ""
                else:
                    remaining = n_tokens - idx
                    if remaining <= 0:
                        seg_text = ""
                    else:
                        if j == len(dia_kept) - 1:
                            take = remaining
                        else:
                            ratio = (dk["dur"] / total_dur) if total_dur > 0 else (1.0 / len(dia_kept))
                            take = max(1, int(round(ratio * n_tokens)))
                            take = min(take, remaining)
                        seg_text = " ".join(blob_tokens[idx: idx + take]).strip()
                        idx += take

                split_segments.append(
                    TranscriptSegment(
                        text=seg_text,
                        start=dk["start"],
                        end=dk["end"],
                        speaker=dk["speaker"],
                    )
                )

        if split_segments:
            logger.info(
                f"[DIARIZE-SPLIT] Created {len(split_segments)} segments from "
                f"{unique_speakers} speakers"
            )
            return split_segments

    # ── Standard path: label existing segments with best-overlap speaker ──
    # If an ASR segment overlaps multiple diarization speakers (common when
    # Whisper emits long segments), split the ASR segment at diarization turn
    # boundaries and distribute text proportionally so speakers don't collapse.
    def _split_segment_by_diarization(seg):
        seg_start = float(seg.get("start", 0.0) or 0.0)
        seg_end = float(seg.get("end", 0.0) or 0.0)
        seg_text = (seg.get("text") or "").strip()
        seg_dur = max(0.0, seg_end - seg_start)

        if seg_dur <= 0.0:
            return []

        overlaps = []
        for dia in diarization_sorted:
            dia_start = float(dia.get("start", 0.0) or 0.0)
            dia_end = float(dia.get("end", 0.0) or 0.0)
            ov = max(0.0, min(seg_end, dia_end) - max(seg_start, dia_start))
            if ov <= 0.0:
                continue
            overlaps.append((ov, dia_start, dia_end, speaker_map.get(dia.get("speaker"), dia.get("speaker"))))

        if not overlaps:
            return []

        overlaps.sort(key=lambda x: x[1])
        speakers_in_seg = [o[3] for o in overlaps if o[3]]
        unique = list(dict.fromkeys(speakers_in_seg))

        # Only split when there are multiple speakers AND the segment is long enough.
        # Keep short segments intact to avoid over-fragmenting.
        if len(unique) < 2 or seg_dur < 1.2:
            return []

        # Build diarization slices clipped to the ASR segment.
        slices = []
        for ov, dia_start, dia_end, spk in overlaps:
            s = max(seg_start, dia_start)
            e = min(seg_end, dia_end)
            if e - s < 0.2:
                continue
            slices.append({"start": s, "end": e, "speaker": spk, "dur": e - s})

        if len(slices) < 2:
            return []

        # Distribute text across slices using diarization boundary timestamps.
        # For each slice boundary, calculate the proportional character position
        # in the text and snap to the nearest sentence-ending punctuation.
        # This handles both ASCII (.!?) and CJK (。！？) sentence endings —
        # the old sentence-count approach treated all CJK text as one sentence
        # because the regex only matched ASCII punctuation.
        _SENT_ENDS = frozenset('.!?。！？')

        def _snap_to_boundary(text, target_char):
            """Index just after the nearest sentence-ending char to target_char."""
            best_idx = target_char
            best_dist = len(text) + 1
            for ci, ch in enumerate(text):
                if ch in _SENT_ENDS:
                    idx = ci + 1
                    dist = abs(idx - target_char)
                    if dist < best_dist:
                        best_dist = dist
                        best_idx = idx
            return best_idx

        n_chars = len(seg_text)
        total_slice_dur = sum(sl["dur"] for sl in slices) or seg_dur
        cum_dur = 0.0
        split_points = []
        for sl in slices[:-1]:
            cum_dur += sl["dur"]
            rel = cum_dur / total_slice_dur if total_slice_dur > 0 else (slices.index(sl) + 1) / len(slices)
            target = int(rel * n_chars)
            split_points.append(_snap_to_boundary(seg_text, target))

        prev = 0
        for j, sl in enumerate(slices):
            end = split_points[j] if j < len(split_points) else n_chars
            sl["text"] = seg_text[prev:end].strip()
            prev = end

        out = []
        for sl in slices:
            out.append(
                TranscriptSegment(
                    text=sl.get("text", ""),
                    start=sl["start"],
                    end=sl["end"],
                    speaker=sl.get("speaker") or "speaker-1",
                )
            )
        return out

    def _best_speaker(seg):
        best_speaker = None
        best_overlap = 0.0
        seg_start = seg.get("start", 0.0)
        seg_end = seg.get("end", 0.0)

        for dia in diarization_sorted:
            dia_start = dia.get("start", 0.0)
            dia_end = dia.get("end", 0.0)
            overlap = max(0.0, min(seg_end, dia_end) - max(seg_start, dia_start))
            if overlap > best_overlap:
                best_overlap = overlap
                best_speaker = speaker_map.get(dia.get("speaker"), dia.get("speaker"))

        return best_speaker

    assigned = []
    last_speaker = "speaker-1"
    for seg in raw_segments:
        split = _split_segment_by_diarization(seg)
        if split:
            for s in split:
                if s.speaker:
                    last_speaker = s.speaker
                assigned.append(s)
            continue
        speaker = _best_speaker(seg) or last_speaker
        last_speaker = speaker
        s = _seg_dict_to_model(seg)
        s.speaker = speaker or "speaker-1"
        assigned.append(s)

    return assigned


def _smooth_speaker_assignments(segments):
    if not segments or len(segments) < 3:
        return segments

    # Pass 1: fix single short flips between matching neighbors.
    # Only reassign very short segments (<0.4s) with minimal text —
    # longer segments (even if short in duration) likely represent real
    # speaker turns in fast-paced dialogue.
    for i in range(1, len(segments) - 1):
        seg = segments[i]
        prev_seg = segments[i - 1]
        next_seg = segments[i + 1]
        dur = max(0.0, (seg.end or 0) - (seg.start or 0))
        text_len = len((seg.text or "").strip())
        # Only smooth truly tiny segments with very short text
        if dur <= 0.4 and text_len < 4 and prev_seg.speaker == next_seg.speaker:
            seg.speaker = prev_seg.speaker

    # Pass 2: merge very short rare speakers into nearest neighbor.
    # Only merge speakers with very low total duration (<1.0s) to avoid
    # collapsing legitimate minor characters.
    counts = {}
    durations = {}
    for seg in segments:
        counts[seg.speaker] = counts.get(seg.speaker, 0) + 1
        durations[seg.speaker] = durations.get(seg.speaker, 0.0) + max(0.0, seg.end - seg.start)

    for i, seg in enumerate(segments):
        if counts.get(seg.speaker, 0) <= 1 and durations.get(seg.speaker, 0.0) < 1.0:
            if i > 0:
                seg.speaker = segments[i - 1].speaker
            elif i + 1 < len(segments):
                seg.speaker = segments[i + 1].speaker

    return segments


def _normalize_speaker_labels(segments):
    mapping = {}
    idx = 1
    for seg in segments:
        speaker = seg.speaker or "speaker-1"
        if speaker not in mapping:
            mapping[speaker] = f"speaker-{idx}"
            idx += 1
        seg.speaker = mapping[speaker]
    return segments


# Subtitle/credit/narration patterns that should not be dubbed. The original
# audio/accompaniment is preserved for these time ranges.
_CREDIT_PATTERNS = [
    r"字幕",                 # Chinese "subtitle"
    r"字幕組",               # subtitle group
    r"中文字幕",             # Chinese subtitles
    r"英文字幕",             # English subtitles
    r"subtitles?\s+by",
    r"subtitled\s+by",
    r"translation\s+by",
    r"translated\s+by",
    r"譯者", r"译者",       # translator
]
_CREDIT_RE = re.compile(r"|".join(_CREDIT_PATTERNS), re.IGNORECASE)


def _mark_credit_segments(segments):
    for seg in segments:
        text = (seg.text or "").strip()
        if _CREDIT_RE.search(text):
            seg.is_credit = True
    return segments


_CJK_RE = re.compile(r"[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]")


def _collapse_cjk_spaces(text: str) -> str:
    if not text:
        return text

    # If the string does not contain CJK chars, avoid touching it.
    if not _CJK_RE.search(text):
        return text

    # Remove spaces between adjacent CJK chars.
    text = re.sub(
        r"([\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF])\s+([\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF])",
        r"\1\2",
        text,
    )
    # Collapse repeated whitespace elsewhere.
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _is_low_quality_cjk_transcript(segments, whisper_language: str) -> bool:
    if not segments:
        return False

    lang = (whisper_language or "").lower().strip()
    if lang not in ("yue", "zh-yue", "yue-hk", "zh-hk", "zh", "zh-cn", "zh-tw"):
        return False

    texts = [(getattr(s, "text", None) or "").strip() for s in segments]
    texts = [t for t in texts if t]
    if not texts:
        return True

    total = len(texts)
    tiny = sum(1 for t in texts if len(t) <= 2)
    avg_len = sum(len(t) for t in texts) / max(1, total)
    return (tiny / max(1, total)) >= 0.55 or avg_len <= 4.0


def _merge_close_transcript_segments(
    segments: list[TranscriptSegment],
    max_gap: float = 0.35,
    max_merged_chars: int = 220,
    max_merge_count: int = 8,
    max_merged_duration: float = 14.0,
) -> list[TranscriptSegment]:
    if not segments:
        return segments

    unique_speakers = set((s.speaker or "speaker-1") for s in segments)
    # If diarization failed (single speaker label), do not merge — it can mash
    # different characters into one line.
    if len(unique_speakers) <= 1:
        return segments

    segs = sorted(segments, key=lambda s: float(s.start))
    merged: list[TranscriptSegment] = [segs[0]]
    merge_counts: list[int] = [1]

    for seg in segs[1:]:
        prev = merged[-1]
        prev_speaker = prev.speaker or "speaker-1"
        seg_speaker = seg.speaker or "speaker-1"
        gap = float(seg.start) - float(prev.end)
        candidate_text = (prev.text or "").rstrip() + " " + (seg.text or "").lstrip()
        merged_duration = float(seg.end) - float(prev.start)

        if (
            prev_speaker == seg_speaker
            and gap >= 0.0
            and gap < max_gap
            and len(prev.text or "") <= max_merged_chars
            and merge_counts[-1] < max_merge_count
            and merged_duration <= max_merged_duration
        ):
            merged[-1] = TranscriptSegment(
                text=candidate_text.strip(),
                start=prev.start,
                end=seg.end,
                speaker=prev_speaker,
                confidence=min(c for c in (prev.confidence, seg.confidence) if c is not None) if (prev.confidence is not None or seg.confidence is not None) else None,
                confidence_tier=prev.confidence_tier,
                words=(prev.words or []) + (seg.words or []) if (prev.words or seg.words) else None,
                velma_emotion=prev.velma_emotion,
                velma_accent=prev.velma_accent,
                velma_deepfake_score=prev.velma_deepfake_score,
            )
            merge_counts[-1] += 1
        else:
            merged.append(seg)
            merge_counts.append(1)

    return merged

# Velma rejects large uploads with HTTP 413. The exact server limit is not
# documented; 24MB is comfortably under what a 119MB MP4 was refused at, and
# leaves room for a feature-length film once compressed (see below).
_VELMA_MAX_UPLOAD_BYTES = 24 * 1024 * 1024


def _vocals_or_video(video_path: str, job_id: str) -> str:
    """Already-separated vocals for this job, if they happen to exist.

    NEVER starts a separation. The earlier version called separate_audio on the
    assumption it would be a cache read — true on the CPU path, false on the
    RunPod path, where the GPU worker does its own separation and never returns
    it. There the call started a SECOND, local, CPU-bound Demucs pass: about six
    seconds on a 99-second clip, and well over an hour on a 105-minute feature,
    blocking the pipeline before any segments were written.

    So: use a separated track only if one is already on disk, and otherwise use
    the source. Mixed-audio pitch analysis is slightly worse than isolated
    vocals; an hour of dead time is a great deal worse.
    """
    import glob as _glob
    try:
        for pattern in (
            os.path.join("data", "separated", f"{job_id}_vocals.wav"),
            os.path.join("data", "separated", f"{job_id}_*vocals*"),
        ):
            for path in _glob.glob(pattern):
                if os.path.isfile(path) and os.path.getsize(path) > 0:
                    logger.info(f"[VOCALS] Job {job_id}: using existing vocals {path}")
                    return path
    except Exception as exc:
        logger.warning(f"[VOCALS] Job {job_id}: vocals lookup failed ({exc})")
    return video_path


def _velma_source_audio(video_path: str, job_id: str, vocals_path: str | None = None) -> str:
    """The file to hand Velma: vocals only, compressed if long.

    Pass vocals_path when the caller already has one (the CPU path separates
    earlier in the pipeline) to skip straight to the size guard.

    Velma wants speech, not a video container. Passing video_path meant every
    RunPod-path job uploaded the whole MP4 and got a 413, so Velma never ran on
    that path and diarization silently fell through to F0 pitch clustering.

    This function does NOT separate. An earlier version called separate_audio
    here, reasoning that it would be a cache read because the pipeline already
    separates — true on the CPU path, false on the RunPod path, where the GPU
    worker separates remotely and never returns the result. There it started a
    second, local, CPU-bound Demucs pass: ~6 seconds on a 99-second clip, and
    over an hour on a 105-minute feature, stalling the pipeline before any
    segments were written. That pass did not exist before and does not belong
    here.

    Instead: use vocals if the caller already has them (the CPU path does), else
    extract the audio track with ffmpeg — a stream copy-and-encode, seconds even
    on a feature — and let the size guard compress it. Velma then gets mixed
    audio rather than isolated vocals on the RunPod path, which is exactly what
    it received before this function existed, only small enough to accept.
    """
    if vocals_path and os.path.isfile(vocals_path):
        logger.info(f"[VELMA-SRC] Job {job_id}: using caller's vocals {vocals_path}")
        return _velma_fit_upload(vocals_path, job_id)

    # An already-separated track costs nothing to reuse; absent one, take the
    # audio track straight off the source. No separation is started either way.
    src = _vocals_or_video(video_path, job_id)
    if src == video_path:
        try:
            audio_only = os.path.join(
                settings.DUBBED_DIR, job_id, f"velma_audio_{job_id}.m4a"
            )
            os.makedirs(os.path.dirname(audio_only), exist_ok=True)
            if not os.path.exists(audio_only):
                result = subprocess.run(
                    ["ffmpeg", "-y", "-i", video_path, "-vn", "-ac", "1",
                     "-ar", "16000", "-c:a", "aac", "-b:a", "48k", audio_only],
                    capture_output=True, text=True,
                )
                if result.returncode != 0:
                    logger.warning(
                        f"[VELMA-SRC] Job {job_id}: audio extract failed, sending source: "
                        f"{result.stderr[-200:]}"
                    )
                    return _velma_fit_upload(video_path, job_id)
            src = audio_only
            logger.info(
                f"[VELMA-SRC] Job {job_id}: extracted audio track "
                f"({os.path.getsize(src) / 1024**2:.1f}MB) — no separation run"
            )
        except Exception as exc:
            logger.warning(f"[VELMA-SRC] Job {job_id}: audio extract error ({exc})")
            return _velma_fit_upload(video_path, job_id)

    return _velma_fit_upload(src, job_id)


def _velma_fit_upload(src: str, job_id: str) -> str:
    """Compress src if it is too large for Velma to accept.

    Vocals come back as uncompressed WAV. That is fine for a 99s clip (~17MB)
    and fatal for a feature: two hours of WAV is ~1GB and 413s exactly like the
    MP4 did. Mono 16kHz 24kbps MP3 is ~11MB/hour — a 2h film lands near 22MB —
    and speech content survives it well enough for diarization and emotion.

    Returns src unchanged when it already fits, so short jobs keep pristine WAV.
    """
    try:
        size = os.path.getsize(src)
        if size <= _VELMA_MAX_UPLOAD_BYTES:
            return src

        compressed = os.path.join(os.path.dirname(src), f"velma_source_{job_id}.mp3")
        if not os.path.exists(compressed):
            cmd = [
                "ffmpeg", "-y",
                "-i", src,
                "-vn",
                "-ac", "1",              # mono: speaker identity survives the downmix
                "-ar", "16000",
                "-b:a", "24k",
                compressed,
            ]
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode != 0:
                logger.error(
                    f"[VELMA-SRC] Job {job_id}: compression failed, sending {size / 1024**2:.0f}MB "
                    f"as-is (may 413):\n{result.stderr[-300:]}"
                )
                return src

        new_size = os.path.getsize(compressed)
        logger.info(
            f"[VELMA-SRC] Job {job_id}: compressed {size / 1024**2:.0f}MB → "
            f"{new_size / 1024**2:.1f}MB for upload"
        )
        if new_size > _VELMA_MAX_UPLOAD_BYTES:
            # Longer than ~4 hours. Chunked upload is the real answer; log loudly
            # rather than pretend, so a 413 here is explained rather than mysterious.
            logger.warning(
                f"[VELMA-SRC] Job {job_id}: still {new_size / 1024**2:.0f}MB after "
                f"compression — Velma will likely 413. Needs chunked upload."
            )
        return compressed
    except Exception as exc:
        logger.warning(f"[VELMA-SRC] Job {job_id}: size check/compression failed ({exc})")
        return src


# Longest source we will run local CPU separation on inside the speaker-split
# fallback. Mirrors dubbing_service.ACCOMPANIMENT_MAX_DURATION_S in intent:
# beyond this, separation costs more than the accuracy it buys.
SPLIT_SEPARATION_MAX_DURATION_S = 600


def _probe_duration(path: str) -> float:
    """Source duration in seconds; infinity if it cannot be read.

    Callers gate hours-long CPU work on this. An unreadable duration therefore
    returns inf, not 0.0 — failing toward the guard, so a broken probe can never
    be what starts a feature-length Demucs run.
    """
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", path],
            capture_output=True, text=True,
        )
        parsed = float((out.stdout or "").strip() or 0)
        return parsed if parsed > 0 else float("inf")
    except Exception:
        return float("inf")


def _fetch_gpu_stems(job_id: str, stems: dict) -> None:
    """Pull the worker's GPU-produced stems into data/separated/.

    The worker already separates on GPU to get a clean transcription signal.
    Landing those files here is what lets dub_video find a cached separation, so
    the long-form guard never fires: the music bed survives and vocals_path stays
    non-None, which is what re-enables voice cloning.

    The filenames are the ones dub_video already probes for, so nothing
    downstream changes. Best-effort: on any failure the job proceeds exactly as
    it did before, dialogue-only.
    """
    if not stems:
        # A pre-V52 worker returns no stem keys at all. Not an error — the job
        # proceeds exactly as before — but it must be visible, or "old worker"
        # and "V52 with a broken export" look identical in the logs.
        logger.warning(
            f"[STEMS] Job {job_id}: worker returned no stems "
            f"(pre-V52 image, or export failed on the worker) - "
            f"backend will separate locally or mix dialogue-only"
        )
        return
    try:
        from app.services.upload_reservations import _r2_client
        client, bucket = _r2_client()
        if client is None:
            logger.warning(
                f"[STEMS] Job {job_id}: R2 not configured on the backend - "
                f"cannot fetch the stems the worker uploaded"
            )
            return
        out_dir = os.path.join("data", "separated")
        os.makedirs(out_dir, exist_ok=True)
        for name in ("vocals", "accompaniment"):
            key = stems.get(name)
            if not key:
                logger.warning(
                    f"[STEMS] Job {job_id}: worker returned no {name} key - "
                    f"{'cloning stays preset-only' if name == 'vocals' else 'no music bed'}"
                )
                continue
            # Transcoded to real WAV rather than saved as .mp3-named-.wav:
            # the vocals stem is read by soundfile for cloning, which cannot be
            # relied on to decode MP3, and a mislabelled file is a trap for
            # whoever debugs this next.
            tmp = os.path.join(out_dir, f"{job_id}_{name}.dl.mp3")
            dest = os.path.join(out_dir, f"{job_id}_{name}.wav")
            client.download_file(bucket, key, tmp)
            subprocess.run(
                ["ffmpeg", "-y", "-i", tmp, "-c:a", "pcm_s16le", dest],
                capture_output=True, check=True,
            )
            os.remove(tmp)
            logger.info(
                f"[STEMS] Job {job_id}: fetched {name} "
                f"({os.path.getsize(dest) // (1024 * 1024)}MB) from {key}"
            )
    except Exception as exc:
        logger.warning(f"[STEMS] Job {job_id}: stem fetch failed ({exc}) — dialogue-only mix")


def _f0_split_speakers(segments, video_path: str, n_speakers: int, job_id: str):
    """
    Fallback when pyannote collapses all segments to 1 speaker:
    extract per-segment median F0 from vocals and cluster into n_speakers groups
    using k-means on pitch. Child voices (F0>220Hz) are trivially separated from
    adults; same-gender adults are split by relative pitch ordering.
    """
    import math
    try:
        from app.pipeline.extract_audio import extract_audio
        from app.pipeline.separate_audio import separate_audio
    except ImportError:
        return segments

    vocals_path = None
    # Same long-form hazard as the mix guard: Demucs has no GPU in this
    # container, so separating a feature-length film here would block speaker
    # splitting for over an hour. Separation only sharpens the F0 estimate —
    # extract_audio falls back to the raw track below — so on long sources we
    # take the slightly noisier pitch reading instead of the stall. Cached
    # stems, if some earlier stage produced them, are still used.
    _cached_vocals = os.path.join("data", "separated", f"{job_id}_vocals.wav")
    if os.path.isfile(_cached_vocals) and os.path.getsize(_cached_vocals) > 1000:
        vocals_path = _cached_vocals
    elif _probe_duration(video_path) > SPLIT_SEPARATION_MAX_DURATION_S:
        logger.warning(
            f"[F0-SPLIT] Job {job_id}: skipping separation on long-form source "
            f"— clustering pitch from the raw track"
        )
    else:
        try:
            sep = separate_audio(video_path, job_id=job_id)
            if sep.get("status") == "ok":
                vocals_path = sep.get("vocals_path")
        except Exception:
            pass

    try:
        src = extract_audio(vocals_path or video_path)
    except Exception:
        return segments

    if src.get("status") != "ok":
        return segments

    audio = src["audio"]
    sample_rate = src["sample_rate"]

    import torch, torchaudio
    pitches = []
    for seg in segments:
        s_t = seg.start if hasattr(seg, "start") else seg.get("start", 0.0)
        e_t = seg.end   if hasattr(seg, "end")   else seg.get("end",   0.0)
        dur = e_t - s_t
        if dur < 0.2:
            pitches.append(None)
            continue
        s_i = int(s_t * sample_rate)
        e_i = min(int(e_t * sample_rate), audio.shape[-1])
        chunk = audio[..., s_i:e_i]
        if chunk.dtype != torch.float32:
            chunk = chunk.float()
        if chunk.dim() == 1:
            chunk = chunk.unsqueeze(0)
        try:
            ph = torchaudio.functional.detect_pitch_frequency(chunk, sample_rate, freq_low=70, freq_high=450)
            ph = ph.squeeze(0)
            voiced = ph[(ph > 70) & (ph < 450)]
            pitches.append(float(voiced.median()) if voiced.numel() > 0 else None)
        except Exception:
            pitches.append(None)

    # Fill missing pitches with global median
    valid = [p for p in pitches if p is not None]
    if not valid:
        return segments
    global_median = sorted(valid)[len(valid) // 2]
    filled = [p if p is not None else global_median for p in pitches]

    # K-means on 1D pitch with n_speakers clusters, initialised by percentile
    k = min(n_speakers, len(set(round(p) for p in filled)))
    cents = [filled[int(i * len(filled) / k)] for i in range(k)]

    for _ in range(20):
        assigns = [min(range(k), key=lambda ci, p=p: abs(p - cents[ci])) for p in filled]
        new_cents = []
        for ci in range(k):
            grp = [filled[i] for i, a in enumerate(assigns) if a == ci]
            new_cents.append(sum(grp) / len(grp) if grp else cents[ci])
        if new_cents == cents:
            break
        cents = new_cents

    label_map = {ci: f"SPEAKER_{ci:02d}" for ci in range(k)}
    out = []
    for seg, cluster in zip(segments, assigns):
        spk = label_map[cluster]
        if hasattr(seg, "speaker"):
            from copy import copy
            seg = copy(seg)
            seg.speaker = spk
        else:
            seg = dict(seg)
            seg["speaker"] = spk
        out.append(seg)

    unique = set(label_map[a] for a in assigns)
    logger.info(f"[F0-SPLIT] job={job_id} pitched {len(segments)} segs into {len(unique)} speakers: {sorted(unique)}")
    out2 = _smooth_speaker_assignments(out)
    out3 = _normalize_speaker_labels(out2)
    return out3


def _estimate_speakers_from_segments(raw_segments) -> int:
    """
    Best-effort estimate of number of speakers using timing gaps when
    diarization is unavailable. Returns 1-4 speakers.
    """
    if not raw_segments or len(raw_segments) < 4:
        return 1

    gaps = []
    for i in range(1, len(raw_segments)):
        gap = (raw_segments[i].get("start", 0.0) - raw_segments[i - 1].get("end", 0.0))
        gaps.append(max(0.0, gap))

    long_gaps = [g for g in gaps if g >= 0.7]
    ratio = len(long_gaps) / max(1, len(raw_segments))

    if ratio < 0.05:
        return 1
    if ratio < 0.15:
        return 2
    # Cap at 3 — combat/crowd scenes have many gaps but that doesn't mean
    # more speakers; DIARIZATION_MAX_SPEAKERS env var overrides this cap.
    max_est = int(os.getenv("DIARIZATION_MAX_SPEAKERS", "3"))
    if ratio < 0.3:
        return min(3, max_est)
    return min(3, max_est)

async def _run_diarization_with_heartbeat(
    job_id: str,
    extract_result: dict,
    timeout_sec: int,
    min_speakers: int = 1,
    max_speakers: int = 6,
) -> dict:
    """
    Run diarization in a worker thread while reporting smooth progress
    (86→89%) based on elapsed time vs expected duration.
    """
    loop = asyncio.get_running_loop()
    start_time = loop.time()
    # Estimate expected duration: ~2x video length on CPU, cap at timeout
    video_duration = extract_result.get("duration", 120)
    expected_sec = min(video_duration * 2, timeout_sec * 0.9)

    diarization_task = asyncio.create_task(
        asyncio.to_thread(diarize_audio, extract_result, job_id, min_speakers, max_speakers)
    )

    while True:
        if diarization_task.done():
            try:
                return diarization_task.result()
            except Exception as exc:
                logger.warning(f"Diarization failed for job {job_id}: {exc}")
                return {"status": "skipped", "reason": "diarization_error"}

        elapsed = loop.time() - start_time
        if elapsed >= timeout_sec:
            diarization_task.cancel()
            logger.warning(
                f"Diarization timed out after {timeout_sec}s for job {job_id}; continuing without diarization"
            )
            return {"status": "skipped", "reason": "diarization_timeout"}

        # Smooth progress: 86 → 89 based on elapsed/expected, never exceeds 89
        fraction = min(elapsed / max(expected_sec, 1), 1.0)
        progress = 86 + int(fraction * 3)

        await job_manager.update_job_status(
            job_id,
            JobStatus.DIARIZING,
            progress=progress,
            current_stage="Identifying speakers",
        )
        await asyncio.sleep(5)

async def _get_runpod_file_url(job_id: str, video_path: str) -> str:
    """
    Return a publicly accessible URL RunPod can download from — audio only.

    RunPod's own pipeline (download, decode, separate, transcribe, diarize)
    never reads a single video frame; only the backend's later mux step
    touches the video, and that reads it back from its own permanent R2 copy
    (still uploaded below, unchanged) — not from whatever URL this function
    hands to RunPod. Sending audio only cuts the worker's download (and its
    decode step, whose demux cost tracks input size) from the full source —
    300-800MB for a feature — down to just the audio track, typically a
    fraction of that. A 364MB film's download+extract measured ~46 minutes
    before any real work (separation/transcription/diarization) started;
    this is the fix.

    Prefers Cloudflare R2 (stable, no tunnel required).
    Raises RuntimeError if R2 is not configured or all upload attempts fail.
    """
    r2_bucket   = os.getenv("R2_BUCKET_NAME", "")
    r2_key_id   = os.getenv("R2_ACCESS_KEY_ID", "")
    r2_secret   = os.getenv("R2_SECRET_ACCESS_KEY", "")
    r2_account  = os.getenv("R2_ACCOUNT_ID", "")

    if not (r2_bucket and r2_key_id and r2_secret and r2_account):
        raise RuntimeError(
            "No video URL available for RunPod: configure R2_BUCKET_NAME / R2_ACCESS_KEY_ID / "
            "R2_SECRET_ACCESS_KEY / R2_ACCOUNT_ID in .env."
        )

    import re
    import boto3
    from botocore.config import Config
    from botocore.exceptions import ClientError

    endpoint = f"https://{r2_account}.r2.cloudflarestorage.com"
    s3 = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=r2_key_id,
        aws_secret_access_key=r2_secret,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )

    safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", Path(video_path).name)
    video_key = f"{job_id}/{safe_name}"

    # --- Permanent source backup — unchanged from before this function did
    # the audio split. Other code reads this same key later (media serving,
    # re-runs); RunPod is no longer one of those readers, but the
    # upload/skip-if-exists behavior here has to stay exactly as it was for
    # everything else that depends on it. ---
    try:
        await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: s3.head_object(Bucket=r2_bucket, Key=video_key),
        )
        logger.info(f"Job {job_id}: video already in R2 at {video_key}, skipping upload")
    except ClientError as head_err:
        if head_err.response["Error"]["Code"] != "404":
            # ERROR, not WARNING: a 404 means "not uploaded yet" and is
            # normal. Anything else — a scoped-down token returning 403,
            # say — means this check can never succeed, so every job
            # silently re-uploads its entire source forever. The dubs all
            # still work, so nothing else would ever surface it.
            logger.error(
                f"Job {job_id}: head_object FAILED ({head_err}) — the "
                f"skip-reupload check is disabled, every job will "
                f"re-transfer its source",
                exc_info=True,
            )
        # 404 = not in R2 yet, fall through to upload loop
        last_r2_err = None
        for attempt in range(1, 4):
            try:
                logger.info(f"Job {job_id}: uploading video to R2 (attempt {attempt}/3) → {r2_bucket}/{video_key}")
                await asyncio.get_event_loop().run_in_executor(
                    None,
                    lambda: s3.upload_file(
                        video_path,
                        r2_bucket,
                        video_key,
                        ExtraArgs={"ContentType": "video/mp4"},
                    ),
                )
                logger.info(f"Job {job_id}: R2 video upload complete")
                break
            except Exception as r2_err:
                last_r2_err = r2_err
                logger.warning(f"Job {job_id}: R2 video upload attempt {attempt}/3 failed: {r2_err}")
                if attempt < 3:
                    await asyncio.sleep(2)
        else:
            raise RuntimeError(f"R2 video upload failed after 3 attempts: {last_r2_err}")

    # --- Audio-only handoff for RunPod ---
    #
    # -acodec copy is a container remux, not a re-encode: near-instant
    # regardless of video length, bit-identical audio, and produces a file
    # that's just the audio track with none of the video weight. .mka
    # (Matroska) accepts any input audio codec without transcoding — uploads
    # span MP4/WebM/MOV, whose audio isn't always AAC, so a codec-specific
    # container (.m4a etc.) would fail to remux some of them.
    audio_key = f"{job_id}/audio_{Path(safe_name).stem}.mka"

    try:
        await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: s3.head_object(Bucket=r2_bucket, Key=audio_key),
        )
        logger.info(f"Job {job_id}: audio already in R2 at {audio_key}, skipping extraction")
        return s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": r2_bucket, "Key": audio_key},
            ExpiresIn=7200,
        )
    except ClientError as head_err:
        if head_err.response["Error"]["Code"] != "404":
            logger.warning(f"Job {job_id}: audio head_object check failed ({head_err}) — re-extracting")

    with tempfile.NamedTemporaryFile(suffix=".mka", delete=False) as tmp:
        tmp_audio_path = tmp.name
    try:
        cmd = [
            "ffmpeg", "-y", "-i", video_path,
            "-vn", "-map", "0:a:0", "-acodec", "copy",
            tmp_audio_path,
        ]
        proc = await asyncio.to_thread(subprocess.run, cmd, capture_output=True, timeout=300)
        if proc.returncode != 0 or not os.path.exists(tmp_audio_path) or os.path.getsize(tmp_audio_path) < 1000:
            # Stream-copy fails for the rare audio codec Matroska can't
            # carry as-is. Re-encode to Opus rather than fail the whole job
            # over a transfer optimization.
            logger.warning(
                f"Job {job_id}: audio stream-copy failed "
                f"({proc.stderr.decode(errors='ignore')[:300]}), re-encoding instead"
            )
            cmd = [
                "ffmpeg", "-y", "-i", video_path,
                "-vn", "-map", "0:a:0", "-c:a", "libopus", "-b:a", "96k",
                tmp_audio_path,
            ]
            proc = await asyncio.to_thread(subprocess.run, cmd, capture_output=True, timeout=600)
            if proc.returncode != 0 or not os.path.exists(tmp_audio_path) or os.path.getsize(tmp_audio_path) < 1000:
                raise RuntimeError(
                    f"Audio extraction failed for RunPod handoff: "
                    f"{proc.stderr.decode(errors='ignore')[:300]}"
                )

        last_r2_err = None
        for attempt in range(1, 4):
            try:
                logger.info(f"Job {job_id}: uploading audio to R2 (attempt {attempt}/3) → {r2_bucket}/{audio_key}")
                await asyncio.get_event_loop().run_in_executor(
                    None,
                    lambda: s3.upload_file(
                        tmp_audio_path,
                        r2_bucket,
                        audio_key,
                        ExtraArgs={"ContentType": "audio/x-matroska"},
                    ),
                )
                logger.info(f"Job {job_id}: audio upload complete, presigned URL generated")
                return s3.generate_presigned_url(
                    "get_object",
                    Params={"Bucket": r2_bucket, "Key": audio_key},
                    ExpiresIn=7200,
                )
            except Exception as r2_err:
                last_r2_err = r2_err
                logger.warning(f"Job {job_id}: audio R2 upload attempt {attempt}/3 failed: {r2_err}")
                if attempt < 3:
                    await asyncio.sleep(2)
        raise RuntimeError(f"Audio R2 upload failed after 3 attempts: {last_r2_err}")
    finally:
        try:
            os.unlink(tmp_audio_path)
        except OSError:
            pass


async def _delete_runpod_file(job_id: str, video_path: str) -> None:
    """UNUSED — deliberately. Do not call this without reading the note below.

    Both call sites (the dub pipeline and the transcribe-video path) were
    removed: this deleted the key {job_id}/{safe_name}, which is the SAME key
    the direct-to-R2 upload writes the user's source video to. R2 is permanent
    source storage, not a GPU handoff scratch area, so every completed job was
    destroying its own source and leaving the local disk as the only copy.
    Both calls sat in finally blocks, so failed runs lost their source too —
    precisely when you would want to retry from it.

    The storage-reclamation intent was valid; this implementation was not.
    Reclamation belongs in an explicit retention policy — delete after N days,
    or when a user deletes a project — never as a silent side effect of a
    pipeline finishing.

    Original docstring follows.

    Remove the R2 copy of a source video once the GPU job is done with it.

    The object exists for exactly one reason: to give the RunPod worker a URL it
    can download from. Nothing reads it afterwards — a re-run calls
    _get_runpod_file_url again, which re-uploads.

    Without this there is no delete path at all, so every source file ever
    uploaded accumulates in R2 forever. A customer dubbing feature films adds
    tens of GB a month that is never reclaimed.

    Best-effort: a failure here must never fail a dub that already succeeded.
    """
    r2_bucket  = os.getenv("R2_BUCKET_NAME", "")
    r2_key_id  = os.getenv("R2_ACCESS_KEY_ID", "")
    r2_secret  = os.getenv("R2_SECRET_ACCESS_KEY", "")
    r2_account = os.getenv("R2_ACCOUNT_ID", "")
    if not (r2_bucket and r2_key_id and r2_secret and r2_account):
        return

    try:
        import re
        import boto3
        from botocore.config import Config

        s3 = boto3.client(
            "s3",
            endpoint_url=f"https://{r2_account}.r2.cloudflarestorage.com",
            aws_access_key_id=r2_key_id,
            aws_secret_access_key=r2_secret,
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )
        # Must match the key built in _get_runpod_file_url exactly.
        safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", Path(video_path).name)
        object_key = f"{job_id}/{safe_name}"
        await asyncio.get_event_loop().run_in_executor(
            None, lambda: s3.delete_object(Bucket=r2_bucket, Key=object_key)
        )
        logger.info(f"Job {job_id}: R2 source object deleted ({object_key})")
    except Exception as e:
        logger.warning(f"Job {job_id}: R2 cleanup failed (object left behind): {e}")


async def _run_runpod_gpu_pipeline(job_id: str, video_path: str, duration: float):
    from app.services.runpod_service import runpod_service

    await job_manager.update_job_status(
        job_id, JobStatus.PROCESSING, progress=15,
        current_stage="Uploading to GPU cloud"
    )

    file_url = await _get_runpod_file_url(job_id, video_path)

    # Per-job source language overrides the global WHISPER_LANGUAGE env var.
    # The frontend sends this on upload (e.g. "yue" for Cantonese videos) so
    # one server can dub videos in different source languages without restart.
    job_for_lang = await job_manager.get_job(job_id)
    job_source_lang = (job_for_lang.source_language if job_for_lang else None) or ""
    whisper_language = (job_source_lang or os.getenv("WHISPER_LANGUAGE", "")).strip()
    if job_source_lang:
        logger.info(
            f"Job {job_id}: using per-job source_language={job_source_lang!r} "
            f"(overrides WHISPER_LANGUAGE env var)"
        )
    # If the user specified an exact speaker count, use it as a hard constraint.
    # Otherwise fall back to env var range (wide range = let pyannote decide).
    _job_for_spk = await job_manager.get_job(job_id)
    _expected_spk = (_job_for_spk.expected_speakers if _job_for_spk else None) or 0
    if _expected_spk and 1 <= _expected_spk <= 10:
        min_speakers = _expected_spk
        max_speakers = _expected_spk
        logger.info(f"Job {job_id}: exact speaker count={_expected_spk} — clamping pyannote to min=max={_expected_spk}")
    else:
        min_speakers = int(os.getenv("DIARIZATION_MIN_SPEAKERS", "1"))
        max_speakers = int(os.getenv("DIARIZATION_MAX_SPEAKERS", "6"))

    # Cantonese quality defaults for GPU worker:
    # - Prefer Whisper large-v3 for yue
    # - Disable Paraformer for yue (Mandarin-focused, often produces blob/junk)
    if whisper_language.lower() == "yue":
        if not os.getenv("WHISPER_MODEL", "").strip():
            os.environ["WHISPER_MODEL"] = "large-v3"
        if not os.getenv("CANTONESE_ASR_ENGINES", "").strip():
            os.environ["CANTONESE_ASR_ENGINES"] = "whisper"

    # Collect env vars the GPU worker needs for ASR engines and callbacks
    _env_keys = [
        "TENCENT_SECRET_ID", "TENCENT_SECRET_KEY",
        "CANTONESE_ASR_ENGINES", "CANTONESE_ASR_WHISPER_GAP_FILL",
        "WHISPER_LANGUAGE", "WHISPER_MODEL",
        "HF_TOKEN", "HUGGING_FACE_TOKEN", "HUGGINGFACE_TOKEN", "HUGGINGFACE_HUB_TOKEN",
        "PARAFORMER_DEVICE",
        "PUBLIC_BASE_URL",  # Worker uses this to POST stage callbacks back to us
    ]
    gpu_env_vars = {}
    for k in _env_keys:
        v = os.getenv(k, "")
        if v is None:
            continue
        v = str(v).strip()
        if v:
            gpu_env_vars[k] = v

    # Force per-job WHISPER_LANGUAGE into the worker env so it overrides any
    # stale value the worker container was started with. Same for the
    # Cantonese-specific defaults applied above.
    if whisper_language:
        gpu_env_vars["WHISPER_LANGUAGE"] = whisper_language
        if whisper_language.lower() == "yue":
            gpu_env_vars.setdefault("WHISPER_MODEL", os.environ.get("WHISPER_MODEL", "large-v3"))
            gpu_env_vars.setdefault("CANTONESE_ASR_ENGINES", os.environ.get("CANTONESE_ASR_ENGINES", "whisper"))
            # Let the worker pick its VAD threshold (default 0.15 for Cantonese).
            # Explicitly setting VAD_THRESHOLD=0 disabled VAD and caused the worker
            # to return empty transcripts on long-form mixed-content films.

    # Pin the transcription model for EVERY language, not just Cantonese.
    # Anything not sent here is inherited from whatever the worker container was
    # started with, which differs between cold and warm containers and across
    # worker redeploys — the same file transcribed 31 segments one night and 21
    # the next. Pinning makes a run reproducible.
    #
    # VAD_THRESHOLD is deliberately NOT given a blanket default: "0" is a
    # Cantonese-specific decision made for fight-scene audio, and inventing a
    # value for other languages would change untested behaviour. Where it is not
    # configured we log that it is worker-inherited, so a future variance
    # investigation starts with the answer instead of a mystery.
    gpu_env_vars.setdefault("WHISPER_MODEL", os.environ.get("WHISPER_MODEL", "large-v3"))
    # pyannote on the worker's CUDA path collapses to one speaker; force CPU
    # diarization while keeping GPU transcription/separation.
    gpu_env_vars["DIARIZATION_DEVICE"] = "cpu"
    _unpinned = [k for k in ("VAD_THRESHOLD",) if k not in gpu_env_vars]
    logger.info(
        f"Job {job_id}: ASR settings pinned — "
        f"language={gpu_env_vars.get('WHISPER_LANGUAGE') or 'auto-detect'}, "
        f"model={gpu_env_vars.get('WHISPER_MODEL')}, "
        f"vad={gpu_env_vars.get('VAD_THRESHOLD', 'worker-inherited')}"
        + (f" | UNPINNED (worker decides): {', '.join(_unpinned)}" if _unpinned else "")
    )

    # Compatibility: the worker (and diarization pipeline) primarily reads HF_TOKEN.
    if not gpu_env_vars.get("HF_TOKEN"):
        alt_hf = (
            os.getenv("HUGGING_FACE_TOKEN", "")
            or os.getenv("HUGGINGFACE_TOKEN", "")
            or os.getenv("HUGGINGFACE_HUB_TOKEN", "")
        )
        alt_hf = str(alt_hf).strip()
        if alt_hf:
            gpu_env_vars["HF_TOKEN"] = alt_hf

    async def _progress_cb(pct):
        from app.services.pipeline_tracker import pipeline_tracker
        # NOTE: RunPod can sit in IN_QUEUE for a while. While queued we
        # should not advance pipeline stages.
        if pct < 15:
            stage = "Waiting for GPU worker (RunPod queue)"
        else:
            stage = "Processing on GPU"

            def _ensure_started(stage_id: str):
                p = pipeline_tracker.get_pipeline(job_id)
                if not p:
                    return
                for s in p.get("stages", []):
                    if s.get("id") == stage_id and s.get("status") == "pending":
                        pipeline_tracker.start_stage(job_id, stage_id)
                        return

            def _ensure_completed(stage_id: str, summary: str):
                p = pipeline_tracker.get_pipeline(job_id)
                if not p:
                    return
                for s in p.get("stages", []):
                    if s.get("id") == stage_id and s.get("status") in ("pending", "active"):
                        pipeline_tracker.complete_stage(job_id, stage_id, summary)
                        return

            # RunPod progress callbacks can jump (e.g. 55% → 90%).
            # Make stage transitions monotonic: once pct passes a threshold,
            # force-complete earlier stages so the UI doesn't get stuck.
            if pct >= 55:
                _ensure_completed("download", "Video downloaded to GPU worker")
                _ensure_started("extract")
            if pct >= 65:
                _ensure_completed("extract", "Audio extracted")
                _ensure_started("separate")
            if pct >= 75:
                _ensure_completed("separate", "Demucs separation complete")
                _ensure_started("transcribe")
            if pct >= 90:
                _ensure_completed("transcribe", "Transcription complete")
                _ensure_started("diarize")

            if pct < 55:
                stage = "Downloading video (GPU)"
            elif pct < 65:
                stage = "Extracting audio (GPU)"
            elif pct < 75:
                stage = "Separating audio (GPU)"
            elif pct < 90:
                stage = "Transcribing (GPU)"
            else:
                stage = "Diarizing speakers (GPU)"
        await job_manager.update_job_status(
            job_id, JobStatus.TRANSCRIBING, progress=pct, current_stage=stage
        )

    try:
        runpod_poll_timeout = int(
            os.getenv(
                "RUNPOD_POLL_TIMEOUT_SEC",
                os.getenv("RUNPOD_QUEUE_TIMEOUT_SEC", "7200"),
            )
        )
    except Exception:
        try:
            runpod_poll_timeout = int(os.getenv("RUNPOD_QUEUE_TIMEOUT_SEC", "7200"))
        except Exception:
            runpod_poll_timeout = 7200

    submit_result = await runpod_service.submit_job(
        file_url=file_url,
        job_id=job_id,
        language=whisper_language,
        min_speakers=min_speakers,
        max_speakers=max_speakers,
        env_vars=gpu_env_vars,
    )

    try:
        _runpod_job_id = submit_result.get("id")
        job_for_rp = await job_manager.get_job(job_id)
        if job_for_rp and _runpod_job_id:
            job_for_rp.runpod_job_id = _runpod_job_id
            logger.info(f"Job {job_id}: stored runpod_job_id={_runpod_job_id}")
    except Exception:
        pass

    runpod_job_id = submit_result.get("id")
    if not runpod_job_id:
        raise RuntimeError(f"RunPod did not return a job ID: {submit_result}")

    async def _record_gpu_cost(exec_s: float, queue_s: float) -> None:
        # Stored on the job so cost per source minute accumulates across runs
        # rather than living only in a log line that rotates away.
        j = await job_manager.get_job(job_id)
        if j is None:
            return
        j.gpu_execution_seconds = exec_s
        j.gpu_queue_seconds = queue_s
        dur = getattr(j, "video_duration", None)
        if dur:
            logger.info(
                f"[RUNPOD-COST] job {job_id}: {exec_s:.1f}s GPU for {dur:.1f}s source "
                f"({exec_s / (dur / 60):.1f}s GPU per source minute)"
            )

    result = await runpod_service.poll_until_complete(
        runpod_job_id=runpod_job_id,
        timeout=runpod_poll_timeout,
        progress_callback=_progress_cb,
        timing_callback=_record_gpu_cost,
    )

    if result.get("error"):
        raise RuntimeError(f"RunPod GPU pipeline failed: {result['error']}")

    # Clear runpod_job_id after success
    try:
        job_for_rp2 = await job_manager.get_job(job_id)
        if job_for_rp2:
            job_for_rp2.runpod_job_id = None
    except Exception:
        pass

    logger.info(f"Job {job_id}: RunPod result keys={list(result.keys())}, "
                f"segments={len(result.get('segments', []))}, "
                f"transcript_segments={len(result.get('transcript', {}).get('segments', []))}, "
                f"timings={result.get('timings')}, gpu={result.get('gpu')}")

    segments_data = result.get("segments", [])
    transcript_data = result.get("transcript", {})
    speaker_genders = result.get("speaker_genders", {})

    if segments_data:
        _sample = segments_data[0]
        logger.info(f"Job {job_id}: RunPod segment[0] keys={list(_sample.keys())}, "
                     f"confidence={_sample.get('confidence')}, words={bool(_sample.get('words'))}")


    diarization_segments = (result.get("diarization", {}) or {}).get("segments", [])

    # Fetch expected speakers once — used by both Velma and F0 fallback below
    _job_for_f0 = await job_manager.get_job(job_id)
    _exp_spk_f0 = (_job_for_f0.expected_speakers if _job_for_f0 else 0) or 0

    # Fetch the GPU stems BEFORE Velma. Velma is the primary transcript AND
    # diarization source, so handing it the full mix means music, effects and
    # crowd noise degrade both. The stems also land where dub_video looks for a
    # cached separation, which is what keeps the long-form mix guard from firing.
    await asyncio.to_thread(_fetch_gpu_stems, job_id, result.get("stems") or {})

    # Try Velma diarization first (primary source)
    velma_result = None
    if os.getenv("MODULATE_API_KEY") and video_path:
        try:
            logger.info(f"Job {job_id}: RunPod path — attempting Velma diarization (primary)")
            # Vocals, not the video container — see _velma_source_audio. Off the
            # event loop: separation and compression are both blocking.
            _vocals_stem = os.path.join("data", "separated", f"{job_id}_vocals.wav")
            _have_vocals = os.path.isfile(_vocals_stem) and os.path.getsize(_vocals_stem) > 1000
            if not _have_vocals:
                logger.warning(
                    f"Job {job_id}: no vocals stem — Velma gets the full mix, so music "
                    f"and effects will degrade its speakers and transcript"
                )
            velma_audio_path = await asyncio.to_thread(
                _velma_source_audio, video_path, job_id,
                _vocals_stem if _have_vocals else None,
            )
            velma_result = await asyncio.to_thread(
                velma_diarize, velma_audio_path, job_id, _exp_spk_f0
            )
        except Exception as _velma_err:
            logger.warning(f"Job {job_id}: Velma diarization failed: {_velma_err}")

    _velma_is_primary = False
    _runpod_segments = segments_data  # preserve RunPod confidence before Velma overwrites
    if velma_result and velma_result.get("status") == "ok":
        _velma_segs = velma_result.get("segments", [])
        logger.info(
            f"Job {job_id}: Velma OK — {len(_velma_segs)} segments, "
            f"{velma_result.get('unique_speakers', '?')} speakers. "
            f"Using as PRIMARY transcript + diarization source."
        )

        def _match_runpod_confidence(velma_start, velma_end, rp_segs):
            """Find best-overlapping RunPod segment and return its confidence + words."""
            best_overlap, best_seg = 0, None
            for rp in rp_segs:
                rp_s, rp_e = float(rp.get("start", 0)), float(rp.get("end", 0))
                overlap = max(0, min(velma_end, rp_e) - max(velma_start, rp_s))
                if overlap > best_overlap:
                    best_overlap, best_seg = overlap, rp
            if best_seg and best_overlap > 0:
                return best_seg.get("confidence"), best_seg.get("confidence_tier"), best_seg.get("words")
            return None, None, None

        segments_data = []
        for s in _velma_segs:
            if not (s.get("text") or "").strip():
                continue
            v_start, v_end = float(s.get("start", 0)), float(s.get("end", 0))
            conf, tier, words = _match_runpod_confidence(v_start, v_end, _runpod_segments)
            segments_data.append({
                "text": s.get("text", ""),
                "start": v_start,
                "end": v_end,
                "speaker": s.get("speaker", "speaker-1"),
                "confidence": conf,
                "confidence_tier": tier,
                "words": words,
                "velma_emotion": s.get("emotion"),
                "velma_accent": s.get("accent"),
                "velma_deepfake_score": s.get("deepfake_score"),
            })
        _velma_is_primary = True

        # Persist Velma scene context for use during translation
        _velma_context = {
            "summary": velma_result.get("summary"),
            "topics": velma_result.get("topics", []),
            "topic_sentiments": velma_result.get("topic_sentiments", []),
            "role_picks": velma_result.get("role_picks", []),
        }
        if any(_velma_context.values()):
            _velma_dir = Path("data/velma")
            _velma_dir.mkdir(parents=True, exist_ok=True)
            _velma_path = _velma_dir / f"{job_id}.json"
            import json as _json_velma
            with open(_velma_path, "w", encoding="utf-8") as _vf:
                _json_velma.dump(_velma_context, _vf, ensure_ascii=False, indent=2)
            logger.info(f"Job {job_id}: Velma scene context saved to {_velma_path}")
    else:
        logger.info(f"Job {job_id}: Velma unavailable — falling back to Whisper/RunPod transcript")

    segments = [
        _seg_dict_to_model(seg)
        for seg in segments_data
        if seg.get("text", "").strip()
    ]

    if not segments and transcript_data.get("segments"):
        segments = [
            _seg_dict_to_model(seg)
            for seg in transcript_data["segments"]
        ]

    # Normalize RunPod/Velma speaker labels (e.g. SPEAKER_00 -> speaker-1) so
    # the editor and downstream voice assignment see consistent, 1-indexed IDs.
    if segments:
        segments = _normalize_speaker_labels(segments)

    # Re-assign speakers from diarization when the transcript collapsed to a
    # single speaker. This used to be skipped whenever Velma was primary, on the
    # assumption that Velma always carries correct speakers — but when Velma
    # returns ONE speaker and pyannote found several, Velma is the wrong source
    # and its labels dub the whole film in one voice. The inner check below only
    # fires on an already-collapsed transcript, so a healthy Velma is untouched.
    if diarization_segments and segments:
        unique_speakers = set((s.speaker or "speaker-1") for s in segments)
        diar_speakers = set((d.get("speaker") or "").strip() for d in diarization_segments if d.get("speaker"))
        if len(unique_speakers) <= 1 and len(diar_speakers) > 1:
            logger.info(
                f"Job {job_id}: transcript has {len(unique_speakers)} speaker label(s) but diarization has "
                f"{len(diar_speakers)} — re-assigning speakers from diarization"
            )
            raw_segments = [
                {"text": s.text, "start": s.start, "end": s.end, "speaker": s.speaker}
                for s in segments
            ]
            reassigned = _assign_speakers_from_diarization(raw_segments, diarization_segments)
            reassigned = _smooth_speaker_assignments(reassigned)
            reassigned = _normalize_speaker_labels(reassigned)
            if reassigned:
                segments = reassigned

    # F0 fallback: if diarization collapsed everything to 1 speaker but the user
    # told us there are N > 1 speakers, split using pitch-based k-means.
    if _exp_spk_f0 > 1 and segments:
        _current_spk = set((s.speaker if isinstance(s, TranscriptSegment) else s.get("speaker", "")) for s in segments)
        if len(_current_spk) <= 1:
            try:
                logger.info(
                    f"Job {job_id}: pyannote returned 1 speaker but expected {_exp_spk_f0} — "
                    "applying F0 k-means fallback"
                )
                segments = await asyncio.to_thread(
                    _f0_split_speakers, segments, video_path, _exp_spk_f0, job_id
                )
            except Exception as _f0_err:
                logger.warning(f"Job {job_id}: F0 fallback failed: {_f0_err}")

            # Re-classify genders immediately with the new speaker labels so
            # stale SPEAKER_00-only data never reaches the status response.
            _post_split_spk = set(
                (s.speaker if isinstance(s, TranscriptSegment) else s.get("speaker", ""))
                for s in segments
            )
            if len(_post_split_spk) > 1:
                try:
                    # Vocals, not the mix: the F0 split above already ran
                    # separation, so this reads the cached track.
                    _f0_audio_src = await asyncio.to_thread(_vocals_or_video, video_path, job_id)
                    _f0_extract = await asyncio.to_thread(extract_audio, _f0_audio_src)
                    if _f0_extract and _f0_extract.get("status") == "ok":
                        _f0_segs = [
                            {
                                "speaker": s.speaker if isinstance(s, TranscriptSegment) else s.get("speaker"),
                                "start": s.start if isinstance(s, TranscriptSegment) else s.get("start"),
                                "end": s.end if isinstance(s, TranscriptSegment) else s.get("end"),
                            }
                            for s in segments
                        ]
                        _new_genders = await asyncio.to_thread(
                            classify_speakers,
                            _f0_extract["audio"],
                            _f0_extract["sample_rate"],
                            _f0_segs,
                        )
                        if _new_genders:
                            speaker_genders = _new_genders
                            await job_manager.update_job_speaker_genders(job_id, _new_genders)
                            logger.info(
                                f"Job {job_id}: re-classified genders after F0 split: {_new_genders}"
                            )
                except Exception as _rcls_err:
                    logger.warning(
                        f"Job {job_id}: gender re-classification after F0 split failed: {_rcls_err}"
                    )

    # Quality gate: if the GPU worker returns an empty transcript, retry
    # transcription on RunPod using the original mixed audio instead of falling
    # back to the local CPU. This applies to every language DubMaster supports.
    if not segments:
        logger.warning(
            f"Job {job_id}: GPU transcript is empty for lang={whisper_language!r}. "
            "Retrying transcription on RunPod (GPU)."
        )
        try:
            fb_segments, fb_diarization = await _runpod_transcribe_fallback(
                job_id, video_path, whisper_language, min_speakers, max_speakers, gpu_env_vars
            )
            if fb_segments:
                segments = [
                    _seg_dict_to_model(s)
                    for s in fb_segments
                    if (s.get("text") or "").strip()
                ]
                diarization_segments = fb_diarization
                logger.info(
                    f"Job {job_id}: RunPod transcription fallback (empty transcript) succeeded "
                    f"(segments={len(segments)})."
                )
            else:
                raise RuntimeError("RunPod transcription fallback returned no segments")
        except Exception as e:
            logger.error(f"Job {job_id}: RunPod transcription fallback failed: {e}")
            raise RuntimeError(
                f"GPU transcription failed for {whisper_language}: RunPod returned an empty transcript "
                "and the fallback also failed. Check RunPod worker configuration or Velma credits."
            ) from e

    # Quality gate: if the GPU transcript is low-quality CJK character soup,
    # retry transcription on RunPod using the original mixed audio instead of
    # falling back to the local CPU.
    if _is_low_quality_cjk_transcript(segments, whisper_language):
        logger.warning(
            f"Job {job_id}: GPU transcript is low-quality CJK character soup for lang={whisper_language!r}. "
            "Retrying transcription on RunPod (GPU)."
        )
        try:
            fb_segments, fb_diarization = await _runpod_transcribe_fallback(
                job_id, video_path, whisper_language, min_speakers, max_speakers, gpu_env_vars
            )
            if fb_segments:
                segments = [
                    _seg_dict_to_model(s)
                    for s in fb_segments
                    if (s.get("text") or "").strip()
                ]
                diarization_segments = fb_diarization
                logger.info(
                    f"Job {job_id}: RunPod transcription fallback (low-quality CJK) succeeded "
                    f"(segments={len(segments)})."
                )
            else:
                raise RuntimeError("RunPod transcription fallback returned no segments")
        except Exception as e:
            logger.error(f"Job {job_id}: RunPod transcription fallback failed: {e}")
            raise RuntimeError(
                f"GPU transcription failed for {whisper_language}: low-quality transcript and the "
                "RunPod fallback also failed. Check RunPod worker configuration or Velma credits."
            ) from e

    # Cantonese cleanup: GPU workers often return CJK characters spaced like tokens.
    # Fix at ingestion time so downstream translation/TTS sees real sentences.
    if whisper_language.lower() in ("yue", "zh-yue", "yue-hk", "zh-hk") and segments:
        before = len(segments)
        segments = [
            TranscriptSegment(
                text=_collapse_cjk_spaces(s.text or ""),
                start=s.start,
                end=s.end,
                speaker=s.speaker or "speaker-1",
                confidence=s.confidence,
                confidence_tier=s.confidence_tier,
                words=s.words,
                velma_emotion=s.velma_emotion,
                velma_accent=s.velma_accent,
                velma_deepfake_score=s.velma_deepfake_score,
                is_credit=s.is_credit,
            )
            for s in segments
            if (s.text or "").strip()
        ]
        segments = _merge_close_transcript_segments(segments)
        after = len(segments)
        if after != before:
            logger.info(f"Job {job_id}: merged micro-fragments after CJK cleanup: {before} -> {after}")

    # Mark subtitle/credit/narration lines so they are excluded from dubbing.
    # The original accompaniment audio is preserved for these time ranges.
    if segments:
        before_credits = len([s for s in segments if s.is_credit])
        segments = _mark_credit_segments(segments)
        after_credits = len([s for s in segments if s.is_credit])
        if after_credits != before_credits:
            logger.info(f"Job {job_id}: marked {after_credits - before_credits} credit/subtitle segment(s)")

    # Apply Velma enrichment to final segments after all speaker reassignment is complete
    if velma_result and velma_result.get("status") == "ok" and segments:
        _velma_segs = velma_result.get("segments", [])
        enriched_segments = []
        for seg in segments:
            s_start = seg.start if isinstance(seg, TranscriptSegment) else seg.get("start", 0)
            s_end = seg.end if isinstance(seg, TranscriptSegment) else seg.get("end", 0)
            spkr = seg.speaker if isinstance(seg, TranscriptSegment) else seg.get("speaker", "speaker-1")
            txt = seg.text if isinstance(seg, TranscriptSegment) else seg.get("text", "")
            best_match = None
            best_overlap = 0
            for vs in _velma_segs:
                ov = min(s_end, vs.get("end", 0)) - max(s_start, vs.get("start", 0))
                if ov > best_overlap:
                    best_overlap = ov
                    best_match = vs
            _conf = seg.confidence if isinstance(seg, TranscriptSegment) else seg.get("confidence")
            _tier = seg.confidence_tier if isinstance(seg, TranscriptSegment) else seg.get("confidence_tier")
            _words = seg.words if isinstance(seg, TranscriptSegment) else None
            enriched_segments.append(TranscriptSegment(
                text=txt,
                start=s_start,
                end=s_end,
                speaker=spkr,
                confidence=_conf,
                confidence_tier=_tier,
                words=_words,
                velma_emotion=best_match.get("emotion") if best_match else None,
                velma_accent=best_match.get("accent") if best_match else None,
                velma_deepfake_score=best_match.get("deepfake_score") if best_match else None,
            ))
        segments = enriched_segments

    transcript = Transcript(
        language=transcript_data.get("language", whisper_language or "en"),
        duration=transcript_data.get("duration", duration),
        text=_collapse_cjk_spaces(transcript_data.get("text", " ".join(s.text for s in segments))),
        segments=segments,
    )

    await job_manager.update_job_transcript(job_id, transcript)

    if speaker_genders:
        await job_manager.update_job_speaker_genders(job_id, speaker_genders)
    else:
        # RunPod handler didn't return speaker gender classifications.
        # Run local F0 pitch analysis on the uploaded video so child-voice
        # routing and gender-based voice assignment work correctly.
        try:
            from app.pipeline.classify_speakers import classify_speakers as _classify

            logger.info(f"Job {job_id}: speaker_genders empty from GPU — running local F0 classification")
            # Vocals rather than the mix — pitch analysis on score and effects
            # skews the register floor that decides male/female.
            extract_result = extract_audio(_vocals_or_video(video_path, job_id))
            if extract_result and extract_result.get("status") == "ok":
                audio_tensor = extract_result["audio"]
                sr = extract_result["sample_rate"]
                segs_for_classify = [
                    {"speaker": s.speaker, "start": s.start, "end": s.end}
                    for s in segments
                ]
                local_genders = _classify(audio_tensor, sr, segs_for_classify)
                if local_genders:
                    await job_manager.update_job_speaker_genders(job_id, local_genders)
                    speaker_genders = local_genders
                    logger.info(f"Job {job_id}: local F0 classification: {local_genders}")
                else:
                    logger.warning(f"Job {job_id}: local F0 classification returned no genders")
        except Exception as classify_err:
            logger.warning(f"Job {job_id}: local F0 classification failed: {classify_err}")

    timings = result.get("timings", {})
    gpu_info = result.get("gpu", {})
    logger.info(
        f"Job {job_id}: RunPod GPU pipeline complete — "
        f"{len(segments)} segments, {len(speaker_genders)} speakers, "
        f"total={timings.get('total', '?')}s, device={gpu_info.get('device', '?')}"
    )

    return True


async def _get_existing_stem_url(job_id: str, stem_name: str = "vocals.mp3") -> Optional[str]:
    """Return a presigned R2 URL for a GPU-produced stem if it exists."""
    r2_bucket = os.getenv("R2_BUCKET_NAME", "")
    r2_key_id = os.getenv("R2_ACCESS_KEY_ID", "")
    r2_secret = os.getenv("R2_SECRET_ACCESS_KEY", "")
    r2_account = os.getenv("R2_ACCOUNT_ID", "")
    if not (r2_bucket and r2_key_id and r2_secret and r2_account):
        return None

    import boto3
    from botocore.config import Config
    from botocore.exceptions import ClientError

    endpoint = f"https://{r2_account}.r2.cloudflarestorage.com"
    s3 = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=r2_key_id,
        aws_secret_access_key=r2_secret,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )
    object_key = f"stems/{job_id}/{stem_name}"
    try:
        await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: s3.head_object(Bucket=r2_bucket, Key=object_key),
        )
        url = s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": r2_bucket, "Key": object_key},
            ExpiresIn=7200,
        )
        logger.info(f"Job {job_id}: using existing R2 stem at {object_key}")
        return url
    except ClientError as head_err:
        if head_err.response["Error"]["Code"] != "404":
            logger.warning(f"Job {job_id}: could not check R2 stem {object_key}: {head_err}")
        return None


async def _runpod_diarize_fallback(
    job_id: str,
    video_path: str,
    min_speakers: int,
    max_speakers: int,
) -> list:
    """Retry speaker diarization on RunPod using the separated vocals stem.

    The transcription fallback uses the original mixed audio so Whisper can
    produce a transcript. pyannote on that same mixed track often fails to
    identify speakers. The GPU worker already produced a clean vocals stem, so
    we send that back to RunPod for a diarization-only pass.
    """
    from app.services.runpod_service import runpod_service

    logger.warning(
        f"Job {job_id}: GPU diarization empty — retrying diarization on RunPod "
        "using separated vocals."
    )

    # Prefer the existing R2 vocals stem; fall back to uploading the local WAV.
    file_url = await _get_existing_stem_url(job_id, "vocals.mp3")
    if not file_url:
        source_path = _vocals_or_video(video_path, job_id)
        file_url = await _get_runpod_file_url(job_id, source_path)

    env_vars = {
        "DIARIZATION_MIN_SPEAKERS": str(min_speakers),
        "DIARIZATION_MAX_SPEAKERS": str(max_speakers),
        # Force CPU diarization on the worker to avoid CUDA collapsing speakers.
        "DIARIZATION_DEVICE": "cpu",
    }
    # The diarization-only job still needs the Hugging Face token to load
    # pyannote/speaker-diarization-3.1 on the worker.
    for hf_key in ("HF_TOKEN", "HUGGING_FACE_TOKEN", "HUGGINGFACE_TOKEN", "HUGGINGFACE_HUB_TOKEN"):
        v = os.getenv(hf_key, "").strip()
        if v:
            env_vars["HF_TOKEN"] = v
            break
    if not env_vars.get("HF_TOKEN"):
        logger.warning(f"Job {job_id}: HF token not available — RunPod diarization fallback may fail")

    submit_result = await runpod_service.submit_job(
        file_url=file_url,
        job_id=f"{job_id}-diarize-fallback",
        language="",
        min_speakers=min_speakers,
        max_speakers=max_speakers,
        steps=["diarize"],
        env_vars=env_vars,
    )
    runpod_job_id = submit_result.get("id")
    if not runpod_job_id:
        raise RuntimeError("RunPod diarization fallback did not return a job ID")

    timeout = int(os.getenv("RUNPOD_POLL_TIMEOUT_SEC", "7200"))
    output = await runpod_service.poll_until_complete(
        runpod_job_id,
        timeout=timeout,
        interval=5,
    )
    if output.get("error"):
        raise RuntimeError(f"RunPod diarization fallback failed: {output['error']}")

    diarization = (output.get("diarization") or {}).get("segments", []) or []
    logger.info(
        f"Job {job_id}: RunPod diarization fallback returned "
        f"{len(diarization)} turn(s)."
    )
    return diarization


async def _runpod_transcribe_fallback(
    job_id: str,
    video_path: str,
    whisper_language: str,
    min_speakers: int,
    max_speakers: int,
    gpu_env_vars: dict,
) -> tuple[list, list]:
    """Retry transcription on RunPod using the original mixed audio.

    The primary GPU pipeline separates vocals before transcribing. Some
    Cantonese sources lose dialogue when the separated vocals are over-filtered
    or when VAD is disabled. This fallback submits a transcription-only job
    against the original mixed audio, keeping the work on GPU instead of the
    local CPU fallback.
    """
    from app.services.runpod_service import runpod_service

    logger.warning(
        f"Job {job_id}: GPU transcript empty/low-quality — retrying transcription on RunPod "
        "using original mixed audio (no Demucs)."
    )
    file_url = await _get_runpod_file_url(job_id, video_path)
    env_vars = dict(gpu_env_vars)
    # Remove any VAD override so the worker uses its default (0.15 for yue).
    env_vars.pop("VAD_THRESHOLD", None)
    # Pin Whisper-only to avoid Tencent 413 / Paraformer unsupported-language issues.
    env_vars["CANTONESE_ASR_ENGINES"] = "whisper"
    env_vars.setdefault("WHISPER_MODEL", "large-v3")

    submit_result = await runpod_service.submit_job(
        file_url=file_url,
        job_id=f"{job_id}-tx-fallback",
        language=whisper_language,
        min_speakers=min_speakers,
        max_speakers=max_speakers,
        steps=["transcribe"],
        env_vars=env_vars,
    )
    runpod_job_id = submit_result.get("id")
    if not runpod_job_id:
        raise RuntimeError("RunPod transcription fallback did not return a job ID")

    timeout = int(os.getenv("RUNPOD_POLL_TIMEOUT_SEC", "7200"))
    output = await runpod_service.poll_until_complete(
        runpod_job_id,
        timeout=timeout,
        interval=5,
    )
    if output.get("error"):
        raise RuntimeError(f"RunPod transcription fallback failed: {output['error']}")

    segments = output.get("segments", []) or []
    diarization = (output.get("diarization") or {}).get("segments", []) or []

    # The mixed-audio transcription path can leave pyannote without a clean
    # enough signal to separate speakers. Run a diarization-only pass on the
    # already-separated vocals stem so downstream voice cloning still gets
    # per-speaker audio.
    if segments and not diarization:
        try:
            diarization = await _runpod_diarize_fallback(
                job_id, video_path, min_speakers, max_speakers
            )
        except Exception as dia_err:
            logger.error(f"Job {job_id}: RunPod diarization fallback failed: {dia_err}")

    logger.info(
        f"Job {job_id}: RunPod transcription fallback returned "
        f"{len(segments)} segment(s), {len(diarization)} diarization turn(s)."
    )
    return segments, diarization


def _should_use_gpu() -> bool:
    mode = os.getenv("PROCESSING_MODE", "cpu").lower()
    if mode == "gpu":
        return True
    if mode == "auto":
        from app.services.runpod_service import runpod_service
        return runpod_service.is_available()
    return False


async def process_video_pipeline(job_id: str, video_path: str):
    from app.services.pipeline_tracker import pipeline_tracker

    pipeline_type = "gpu" if _should_use_gpu() else "analysis"
    pipeline_tracker.init_pipeline(job_id, pipeline_type)
    pipeline_tracker.start_stage(job_id, "upload")
    pipeline_tracker.complete_stage(job_id, "upload", f"File: {Path(video_path).name}")

    try:
        await job_manager.update_job_status(
            job_id,
            JobStatus.PROCESSING,
            progress=10,
            current_stage="Getting video duration"
        )
        
        duration = chunker.get_video_duration(video_path)
        if not duration:
            await job_manager.update_job_status(
                job_id,
                JobStatus.FAILED,
                error_message="Could not determine video duration"
            )
            return
        
        job = await job_manager.get_job(job_id)
        if job:
            job.video_duration = duration

        if _should_use_gpu():
            from app.services.runpod_service import runpod_service
            if runpod_service.is_available():
                logger.info(f"Job {job_id}: routing to RunPod GPU serverless endpoint")
                # Re-init as GPU pipeline with GPU-specific stages
                pipeline_tracker.init_pipeline(job_id, "gpu")
                pipeline_tracker.start_stage(job_id, "download")
                try:
                    await _run_runpod_gpu_pipeline(job_id, video_path, duration)
                    # Mark all GPU stages complete
                    for sid in ["download", "extract", "separate", "transcribe", "diarize"]:
                        if pipeline_tracker.get_pipeline(job_id):
                            stage_data = pipeline_tracker._pipelines[job_id]["stages"].get(sid, {})
                            if stage_data.get("status") in ("pending", "active"):
                                pipeline_tracker.complete_stage(job_id, sid)
                    await job_manager.update_job_status(
                        job_id, JobStatus.COMPLETED, progress=100,
                        current_stage="Video processing complete (GPU)"
                    )
                    return
                except Exception as gpu_err:
                    mode = os.getenv("PROCESSING_MODE", "cpu").lower()
                    allow_fallback = os.getenv("GPU_ALLOW_CPU_FALLBACK", "").lower()
                    if allow_fallback in {"1", "true", "yes"}:
                        allow_fallback_bool = True
                    elif allow_fallback in {"0", "false", "no"}:
                        allow_fallback_bool = False
                    else:
                        allow_fallback_bool = (mode == "auto")

                    if not allow_fallback_bool and mode == "gpu":
                        logger.error(f"Job {job_id}: GPU pipeline failed (no CPU fallback): {gpu_err}")
                        try:
                            p = pipeline_tracker.get_pipeline(job_id) or {}
                            active_stage = p.get("active_stage")
                            if active_stage:
                                pipeline_tracker.fail_stage(job_id, active_stage, str(gpu_err))
                            else:
                                pipeline_tracker.fail_stage(job_id, "download", str(gpu_err))
                        except Exception:
                            pipeline_tracker.fail_stage(job_id, "download", str(gpu_err))
                        await job_manager.update_job_status(
                            job_id,
                            JobStatus.FAILED,
                            progress=100,
                            error_message=f"GPU pipeline failed: {gpu_err}",
                        )
                        return

                    logger.warning(f"Job {job_id}: GPU pipeline failed, falling back to CPU: {gpu_err}")
                    # Re-init as CPU analysis pipeline for fallback
                    pipeline_tracker.init_pipeline(job_id, "analysis")
                    pipeline_tracker.start_stage(job_id, "upload")
                    pipeline_tracker.complete_stage(job_id, "upload", f"File: {Path(video_path).name}")
            else:
                logger.info(f"Job {job_id}: PROCESSING_MODE=gpu but RunPod not configured, using CPU")

        pipeline_tracker.start_stage(job_id, "chunk")
        await job_manager.update_job_status(
            job_id,
            JobStatus.CHUNKING,
            progress=20,
            current_stage="Chunking video"
        )

        chunks = chunker.chunk_video(job_id, video_path)
        
        if not chunks:
            await job_manager.update_job_status(
                job_id,
                JobStatus.FAILED,
                error_message="Failed to create video chunks"
            )
            return
        
        await job_manager.update_job_chunks(job_id, chunks)
        pipeline_tracker.complete_stage(job_id, "chunk", f"{len(chunks)} chunk(s)")

        pipeline_tracker.start_stage(job_id, "extract_audio")
        await job_manager.update_job_status(
            job_id,
            JobStatus.EXTRACTING_AUDIO,
            progress=40,
            current_stage="Extracting audio from video"
        )

        extract_result = await asyncio.to_thread(extract_audio, video_path)
        
        if extract_result["status"] != "ok":
            logger.warning(f"Audio extraction failed: {extract_result.get('reason')}")
            await job_manager.update_job_status(
                job_id,
                JobStatus.FAILED,
                error_message=f"Audio extraction failed: {extract_result.get('reason', 'unknown')}"
            )
            return
        
        pipeline_tracker.complete_stage(job_id, "extract_audio", f"{extract_result.get('sample_rate', 16000)}Hz audio extracted")

        pipeline_tracker.start_stage(job_id, "separate")
        await job_manager.update_job_status(
            job_id,
            JobStatus.TRANSCRIBING,
            progress=55,
            current_stage="Separating speech from background noise"
        )

        # Run Demucs vocal separation before Whisper so transcription uses
        # clean isolated speech instead of the raw mix (fight SFX, music, crowd).
        from app.services.replicate_service import is_cloud_enabled, cloud_separate
        from app.pipeline.separate_audio import separate_audio

        if is_cloud_enabled():
            logger.info(f"Job {job_id}: using CLOUD GPU for Demucs separation")
            separation_result = await asyncio.to_thread(cloud_separate, video_path, job_id)
            if separation_result.get("status") != "ok":
                logger.warning(f"Job {job_id}: cloud separation failed, falling back to local CPU")
                separation_result = await asyncio.to_thread(separate_audio, video_path, job_id)
        else:
            separation_result = await asyncio.to_thread(separate_audio, video_path, job_id)

        transcribe_input = extract_result
        if separation_result.get("status") == "ok":
            vocals_path = separation_result.get("vocals_path")
            logger.info(f"Job {job_id}: using separated vocals for transcription: {vocals_path}")
            # Load the clean vocals WAV into the same format as extract_result
            try:
                import soundfile as sf
                import numpy as np
                import torch
                vocals_data, vocals_sr = sf.read(vocals_path, always_2d=True)
                vocals_waveform = torch.from_numpy(vocals_data.T).float()  # [channels, samples]
                # Resample to 16kHz mono for Whisper if needed
                if vocals_sr != 16000:
                    vocals_waveform = torchaudio.functional.resample(vocals_waveform, vocals_sr, 16000)
                    vocals_sr = 16000
                if vocals_waveform.shape[0] > 1:
                    vocals_waveform = vocals_waveform.mean(dim=0, keepdim=True)

                # ── Speech energy gate ──
                # Zero out low-energy frames to suppress residual grunts/noise
                # that Demucs couldn't fully remove from the vocals track.
                frame_size = int(0.03 * vocals_sr)  # 30ms frames
                hop = frame_size
                n_samples = vocals_waveform.shape[-1]
                rms_values = []
                for fi in range(0, n_samples - frame_size, hop):
                    frame = vocals_waveform[0, fi:fi + frame_size]
                    rms_values.append(frame.pow(2).mean().sqrt().item())

                if rms_values:
                    rms_tensor = torch.tensor(rms_values)
                    # Use adaptive threshold: median + 1 std of non-silent frames
                    non_silent = rms_tensor[rms_tensor > 0.001]
                    if len(non_silent) > 10:
                        threshold = float(non_silent.median() * 0.5)
                    else:
                        threshold = 0.01

                    gated = vocals_waveform.clone()
                    frames_zeroed = 0
                    for fi_idx, fi in enumerate(range(0, n_samples - frame_size, hop)):
                        if rms_values[fi_idx] < threshold:
                            gated[0, fi:fi + frame_size] = 0.0
                            frames_zeroed += 1

                    total_frames = len(rms_values)
                    speech_pct = 100 * (1 - frames_zeroed / total_frames) if total_frames else 0
                    logger.info(
                        f"Job {job_id}: speech energy gate — threshold={threshold:.4f}, "
                        f"kept {total_frames - frames_zeroed}/{total_frames} frames "
                        f"({speech_pct:.1f}% speech)"
                    )
                    vocals_waveform = gated

                transcribe_input = {
                    "status": "ok",
                    "audio": vocals_waveform,
                    "sample_rate": vocals_sr,
                }
            except Exception as voc_err:
                logger.warning(f"Job {job_id}: failed to load vocals for transcription, using raw audio: {voc_err}")
        else:
            logger.info(f"Job {job_id}: separation skipped ({separation_result.get('reason')}), transcribing raw audio")

        pipeline_tracker.complete_stage(job_id, "separate",
            f"Demucs {separation_result.get('model', 'htdemucs')}" if separation_result.get("status") == "ok" else "Skipped")

        pipeline_tracker.start_stage(job_id, "transcribe")
        await job_manager.update_job_status(
            job_id,
            JobStatus.TRANSCRIBING,
            progress=60,
            current_stage="Transcribing audio"
        )

        # Use the multi-engine Cantonese pipeline for CJK languages,
        # fall back to Whisper-only for other languages.
        # Per-job source_language overrides the global WHISPER_LANGUAGE env var.
        _job_for_lang = await job_manager.get_job(job_id)
        _job_src_lang = (_job_for_lang.source_language if _job_for_lang else None) or ""
        whisper_language = (_job_src_lang or os.getenv("WHISPER_LANGUAGE", "")).strip()
        if _job_src_lang:
            logger.info(
                f"Job {job_id}: CPU transcribe using per-job source_language={_job_src_lang!r}"
            )
        _CJK_LANGS = {"zh", "yue", "ja", "ko", "cmn"}
        vocals_path = separation_result.get("vocals_path") if separation_result.get("status") == "ok" else None

        from app.services.replicate_service import cloud_transcribe

        if is_cloud_enabled() and vocals_path:
            logger.info(f"Job {job_id}: using CLOUD GPU for Whisper transcription")
            transcribe_result = await asyncio.to_thread(
                cloud_transcribe, vocals_path, whisper_language, job_id
            )
            if transcribe_result.get("status") != "ok":
                logger.warning(f"Job {job_id}: cloud transcription failed, falling back to local")
                if whisper_language in _CJK_LANGS:
                    from app.pipeline.transcribe_cantonese import transcribe_cantonese
                    transcribe_result = await asyncio.to_thread(
                        transcribe_cantonese, transcribe_input, vocals_path, job_id, whisper_language
                    )
                else:
                    transcribe_result = await asyncio.to_thread(transcribe_audio, transcribe_input, job_id)
        elif whisper_language in _CJK_LANGS:
            from app.pipeline.transcribe_cantonese import transcribe_cantonese
            logger.info(f"Job {job_id}: using multi-engine Cantonese ASR pipeline (lang={whisper_language})")
            transcribe_result = await asyncio.to_thread(
                transcribe_cantonese, transcribe_input, vocals_path, job_id, whisper_language
            )
        else:
            transcribe_result = await asyncio.to_thread(transcribe_audio, transcribe_input, job_id)
        
        if transcribe_result["status"] == "ok":
            import json
            transcript_path = transcribe_result.get("transcript_path")
            if transcript_path:
                with open(transcript_path, "r", encoding="utf-8") as f:
                    transcript_data = json.load(f)

                job = await job_manager.get_job(job_id)
                # 0 = not specified, consistent with the model default. This value
                # is currently unused — it is reassigned from
                # _estimate_speakers_from_segments below before any read — but a
                # stray "3" here is a trap for the next person to consume it.
                expected_speakers = job.expected_speakers if job and hasattr(job, "expected_speakers") else 0

                raw_segments = transcript_data.get("segments", [])

                pipeline_tracker.complete_stage(job_id, "transcribe", f"{len(raw_segments)} segments")

                pipeline_tracker.start_stage(job_id, "diarize")
                await job_manager.update_job_status(
                    job_id,
                    JobStatus.DIARIZING,
                    progress=85,
                    current_stage="Identifying speakers"
                )

                diarization_segments = []
                diarization_timeout_sec = int(os.getenv("DIARIZATION_TIMEOUT_SEC", "600"))
                _job_spk = await job_manager.get_job(job_id)
                _exp_spk = (_job_spk.expected_speakers if _job_spk else 0) or 0
                if _exp_spk and 1 <= _exp_spk <= 10:
                    min_speakers = _exp_spk
                    max_speakers = _exp_spk
                    logger.info(f"Job {job_id}: local diarize exact count={_exp_spk}")
                else:
                    min_speakers = int(os.getenv("DIARIZATION_MIN_SPEAKERS", "1"))
                    max_speakers = int(os.getenv("DIARIZATION_MAX_SPEAKERS", "6"))

                # Use separated vocals for diarization when available —
                # the original mix has fight SFX / music that confuse pyannote.
                diarize_input = transcribe_input if transcribe_input is not extract_result else extract_result

                from app.services.replicate_service import cloud_diarize

                # Try Velma diarization first if API key is configured
                velma_result = None
                if os.getenv("MODULATE_API_KEY") and (vocals_path or video_path):
                    try:
                        logger.info(f"Job {job_id}: attempting Velma diarization")
                        # Same size guard as the RunPod path: this path already
                        # has clean vocals, but a feature-length WAV still 413s.
                        velma_audio_path = await asyncio.to_thread(
                            _velma_source_audio, video_path, job_id, vocals_path
                        )
                        velma_result = await asyncio.to_thread(
                            velma_diarize, velma_audio_path, job_id, _exp_spk
                        )
                    except Exception as _velma_err:
                        logger.warning(f"Job {job_id}: Velma diarization failed: {_velma_err}")

                _velma_is_primary_local = False
                if velma_result and velma_result.get("status") == "ok":
                    _velma_segs_local = velma_result.get("segments", [])
                    logger.info(
                        f"Job {job_id}: Velma OK — {len(_velma_segs_local)} segments. "
                        f"Using as PRIMARY transcript + diarization source."
                    )
                    raw_segments = [
                        {
                            "text": s.get("text", ""),
                            "start": s.get("start", 0),
                            "end": s.get("end", 0),
                            "speaker": s.get("speaker", "speaker-1"),
                        }
                        for s in _velma_segs_local
                        if (s.get("text") or "").strip()
                    ]
                    _velma_is_primary_local = True

                    # Persist Velma scene context for use during translation
                    _velma_ctx = {
                        "summary": velma_result.get("summary"),
                        "topics": velma_result.get("topics", []),
                        "topic_sentiments": velma_result.get("topic_sentiments", []),
                        "role_picks": velma_result.get("role_picks", []),
                    }
                    if any(_velma_ctx.values()):
                        _vd = Path("data/velma")
                        _vd.mkdir(parents=True, exist_ok=True)
                        with open(_vd / f"{job_id}.json", "w", encoding="utf-8") as _vf2:
                            _json.dump(_velma_ctx, _vf2, ensure_ascii=False, indent=2)
                        logger.info(f"Job {job_id}: Velma scene context saved")
                else:
                    # Velma unavailable — fall back to Whisper + pyannote/cloud diarization
                    logger.info(f"Job {job_id}: Velma unavailable — falling back to Whisper + diarization")
                    if is_cloud_enabled() and vocals_path:
                        logger.info(f"Job {job_id}: using CLOUD GPU for diarization")
                        diarization_result = await asyncio.to_thread(
                            cloud_diarize, vocals_path, min_speakers, max_speakers, job_id
                        )
                        if diarization_result.get("status") != "ok":
                            logger.warning(f"Job {job_id}: cloud diarization failed, falling back to local")
                            diarization_result = await _run_diarization_with_heartbeat(
                                job_id, diarize_input, diarization_timeout_sec,
                                min_speakers, max_speakers,
                            )
                    else:
                        logger.info(
                            f"Job {job_id}: diarization using "
                            f"{'separated vocals' if diarize_input is not extract_result else 'original audio'}"
                        )
                        diarization_result = await _run_diarization_with_heartbeat(
                            job_id, diarize_input, diarization_timeout_sec,
                            min_speakers, max_speakers,
                        )

                    if diarization_result.get("status") == "ok":
                        diarization_segments = diarization_result.get("segments", [])
                    else:
                        logger.info(
                            f"Diarization skipped: {diarization_result.get('reason', 'unknown')}"
                        )

                if _velma_is_primary_local:
                    segments = [
                        _seg_dict_to_model(s)
                        for s in raw_segments
                        if s.get("text", "").strip()
                    ]
                else:
                    segments = _assign_speakers_from_diarization(raw_segments, diarization_segments)

                # ── Re-transcribe split segments that have empty text ──
                # When diarization splits a single blob, each segment needs
                # its own transcription from the isolated time range.
                if segments and any(not seg.text.strip() for seg in segments):
                    logger.info(f"Job {job_id}: re-transcribing {len(segments)} diarization-split segments")
                    import soundfile as sf
                    import numpy as np

                    # Use the vocals waveform for re-transcription
                    src_audio = transcribe_input.get("audio")
                    src_sr = transcribe_input.get("sample_rate", 16000)

                    for i, seg in enumerate(segments):
                        if seg.text.strip():
                            continue
                        start_sample = int(seg.start * src_sr)
                        end_sample = int(seg.end * src_sr)
                        if src_audio is not None and end_sample <= src_audio.shape[-1]:
                            chunk = src_audio[..., start_sample:end_sample]
                            chunk_input = {"status": "ok", "audio": chunk, "sample_rate": src_sr}
                            try:
                                chunk_result = await asyncio.to_thread(
                                    transcribe_audio, chunk_input, f"{job_id}_seg{i}"
                                )
                                if chunk_result.get("status") == "ok":
                                    chunk_segs = chunk_result.get("segments", [])
                                    if chunk_segs:
                                        seg_text = " ".join(s.get("text", "") for s in chunk_segs).strip()
                                        segments[i] = TranscriptSegment(
                                            text=seg_text,
                                            start=seg.start,
                                            end=seg.end,
                                            speaker=seg.speaker,
                                        )
                                        logger.info(
                                            f"Job {job_id}: seg {i} ({seg.speaker}) "
                                            f"[{seg.start:.1f}-{seg.end:.1f}s]: {seg_text[:60]}"
                                        )
                            except Exception as rt_err:
                                logger.warning(f"Job {job_id}: re-transcribe seg {i} failed: {rt_err}")

                    # Remove segments that still have no text after re-transcription
                    segments = [s for s in segments if s.text.strip()]
                    logger.info(f"Job {job_id}: {len(segments)} segments with text after re-transcription")

                if not segments:
                    total_segments = len(raw_segments)
                    expected_speakers = _estimate_speakers_from_segments(raw_segments)
                    segments_per_speaker = max(1, total_segments // expected_speakers) if total_segments > 0 else 1
                    segments = []
                    for i, seg in enumerate(raw_segments):
                        speaker_idx = min(i // segments_per_speaker, expected_speakers - 1)
                        s = _seg_dict_to_model(seg)
                        s.speaker = f"speaker-{speaker_idx + 1}"
                        segments.append(s)
                
                segments = _smooth_speaker_assignments(segments)
                segments = _normalize_speaker_labels(segments)

                pipeline_tracker.complete_stage(job_id, "diarize",
                    f"{len(set(s.speaker for s in segments))} speakers detected")

                # Classify each speaker's gender/age from pitch (Fix 2).
                pipeline_tracker.start_stage(job_id, "classify")
                try:
                    speaker_genders = classify_speakers(
                        audio=extract_result["audio"],
                        sample_rate=extract_result["sample_rate"],
                        segments=segments,
                    )
                    if speaker_genders:
                        await job_manager.update_job_speaker_genders(job_id, speaker_genders)
                        logger.info(f"Job {job_id}: speaker genders = {speaker_genders}")
                    pipeline_tracker.complete_stage(job_id, "classify",
                        f"Genders: {speaker_genders}" if speaker_genders else "No genders detected")
                except Exception as cls_err:
                    logger.warning(f"Job {job_id}: speaker classification failed: {cls_err}")
                    pipeline_tracker.fail_stage(job_id, "classify", str(cls_err))

                transcript = Transcript(
                    language=transcript_data.get("language", "en"),
                    duration=transcript_data.get("duration", 0.0),
                    text=transcript_data.get("text", ""),
                    segments=segments
                )
                
                await job_manager.update_job_transcript(job_id, transcript)
                logger.info(f"Job {job_id}: Transcription complete with {len(segments)} segments")
        else:
            err_msg = transcribe_result.get('error_message', 'unknown error')
            logger.error(f"Transcription failed for job {job_id}: {transcribe_result.get('reason')} — {err_msg}")
            await job_manager.update_job_status(
                job_id,
                JobStatus.FAILED,
                error_message=f"Transcription failed: {err_msg}"
            )
            return

        await job_manager.update_job_status(
            job_id,
            JobStatus.COMPLETED,
            progress=100,
            current_stage="Video processing complete"
        )
        
        logger.info(f"Job {job_id} completed successfully")
        
    except Exception as e:
        logger.error(f"Error processing job {job_id}: {e}")
        await job_manager.update_job_status(
            job_id,
            JobStatus.FAILED,
            error_message=str(e)
        )


# ---------------------------------------------------------------------------
@router.post("/upload", response_model=UploadResponse, dependencies=[Depends(_dep_auth)])
async def upload_video(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    source_language: Optional[str] = Form(None),
    num_speakers: Optional[int] = Form(None),
    target_language: Optional[str] = Form(None),
):
    """Upload a video directly to this backend and start the pipeline.

    Restored from the pre-direct-to-R2 design. The client posts the file here,
    it lands on local disk, and processing starts — one transfer, no presign
    round trips, and the job's language and speaker count arrive as form fields
    on the same request that carries the bytes.

    That last point is why this path is back: the direct-to-R2 client replaced
    it without carrying those three fields, so every job silently ran with
    source_language unset (Cantonese auto-detecting as "zh") and the default
    speaker count. Parameters that travel with the upload cannot be dropped
    between two calls, because there is only one call.

    Billing is unchanged from the R2 path: the duration-scaled size cap is
    enforced after probing, minutes are reserved before any processing starts,
    and set_minutes_charged goes through job_manager so a crash cannot lose the
    refund.
    """
    user_id = _caller(request)

    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in settings.ALLOWED_VIDEO_FORMATS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file format. Allowed: {', '.join(settings.ALLOWED_VIDEO_FORMATS)}",
        )

    # Normalize source language. "auto"/empty → leave as None so detection runs.
    src_lang: Optional[str] = None
    if source_language:
        normalized = normalize_language_code(source_language, allow_auto=True)
        if normalized and normalized != "auto":
            src_lang = normalized

    # If no source language was chosen but the filename says Cantonese, persist
    # yue rather than leaving detection to guess — it guesses "zh", which is the
    # wrong language for the same script.
    if not src_lang:
        _fn = (file.filename or "").lower()
        if any(t in _fn for t in ("canton", "cantonese", " yue", "_yue", "-yue")):
            src_lang = "yue"

    tgt_lang: Optional[str] = None
    if target_language:
        try:
            _tgt_norm = normalize_language_code(target_language, strict=True)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        if _tgt_norm and _tgt_norm != "auto":
            tgt_lang = _tgt_norm

    job_id = str(uuid.uuid4())

    try:
        video_path = storage.get_upload_path(job_id, file.filename)

        await job_manager.create_job(
            job_id=job_id,
            video_filename=file.filename,
            video_path=video_path,
            video_size=0,
            user_id=user_id,
        )

        job_for_lang = await job_manager.get_job(job_id)
        if job_for_lang:
            if src_lang:
                job_for_lang.source_language = src_lang
                logger.info(f"Job {job_id}: source_language set to {src_lang!r} from upload request")
            if tgt_lang:
                job_for_lang.target_language = tgt_lang
                logger.info(f"Job {job_id}: target_language set to {tgt_lang!r} from upload request")
            if num_speakers is not None and 1 <= num_speakers <= 10:
                job_for_lang.expected_speakers = num_speakers
                logger.info(f"Job {job_id}: expected_speakers set to {num_speakers} from upload request")

        await job_manager.update_job_status(
            job_id, JobStatus.UPLOADING, progress=5, current_stage="Uploading file"
        )

        file_size = 0
        with open(video_path, "wb") as f:
            while chunk := await file.read(1024 * 1024):
                f.write(chunk)
                file_size += len(chunk)
                # Absolute ceiling while streaming, before the duration is known.
                # The duration-scaled cap below is the real limit.
                if file_size > settings.MAX_UPLOAD_SIZE:
                    os.remove(video_path)
                    await job_manager.delete_job(job_id)
                    raise HTTPException(
                        status_code=413,
                        detail=f"File too large. Max size: {settings.MAX_UPLOAD_SIZE / (1024**3):.1f}GB",
                    )

        _dur = await asyncio.to_thread(_probe_video_duration, video_path)
        if not _dur:
            os.remove(video_path)
            await job_manager.delete_job(job_id)
            raise HTTPException(status_code=400, detail="Could not read that file as video")

        # Duration-scaled size cap — the same rule the R2 path enforced at
        # presign time, applied here against the true duration rather than a
        # claimed one.
        if file_size > upload_size_cap(_dur):
            os.remove(video_path)
            await job_manager.delete_job(job_id)
            raise HTTPException(
                status_code=413,
                detail=(
                    f"That file is {file_size / 1024**3:.1f}GB for {_dur / 60:.0f} min "
                    f"of video — over the limit for its duration."
                ),
            )

        # Reserve minutes before any work starts. Refunded in full by
        # job_manager if the job ends FAILED or CANCELLED.
        _plan = await asyncio.to_thread(_plan_for_user, user_id)
        _plan_key = "basic" if _plan in (None, _PLAN_UNKNOWN) else _plan
        _pool = PLAN_MINUTES.get(_plan_key)
        if _pool:
            _need = usage_service.minutes_for(_dur)
            _used = await asyncio.to_thread(usage_service.get_used_minutes, user_id)
            _left = _pool - _used
            if _need > _left:
                os.remove(video_path)
                await job_manager.delete_job(job_id)
                raise HTTPException(
                    status_code=402,
                    detail=(
                        f"This video needs {_need} min but you have {max(0, _left)} "
                        f"of your {_pool}-minute monthly allowance left."
                    ),
                )
            if await asyncio.to_thread(usage_service.adjust, user_id, _need):
                # Through job_manager, not a direct mutation: this has to persist
                # immediately, or a crash before the next status change loses the
                # record and the refund with it.
                await job_manager.set_minutes_charged(job_id, _need)

        job = await job_manager.get_job(job_id)
        if job:
            job.video_size = file_size
            job.video_duration = _dur

        logger.info(f"File uploaded: {file.filename} ({file_size} bytes, {_dur:.1f}s) -> Job {job_id}")

        background_tasks.add_task(process_video_pipeline, job_id, video_path)

        return UploadResponse(
            job_id=job_id,
            status="accepted",
            message="Video uploaded successfully, processing started",
            video_filename=file.filename,
            video_size=file_size,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Upload failed: {e}")
        await job_manager.delete_job(job_id)
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")


    return {"status": "aborted"}


def _build_ref_segments(raw_segments: list, ref_id: str, lang: str) -> list:
    """Convert raw Whisper segments to the ref segment schema."""
    out = []
    for i, seg in enumerate(raw_segments):
        if isinstance(seg, dict):
            text = seg.get("text", "").strip()
            start = float(seg.get("start", 0))
            end = float(seg.get("end", 0))
            speaker = seg.get("speaker") or f"SPEAKER_{i % 2:02d}"
        else:
            text = getattr(seg, "text", "").strip()
            start = float(getattr(seg, "start", 0))
            end = float(getattr(seg, "end", 0))
            speaker = getattr(seg, "speaker", None) or f"SPEAKER_{i % 2:02d}"
        if not text or end <= start:
            continue
        out.append({"id": f"{ref_id}_{i}", "index": i, "start": start, "end": end,
                    "text": text, "speaker_id": speaker})
    return out


async def _transcribe_ref_runpod_bg(ref_id: str, video_path: str, lang: str):
    """
    Background task: submit transcription-only job to RunPod GPU, wait for result,
    write segments to disk so GET /transcript/{ref_id} can return them.
    """
    from app.services.runpod_service import runpod_service
    out_path = os.path.join("data", "jobs", ref_id, "ref_transcript.json")
    try:
        await job_manager.update_job_status(
            ref_id, JobStatus.PROCESSING, progress=10,
            current_stage="Uploading to GPU cloud"
        )
        file_url = await _get_runpod_file_url(ref_id, video_path)

        env_vars: Dict[str, str] = {}
        # Always send WHISPER_LANGUAGE explicitly — empty string clears any stale
        # value left on the RunPod worker from a previous Cantonese/other-language job.
        env_vars["WHISPER_LANGUAGE"] = lang if lang else ""
        for k in ("HF_TOKEN", "HUGGING_FACE_TOKEN", "HUGGINGFACE_TOKEN",
                  "HUGGINGFACE_HUB_TOKEN", "PUBLIC_BASE_URL"):
            v = os.getenv(k, "").strip()
            if v:
                env_vars.setdefault("HF_TOKEN" if "HF" in k or "HUGGING" in k else k, v)

        await job_manager.update_job_status(
            ref_id, JobStatus.PROCESSING, progress=20,
            current_stage="Waiting for GPU worker"
        )
        submit_result = await runpod_service.submit_job(
            file_url=file_url,
            job_id=ref_id,
            language=lang or "",
            min_speakers=1,
            max_speakers=6,
            steps=["transcribe"],   # skip separation and diarization
            env_vars=env_vars,
        )
        runpod_job_id = submit_result.get("id")
        if not runpod_job_id:
            raise RuntimeError(f"RunPod did not return a job ID: {submit_result}")

        job_obj = await job_manager.get_job(ref_id)
        if job_obj:
            job_obj.runpod_job_id = runpod_job_id

        async def _prog(pct):
            await job_manager.update_job_status(
                ref_id, JobStatus.TRANSCRIBING, progress=20 + int(pct * 0.7),
                current_stage="Transcribing on GPU" if pct > 15 else "Waiting for GPU worker"
            )

        result = await runpod_service.poll_until_complete(
            runpod_job_id=runpod_job_id,
            timeout=int(os.getenv("RUNPOD_POLL_TIMEOUT_SEC", "1800")),
            progress_callback=_prog,
        )

        if result.get("error"):
            raise RuntimeError(f"RunPod transcription failed: {result['error']}")

        # For steps=["transcribe"], transcript is in result["transcript"]["segments"]
        transcript = result.get("transcript", {})
        raw_segs = transcript.get("segments", []) or result.get("segments", [])
        detected_lang = (transcript.get("language") or lang or "en")

        segments_out = _build_ref_segments(raw_segs, ref_id, detected_lang)
        payload = {"ref_job_id": ref_id, "detected_language": detected_lang,
                   "segment_count": len(segments_out), "segments": segments_out}

        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as fh:
            _json.dump(payload, fh)

        await job_manager.update_job_status(
            ref_id, JobStatus.READY_FOR_REVIEW, progress=100,
            current_stage="Transcription complete"
        )
        logger.info(f"[TRANSCRIBE-VIDEO] {ref_id}: RunPod done — {len(segments_out)} segments, lang={detected_lang}")

    except Exception as e:
        logger.error(f"[TRANSCRIBE-VIDEO] {ref_id}: RunPod background task failed: {e}", exc_info=True)
        # Write an error marker so the GET endpoint can report failure
        try:
            os.makedirs(os.path.dirname(out_path), exist_ok=True)
            with open(out_path, "w", encoding="utf-8") as fh:
                _json.dump({"error": str(e), "ref_job_id": ref_id, "segments": []}, fh)
        except Exception:
            pass
        await job_manager.update_job_status(
            ref_id, JobStatus.ERROR, progress=0,
            current_stage=f"Transcription failed: {e}"
        )


@router.post("/transcribe-video", dependencies=[Depends(_dep_auth)])
async def transcribe_video_only(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    language: Optional[str] = Form(None),
):
    """
    Transcribe a video without dubbing for reference import and EI Library building.
    Routes through RunPod GPU for production-grade speed (~10-20s on GPU).
    Returns {ref_job_id, status: "processing"} immediately; poll
    GET /api/transcript/{ref_job_id} until status is "complete".
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in settings.ALLOWED_VIDEO_FORMATS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file format. Allowed: {', '.join(settings.ALLOWED_VIDEO_FORMATS)}",
        )

    lang: Optional[str] = None
    if language:
        normalized = normalize_language_code(language, allow_auto=True)
        if normalized and normalized != "auto":
            lang = normalized

    ref_id = f"ref_{uuid.uuid4().hex[:12]}"
    owner_id = _caller(request)

    try:
        video_path = storage.get_upload_path(ref_id, file.filename)
        await job_manager.create_job(
            job_id=ref_id,
            video_filename=file.filename,
            video_path=video_path,
            video_size=0,
            # The real caller, not the literal "ref". A magic non-UUID can
            # never satisfy the uuid column, so these jobs failed every upsert
            # and were unattributable. /transcribe-video is authenticated now,
            # so the owner is available.
            user_id=owner_id,
        )
        if lang:
            job_obj = await job_manager.get_job(ref_id)
            if job_obj:
                job_obj.source_language = lang

        with open(video_path, "wb") as fh:
            while chunk := await file.read(1024 * 1024):
                fh.write(chunk)

        from app.services.runpod_service import runpod_service
        if runpod_service.is_available():
            # Production path: GPU via RunPod
            background_tasks.add_task(_transcribe_ref_runpod_bg, ref_id, video_path, lang or "")
            logger.info(f"[TRANSCRIBE-VIDEO] {ref_id}: submitted to RunPod GPU (lang={lang})")
            return {"ref_job_id": ref_id, "status": "processing", "segments": [], "detected_language": lang or ""}
        else:
            # Dev/offline fallback: local CPU (medium model)
            logger.warning(f"[TRANSCRIBE-VIDEO] {ref_id}: RunPod not configured — falling back to local CPU")
            extract_result = extract_audio(video_path)
            if extract_result.get("status") != "ok":
                raise HTTPException(status_code=500, detail="Audio extraction failed")

            os.environ.pop("WHISPER_LANGUAGE", None)
            if lang:
                os.environ["WHISPER_LANGUAGE"] = lang

            transcript_result = transcribe_audio(extract_result, job_id=ref_id, source_language=lang)

            os.environ.pop("WHISPER_LANGUAGE", None)

            if transcript_result.get("status") != "ok":
                raise HTTPException(status_code=500,
                    detail=f"Transcription failed: {transcript_result.get('reason', 'unknown')}")

            transcript_path = transcript_result.get("transcript_path", "")
            if not transcript_path or not os.path.exists(transcript_path):
                raise HTTPException(status_code=500, detail="Transcript file missing")

            with open(transcript_path, "r", encoding="utf-8") as fh:
                td = _json.load(fh)

            detected_lang = td.get("language", lang or "en")
            segments_out = _build_ref_segments(td.get("segments", []), ref_id, detected_lang)

            out_path = os.path.join("data", "jobs", ref_id, "ref_transcript.json")
            os.makedirs(os.path.dirname(out_path), exist_ok=True)
            payload = {"ref_job_id": ref_id, "detected_language": detected_lang,
                       "segment_count": len(segments_out), "segments": segments_out}
            with open(out_path, "w", encoding="utf-8") as fh:
                _json.dump(payload, fh)

            logger.info(f"[TRANSCRIBE-VIDEO] {ref_id}: local CPU done — {len(segments_out)} segments")
            return {"ref_job_id": ref_id, "status": "complete",
                    "detected_language": detected_lang,
                    "segment_count": len(segments_out), "segments": segments_out}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"transcribe_video_only failed for {ref_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")


@router.get("/ref-transcript/{ref_job_id}", dependencies=[Depends(_dep_auth)])
async def get_ref_transcript(ref_job_id: str):
    """Poll endpoint for reference transcription status. Returns segments when ready."""
    out_path = os.path.join("data", "jobs", ref_job_id, "ref_transcript.json")
    if os.path.exists(out_path):
        with open(out_path, "r", encoding="utf-8") as fh:
            data = _json.load(fh)
        if data.get("error"):
            return {"status": "error", "error": data["error"], "ref_job_id": ref_job_id, "segments": []}
        return {"status": "complete", **data}
    # Check if job errored out without writing the file
    job = await _get_or_rehydrate_job(ref_job_id)
    if job and str(getattr(job, "status", "")).lower() == "error":
        return {"status": "error", "error": getattr(job, "current_stage", "Unknown error"),
                "ref_job_id": ref_job_id, "segments": []}
    return {"status": "processing", "ref_job_id": ref_job_id, "segments": []}


@router.get("/status/{job_id}", response_model=StatusResponse, dependencies=[Depends(_dep_job_access)])
async def get_job_status(job_id: str):
    job = await _get_or_rehydrate_job(job_id)
    
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    return StatusResponse(
        job_id=job.job_id,
        status=job.status,
        progress=job.progress,
        current_stage=job.current_stage,
        video_filename=job.video_filename,
        video_url=f"/api/media/{job.job_id}/video",
        video_duration=job.video_duration,
        total_chunks=job.total_chunks,
        processed_chunks=job.processed_chunks,
        chunks=job.chunks,
        source_language=getattr(job, "source_language", None),
        dubbed_video_url=job.dubbed_video_url,
        tts_engine=job.tts_engine,
        segment_tts_engines=job.segment_tts_engines,
        expected_speakers=getattr(job, "expected_speakers", 0),   # 0 = not specified
        speaker_genders=job.speaker_genders,
        voice_mapping=job.voice_mapping,
        traits_mapping=job.traits_mapping,
        error_message=job.error_message,
        created_at=job.created_at,
        updated_at=job.updated_at
    )


@router.get("/chunks/{job_id}", response_model=ChunkManifest, dependencies=[Depends(_dep_job_access)])
async def get_chunk_manifest(job_id: str):
    job = await _get_or_rehydrate_job(job_id)
    
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if not job.chunks:
        raise HTTPException(status_code=404, detail="No chunks available yet")
    
    total_duration = job.video_duration or 0.0
    
    return ChunkManifest(
        job_id=job_id,
        total_chunks=len(job.chunks),
        total_duration=total_duration,
        chunks=job.chunks
    )


@router.get("/transcript/export/{job_id}", dependencies=[Depends(_dep_job_access)])
async def export_transcript_srt(job_id: str):
    """Export dubbed segment text as a downloadable SRT file."""
    segments_path = os.path.join(settings.DUBBED_DIR, job_id, "segments.json")
    if not os.path.exists(segments_path):
        raise HTTPException(status_code=404, detail="No segments found for this job")

    with open(segments_path, "r", encoding="utf-8") as f:
        data = _json.load(f)

    def _srt_time(seconds: float) -> str:
        ms = int((seconds % 1) * 1000)
        s = int(seconds)
        m, s = divmod(s, 60)
        h, m = divmod(m, 60)
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

    lines = []
    for i, seg in enumerate(data.get("segments", []), start=1):
        text = (seg.get("committed_adapted_text") or seg.get("text") or "").strip()
        start = float(seg.get("start", 0))
        end = float(seg.get("end", 0))
        lines.append(str(i))
        lines.append(f"{_srt_time(start)} --> {_srt_time(end)}")
        lines.append(text)
        lines.append("")

    srt_content = "\n".join(lines)
    return Response(
        content=srt_content,
        media_type="text/plain",
        headers={"Content-Disposition": f"attachment; filename=\"transcript_{job_id[:8]}.srt\""},
    )


@router.get("/transcript/{job_id}", dependencies=[Depends(_dep_job_access)])
async def get_transcript(job_id: str):
    job = await _get_or_rehydrate_job(job_id)
    
    # The segments check is load-bearing. A job rehydrated from Supabase on
    # startup gets a Transcript with segments=[] (main.py does not restore
    # them), so `if job and job.transcript` alone returns 200 with an empty
    # list and never reaches the file on disk that does have them — the source
    # column silently empties after every backend restart.
    if job and job.transcript and job.transcript.segments:
        return {
            "job_id": job_id,
            "language": job.transcript.language,
            "duration": job.transcript.duration,
            "text": job.transcript.text,
            "segments": [
                {
                    "text": seg.text,
                    "start": seg.start,
                    "end": seg.end,
                    "speaker": seg.speaker,
                    "confidence": seg.confidence,
                    "confidence_tier": seg.confidence_tier,
                    "words": [w.model_dump() for w in seg.words] if seg.words else None,
                    "velma_emotion": seg.velma_emotion,
                    "velma_accent": seg.velma_accent,
                    "velma_deepfake_score": seg.velma_deepfake_score,
                }
                for seg in job.transcript.segments
            ]
        }
    
    import json
    # CRITICAL: Load ONLY the job-specific transcript file. Never fall back to
    # a global transcript.json — that causes data isolation violations where
    # fresh jobs silently inherit stale transcripts from previous jobs.
    # See: https://github.com/anthropics/dubverse/issues/data-isolation-transcript-fallback
    transcript_file = Path("data/transcripts") / f"{job_id}.json"

    if transcript_file.exists():
        try:
            with open(transcript_file, "r", encoding="utf-8") as f:
                transcript_data = json.load(f)

            # Return the transcript exactly as stored (including speaker labels)
            # to avoid inventing speakers and to preserve correct downstream QA.
            return {
                "job_id": job_id,
                "language": transcript_data.get("language", "en"),
                "duration": transcript_data.get("duration", 0),
                "text": transcript_data.get("text", ""),
                "segments": transcript_data.get("segments", []),
            }
        except Exception as e:
            logger.error(f"Error reading transcript file for {job_id}: {e}")

    raise HTTPException(status_code=404, detail="Transcript not available yet")


@router.get("/transcript/{job_id}/editor-format", dependencies=[Depends(_dep_job_access)])
async def get_transcript_editor_format(job_id: str):
    """Serve transcript in the format expected by the standalone Transcript Editor.

    Transforms DubMaster/Velma segments into the editor's schema with
    speakers, segments (id, text, speaker_id, confidence, status, words),
    and Velma role picks mapped to speaker names.
    """
    import json as _json_ed

    transcript_file = Path("data/transcripts") / f"{job_id}.json"
    velma_file = Path("data/velma") / f"{job_id}.json"

    if not transcript_file.exists():
        job = await _get_or_rehydrate_job(job_id)
        if not (job and job.transcript):
            raise HTTPException(status_code=404, detail="Transcript not available yet")
        segments_raw = [
            {"text": s.text, "start": s.start, "end": s.end, "speaker": s.speaker}
            for s in job.transcript.segments
        ]
        duration = job.transcript.duration or 0
        language = job.transcript.language or "en"
    else:
        with open(transcript_file, "r", encoding="utf-8") as f:
            tdata = _json_ed.load(f)
        segments_raw = tdata.get("segments", [])
        duration = tdata.get("duration", 0)
        language = tdata.get("language", "en")

    velma_context = None
    if velma_file.exists():
        try:
            with open(velma_file, "r", encoding="utf-8") as f:
                velma_context = _json_ed.load(f)
        except Exception:
            pass

    role_map: dict = {}
    if velma_context and velma_context.get("role_picks"):
        for rp in velma_context["role_picks"]:
            role_map[str(rp.get("speaker_label", ""))] = rp.get("name", "Speaker")

    speaker_genders = {}
    job_obj = await _get_or_rehydrate_job(job_id)
    if job_obj and hasattr(job_obj, "speaker_genders") and job_obj.speaker_genders:
        speaker_genders = job_obj.speaker_genders

    colors = ["#3B82F6", "#10B981", "#F59E0B", "#EC4899", "#8B5CF6",
              "#EF4444", "#06B6D4", "#84CC16", "#F97316", "#6366F1"]
    unique_speakers = sorted(set(str(s.get("speaker", "1")) for s in segments_raw))

    speakers = []
    for i, spk in enumerate(unique_speakers):
        name = role_map.get(spk, f"Speaker {spk}")
        gender = speaker_genders.get(f"speaker-{spk}", speaker_genders.get(spk, "male"))
        speakers.append({
            "id": f"spk_{i}",
            "name": name,
            "gender": gender,
            "age_estimate": 8 if gender == "child" else 35,
            "color": colors[i % len(colors)],
        })

    spk_id_map = {spk: f"spk_{i}" for i, spk in enumerate(unique_speakers)}

    editor_segments = []
    for i, seg in enumerate(segments_raw):
        text = seg.get("text", "").strip()
        if not text:
            continue
        spk_label = str(seg.get("speaker", "1"))
        editor_segments.append({
            "id": f"seg_{i:03d}",
            "text": text,
            "original_text": text,
            "start": seg.get("start", 0),
            "end": seg.get("end", 0),
            "speaker_id": spk_id_map.get(spk_label, "spk_0"),
            "language": language,
            "confidence": 1.0,
            "words": [],
            "is_edited": False,
            "status": "pending",
        })

    return {
        "project": {
            "id": job_id,
            "name": f"Job {job_id[:8]}",
            "duration": duration,
            "language": language,
        },
        "speakers": speakers,
        "segments": editor_segments,
        "velma_summary": velma_context.get("summary") if velma_context else None,
    }


@router.delete("/jobs/clear-all")
async def clear_all_jobs(request: Request, force: bool = False):
    """Delete all jobs belonging to the authenticated user.

    By default only clears jobs older than CLEAR_ALL_MIN_AGE_MINUTES.
    Pass force=true to clear all immediately.
    Disk cleanup is per-job — no other user's files are touched.
    """
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.removeprefix("Bearer ").strip()
    user_id = verify_jwt(token)

    import shutil
    import time

    min_age_minutes = int(os.getenv("CLEAR_ALL_MIN_AGE_MINUTES", "60"))
    now = time.time()
    cutoff = now - (min_age_minutes * 60)

    # Clear in-memory jobs — user-scoped only.
    # Jobs still in flight on RunPod GPU must be cancelled here before their local
    # record disappears — otherwise the remote worker keeps running unaware the
    # job was cleared, permanently occupying the account's worker slot(s) and
    # blocking every subsequent job from ever leaving IN_QUEUE (mirrors the
    # best-effort cancel already done in the single-job /cancel endpoint above).
    from app.services.runpod_service import runpod_service
    _TERMINAL_STATUSES = {JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED}
    cleared_ids: list[str] = []
    runpod_ids_to_cancel: list[str] = []
    if force:
        for jid, job in list(job_manager._jobs.items()):
            if job.user_id == user_id:
                cleared_ids.append(jid)
                runpod_id = getattr(job, "runpod_job_id", None)
                if runpod_id and getattr(job, "status", None) not in _TERMINAL_STATUSES:
                    runpod_ids_to_cancel.append(runpod_id)
                job_manager._jobs.pop(jid, None)
    else:
        for jid, job in list(job_manager._jobs.items()):
            if job.user_id != user_id:
                continue
            try:
                updated = getattr(job, "updated_at", None)
                created = getattr(job, "created_at", None)
                ts = None
                if updated:
                    ts = updated.timestamp()
                elif created:
                    ts = created.timestamp()
                if ts is not None and ts >= cutoff:
                    continue
            except Exception:
                continue
            cleared_ids.append(jid)
            runpod_id = getattr(job, "runpod_job_id", None)
            if runpod_id and getattr(job, "status", None) not in _TERMINAL_STATUSES:
                runpod_ids_to_cancel.append(runpod_id)
            job_manager._jobs.pop(jid, None)

    if runpod_ids_to_cancel and runpod_service.is_available():
        for runpod_id in runpod_ids_to_cancel:
            try:
                await runpod_service.cancel_job(runpod_id)
            except Exception as exc:
                logger.warning(f"[CLEAR-ALL] RunPod cancel failed for {runpod_id}: {exc}")

    # Delete from Supabase — scoped to this user (CASCADE removes segments + speakers)
    if cleared_ids:
        try:
            # service_role, not anon: RLS blocks the anon client, so this
            # delete silently affected zero rows and reported success. Jobs
            # "deleted" months ago were still in the table and came back into
            # memory once the startup loader was fixed to read with the same
            # service_role client. The .eq("user_id") filter below is what
            # scopes this to the caller — RLS was never doing that job here.
            from app.services.supabase_client import supabase_writer
            for jid in cleared_ids:
                supabase_writer.table("jobs").delete().eq(
                    "job_id", jid
                ).eq("user_id", user_id).execute()
        except Exception as exc:
            logger.error(f"[CLEAR-ALL] Supabase delete failed: {exc}", exc_info=True)

    # Clean up disk artifacts per job — safe for multi-tenant
    import glob as _glob
    files_removed = 0
    for jid in cleared_ids:
        try:
            storage.delete_job_files(jid)
            files_removed += 1
        except Exception:
            pass
        dubbed_dir = os.path.join(settings.DUBBED_DIR, jid)
        if os.path.isdir(dubbed_dir):
            shutil.rmtree(dubbed_dir, ignore_errors=True)
        for sep_file in _glob.glob(
            os.path.join("data/separated", f"{jid}_*")
        ):
            try:
                os.remove(sep_file)
            except OSError:
                pass

    logger.info(
        f"[CLEAR-ALL] user={user_id} force={force} "
        f"cleared_jobs={len(cleared_ids)} files_removed={files_removed}"
    )
    return {
        "force": force,
        "min_age_minutes": min_age_minutes,
        "cleared_jobs": len(cleared_ids),
        "files_removed": files_removed,
        "job_ids": cleared_ids,
    }


@router.delete("/job/{job_id}", dependencies=[Depends(_dep_job_access)])
@router.delete("/jobs/{job_id}", dependencies=[Depends(_dep_job_access)])
async def delete_job(job_id: str, request: Request):
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.removeprefix("Bearer ").strip()
    user_id = verify_jwt(token)

    # Verify ownership before deleting
    job = await job_manager.get_job(job_id)
    if job and job.user_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Cancel any still-running RunPod GPU job before dropping the local record —
    # same orphaned-worker bug clear_all_jobs had: without this, the remote worker
    # keeps running unaware the job was deleted, permanently occupying the
    # account's worker slot and blocking every subsequent job from leaving
    # IN_QUEUE. See the /jobs/{job_id}/cancel endpoint above for the same pattern.
    if job:
        _TERMINAL_STATUSES = {JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED}
        runpod_id = getattr(job, "runpod_job_id", None)
        if runpod_id and getattr(job, "status", None) not in _TERMINAL_STATUSES:
            from app.services.runpod_service import runpod_service
            if runpod_service.is_available():
                try:
                    await runpod_service.cancel_job(runpod_id)
                except Exception as exc:
                    logger.warning(f"Job {job_id}: RunPod cancel failed for {runpod_id}: {exc}")

    # Delete from Supabase (CASCADE removes segments + job_speakers)
    try:
        # service_role, not anon — see the note in /jobs/clear-all. Ownership
        # is enforced by the .eq("user_id") filter, not by RLS.
        from app.services.supabase_client import supabase_writer
        supabase_writer.table("jobs").delete().eq(
            "job_id", job_id
        ).eq("user_id", user_id).execute()
    except Exception as exc:
        logger.error(f"Job {job_id}: Supabase delete failed: {exc}", exc_info=True)

    # Mark as deleted FIRST to prevent rehydration race
    await job_manager.delete_job(job_id)

    # Clean up all disk artifacts (uploads, chunks, processed, output)
    storage.delete_job_files(job_id)

    # Also clean dubbed and separated files which StorageManager doesn't cover
    import shutil
    dubbed_dir = os.path.join(settings.DUBBED_DIR, job_id)
    if os.path.isdir(dubbed_dir):
        shutil.rmtree(dubbed_dir, ignore_errors=True)
        logger.info(f"Deleted dubbed directory: {dubbed_dir}")

    separated_pattern = os.path.join("data/separated", f"{job_id}_*")
    import glob as _glob
    for sep_file in _glob.glob(separated_pattern):
        try:
            os.remove(sep_file)
            logger.info(f"Deleted separated file: {sep_file}")
        except OSError:
            pass

    # Same purge the retention sweep uses — one list, so the two paths cannot
    # drift into cleaning different subsets (which is how the gap arose).
    _purged = _purge_job_artifacts(job_id)
    logger.info(f"Job {job_id}: purge removed {len(_purged)} artifact(s)")
    return {
        "message": f"Job {job_id} deleted successfully",
        "artifacts_removed": len(_purged),
    }


# Everything a job leaves on disk or in the bucket, for a total purge.
# Deletion and expiry MUST use the same list — the retention gap existed
# precisely because two code paths each cleaned up a different subset.
PURGE_RETENTION_DAYS = int(os.getenv("DUBMASTER_PURGE_RETENTION_DAYS", "30"))
# Work that was started in the editor but never rendered. A user may be part
# way through a feature over several weeks, so this window is much longer than
# the post-render one — but it is still finite: abandoned work cannot sit on
# our disks forever.
ABANDON_RETENTION_DAYS = int(os.getenv("DUBMASTER_ABANDON_RETENTION_DAYS", "120"))
# How close to the deadline the editor starts warning the user.
RETENTION_WARN_DAYS = int(os.getenv("DUBMASTER_RETENTION_WARN_DAYS", "10"))


def _retention_state(job_id: str) -> dict:
    """When this job's work will be deleted, and why.

    Two clocks, and the rendered one wins:
      purge_after    stamped at MAKE MOVIE — 30 days, the customer has the film
      abandon_after  stamped for editor work never rendered — 4 months

    A job with neither stamp is back-filled from its segments.json mtime, so
    work that predates this policy still gets a deadline rather than living
    forever by accident.
    """
    seg_path = os.path.join(settings.DUBBED_DIR, job_id, "segments.json")
    if not os.path.isfile(seg_path):
        return {}
    try:
        with open(seg_path, "r", encoding="utf-8") as f:
            data = _json.load(f) or {}
    except Exception:
        return {}

    now = datetime.utcnow()
    stamp, kind = data.get("purge_after"), "rendered"
    if not stamp:
        stamp, kind = data.get("abandon_after"), "abandoned"
    if not stamp:
        # Never stamped: date it from when the work last changed on disk.
        try:
            mtime = datetime.utcfromtimestamp(os.path.getmtime(seg_path))
        except OSError:
            return {}
        stamp = (mtime + timedelta(days=ABANDON_RETENTION_DAYS)).isoformat()
        kind = "abandoned"

    try:
        deadline = datetime.fromisoformat(str(stamp).replace("Z", ""))
    except Exception:
        return {}

    days_left = (deadline - now).total_seconds() / 86400.0
    return {
        "deadline": deadline.isoformat(),
        "kind": kind,
        "days_left": round(days_left, 2),
        "expired": days_left <= 0,
        "warn": days_left <= RETENTION_WARN_DAYS,
        "warn_days": RETENTION_WARN_DAYS,
    }


def _purge_job_artifacts(job_id: str) -> list:
    """Remove every artifact belonging to a job. Best-effort per target.

    Each path is removed independently: one missing or locked file must never
    abort the rest, because a partial failure that reported success is what
    leaves a customer's film on our disks.
    """
    import shutil
    import glob as _glob
    removed: list = []

    for _dir in (
        os.path.join(settings.PROJECTS_DIR, job_id),      # source video + dubbed + transcript
        os.path.join(settings.DUBBED_DIR, job_id),
        os.path.join(settings.UPLOAD_DIR, job_id),
        os.path.join(settings.CHUNKS_DIR, job_id),
        os.path.join(settings.PROCESSED_DIR, job_id),
        os.path.join(settings.OUTPUT_DIR, job_id),
        os.path.join("data", "diarization", job_id),
        os.path.join("data", "audio", job_id),
    ):
        if os.path.isdir(_dir):
            shutil.rmtree(_dir, ignore_errors=True)
            removed.append(_dir)

    for _pattern in (
        os.path.join("data", "transcripts", f"{job_id}*.json"),
        os.path.join("data", "velma", f"{job_id}*.json"),
        os.path.join("data", "separated", f"{job_id}_*"),
        os.path.join("data", "jobs", f"{job_id}*"),
        os.path.join("data", "diarization", f"{job_id}*"),
        os.path.join("data", "audio", f"{job_id}*"),
    ):
        for _path in _glob.glob(_pattern):
            try:
                if os.path.isdir(_path):
                    shutil.rmtree(_path, ignore_errors=True)
                else:
                    os.remove(_path)
                removed.append(_path)
            except OSError as _exc:
                logger.warning(f"[PURGE] {job_id}: could not delete {_path}: {_exc}")

    # The R2 copy — the one the customer can neither see nor reach.
    try:
        from app.services import upload_reservations as _ur
        _row = _ur._get(job_id)
        if _row and _row.get("object_key"):
            if _ur.delete_object(_row["object_key"]):
                removed.append(f"r2:{_row['object_key']}")
            _ur.release(job_id, "job purged")
    except Exception as _exc:
        logger.warning(f"[PURGE] {job_id}: R2/reservation cleanup failed: {_exc}")

    return removed


def _stamp_purge_deadline(job_id: str) -> None:
    """Start the retention countdown for a job, at render completion."""
    deadline = (datetime.utcnow() + timedelta(days=PURGE_RETENTION_DAYS)).isoformat()
    _persist_job_metadata_field(job_id, "purge_after", deadline)
    logger.info(f"[RETENTION] {job_id}: purge_after set to {deadline} ({PURGE_RETENTION_DAYS}d)")


def _sweep_purgeable_jobs() -> int:
    """Purge every job whose retention window has closed.

    Reads purge_after from each job's segments.json. A job with no stamp has
    never been rendered, so its clock has not started — those are left alone
    rather than deleted on a guess.
    """
    purged = 0
    base = settings.DUBBED_DIR
    if not os.path.isdir(base):
        return 0
    for job_id in os.listdir(base):
        state = _retention_state(job_id)
        if not state or not state.get("expired"):
            continue
        removed = _purge_job_artifacts(job_id)
        purged += 1
        logger.info(
            f"[RETENTION] purged {job_id} ({state.get('kind')}, deadline "
            f"{state.get('deadline')}) — {len(removed)} artifact(s) removed"
        )
    return purged


@router.post("/jobs/{job_id}/retention/resubmit", dependencies=[Depends(_dep_job_access)])
async def resubmit_retention(job_id: str):
    """Reset the retention clock on unrendered work.

    The escape hatch for the deletion countdown: a user part way through a
    feature must be able to say "I am still working on this" without being
    forced to render something they are not ready to render. Only meaningful
    for abandoned-state work — once rendered, the 30-day post-render window
    applies and is not extendable this way.
    """
    state = _retention_state(job_id)
    if not state:
        raise HTTPException(status_code=404, detail="No work found for this job")
    if state.get("kind") == "rendered":
        raise HTTPException(
            status_code=400,
            detail="This job has been rendered; its 30-day window cannot be extended.",
        )
    deadline = (datetime.utcnow() + timedelta(days=ABANDON_RETENTION_DAYS)).isoformat()
    _persist_job_metadata_field(job_id, "abandon_after", deadline)
    logger.info(f"[RETENTION] {job_id}: resubmitted — abandon_after now {deadline}")
    return {"status": "ok", "job_id": job_id, **_retention_state(job_id)}


def _persist_job_metadata_field(job_id: str, field: str, value) -> None:
    """Write a job-level metadata field into segments.json's top-level dict —
    the one place that's genuinely durable across a backend restart. Job objects
    like voice_mapping/traits_mapping used to be set ONLY in-memory (job.x = value)
    with a docstring claiming to "persist" it — but nothing ever wrote it to disk,
    so it silently reverted to null the moment the job got rehydrated (backend
    restart, in-memory eviction, etc.). Confirmed real: a user's voice assignments
    vanished after normal navigation away from and back into the editor, which
    happened to coincide with a backend restart during the same session.
    """
    segments_path = os.path.join(settings.DUBBED_DIR, job_id, "segments.json")
    if not os.path.exists(segments_path):
        return
    try:
        with open(segments_path, "r", encoding="utf-8") as f:
            data = _json.load(f)
        data[field] = value
        atomic_write_json(segments_path, data)
    except Exception as e:
        logger.warning(f"Job {job_id}: failed to persist {field} to segments.json: {e}")


@router.patch("/jobs/{job_id}/voice-mapping", status_code=204, dependencies=[Depends(_dep_job_access)])
async def update_voice_mapping(job_id: str, body: Dict[str, str] = Body(...)):
    """Persist a speaker_id → voice_key mapping for this job."""
    job = await _get_or_rehydrate_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    job.voice_mapping = body
    _persist_job_metadata_field(job_id, "voice_mapping", body)
    logger.info(f"[VOICE MAP] Job {job_id} voice mapping updated: {body}")


@router.patch("/jobs/{job_id}/traits-mapping", status_code=204, dependencies=[Depends(_dep_job_access)])
async def update_traits_mapping(job_id: str, body: Dict[str, List[str]] = Body(...)):
    """Persist a speaker_id → traits[] mapping for this job. Applied on regenerate
    via segment.attached_traits, and on initial batch dub via Job.traits_mapping."""
    job = await _get_or_rehydrate_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    job.traits_mapping = body
    _persist_job_metadata_field(job_id, "traits_mapping", body)
    logger.info(f"[TRAITS MAP] Job {job_id} traits mapping updated: {body}")


@router.patch("/jobs/{job_id}/speaker-reassign", status_code=204, dependencies=[Depends(_dep_job_access)])
async def reassign_segment_speaker(job_id: str, body: dict = Body(...)):
    """Reassign a single transcript segment to a different speaker."""
    job = await _get_or_rehydrate_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    segment_index = body.get("segment_index")
    new_speaker_id = body.get("new_speaker_id")

    if segment_index is None or new_speaker_id is None:
        raise HTTPException(status_code=422, detail="segment_index and new_speaker_id required")

    if not job.transcript or not job.transcript.segments:
        raise HTTPException(status_code=422, detail="No transcript segments found")

    if segment_index < 0 or segment_index >= len(job.transcript.segments):
        raise HTTPException(status_code=422, detail="Invalid segment_index")

    old_speaker = job.transcript.segments[segment_index].speaker
    job.transcript.segments[segment_index].speaker = new_speaker_id
    logger.info(f"[SPEAKER REASSIGN] Job {job_id} segment {segment_index}: {old_speaker} -> {new_speaker_id}")

    # Persist updated transcript to disk
    await job_manager.update_job_transcript(job_id, job.transcript)


@router.post("/jobs/{job_id}/cancel", dependencies=[Depends(_dep_job_access)])
async def cancel_job(job_id: str):
    """Cancel an in-flight job.

    If the job was submitted to RunPod GPU, also cancels the RunPod serverless job.
    """
    from app.services.runpod_service import runpod_service

    job = await _get_or_rehydrate_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Best-effort cancel of GPU job
    runpod_id = getattr(job, "runpod_job_id", None)
    runpod_cancel_result = None
    if runpod_id and runpod_service.is_available():
        try:
            runpod_cancel_result = await runpod_service.cancel_job(runpod_id)
        except Exception as exc:
            logger.warning(f"Job {job_id}: RunPod cancel failed for {runpod_id}: {exc}")

    await job_manager.update_job_status(
        job_id, JobStatus.CANCELLED, progress=100,
        current_stage="Cancelled",
        error_message="Cancelled by user",
    )

    # Delete artifacts (but keep job record in memory until delete endpoint is called)
    try:
        storage.delete_job_files(job_id)
    except Exception:
        pass

    return {
        "job_id": job_id,
        "status": "cancelled",
        "runpod_job_id": runpod_id,
        "runpod_cancel_result": runpod_cancel_result,
    }


@router.get("/jobs")
async def list_all_jobs(request: Request):
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.removeprefix("Bearer ").strip()
    user_id = verify_jwt(token)

    jobs = await job_manager.list_jobs(user_id=user_id)
    # Sort by most recently updated, newest first
    jobs.sort(key=lambda j: j.updated_at or j.created_at, reverse=True)
    # Filter out stale rehydrated jobs that have no transcript (processing/50%)
    # keeping only completed, failed, or actively running jobs
    filtered = [
        j for j in jobs
        if j.status != "processing" or j.progress != 50 or
           (j.updated_at and j.created_at and j.updated_at != j.created_at)
    ]
    return {
        "total": len(filtered),
        "jobs": [
            {
                "job_id": job.job_id,
                "status": job.status,
                "progress": job.progress,
                "video_filename": job.video_filename,
                "created_at": job.created_at,
                "updated_at": job.updated_at
            }
            for job in filtered
        ]
    }


def _project_expired(meta: dict) -> bool:
    """True when a project is past its retention date.

    Absent or unparseable expires_at means permanent — never expire a project
    because we couldn't read a date. Professional projects have no date at all.
    """
    raw = meta.get("expires_at")
    if not raw:
        return False
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "")) < datetime.utcnow()
    except Exception:
        return False


def _sweep_expired_projects(owner: Optional[str] = None) -> int:
    """Delete projects past their retention date. Scoped to one owner when
    given, which is what the list endpoint uses so a user's own visit tidies
    their own projects without touching anyone else's."""
    import shutil
    removed = 0
    base = _projects_base_dir()
    if not base.exists():
        return 0
    for entry in base.iterdir():
        if not entry.is_dir():
            continue
        try:
            with open(entry / "project.json", "r", encoding="utf-8") as f:
                meta = _json.load(f)
        except Exception:
            continue
        if owner is not None and meta.get("user_id") != owner:
            continue
        if _project_expired(meta):
            try:
                shutil.rmtree(entry)
                removed += 1
                logger.info(
                    f"[RETENTION] removed expired project {entry.name} "
                    f"(expired {meta.get('expires_at')})"
                )
            except Exception as e:
                logger.warning(f"[RETENTION] could not remove {entry.name}: {e}")
    return removed


@router.get("/projects")
async def list_projects(request: Request):
    """The caller's projects.

    Previously unauthenticated and unfiltered: it walked the projects
    directory and returned everything on disk to anyone who asked, with no
    token required. Projects carry a user_id now, and anything without one is
    withheld rather than shown to everybody.
    """
    auth_header = request.headers.get("Authorization", "")
    caller = verify_jwt(auth_header.removeprefix("Bearer ").strip())

    # A user's own visit tidies their own expired projects. There is no
    # scheduler, so without this an expired project would linger until
    # /cleanup happened to be called.
    await asyncio.to_thread(_sweep_expired_projects, caller)

    base = _projects_base_dir()
    base.mkdir(parents=True, exist_ok=True)
    projects = []
    for entry in base.iterdir():
        if not entry.is_dir():
            continue
        meta_path = entry / "project.json"
        if meta_path.exists():
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    meta = _json.load(f)
                if meta.get("user_id") == caller:
                    projects.append(meta)
                continue
            except Exception:
                pass
        # A directory with no readable project.json has no provable owner, so
        # it is withheld. Previously these were returned to everyone.
    projects.sort(key=lambda p: p.get("updated_at") or p.get("created_at") or "", reverse=True)
    return {"total": len(projects), "projects": projects}


class SaveProjectBody(BaseModel):
    title: Optional[str] = None
    target_language: Optional[str] = None
    thumbnail_url: Optional[str] = None


@router.post("/projects/save/{job_id}", dependencies=[Depends(_dep_job_access)])
async def save_project(job_id: str, request: Request, body: SaveProjectBody = SaveProjectBody()):
    auth_header = request.headers.get("Authorization", "")
    caller = verify_jwt(auth_header.removeprefix("Bearer ").strip())

    job = await job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    # 404 rather than 403 for someone else's job: a 403 would confirm the id
    # exists, which is itself a disclosure.
    if getattr(job, "user_id", None) and job.user_id != caller:
        raise HTTPException(status_code=404, detail="Job not found")

    _plan = await asyncio.to_thread(_plan_for_user, caller)
    _plan_key = "basic" if _plan in (None, _PLAN_UNKNOWN) else _plan

    from datetime import datetime

    project_id = job_id
    base = _projects_base_dir() / project_id
    base.mkdir(parents=True, exist_ok=True)

    now = datetime.utcnow().isoformat()

    # Project cap. Counted only for NEW projects — re-saving one you already
    # have must never be blocked, or a user at their limit could no longer
    # save changes to existing work.
    _limit = PROJECT_LIMITS.get(_plan_key)
    if _limit is not None and not (base / "project.json").exists():
        _owned = 0
        for _e in _projects_base_dir().iterdir():
            if not _e.is_dir():
                continue
            try:
                with open(_e / "project.json", "r", encoding="utf-8") as _f:
                    if _json.load(_f).get("user_id") == caller:
                        _owned += 1
            except Exception:
                continue
        if _owned >= _limit:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"You have {_owned} of {_limit} projects. Delete one, or "
                    f"upgrade for more."
                ),
            )

    # Preserve created_at if project already exists
    existing_created_at = now
    meta_path = base / "project.json"
    if meta_path.exists():
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                existing = _json.load(f)
                existing_created_at = existing.get("created_at", now)
        except Exception:
            pass

    meta = {
        "project_id": project_id,
        "job_id": job_id,
        # Ownership. Without this the projects list had nothing to filter on,
        # so /projects returned every project on disk to every caller.
        "user_id": getattr(job, "user_id", None) or None,
        # Retention. Absent/None means permanent (Professional). Recomputed on
        # every save, so editing a project resets its clock — work you are
        # actively touching shouldn't quietly expire.
        "expires_at": (
            (datetime.utcnow() + timedelta(days=PROJECT_RETENTION_DAYS[_plan_key])).isoformat()
            if _plan_key in PROJECT_RETENTION_DAYS else None
        ),
        "title": body.title or getattr(job, "video_filename", None) or job_id,
        "video_filename": getattr(job, "video_filename", None),
        "source_language": getattr(job, "source_language", None),
        "target_language": body.target_language or getattr(job, "target_language", None),
        "thumbnail_url": body.thumbnail_url,
        "status": getattr(job, "status", "completed"),
        "progress": getattr(job, "progress", 100),
        "created_at": existing_created_at,
        "updated_at": now,
    }

    # Copy canonical artifacts
    try:
        if getattr(job, "video_path", None):
            vp = Path(job.video_path)
            _safe_copytree(vp, base / "video" / vp.name)
    except Exception:
        pass

    try:
        video_copy_path = base / "video" / Path(job.video_path).name if getattr(job, "video_path", None) else None
        if video_copy_path and video_copy_path.exists():
            thumb_path = base / "thumbnail.jpg"
            cmd = [
                "ffmpeg", "-y", "-ss", "1", "-i", str(video_copy_path),
                "-frames:v", "1", "-vf", "scale=320:-2", "-q:v", "4",
                str(thumb_path),
            ]
            result = await asyncio.to_thread(subprocess.run, cmd, capture_output=True, timeout=15)
            if result.returncode == 0 and thumb_path.exists() and thumb_path.stat().st_size > 0:
                meta["thumbnail_url"] = f"/api/projects/{project_id}/thumbnail"
            else:
                logger.warning(f"[THUMBNAIL] generation failed for project={project_id}: {result.stderr.decode(errors='ignore')[:500]}")
    except Exception as e:
        logger.warning(f"[THUMBNAIL] generation failed for project={project_id}: {e}")

    try:
        transcript_path = Path("data/transcripts") / f"{job_id}.json"
        if transcript_path.exists():
            _safe_copytree(transcript_path, base / "transcript.json")
    except Exception:
        pass

    try:
        dubbed_dir = Path(settings.DUBBED_DIR) / job_id
        if dubbed_dir.exists():
            _safe_copytree(dubbed_dir, base / "dubbed")
    except Exception:
        pass

    with open(base / "project.json", "w", encoding="utf-8") as f:
        _json.dump(meta, f, indent=2, ensure_ascii=False)

    return meta


@router.delete("/projects/{project_id}")
async def delete_project(project_id: str, request: Request):
    """Delete one of the caller's projects.

    Was unauthenticated: any caller could delete any project by id.
    """
    import shutil
    auth_header = request.headers.get("Authorization", "")
    caller = verify_jwt(auth_header.removeprefix("Bearer ").strip())

    base = _projects_base_dir() / project_id
    if not base.exists():
        raise HTTPException(status_code=404, detail="Project not found")

    meta_path = base / "project.json"
    owner = None
    if meta_path.exists():
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                owner = _json.load(f).get("user_id")
        except Exception:
            owner = None
    if owner != caller:
        # Unowned projects are not deletable either — they predate ownership
        # and we can't prove they're the caller's.
        raise HTTPException(status_code=404, detail="Project not found")

    shutil.rmtree(base)
    return {"deleted": True, "project_id": project_id}


@router.post("/cleanup", dependencies=[Depends(_dep_admin)])
async def cleanup_old_files():
    try:
        storage.cleanup_old_files()
        # Covers users who never log in — the lazy sweep on /projects only
        # runs for people who actually visit.
        removed = await asyncio.to_thread(_sweep_expired_projects, None)
        return {
            "message": "Cleanup completed successfully",
            "expired_projects_removed": removed,
        }
    except Exception as e:
        logger.error(f"Cleanup failed: {e}")
        raise HTTPException(status_code=500, detail=f"Cleanup failed: {str(e)}")


async def process_vozo_pipeline(
    job_id: str,
    video_path: str,
    target_lang: str,
    source_lang: str,
    user_prompt: str | None = None,
):
    """Delegate the entire dubbing pipeline to Vozo AI."""
    try:
        video_url = f"{vozo_service.public_base_url}/api/media/{job_id}/video"

        await job_manager.update_job_status(
            job_id, JobStatus.PROCESSING, progress=5,
            current_stage="Submitting to Vozo AI",
        )

        vozo_task_id = await vozo_service.start_dub(
            job_id=job_id,
            video_url=video_url,
            source_language=source_lang,
            target_language=target_lang,
            user_prompt=user_prompt,
        )

        if not vozo_task_id:
            await job_manager.update_job_status(
                job_id, JobStatus.FAILED,
                error_message="Failed to submit job to Vozo AI. Check API key and PUBLIC_BASE_URL.",
            )
            return

        # Poll loop
        for attempt in range(1, MAX_POLL_ATTEMPTS + 1):
            await asyncio.sleep(POLL_INTERVAL_SEC)

            data = await vozo_service.poll_dub_status(vozo_task_id)
            vozo_status = data.get("status", "unknown")

            mapped = VOZO_STATUS_MAP.get(vozo_status)
            if mapped:
                our_status, progress, stage_msg = mapped
                if our_status not in ("completed", "failed"):
                    await job_manager.update_job_status(
                        job_id, JobStatus(our_status),
                        progress=progress, current_stage=stage_msg,
                    )

            if vozo_status == "done":
                video_result_url = data.get("video_url")
                if not video_result_url:
                    await job_manager.update_job_status(
                        job_id, JobStatus.FAILED,
                        error_message="Vozo completed but returned no video URL",
                    )
                    return

                output_dir = os.path.join(settings.DUBBED_DIR, job_id)
                os.makedirs(output_dir, exist_ok=True)
                output_path = os.path.join(output_dir, f"dubbed_{target_lang}.mp4")

                success = await vozo_service.download_result(video_result_url, output_path)
                if not success:
                    await job_manager.update_job_status(
                        job_id, JobStatus.FAILED,
                        error_message="Failed to download dubbed video from Vozo",
                    )
                    return

                # Download subtitles if available
                subtitle_url = data.get("subtitle_url")
                if subtitle_url:
                    srt_path = os.path.join(output_dir, f"subtitles_{target_lang}.srt")
                    await vozo_service.download_result(subtitle_url, srt_path)

                dubbed_url = f"/api/download/{job_id}/{target_lang}"
                await job_manager.update_job_dubbing_result(
                    job_id, dubbed_url, tts_engine="vozo",
                )
                await job_manager.update_job_status(
                    job_id, JobStatus.COMPLETED, progress=100,
                    current_stage="Vozo dubbing complete",
                )
                logger.info(f"Job {job_id} Vozo dubbing completed successfully")

                # Auto-trigger QC analysis concurrently — non-blocking fire-and-forget
                try:
                    from app.pipeline.analyze_dub import analyze_dub as _analyze_dub
                    asyncio.create_task(asyncio.to_thread(_analyze_dub, job_id, target_lang, video_path))
                    logger.info(f"Job {job_id}: QC analysis auto-triggered (Vozo)")
                except Exception as _qc_err:
                    logger.warning(f"Job {job_id}: QC auto-trigger skipped (Vozo): {_qc_err}")
                return

            elif vozo_status == "failed":
                error_detail = data.get("message", "Vozo reported failure")
                await job_manager.update_job_status(
                    job_id, JobStatus.FAILED,
                    error_message=f"Vozo dubbing failed: {error_detail}",
                )
                return

        # Timed out
        await job_manager.update_job_status(
            job_id, JobStatus.FAILED,
            error_message=f"Vozo dubbing timed out after {MAX_POLL_ATTEMPTS * POLL_INTERVAL_SEC}s",
        )

    except Exception as e:
        logger.error(f"Error in Vozo pipeline for job {job_id}: {e}")
        await job_manager.update_job_status(
            job_id, JobStatus.FAILED, error_message=str(e),
        )


async def process_dubbing_pipeline(
    job_id: str,
    video_path: str,
    transcript_dicts: list,
    target_lang: str,
    source_lang: str,
    voice_mapping: dict,
    voice_settings: dict | None,
    speaker_genders: dict | None = None,
    adaptation_selections: dict | None = None,
    traits_mapping: dict | None = None,
    character_profiles: list | None = None,
):
    try:
        if source_lang != target_lang:
            await job_manager.update_job_status(
                job_id,
                JobStatus.TRANSLATING,
                progress=30,
                current_stage=f"Translating to {target_lang}"
            )

        await job_manager.update_job_status(
            job_id,
            JobStatus.SYNTHESIZING,
            progress=50,
            current_stage="Generating dubbed audio with AI voices"
        )

        dubbed_video = await dubbing_service.dub_video(
            job_id=job_id,
            video_path=video_path,
            transcript=transcript_dicts,
            target_language=target_lang,
            voice_mapping=voice_mapping,
            voice_settings=voice_settings,
            source_language=source_lang,
            speaker_genders=speaker_genders,
            adaptation_selections=adaptation_selections,
            traits_mapping=traits_mapping,
            character_profiles=character_profiles,
        )

        if dubbed_video:
            if isinstance(dubbed_video, dict):
                tts_engine = dubbed_video.get("tts_engine")
                segment_engines = dubbed_video.get("segment_engines")
                dubbed_output_path = dubbed_video.get("output_path")
            else:
                tts_engine = None
                segment_engines = None
                dubbed_output_path = None

            # --- Sync.Labs lip sync (optional, non-fatal) ---
            if lipsync_service.enabled and dubbed_output_path:
                await job_manager.update_job_status(
                    job_id,
                    JobStatus.LIP_SYNCING,
                    progress=85,
                    current_stage="Syncing lips to dubbed audio",
                )
                audio_path = os.path.join(settings.DUBBED_DIR, job_id, "dubbed_audio.mp3")
                if os.path.exists(audio_path):
                    lipsync_ok = await lipsync_service.lipsync_video(
                        job_id=job_id,
                        video_path=video_path,       # original video for clean faces
                        audio_path=audio_path,        # merged dubbed audio
                        output_path=dubbed_output_path,  # overwrites dubbed video in-place
                    )
                    # Metered by VIDEO duration, which is what lip-sync vendors
                    # bill on — unlike TTS, which bills speech. Recorded even
                    # on failure: a failed pass still costs vendor time.
                    try:
                        _lj = await job_manager.get_job(job_id)
                        tts_usage.record_lipsync(
                            os.path.join(settings.DUBBED_DIR, job_id),
                            "synclabs",
                            video_seconds=float(getattr(_lj, "video_duration", 0) or 0),
                            succeeded=bool(lipsync_ok),
                        )
                    except Exception as _e:
                        logger.warning(f"[LIPSYNC-USAGE] accounting skipped: {_e}")

                    if lipsync_ok:
                        logger.info(f"Job {job_id}: lip sync applied successfully")
                    else:
                        logger.warning(f"Job {job_id}: lip sync failed, keeping dubbed-only video")
                else:
                    logger.warning(f"Job {job_id}: dubbed_audio.mp3 not found, skipping lip sync")

            dubbed_url = f"/api/download/{job_id}/{target_lang}"
            await job_manager.update_job_dubbing_result(
                job_id,
                dubbed_url,
                tts_engine,
                segment_tts_engines=segment_engines,
            )
            await job_manager.update_job_status(
                job_id,
                JobStatus.COMPLETED,
                progress=100,
                current_stage="Dubbing complete"
            )
            logger.info(f"Job {job_id} dubbing completed successfully")

            # Auto-trigger QC analysis concurrently — non-blocking fire-and-forget
            try:
                from app.pipeline.analyze_dub import analyze_dub as _analyze_dub
                asyncio.create_task(asyncio.to_thread(_analyze_dub, job_id, target_lang, video_path))
                logger.info(f"Job {job_id}: QC analysis auto-triggered")
            except Exception as _qc_err:
                logger.warning(f"Job {job_id}: QC auto-trigger skipped: {_qc_err}")
        else:
            await job_manager.update_job_status(
                job_id,
                JobStatus.FAILED,
                error_message="Dubbing failed"
            )
    except Exception as e:
        logger.error(f"Error dubbing job {job_id}: {e}")
        await job_manager.update_job_status(
            job_id,
            JobStatus.FAILED,
            error_message=str(e)
        )


@router.post("/adapt", response_model=AdaptResponse)
async def run_adaptation(request: AdaptRequest, http_request: Request):
    """
    On-demand: generate 3 adaptation variants (faithful / performable / sync_fit)
    for the provided segments. Called by the editor when the Adaptation Panel is
    opened. Does NOT trigger TTS — variants are stored in editor state only.
    Always returns HTTP 200; sets fallback=True if the LLM was unavailable.

    job_id arrives in the body, so this cannot use the _dep_job_access guard the
    path-param routes use — ownership is checked inline instead.
    """
    await _require_job(request.job_id, _caller(http_request))
    from dataclasses import asdict
    from app.services.adaptation_engine import adapt_batch

    fallback = False
    try:
        if not request.segments:
            return AdaptResponse(job_id=request.job_id, fallback=False, adapted_segments=[])

        target_language = request.segments[0].get("target_language", "en")
        adapted = await adapt_batch(
            segments=request.segments,
            target_language=target_language,
            scene_context=request.scene_context,
        )
        # Detect whether all variants are fallbacks (LLM unavailable)
        if adapted and adapted[0].variants and adapted[0].variants[0].rationale.startswith("Fallback"):
            fallback = True

        return AdaptResponse(
            job_id=request.job_id,
            fallback=fallback,
            adapted_segments=[asdict(a) for a in adapted],
        )
    except Exception as e:
        logger.error(f"[ADAPT ROUTE] Unexpected error: {e}", exc_info=True)
        return AdaptResponse(job_id=request.job_id, fallback=True, adapted_segments=[])


@router.post("/dub", response_model=DubResponse)
async def dub_video(request: DubRequest, http_request: Request, background_tasks: BackgroundTasks):
    # job_id is in the body, so the _dep_job_access guard cannot reach it.
    # Without this, /transcribe-video -> /dub is a complete unauthenticated,
    # unmetered dubbing pipeline.
    await _require_job(request.job_id, _caller(http_request))

    job = await _get_or_rehydrate_job(request.job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Job not found. Please upload the video first.")

    if not request.transcript:
        raise HTTPException(status_code=400, detail="Transcript is required to start dubbing.")

    req_speakers = set((seg.speaker or "speaker-1") for seg in request.transcript)
    job_segments = (job.transcript.segments if job and job.transcript and job.transcript.segments else [])
    job_speakers = set((seg.speaker or "speaker-1") for seg in job_segments)

    # CRITICAL: Always use request.transcript, never fall back to cached job_segments.
    # The previous fallback (if req_speakers <= 1 and job_speakers > 1) caused
    # cross-job contamination: fresh dub requests would inherit stale segments
    # from previously cached jobs still in memory, resulting in old translated
    # text being written to the fresh job's segments.json.
    transcript_source = request.transcript

    # Build confidence lookup from stored transcript so ASR confidence scores
    # survive the frontend round-trip (the frontend doesn't send them back).
    # Keyed by timestamp to match Velma segments; split sub-segments that don't
    # match fall back to None gracefully.
    _conf_lookup: Dict[str, tuple] = {}
    if job and job.transcript and job.transcript.segments:
        for _js in job.transcript.segments:
            _k = f"{_js.start:.3f}_{_js.end:.3f}"
            _conf_lookup[_k] = (_js.confidence, _js.confidence_tier)

    transcript_dicts = []
    for seg in transcript_source:
        _k = f"{seg.start:.3f}_{seg.end:.3f}"
        _conf, _tier = _conf_lookup.get(_k, (None, None))
        transcript_dicts.append({
            "text": seg.text,
            "start": seg.start,
            "end": seg.end,
            "speaker": seg.speaker,
            "velma_emotion": seg.velma_emotion,
            "velma_accent": seg.velma_accent,
            "velma_deepfake_score": seg.velma_deepfake_score,
            "confidence": seg.confidence if getattr(seg, "confidence", None) is not None else _conf,
            "confidence_tier": seg.confidence_tier if getattr(seg, "confidence_tier", None) is not None else _tier,
        })

    detected_lang = job.transcript.language if job and job.transcript else None

    source_lang = request.source_language
    if (not source_lang) or normalize_language_code(source_lang, allow_auto=True) == "auto":
        # Prefer the explicit hint the user gave at upload time, then the
        # language Whisper actually detected, then fall back to "auto".
        if job and getattr(job, "source_language", None):
            source_lang = job.source_language
        elif detected_lang:
            source_lang = detected_lang
        else:
            source_lang = "auto"

    try:
        target_lang = normalize_language_code(request.target_language, strict=True)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    source_lang = normalize_language_code(source_lang, allow_auto=True)

    if detected_lang:
        detected_norm = normalize_language_code(detected_lang, allow_auto=True)
        if target_lang == "en" and source_lang in ("en", "auto") and detected_norm != "en":
            logger.info(
                f"Overriding source language to detected '{detected_norm}' for English dubbing"
            )
            source_lang = detected_norm

    if target_lang != request.target_language or source_lang != request.source_language:
        logger.info(
            f"Normalized request languages: source={request.source_language} -> {source_lang}, "
            f"target={request.target_language} -> {target_lang}"
        )

    # Determine dubbing engine
    engine = (request.dubbing_engine or "dubmaster").lower().strip()

    if engine == "vozo":
        if not vozo_service.enabled:
            raise HTTPException(
                status_code=400,
                detail="Vozo AI is not available. Set VOZO_API_KEY, VOZO_ENABLED=true, and PUBLIC_BASE_URL in .env",
            )

        job.dubbing_engine = "vozo"
        await job_manager.update_job_status(
            request.job_id, JobStatus.PROCESSING, progress=5,
            current_stage="Starting Vozo AI pipeline",
        )

        background_tasks.add_task(
            process_vozo_pipeline,
            job_id=request.job_id,
            video_path=job.video_path,
            target_lang=target_lang,
            source_lang=source_lang,
            user_prompt=request.vozo_user_prompt,
        )

        return DubResponse(
            job_id=request.job_id,
            status="processing",
            dubbed_video_url=None,
            tts_engine=None,
            dubbing_engine="vozo",
            message="Vozo AI dubbing started, poll /api/status for progress",
        )

    # === DubMaster pipeline (default) ===
    job.dubbing_engine = "dubmaster"

    await job_manager.update_job_status(
        request.job_id,
        JobStatus.PROCESSING,
        progress=10,
        current_stage="Starting dubbing pipeline"
    )

    background_tasks.add_task(
        process_dubbing_pipeline,
        job_id=request.job_id,
        video_path=job.video_path,
        transcript_dicts=transcript_dicts,
        target_lang=target_lang,
        source_lang=source_lang,
        voice_mapping=request.voice_mapping,
        voice_settings=request.voice_settings,
        speaker_genders=job.speaker_genders,
        adaptation_selections=request.adaptation_selections,
        traits_mapping=job.traits_mapping,
        character_profiles=request.character_profiles or job.character_profiles,
    )

    return DubResponse(
        job_id=request.job_id,
        status="processing",
        dubbed_video_url=None,
        tts_engine=None,
        dubbing_engine="dubmaster",
        message="Dubbing started, poll /api/status for progress"
    )


@router.post("/translate-only")
async def translate_only(request: DubRequest, http_request: Request):
    """Run translation + adaptation only — no TTS or mixing.

    Returns the translated segments so the frontend can show them in the
    inline editor for user review before rendering.
    """
    await _require_job(request.job_id, _caller(http_request))
    import json as _json_to
    from app.services.translation_service import translation_service as _ts

    job = await _get_or_rehydrate_job(request.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    # Build a lookup from the job's stored transcript to carry confidence/words
    _job_seg_lookup: Dict[str, dict] = {}
    if job and job.transcript:
        for js in job.transcript.segments:
            _key = f"{js.start:.3f}_{js.end:.3f}"
            _job_seg_lookup[_key] = {
                "confidence": js.confidence,
                "confidence_tier": js.confidence_tier,
                "words": [w.model_dump() for w in js.words] if js.words else None,
            }

    transcript_dicts = []
    for seg in request.transcript:
        d: dict = {
            "text": seg.text,
            "start": seg.start,
            "end": seg.end,
            "speaker": seg.speaker,
            "velma_emotion": seg.velma_emotion,
            "velma_accent": seg.velma_accent,
        }
        _key = f"{seg.start:.3f}_{seg.end:.3f}"
        if _key in _job_seg_lookup:
            d.update(_job_seg_lookup[_key])
        transcript_dicts.append(d)

    detected_lang = job.transcript.language if job and job.transcript else None
    source_lang = request.source_language
    if (not source_lang) or normalize_language_code(source_lang, allow_auto=True) == "auto":
        if job and getattr(job, "source_language", None):
            source_lang = job.source_language
        elif detected_lang:
            source_lang = detected_lang
        else:
            source_lang = "auto"

    try:
        target_lang = normalize_language_code(request.target_language, strict=True)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    source_lang = normalize_language_code(source_lang, allow_auto=True)

    if detected_lang:
        detected_norm = normalize_language_code(detected_lang, allow_auto=True)
        if target_lang == "en" and source_lang in ("en", "auto") and detected_norm != "en":
            source_lang = detected_norm

    for i, seg in enumerate(transcript_dicts):
        seg["segment_id"] = str(i)
        seg["source_text"] = seg.get("text", "")

    if source_lang != target_lang:
        _velma_context = None
        _velma_path = os.path.join("data", "velma", f"{request.job_id}.json")
        if os.path.exists(_velma_path):
            try:
                with open(_velma_path, "r", encoding="utf-8") as _vf:
                    _velma_context = _json_to.load(_vf)
            except Exception:
                pass

        transcript_dicts = await _ts.translate_segments(
            transcript_dicts,
            source_lang,
            target_lang,
            character_profiles=request.character_profiles or (job.character_profiles if job else None),
            velma_context=_velma_context,
        )

        _NOISE_WORDS = {
            "you", "it", "he", "she", "they", "i", "we",
            "sa", "ha", "oh", "ah", "uh", "bobo", "babo",
            "the", "a", "an",
        }
        transcript_dicts = [
            s for s in transcript_dicts
            if s.get("text", "").strip()
            and s.get("text", "").strip().lower().rstrip(".,!?") not in _NOISE_WORDS
        ]

        # Clear source-language word alignments — they don't match the
        # translated text and would cause the editor to display Chinese
        # characters instead of the English translation.
        for s in transcript_dicts:
            s.pop("words", None)

    output_dir = os.path.join(settings.DUBBED_DIR, request.job_id)
    os.makedirs(output_dir, exist_ok=True)
    segments_path = os.path.join(output_dir, "segments.json")
    payload = {
        "job_id": request.job_id,
        "language": target_lang,
        "source_language": source_lang,
        "generated_at": "",
        "translated_only": True,
        "segments": [
            {
                **seg,
                "locked": False,
                "candidates": [],
                "edit_history": [],
            }
            for seg in transcript_dicts
        ],
    }
    atomic_write_json(segments_path, payload)

    await job_manager.update_job_status(
        request.job_id,
        JobStatus.READY_FOR_REVIEW,
        progress=40,
        current_stage="Translation complete — review before rendering",
    )

    _speaker_genders = job.speaker_genders if job else {}

    return {
        "job_id": request.job_id,
        "status": "ready_for_review",
        "target_language": target_lang,
        "source_language": source_lang,
        "speaker_genders": _speaker_genders or {},
        "segments": transcript_dicts,
    }


@router.post("/render")
async def render_dubbed_video(request: DubRequest, http_request: Request, background_tasks: BackgroundTasks):
    """Pick up translated (and user-edited) segments and run TTS + mix.

    Called after the user reviews the translation in the inline editor.
    The request.transcript contains the corrected translated text.
    """
    await _require_job(request.job_id, _caller(http_request))
    job = await _get_or_rehydrate_job(request.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    _render_conf_lookup: Dict[str, tuple] = {}
    if job and job.transcript and job.transcript.segments:
        for _js in job.transcript.segments:
            _k = f"{_js.start:.3f}_{_js.end:.3f}"
            _render_conf_lookup[_k] = (_js.confidence, _js.confidence_tier)

    transcript_dicts = []
    for i, seg in enumerate(request.transcript):
        _k = f"{seg.start:.3f}_{seg.end:.3f}"
        _conf, _tier = _render_conf_lookup.get(_k, (None, None))
        transcript_dicts.append({
            "text": seg.text,
            "start": seg.start,
            "end": seg.end,
            "speaker": seg.speaker,
            "segment_id": str(i),
            "source_text": getattr(seg, "source_text", None) or seg.text,
            "confidence": seg.confidence if getattr(seg, "confidence", None) is not None else _conf,
            "confidence_tier": seg.confidence_tier if getattr(seg, "confidence_tier", None) is not None else _tier,
        })

    try:
        target_lang = normalize_language_code(request.target_language, strict=True)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    detected_lang = job.transcript.language if job and job.transcript else None
    source_lang = request.source_language
    if (not source_lang) or normalize_language_code(source_lang, allow_auto=True) == "auto":
        if job and getattr(job, "source_language", None):
            source_lang = job.source_language
        elif detected_lang:
            source_lang = detected_lang
        else:
            source_lang = "auto"
    source_lang = normalize_language_code(source_lang, allow_auto=True)

    await job_manager.update_job_status(
        request.job_id,
        JobStatus.SYNTHESIZING,
        progress=50,
        current_stage="Generating dubbed audio with AI voices",
    )

    background_tasks.add_task(
        process_dubbing_pipeline,
        job_id=request.job_id,
        video_path=job.video_path,
        transcript_dicts=transcript_dicts,
        target_lang=target_lang,
        source_lang=target_lang,
        voice_mapping=request.voice_mapping,
        voice_settings=request.voice_settings,
        speaker_genders=job.speaker_genders,
        adaptation_selections=request.adaptation_selections,
        traits_mapping=job.traits_mapping,
        character_profiles=request.character_profiles or job.character_profiles,
    )

    return DubResponse(
        job_id=request.job_id,
        status="processing",
        dubbed_video_url=None,
        tts_engine=None,
        dubbing_engine="dubmaster",
        message="Rendering started, poll /api/status for progress",
    )


@router.get("/download/{job_id}/{language}", dependencies=[Depends(_dep_job_access)])
async def download_dubbed_video(job_id: str, language: str, attachment: bool = False):
    """Serve the finished dub.

    Defaults to `inline` because the same URL backs the <video> player. Pass
    ?attachment=1 to get a real download: the HTML `download` attribute is
    IGNORED for cross-origin URLs, and the app runs on a different port from
    the API, so a plain link only ever played the file. Content-Disposition is
    the only thing that actually makes the browser save it.
    """
    dubbed_path = os.path.join(settings.DUBBED_DIR, job_id, f"dubbed_{language}.mp4")

    if not os.path.exists(dubbed_path):
        raise HTTPException(status_code=404, detail="Dubbed video not found")

    if attachment:
        filename = f"dubbed_{language}_{job_id[:8]}.mp4"
        return FileResponse(
            dubbed_path,
            media_type="video/mp4",
            filename=filename,   # sets Content-Disposition: attachment
        )

    return FileResponse(
        dubbed_path,
        media_type="video/mp4",
        headers={"Content-Disposition": "inline"},
    )


@router.get("/projects/{project_id}/thumbnail", dependencies=[Depends(_dep_auth)])
async def serve_project_thumbnail(project_id: str):
    """Serve a saved project's generated thumbnail image."""
    thumb_path = _projects_base_dir() / project_id / "thumbnail.jpg"
    if not thumb_path.exists():
        raise HTTPException(status_code=404, detail="Thumbnail not found")
    return FileResponse(thumb_path, media_type="image/jpeg")


@router.get("/media/{job_id}/video", dependencies=[Depends(_dep_job_access)])
async def serve_job_video(job_id: str):
    """Serve the original uploaded video so Sync.Labs can fetch it by URL."""
    job = await _get_or_rehydrate_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if not os.path.exists(job.video_path):
        raise HTTPException(status_code=404, detail="Video file not found")
    ext = Path(job.video_path).suffix.lower()
    media_types = {
        ".mp4": "video/mp4",
        ".mov": "video/quicktime",
        ".avi": "video/x-msvideo",
        ".mkv": "video/x-matroska",
        ".webm": "video/webm",
    }
    # Vary: Origin so the browser cache keys this by origin — the crossorigin
    # thumbnail request and the no-cors player request never share (and poison)
    # a cache entry, which otherwise makes the thumbnail fetch fail CORS.
    return FileResponse(job.video_path, media_type=media_types.get(ext, "video/mp4"),
        headers={"Vary": "Origin"})


# Segment audio is REGENERATED in place (same filename overwritten), so it must
# never be cached by the browser — a cached copy is exactly the "stale playback
# from disk" that overrides a fresh regen. no-store forces the current bytes every
# time (files are tiny, so the re-fetch cost is negligible).
_NO_STORE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
}


@router.get("/media/{job_id}/audio/{filename}", dependencies=[Depends(_dep_job_access)])
async def serve_job_audio(job_id: str, filename: str):
    """Serve a dubbed audio file so Sync.Labs can fetch it by URL."""
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    audio_path = os.path.join(settings.DUBBED_DIR, job_id, filename)
    if not os.path.exists(audio_path):
        raise HTTPException(status_code=404, detail="Audio file not found")
    ext = Path(filename).suffix.lower()
    media_types = {".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4"}
    return FileResponse(audio_path, media_type=media_types.get(ext, "audio/mpeg"),
        headers=_NO_STORE_HEADERS)


@router.get("/media/{job_id}/separated/{audio_type}", dependencies=[Depends(_dep_job_access)])
async def get_separated_audio(job_id: str, audio_type: str):
    """Serve a separated audio track (vocals or accompaniment) for waveform rendering."""
    if audio_type not in ("vocals", "accompaniment"):
        raise HTTPException(status_code=400, detail="audio_type must be 'vocals' or 'accompaniment'")
    filename = f"{job_id}_{audio_type}.wav"
    path = os.path.join(settings.SEPARATED_DIR, filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"Separated audio not found: {filename}")
    return FileResponse(path, media_type="audio/wav",
        headers={"Cache-Control": "public, max-age=3600"})


# Peaks are precomputed at a fixed resolution rather than per-request: the editor
# caps its canvas at 16000px and draws 2px bars, so 8000 buckets is every bar it
# can ever show. More would be discarded by the renderer; fewer would visibly step.
WAVEFORM_BUCKETS = 8000


@router.get("/media/{job_id}/waveform/{audio_type}", dependencies=[Depends(_dep_job_access)])
async def get_waveform_peaks(job_id: str, audio_type: str):
    """Amplitude peaks for a separated stem, for drawing a waveform.

    The editor used to fetch the stem itself and decode it in the browser. A stem
    is full-length uncompressed WAV — 1.06 GB for a 105-minute feature — and
    decoding needs it again as float32, so it never succeeded on anything
    feature-length: a gigabyte transferred, twice the memory asked for, and no
    waveform. A waveform is only ever drawn at screen resolution, so the samples
    were discarded by the renderer regardless.

    This does the reduction once, server-side, and hands back about 60 KB of JSON.
    Cached beside the stem, because reading a gigabyte takes a few seconds and the
    answer never changes for a given file.
    """
    if audio_type not in ("vocals", "accompaniment"):
        raise HTTPException(status_code=400, detail="audio_type must be 'vocals' or 'accompaniment'")

    src = os.path.join(settings.SEPARATED_DIR, f"{job_id}_{audio_type}.wav")
    if not os.path.exists(src):
        raise HTTPException(status_code=404, detail=f"No {audio_type} stem for this job")

    cache = os.path.join(settings.SEPARATED_DIR, f"{job_id}_{audio_type}_peaks.json")
    # Rebuild if the stem is newer than the cache, so a re-separation is picked up.
    if os.path.exists(cache) and os.path.getmtime(cache) >= os.path.getmtime(src):
        return FileResponse(cache, media_type="application/json",
            headers={"Cache-Control": "public, max-age=3600"})

    def _build() -> dict:
        import soundfile as _sf
        import numpy as _np
        with _sf.SoundFile(src) as f:
            total = len(f)
            rate = f.samplerate
            channels = f.channels
            if total <= 0:
                return {"duration": 0.0, "buckets": 0, "left": [], "right": []}
            per_bucket = max(1, total // WAVEFORM_BUCKETS)
            left: list[int] = []
            right: list[int] = []
            # Streamed in blocks: the point of this endpoint is not to hold the
            # whole file in memory either.
            for block in f.blocks(blocksize=per_bucket, dtype="float32"):
                if block.size == 0:
                    continue
                if channels > 1:
                    l = float(_np.abs(block[:, 0]).max())
                    r = float(_np.abs(block[:, 1]).max())
                else:
                    l = r = float(_np.abs(block).max())
                # int8 rather than float: the renderer maps these to at most 48px
                # of height, so a byte per bucket is already finer than the display.
                left.append(int(round(min(1.0, l) * 127)))
                right.append(int(round(min(1.0, r) * 127)))
            return {
                "duration": total / float(rate),
                "buckets": len(left),
                "left": left,
                "right": right,
            }

    try:
        data = await asyncio.to_thread(_build)
    except Exception as e:
        logger.error(f"[WAVEFORM] failed to build peaks for {job_id}/{audio_type}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Could not build waveform peaks")

    try:
        os.makedirs(os.path.dirname(cache), exist_ok=True)
        with open(cache, "w", encoding="utf-8") as f:
            _json.dump(data, f)
    except Exception as e:
        # A cache that cannot be written is not a reason to fail the request.
        logger.warning(f"[WAVEFORM] could not cache peaks: {e}")

    return JSONResponse(data, headers={"Cache-Control": "public, max-age=3600"})

@router.get("/media/{job_id}/{filename}", dependencies=[Depends(_dep_job_access)])
async def serve_job_audio_legacy(job_id: str, filename: str):
    """Backwards-compat: serve segment audio and scene previews from the job dir.
    Resolves stale URLs persisted in client localStorage before the /audio/
    sub-path was introduced to the getAudioFileUrl helper."""
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    file_path = os.path.join(settings.DUBBED_DIR, job_id, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    ext = Path(filename).suffix.lower()
    media_types = {
        ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4",
        ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
    }
    return FileResponse(file_path, media_type=media_types.get(ext, "audio/mpeg"),
        headers=_NO_STORE_HEADERS)


@router.get("/dubbing-engines")
async def get_dubbing_engines():
    """Return available dubbing engines and their status."""
    from app.services.runpod_service import runpod_service
    return {
        "engines": {
            "dubmaster": {
                "available": True,
                "description": "Local pipeline: Whisper + Demucs + ElevenLabs/Fish Audio",
                "features": ["voice_selection", "emotion_control", "segment_editing"],
            },
            "vozo": {
                "available": vozo_service.enabled,
                "description": "Vozo AI cloud pipeline (full-service dubbing)",
                "features": ["auto_voice_matching", "auto_translation", "lip_sync"],
                "requires_public_url": True,
                "public_url_set": bool(settings.PUBLIC_BASE_URL),
            },
        },
        "processing_mode": os.getenv("PROCESSING_MODE", "cpu"),
        "gpu_available": runpod_service.is_available(),
    }


@router.get("/pipeline/{job_id}", dependencies=[Depends(_dep_job_access)])
async def get_pipeline_status(job_id: str):
    """Return structured pipeline stage data for the Pipeline Monitor frontend component."""
    from app.services.pipeline_tracker import pipeline_tracker

    job = await job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    status_str = job.status.value if hasattr(job.status, "value") else str(job.status)
    progress = job.progress or 0
    current_stage = getattr(job, "current_stage", None)

    pipeline_data = pipeline_tracker.get_pipeline(job_id)

    # Safety net: if the job is terminal but a stage is still marked active,
    # force stages to terminal states so the UI can't show impossible combinations
    # like "Download: Running" while later stages are Done at 100%.
    try:
        terminal = {"COMPLETED", "FAILED", "CANCELLED"}
        if status_str in terminal and pipeline_data and pipeline_data.get("type") == "gpu":
            p_raw = pipeline_tracker._pipelines.get(job_id) or {}
            stages = (p_raw.get("stages") or {})
            stage_ids = list(stages.keys())
            if status_str == "COMPLETED":
                for sid in stage_ids:
                    if stages.get(sid, {}).get("status") in ("pending", "active"):
                        pipeline_tracker.complete_stage(job_id, sid)
            else:
                active = pipeline_data.get("active_stage")
                if active and stages.get(active, {}).get("status") == "active":
                    pipeline_tracker.fail_stage(job_id, active, f"Job ended with status={status_str}")
            pipeline_data = pipeline_tracker.get_pipeline(job_id)
    except Exception:
        pass

    return {
        "job_id": job_id,
        "job_status": status_str,
        "job_progress": progress,
        "current_stage": current_stage,
        "pipeline": pipeline_data,
    }


@router.post("/worker-stage", dependencies=[Depends(_dep_internal)])
async def worker_stage_update(request: Request):
    """
    Called by the RunPod worker at each stage boundary so the backend can
    update pipeline_tracker in real time — giving the frontend live progress
    even before the job completes.

    Payload:
        { "job_id": "...", "stage": "download|extract|separate|transcribe|diarize",
          "status": "started|completed|failed|skipped",
          "summary": "optional human-readable summary",
          "error": "optional error message" }
    """
    from app.services.pipeline_tracker import pipeline_tracker

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    job_id = body.get("job_id", "")
    stage   = body.get("stage", "")
    status  = body.get("status", "")
    summary = body.get("summary", "")
    error   = body.get("error", "")

    if not job_id or not stage or not status:
        raise HTTPException(status_code=400, detail="job_id, stage, and status are required")

    job = await job_manager.get_job(job_id)
    if not job:
        # Worker may call back before backend registers the job — ignore gracefully
        logger.warning(f"[WORKER-STAGE] Unknown job_id={job_id}, ignoring callback")
        return {"ok": True}

    logger.info(f"[WORKER-STAGE] job={job_id} stage={stage} status={status} summary={summary!r}")

    if status == "started":
        # Ensure GPU pipeline is initialised if the first callback arrives before
        # process_video_pipeline has had a chance to init it.
        p = pipeline_tracker.get_pipeline(job_id)
        if not p or p.get("type") != "gpu":
            pipeline_tracker.init_pipeline(job_id, "gpu")
        pipeline_tracker.start_stage(job_id, stage)

        # Map stage → job status label so the top-level status reflects the active step
        _stage_status_map = {
            "download":  (JobStatus.PROCESSING,   "Downloading video to GPU"),
            "extract":   (JobStatus.PROCESSING,   "Extracting audio on GPU"),
            "separate":  (JobStatus.PROCESSING,   "Separating audio (Demucs)"),
            "transcribe":(JobStatus.TRANSCRIBING, "Transcribing audio (Whisper)"),
            "diarize":   (JobStatus.TRANSCRIBING, "Identifying speakers (pyannote)"),
        }
        if stage in _stage_status_map:
            new_status, new_label = _stage_status_map[stage]
            _stage_pct = {"download": 20, "extract": 35, "separate": 50, "transcribe": 65, "diarize": 82}
            await job_manager.update_job_status(
                job_id, new_status,
                progress=_stage_pct.get(stage, job.progress or 20),
                current_stage=new_label,
            )

    elif status == "completed":
        pipeline_tracker.complete_stage(job_id, stage, summary or None)

    elif status == "failed":
        pipeline_tracker.fail_stage(job_id, stage, error or summary or "Worker reported failure")

    elif status == "skipped":
        pipeline_tracker.skip_stage(job_id, stage, summary or "Skipped by worker")

    return {"ok": True}


@router.get("/gpu-status", dependencies=[Depends(_dep_auth)])
async def get_gpu_status():
    from app.services.runpod_service import runpod_service
    health = await runpod_service.get_endpoint_health()
    return {
        "processing_mode": os.getenv("PROCESSING_MODE", "cpu"),
        "runpod_configured": runpod_service.is_available(),
        "endpoint_id": runpod_service.endpoint_id or None,
        "endpoint_health": health,
        "public_base_url": os.getenv("PUBLIC_BASE_URL", "") or None,
    }


@router.get("/tts-provider", dependencies=[Depends(_dep_auth)])
async def get_tts_provider():
    """Return the currently active TTS provider and availability info."""
    provider = os.getenv("TTS_PROVIDER", settings.TTS_PROVIDER).lower().strip()
    return {
        "active": provider,
        "providers": {
            "elevenlabs": {"available": bool(settings.ELEVENLABS_API_KEY)},
            "fish-audio": {
                "available": fish_audio_tts.enabled,
                "voice_cloning": fish_audio_tts.enabled,
            },
        },
    }


@router.post("/tts-provider", dependencies=[Depends(_dep_admin)])
async def set_tts_provider(body: dict):
    """Switch the active TTS provider at runtime.

    Accepts ``{"provider": "fish-audio"}`` or ``{"provider": "elevenlabs"}``.
    Sets the ``TTS_PROVIDER`` env var for the current process (persists until
    container restart).  Returns the updated provider state.
    """
    requested = (body.get("provider") or "").lower().strip()
    valid = {"elevenlabs", "fish-audio"}
    if requested not in valid:
        raise HTTPException(status_code=400, detail=f"Invalid provider. Choose from: {', '.join(sorted(valid))}")

    if requested == "fish-audio" and not fish_audio_tts.enabled:
        raise HTTPException(status_code=400, detail="Fish Audio API key not configured. Set FISH_AUDIO_API_KEY in .env")

    os.environ["TTS_PROVIDER"] = requested
    logger.info(f"[TTS] Provider switched to: {requested}")

    return {
        "active": requested,
        "providers": {
            "elevenlabs": {"available": bool(settings.ELEVENLABS_API_KEY)},
            "fish-audio": {
                "available": fish_audio_tts.enabled,
                "voice_cloning": fish_audio_tts.enabled,
            },
        },
    }


@router.get("/voices/presets", dependencies=[Depends(_dep_auth)])
async def get_preset_voice_map():
    """Reverse map of the configured FISH_VOICE_* presets: voice_id -> label.

    The editor needs to name a voice it never browsed. Preset voices are
    assigned automatically at dub time, so their ids appear on segments while
    their names were never seen by the client — the speakers strip could only
    say "(voice set)". The public catalog has no lookup-by-id, but the presets
    are ours, so we can answer authoritatively from env.
    """
    from app.services.fish_audio_tts import _load_voice_map_from_env

    labels: Dict[str, str] = {}
    try:
        for key, vid in (_load_voice_map_from_env() or {}).items():
            if not vid:
                continue
            # "male-1" -> "Male 1"
            parts = key.split("-")
            labels[vid] = " ".join(p.capitalize() for p in parts)
    except Exception as exc:
        logger.warning(f"[VOICES] preset map unavailable: {exc}")
    return {"presets": labels}


@router.get("/voices", dependencies=[Depends(_dep_auth)])
async def get_available_voices(
    page: int = 1,
    page_size: int = 50,
    tag: Optional[str] = None,
    gender: Optional[str] = None,
    language: Optional[str] = None,
    search: Optional[str] = None,
    sort_by: str = "task_count",
):
    try:
        provider = os.getenv("TTS_PROVIDER", settings.TTS_PROVIDER).lower().strip()

        if provider == "fish-audio" and fish_audio_tts.enabled:
            result = await fish_audio_tts.list_voices_filtered(
                page=page, page_size=page_size,
                tag=tag, gender=gender, language=language, search=search,
                sort_by=sort_by,
            )
            return {**result, "provider": "fish-audio"}

        # ElevenLabs fallback — return full list, no server-side filtering
        voices = await elevenlabs_tts.get_voices()
        formatted_voices = []
        for voice in voices:
            voice_id = voice.get("voice_id")
            formatted_voices.append({
                "voice_id": voice_id,
                "name": voice.get("name"),
                "category": voice.get("category", "generated"),
                "labels": voice.get("labels", {}),
                "preview_url": f"/api/voice-preview/{voice_id}",
                "description": voice.get("description", ""),
                "tags": [],
                "task_count": 0,
                "like_count": 0,
            })
        return {
            "voices": formatted_voices,
            "total": len(formatted_voices),
            "page": 1,
            "page_size": len(formatted_voices),
            "provider": "elevenlabs",
        }
    except Exception as e:
        logger.error(f"Failed to fetch voices: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch voices")


@router.get("/voice-preview/{voice_id:path}", dependencies=[Depends(_dep_auth)])
async def get_voice_preview(voice_id: str):
    """Generate and serve a voice preview sample using the active TTS provider."""
    preview_dir = Path("data/voice_previews")
    preview_dir.mkdir(parents=True, exist_ok=True)

    # Use a filesystem-safe hashed filename for previews to avoid issues when
    # voice IDs contain slashes or other reserved/path characters.
    safe_name = hashlib.sha256(voice_id.encode('utf-8')).hexdigest()
    preview_path = preview_dir / f"{safe_name}.mp3"

    if preview_path.exists():
        return FileResponse(
            str(preview_path),
            media_type="audio/mpeg",
            filename=f"{voice_id}_preview.mp3"
        )

    provider = os.getenv("TTS_PROVIDER", settings.TTS_PROVIDER).lower().strip()
    if provider == "fish-audio" and fish_audio_tts.enabled:
        tts = fish_audio_tts
    else:
        tts = elevenlabs_tts

    # Attempt to generate a preview directly for the requested voice_id.
    # Do not rely on a prior listing of voices which may be paginated or cached
    # differently between list endpoints and real-time preview generation.
    preview_text = f"Hello, I'm a preview voice. This is a short sample for voice id {voice_id}."
    try:
        result = await tts.text_to_speech(
            text=preview_text,
            voice_id=voice_id,
            output_path=str(preview_path),
            stability=0.3,
            similarity_boost=0.9,
            style=0.5,
            language="en",
        )
    except Exception as e:
        tb = traceback.format_exc()
        logger.error(f"Preview generation failed for voice {voice_id}: {e}\n{tb}")
        # Return 500 so the client sees a server error and we can inspect details in logs.
        raise HTTPException(status_code=500, detail=f"Preview generation failed: {str(e)}")

    if result and preview_path.exists():
        return FileResponse(
            str(preview_path),
            media_type="audio/mpeg",
            filename=f"{voice_id}_preview.mp3"
        )
    else:
        raise HTTPException(status_code=500, detail="Failed to generate voice preview")


@router.get("/voices/by-id/{voice_id:path}", dependencies=[Depends(_dep_auth)])
async def get_voice_by_id(voice_id: str):
    """Resolve a Fish voice ID to its name + tags for display in UI components
    like the Character Profile popover. Returns 404 for unknown IDs (e.g.
    canonical keys like 'male-3' that aren't Fish IDs)."""
    if not fish_audio_tts.enabled:
        raise HTTPException(status_code=503, detail="Fish Audio not configured")
    try:
        client = fish_audio_tts._get_client()
        m = await client.voices.get(voice_id)
        return {
            "voice_id": voice_id,
            "name": getattr(m, "title", None) or "Unknown Voice",
            "tags": list(getattr(m, "tags", None) or []),
        }
    except Exception as e:
        logger.warning(f"Voice lookup failed for {voice_id}: {e}")
        raise HTTPException(status_code=404, detail="Voice not found")


# ---------------------------------------------------------------------------
# Custom voices — user-added Fish Audio / ElevenLabs voices, persisted to a
# JSON file and merged into the Voice Library so they can be assigned like any
# catalog voice. (Global list; wire to per-user storage when auth requires it.)
# ---------------------------------------------------------------------------

CUSTOM_VOICES_PATH = os.path.join("data", "custom_voices.json")


def _load_custom_voices() -> list:
    try:
        with open(CUSTOM_VOICES_PATH, "r", encoding="utf-8") as f:
            data = _json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _save_custom_voices(voices: list) -> None:
    os.makedirs(os.path.dirname(CUSTOM_VOICES_PATH), exist_ok=True)
    with open(CUSTOM_VOICES_PATH, "w", encoding="utf-8") as f:
        _json.dump(voices, f, indent=2, ensure_ascii=False)


# Max length of an UPLOADED video per plan, in seconds. Professional is absent
# from the map, meaning unlimited. Mirrors UPLOAD_DURATION_LIMITS in the
# frontend's lib/plan-features.ts — the client checks this too, for a fast
# rejection; this is the copy that actually enforces it.
# Monthly dubbing allowance in MINUTES, pooled across every video in the period.
# Mirrors PLAN_MINUTES in the frontend's lib/plan-features.ts — keep in step.
PLAN_MINUTES = {
    "basic":         60,
    "premium":      120,
    # 589 min (~9.8h) is a deliberate professional allowance, not a round
    # number: at the measured ~4.5c/min GPU+TTS it costs ~$26.51 against a
    # $149 plan, so a subscriber who maxes it every month still leaves ~82%
    # gross margin.
    "professional": 589,
}

# A single file may not exceed the whole monthly pool, so one upload can't
# swallow the billing period. Derived so the two can't drift apart.
UPLOAD_DURATION_LIMITS = {k: v * 60 for k, v in PLAN_MINUTES.items()}

# How many saved projects a plan may keep. Professional is absent, meaning
# unlimited. Mirrors PROJECT_LIMITS in the frontend's lib/plan-features.ts.
PROJECT_LIMITS = {
    "basic":   3,
    "premium": 10,
}

# How long a saved project survives, in days. Professional is absent, meaning
# permanent. Mirrors PROJECT_RETENTION_DAYS in lib/plan-features.ts.
PROJECT_RETENTION_DAYS = {
    "basic":   30,
    "premium": 90,
}

# Returned when the plan lookup itself fails, as distinct from "no subscription".
_PLAN_UNKNOWN = "__lookup_failed__"


def _plan_for_user(user_id: str) -> Optional[str]:
    """The caller's active plan, None if they have no subscription, or
    _PLAN_UNKNOWN if the lookup failed.

    The three cases are kept apart deliberately: no subscription should be
    treated as the most restrictive plan, but a Supabase blip should NOT
    suddenly cap a paying customer's upload — see the caller.
    """
    from app.services.supabase_client import supabase_writer
    try:
        res = supabase_writer.table("subscriptions") \
            .select("plan_type") \
            .eq("user_id", user_id) \
            .in_("status", ["active", "trialing"]) \
            .limit(1) \
            .execute()
        return res.data[0]["plan_type"] if res.data else None
    except Exception as e:
        logger.warning(f"[PLAN] lookup failed for {user_id}: {e}")
        return _PLAN_UNKNOWN


def _probe_video_duration(path: str) -> Optional[float]:
    """Duration in seconds via ffprobe, or None when it can't be read.

    Unreadable is NOT treated as over-length: better to accept a file we
    couldn't measure than to reject a valid one on our own limitation.
    """
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", path],
            capture_output=True, text=True, timeout=60,
        )
        val = out.stdout.strip()
        return float(val) if out.returncode == 0 and val else None
    except Exception as e:
        logger.warning(f"[UPLOAD] ffprobe failed for {path}: {e}")
        return None


def _require_plan(request: Request, allowed: tuple, feature: str) -> str:
    """Enforce plan entitlement server-side — mirrors the auth pattern in /ask-ai
    so a gated feature can't be reached by hitting the API directly. Raises 403 if
    the caller's active subscription plan isn't in `allowed`."""
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.removeprefix("Bearer ").strip()
    user_id = verify_jwt(token)
    from app.services.supabase_client import supabase_writer
    sub_result = supabase_writer.table("subscriptions") \
        .select("plan_type") \
        .eq("user_id", user_id) \
        .in_("status", ["active", "trialing"]) \
        .limit(1) \
        .execute()
    plan_type = sub_result.data[0]["plan_type"] if sub_result.data else None
    if plan_type not in allowed:
        raise HTTPException(status_code=403, detail=f"{feature} requires a Professional plan")
    return user_id


class CustomVoiceRequest(BaseModel):
    provider: str  # "fish-audio" | "elevenlabs"
    voice_id: str
    name: str = ""


@router.get("/voices/custom", dependencies=[Depends(_dep_auth)])
async def list_custom_voices():
    return {"voices": _load_custom_voices()}


@router.post("/voices/custom", dependencies=[Depends(_dep_auth)])
async def add_custom_voice(body: CustomVoiceRequest, request: Request):
    _require_plan(request, ("professional",), "Custom Voices")
    provider = (body.provider or "").lower().strip()
    voice_id = (body.voice_id or "").strip()
    if provider not in ("fish-audio", "elevenlabs"):
        raise HTTPException(status_code=422, detail="provider must be 'fish-audio' or 'elevenlabs'")
    if not voice_id:
        raise HTTPException(status_code=422, detail="voice_id is required")

    # Best-effort validation + name/tag lookup. Never hard-fail on lookup — the
    # id may be valid even if the metadata call errors; store what we can.
    name = (body.name or "").strip()
    tags: list = []
    try:
        if provider == "fish-audio" and fish_audio_tts.enabled:
            m = await fish_audio_tts._get_client().voices.get(voice_id)
            name = name or (getattr(m, "title", None) or "Custom Voice")
            tags = list(getattr(m, "tags", None) or [])
        elif provider == "elevenlabs":
            voices = await elevenlabs_tts.get_voices()
            match = next((v for v in voices if v.get("voice_id") == voice_id), None)
            if match:
                name = name or match.get("name") or "Custom Voice"
    except Exception as e:
        logger.warning(f"Custom voice validation failed for {provider}/{voice_id}: {e}")

    entry = {
        "voice_id": voice_id,
        "provider": provider,
        "name": name or "Custom Voice",
        "tags": tags,
        "custom": True,
    }
    voices = _load_custom_voices()
    # Replace any existing entry with the same provider+id, then put newest first.
    voices = [v for v in voices if not (v.get("voice_id") == voice_id and v.get("provider") == provider)]
    voices.insert(0, entry)
    _save_custom_voices(voices)
    return entry


CUSTOM_VOICE_SAMPLE_DIR = os.path.join("data", "custom_voice_samples")


def _custom_voice_sample_path(voice_id: str, ext: str) -> str:
    """Filesystem-safe path for a cloned voice's source clip.

    Voice ids come from an upstream provider and may contain slashes or other
    reserved characters, so hash rather than trusting them as a filename — the
    same approach /voice-preview already takes.
    """
    safe = hashlib.sha256(voice_id.encode("utf-8")).hexdigest()
    return os.path.join(CUSTOM_VOICE_SAMPLE_DIR, f"{safe}{ext}")


@router.get("/voices/custom/{voice_id:path}/sample", dependencies=[Depends(_dep_auth)])
async def get_custom_voice_sample(voice_id: str):
    """Serve the clip a voice was cloned from, so the panel can preview it.

    Media route: an <audio> element cannot send an Authorization header, so auth
    travels as access_token like every other media URL.
    """
    entry = next(
        (v for v in _load_custom_voices() if v.get("voice_id") == voice_id),
        None,
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Unknown voice")
    ext = entry.get("sample_ext")
    if not ext:
        # Cloned before samples were kept. Nothing to serve and nothing to fix.
        raise HTTPException(status_code=404, detail="No stored sample for this voice")
    path = _custom_voice_sample_path(voice_id, ext)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Sample file is missing")
    return FileResponse(path, media_type="audio/mpeg", filename=f"{entry.get('name', 'voice')}{ext}")


@router.delete("/voices/custom/{voice_id:path}", dependencies=[Depends(_dep_auth)])
async def delete_custom_voice(voice_id: str, provider: Optional[str] = None):
    voices = _load_custom_voices()
    before = len(voices)
    # Remove the stored clip too, or deleting a voice would leak its audio.
    for v in voices:
        if v.get("voice_id") == voice_id and v.get("sample_ext"):
            try:
                _p = _custom_voice_sample_path(voice_id, v["sample_ext"])
                if os.path.exists(_p):
                    os.remove(_p)
            except Exception as _e:
                logger.warning(f"[VOICE-DELETE] could not remove sample for {voice_id}: {_e}")
    voices = [
        v for v in voices
        if not (v.get("voice_id") == voice_id and (provider is None or v.get("provider") == provider))
    ]
    _save_custom_voices(voices)
    return {"status": "ok", "removed": before - len(voices)}


@router.post("/voices/clone")
async def clone_voice(
    request: Request,
    file: UploadFile = File(...),
    name: str = Form(""),
):
    """Clone a voice from an uploaded audio sample under DubMaster's OWN Fish Audio
    account, then add it to the custom-voices library.

    No user API keys or external accounts — the customer just uploads a short
    clip of the voice. The cloned model lives on the account we generate with, so
    it works everywhere immediately (assign, generate, export).
    """
    _require_plan(request, ("professional",), "Custom Voices")
    if not fish_audio_tts.enabled:
        raise HTTPException(status_code=503, detail="Voice cloning is not available right now")

    audio_bytes = await file.read()
    if not audio_bytes or len(audio_bytes) < 2000:
        raise HTTPException(
            status_code=422,
            detail="Please upload a clear audio sample — a few seconds of clean speech works best.",
        )

    title = (name or "").strip() or "My Voice"
    try:
        voice = await fish_audio_tts._get_client().voices.create(
            title=title,
            voices=[audio_bytes],
            visibility="private",
            train_mode="fast",
        )
    except Exception as e:
        logger.error(f"[VOICE-CLONE] failed: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail="Voice cloning failed — try a longer, cleaner sample.")

    voice_id = getattr(voice, "id", None)
    if not voice_id:
        raise HTTPException(status_code=502, detail="Voice cloning did not return a voice id.")

    # Keep the uploaded clip. It used to be discarded the moment it was sent to
    # Fish, which left a cloned voice with nothing to preview (so the panel had a
    # dead Preview button) and made re-cloning impossible without the original
    # file, which only the user had. Stored under the voice id so delete can find
    # it. Failure here must not fail the clone — the voice already exists upstream.
    sample_ext = os.path.splitext(file.filename or "")[1].lower() or ".mp3"
    if sample_ext not in (".mp3", ".wav", ".m4a", ".ogg", ".flac", ".webm"):
        sample_ext = ".mp3"
    try:
        os.makedirs(CUSTOM_VOICE_SAMPLE_DIR, exist_ok=True)
        with open(_custom_voice_sample_path(voice_id, sample_ext), "wb") as _sf:
            _sf.write(audio_bytes)
    except Exception as _e:
        logger.warning(f"[VOICE-CLONE] could not store sample for {voice_id}: {_e}")
        sample_ext = None

    entry = {
        "voice_id": voice_id,
        "provider": "fish-audio",
        "name": title,
        "tags": list(getattr(voice, "tags", None) or []),
        "custom": True,
        "cloned": True,
        # Extension of the stored source clip, or absent for voices cloned before
        # samples were kept — the endpoint 404s for those rather than guessing.
        **({"sample_ext": sample_ext} if sample_ext else {}),
    }
    voices = _load_custom_voices()
    voices = [v for v in voices if v.get("voice_id") != voice_id]
    voices.insert(0, entry)
    _save_custom_voices(voices)
    logger.info(f"[VOICE-CLONE] created '{title}' -> {voice_id}")
    return entry


# ---------------------------------------------------------------------------
# Quality Analysis endpoints
# ---------------------------------------------------------------------------

@router.post("/analyze/{job_id}/{language}", dependencies=[Depends(_dep_job_access)])
async def trigger_analysis(job_id: str, language: str, background_tasks: BackgroundTasks):
    """Trigger post-dub quality analysis. Returns 202 immediately."""
    job = await _get_or_rehydrate_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    lang_norm = language.lower().strip()
    dubbed_dir = Path(settings.DUBBED_DIR) / job_id
    dubbed_video = dubbed_dir / f"dubbed_{lang_norm}.mp4"
    if not dubbed_video.exists():
        raise HTTPException(
            status_code=404,
            detail=f"No dubbed video found for language '{lang_norm}'"
        )

    # Check if already running
    sentinel = dubbed_dir / f"analysis_{lang_norm}.running"
    if sentinel.exists():
        return JSONResponse(
            status_code=202,
            content={"status": "running", "message": "Analysis already in progress"}
        )

    from app.pipeline.analyze_dub import analyze_dub

    background_tasks.add_task(
        asyncio.to_thread,
        analyze_dub,
        job_id,
        lang_norm,
        job.video_path,
    )
    logger.info(f"Job {job_id}: quality analysis triggered for {lang_norm}")

    return JSONResponse(
        status_code=202,
        content={"status": "started", "message": "Quality analysis started"}
    )


@router.post("/analyze-segment/{job_id}/{segment_index}", dependencies=[Depends(_dep_job_access)])
async def analyze_segment(job_id: str, segment_index: int):
    """Verify a single segment's lip-sync WITHOUT requiring a full video rebuild.

    Analyze_dub's /analysis/{job_id}/{language} endpoint only ever reads
    dubbed_{lang}.mp4 (the fully assembled video) — a per-segment Fix that
    only writes segment_NNNN_regen.mp3 has zero effect on that file until a
    full Rebuild (remix) happens. Re-running the whole-video analysis after a
    single-segment fix would silently re-score stale, unchanged video content.
    This runs the same audio/mouth-movement correlation scoped to just this
    segment: mouth movement straight from the original source video (the
    on-screen mouth doesn't change when only the dub audio is regenerated),
    audio energy straight from the segment's freshly-regenerated audio file.
    """
    segments_path = os.path.join(settings.DUBBED_DIR, job_id, "segments.json")
    if not os.path.exists(segments_path):
        raise HTTPException(status_code=404, detail=f"segments.json not found for job {job_id}")

    with open(segments_path, "r", encoding="utf-8") as f:
        data = _json.load(f)

    video_path = data.get("video_path")
    if not video_path:
        raise HTTPException(status_code=404, detail="Original source video path not recorded for this job")

    seg = next((s for s in data.get("segments", []) if s.get("transcript_index") == segment_index), None)
    if seg is None:
        raise HTTPException(status_code=404, detail=f"Segment with transcript_index={segment_index} not found")

    audio_path = seg.get("path")
    if not audio_path or not os.path.exists(audio_path):
        raise HTTPException(status_code=404, detail="Segment audio file not found — regenerate it first")

    seg_start = seg.get("committed_start_time")
    seg_start = float(seg_start) if seg_start is not None else float(seg.get("start_time") or seg.get("start") or 0)
    seg_end = seg.get("committed_end_time")
    seg_end = float(seg_end) if seg_end is not None else float(seg.get("end_time") or seg.get("end") or 0)

    from app.services.syncnet_service import analyze_segment_lip_sync
    result = await asyncio.to_thread(analyze_segment_lip_sync, video_path, audio_path, seg_start, seg_end)
    if result is None:
        raise HTTPException(status_code=503, detail="Lip-sync analysis unavailable (OpenCV not installed) or source video missing")

    return result


@router.get("/analysis/{job_id}/{language}", dependencies=[Depends(_dep_job_access)])
async def get_analysis(job_id: str, language: str):
    """Get quality analysis results. 202 if running, 200 if complete, 404 if not triggered."""
    lang_norm = language.lower().strip()
    dubbed_dir = Path(settings.DUBBED_DIR) / job_id

    # Check sentinel first — but also detect stale sentinels (result file
    # already exists means the analysis finished but sentinel wasn't cleaned up).
    sentinel = dubbed_dir / f"analysis_{lang_norm}.running"
    result_file = dubbed_dir / f"analysis_{lang_norm}.json"
    if sentinel.exists():
        if result_file.exists():
            # Stale sentinel — analysis completed but cleanup didn't fire.
            try:
                sentinel.unlink(missing_ok=True)
            except Exception:
                pass
        else:
            return JSONResponse(
                status_code=202,
                content={"status": "running", "message": "Analysis in progress"}
            )

    if not result_file.exists():
        raise HTTPException(
            status_code=404,
            detail="Analysis not found. Trigger with POST /api/analyze/{job_id}/{language}"
        )

    with open(result_file, "r", encoding="utf-8") as f:
        analysis = _json.load(f)

    return {"status": "complete", "analysis": analysis}


# ---------------------------------------------------------------------------
# Per-segment emotion analysis — emotion2vec + Velma fallback, 50-chord model
# ---------------------------------------------------------------------------

# Natural next-emotion progression (mirrors frontend NEXT_EMOTION)
_NEXT_CHORD: Dict[str, str] = {
    "Anger": "Frustration", "Frustration": "Resentment", "Resentment": "Contempt",
    "Contempt": "Disgust", "Disgust": "Sadness", "Irritation": "Frustration",
    "Jealousy": "Resentment", "Fear": "Anxiety", "Anxiety": "Apprehension",
    "Apprehension": "Confusion", "Confusion": "Vulnerability",
    "Boredom": "Indifference", "Zeal": "Excitement", "Excitement": "Anticipation",
    "Anticipation": "Hope", "Hope": "Joy", "Surprise": "Curiosity",
    "Joy": "Delight", "Delight": "Euphoria", "Euphoria": "Excitement",
    "Love": "Tenderness", "Tenderness": "Compassion", "Compassion": "Empathy",
    "Empathy": "Gratitude", "Gratitude": "Trust", "Trust": "Serenity",
    "Serenity": "Contentment", "Contentment": "Acceptance", "Acceptance": "Serenity",
    "Awe": "Wonder", "Wonder": "Curiosity", "Curiosity": "Surprise",
    "Pride": "Confidence", "Confidence": "Determination", "Determination": "Courage",
    "Courage": "Pride", "Humility": "Acceptance", "Relief": "Contentment",
    "Sadness": "Grief", "Grief": "Loneliness", "Loneliness": "Longing",
    "Longing": "Yearning", "Yearning": "Pleading", "Pleading": "Desperation",
    "Desperation": "Despair", "Melancholy": "Longing", "Nostalgia": "Longing",
    "Regret": "Longing", "Vulnerability": "Pleading",
    "Shame": "Guilt", "Guilt": "Regret",
    "Despair": "Sadness", "Indifference": "Boredom",
}

_EMOTION_INTENSITY: Dict[str, float] = {
    "Anger": 0.92, "Frustration": 0.78, "Resentment": 0.72, "Contempt": 0.68,
    "Disgust": 0.70, "Irritation": 0.65, "Jealousy": 0.74, "Fear": 0.84,
    "Anxiety": 0.76, "Apprehension": 0.62, "Confusion": 0.50, "Boredom": 0.22,
    "Zeal": 0.80, "Excitement": 0.82, "Anticipation": 0.68, "Hope": 0.64,
    "Surprise": 0.78, "Joy": 0.85, "Delight": 0.80, "Euphoria": 0.95,
    "Love": 0.75, "Tenderness": 0.65, "Compassion": 0.68, "Empathy": 0.66,
    "Gratitude": 0.72, "Trust": 0.58, "Serenity": 0.55, "Contentment": 0.60,
    "Acceptance": 0.52, "Awe": 0.88, "Wonder": 0.82, "Curiosity": 0.70,
    "Pride": 0.82, "Confidence": 0.78, "Determination": 0.80, "Courage": 0.85,
    "Humility": 0.48, "Relief": 0.60, "Sadness": 0.32, "Grief": 0.28,
    "Loneliness": 0.30, "Melancholy": 0.35, "Nostalgia": 0.42, "Regret": 0.38,
    "Vulnerability": 0.40, "Shame": 0.42, "Guilt": 0.38, "Despair": 0.20,
    "Indifference": 0.25, "Resentment": 0.72,
    "Longing": 0.45, "Yearning": 0.60, "Pleading": 0.75, "Desperation": 0.90,
}

_EMOTION_COLOR: Dict[str, str] = {
    "Anger": "#ef4444", "Contempt": "#ef4444", "Disgust": "#ef4444",
    "Frustration": "#ef4444", "Resentment": "#ef4444", "Irritation": "#ef4444",
    "Jealousy": "#ef4444", "Anticipation": "#f59e0b", "Fear": "#f59e0b",
    "Surprise": "#f59e0b", "Excitement": "#f59e0b", "Anxiety": "#f59e0b",
    "Apprehension": "#f59e0b", "Zeal": "#f59e0b", "Boredom": "#f59e0b",
    "Confusion": "#f59e0b", "Hope": "#f59e0b", "Joy": "#22c55e",
    "Love": "#22c55e", "Pride": "#22c55e", "Trust": "#22c55e",
    "Gratitude": "#22c55e", "Euphoria": "#22c55e", "Delight": "#22c55e",
    "Contentment": "#22c55e", "Serenity": "#22c55e", "Awe": "#22c55e",
    "Wonder": "#22c55e", "Acceptance": "#22c55e", "Courage": "#22c55e",
    "Confidence": "#22c55e", "Relief": "#22c55e", "Empathy": "#22c55e",
    "Compassion": "#22c55e", "Tenderness": "#22c55e", "Determination": "#22c55e",
    "Humility": "#22c55e", "Sadness": "#a78bfa", "Shame": "#a78bfa",
    "Guilt": "#a78bfa", "Loneliness": "#a78bfa", "Nostalgia": "#a78bfa",
    "Regret": "#a78bfa", "Melancholy": "#a78bfa", "Vulnerability": "#a78bfa",
    "Despair": "#a78bfa", "Grief": "#a78bfa", "Indifference": "#a78bfa",
    "Longing": "#6B48FF", "Yearning": "#8B2FC9",
    "Pleading": "#F59E0B", "Desperation": "#DC2626",
}


def _build_progression(start_emotion: str, steps: int = 5) -> List[str]:
    """Follow NEXT_CHORD chain from start_emotion, up to `steps` unique emotions."""
    chain = [start_emotion]
    seen = {start_emotion}
    current = start_emotion
    for _ in range(steps - 1):
        nxt = _NEXT_CHORD.get(current)
        if not nxt or nxt in seen:
            break
        chain.append(nxt)
        seen.add(nxt)
        current = nxt
    return chain


class SegmentAnalyzeRequest(BaseModel):
    start_time: float
    end_time: float


@router.post("/jobs/{job_id}/rediarize-velma", dependencies=[Depends(_dep_job_access)])
async def rediarize_with_velma(job_id: str, request: Request):
    """
    Re-run Velma diarization on an existing job's source audio and patch
    velma_emotion (and velma_accent, velma_deepfake_score) back onto
    every segment in segments.json, both on disk and in Supabase.
    """
    if not os.getenv("MODULATE_API_KEY"):
        raise HTTPException(status_code=503, detail="MODULATE_API_KEY not configured")

    job = await _get_or_rehydrate_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    source_path = Path(job.video_path)
    if not source_path.exists():
        raise HTTPException(status_code=404, detail="Source video not found")

    # Run Velma on the full source audio
    logger.info(f"[REDIARIZE] Job {job_id}: running Velma on {source_path}")
    velma_result = await asyncio.to_thread(
        velma_diarize, str(source_path), job_id, 0
    )

    if not velma_result or velma_result.get("status") != "ok":
        reason = velma_result.get("error_message", "unknown") if velma_result else "no result"
        raise HTTPException(status_code=502, detail=f"Velma diarization failed: {reason}")

    velma_segs = velma_result.get("segments", [])
    logger.info(f"[REDIARIZE] Job {job_id}: Velma returned {len(velma_segs)} utterances")

    # Build a lookup: for each Velma utterance, find overlapping segments.json segments
    segments_path = os.path.join(settings.DUBBED_DIR, job_id, "segments.json")
    if not os.path.exists(segments_path):
        raise HTTPException(status_code=404, detail="segments.json not found for this job")

    with open(segments_path, "r", encoding="utf-8") as f:
        segments_doc = _json.load(f)

    # segments.json is {"job_id":..., "segments": [...]}
    disk_segs = segments_doc.get("segments", segments_doc) if isinstance(segments_doc, dict) else segments_doc

    patched = 0
    for ds in disk_segs:
        ds_start = float(ds.get("start_time", ds.get("start", 0)))
        ds_end = float(ds.get("end_time", ds.get("end", 0)))

        # Find the Velma utterance with the most overlap
        best_overlap = 0.0
        best_velma = None
        for vs in velma_segs:
            vs_start = float(vs.get("start", 0))
            vs_end = float(vs.get("end", 0))
            overlap = max(0.0, min(ds_end, vs_end) - max(ds_start, vs_start))
            if overlap > best_overlap:
                best_overlap = overlap
                best_velma = vs

        if best_velma and best_overlap > 0.1:
            if best_velma.get("emotion"):
                ds["velma_emotion"] = best_velma["emotion"]
                patched += 1
            if best_velma.get("accent"):
                ds["velma_accent"] = best_velma["accent"]
            if best_velma.get("deepfake_score") is not None:
                ds["velma_deepfake_score"] = best_velma["deepfake_score"]

    # Write patched segments back to disk (preserve wrapper doc)
    if isinstance(segments_doc, dict) and "segments" in segments_doc:
        segments_doc["segments"] = disk_segs
        write_data = segments_doc
    else:
        write_data = disk_segs
    atomic_write_json(segments_path, write_data)

    # Update in-memory job transcript segments too
    if job.transcript and job.transcript.segments:
        for ts in job.transcript.segments:
            best_overlap = 0.0
            best_velma = None
            for vs in velma_segs:
                vs_start = float(vs.get("start", 0))
                vs_end = float(vs.get("end", 0))
                overlap = max(0.0, min(ts.end, vs_end) - max(ts.start, vs_start))
                if overlap > best_overlap:
                    best_overlap = overlap
                    best_velma = vs
            if best_velma and best_overlap > 0.1 and best_velma.get("emotion"):
                ts.velma_emotion = best_velma["emotion"]

    logger.info(f"[REDIARIZE] Job {job_id}: patched velma_emotion on {patched}/{len(disk_segs)} segments")

    return {
        "status": "ok",
        "job_id": job_id,
        "velma_utterances": len(velma_segs),
        "segments_patched": patched,
        "total_segments": len(disk_segs),
    }


# emotion2vec label → chord emotion name (frame-level real analysis path)
_E2V_TO_CHORD_ROUTE: Dict[str, str] = {
    "angry": "Anger",
    "disgusted": "Contempt",
    "fearful": "Fear",
    "happy": "Excitement",
    "neutral": "Serenity",
    "other": "Serenity",
    "sad": "Sadness",
    "surprised": "Surprise",
    "unknown": "Serenity",
}


async def _analyze_segment_with_emotion2vec(job, start_time: float, end_time: float) -> Optional[Dict]:
    """
    Real frame-level emotion curve: slice the segment's audio out of the
    source video, run emotion2vec in a sliding window across it, map each
    window's dominant emotion to the chord scale, and resample into the
    50-point curve. Returns None (caller falls back to Velma synthesis)
    if the source audio is unavailable or analysis fails.
    """
    try:
        from app.services import emotion2vec_service
        if not emotion2vec_service.is_enabled():
            return None

        video_path = getattr(job, "video_path", None)
        if not video_path or not os.path.exists(video_path):
            return None

        duration = end_time - start_time
        if duration < 0.5:
            return None

        # Prefer Demucs-separated vocals (cached from the main dub pipeline)
        # over the raw mixed track. Background score / fight-scene effects
        # dilute the vocal emotional signal and bias the model toward
        # "neutral" — see _analyze_segment_with_emotion2vec investigation.
        # No on-demand Demucs here (3-8 min run) — only use if already cached.
        job_id = getattr(job, "job_id", None)
        source_path = video_path
        if job_id:
            vocals_candidate = os.path.join("data", "separated", f"{job_id}_vocals.wav")
            if os.path.exists(vocals_candidate) and os.path.getsize(vocals_candidate) > 1000:
                source_path = vocals_candidate
                logger.info(f"[EMOTION2VEC-CHORD] using cached separated vocals for {job_id}")
            else:
                logger.info(f"[EMOTION2VEC-CHORD] no vocals cache — using raw video for {job_id}")

        logger.info(f"[EMOTION2VEC] analyzing file: {source_path} (seg {start_time:.2f}–{end_time:.2f}s)")

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp_path = tmp.name
        try:
            cmd = [
                "ffmpeg", "-y", "-ss", str(start_time), "-t", str(duration),
                "-i", source_path, "-vn", "-ar", "16000", "-ac", "1", "-f", "wav", tmp_path,
            ]
            proc = await asyncio.to_thread(
                subprocess.run, cmd, capture_output=True, timeout=30
            )
            if proc.returncode != 0 or not os.path.exists(tmp_path) or os.path.getsize(tmp_path) < 1000:
                logger.warning(f"[EMOTION2VEC-CHORD] audio slice extraction failed: {proc.stderr.decode(errors='ignore')[:200]}")
                return None

            windows = await asyncio.to_thread(
                emotion2vec_service.analyze_sliding_window, tmp_path, 200, 200
            )
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

        if not windows or len(windows) < 2:
            return None

        # Resample window-level dominant emotions into a 50-point curve
        _SKIP_LABELS = {"neutral", "other", "unknown"}
        curve = [0.05] * 50
        chord_at_point: List[str] = []
        for w in windows:
            scores = w["scores"]
            top_label = max(
                (k for k in scores if k not in _SKIP_LABELS),
                key=lambda k: scores[k],
                default=max(scores, key=lambda k: scores[k]),
            )
            top_score = scores[top_label]
            chord_emotion = _E2V_TO_CHORD_ROUTE.get(top_label, "Serenity")
            chord_at_point.append(chord_emotion)
            idx = min(49, int(w["t"] * 49))
            intensity = max(0.05, min(1.0, top_score))
            curve[idx] = max(curve[idx], intensity)

        # Fill gaps between sampled points by linear interpolation
        known = [i for i in range(50) if curve[i] > 0.05]
        if known:
            for i in range(50):
                if curve[i] <= 0.05:
                    prev_pts = [k for k in known if k <= i]
                    next_pts = [k for k in known if k >= i]
                    if prev_pts and next_pts:
                        p, n = prev_pts[-1], next_pts[0]
                        if n == p:
                            curve[i] = curve[p]
                        else:
                            frac = (i - p) / (n - p)
                            curve[i] = curve[p] * (1 - frac) + curve[n] * frac

        # Ease in/out from a neutral baseline at the very start and end —
        # matches the old synthetic curves' 10% lead-in/lead-out margin so
        # the line doesn't start or end "hot" from the first/last raw sample.
        baseline = 0.08
        ease_points = 5  # 10% of 50
        anchor_start = curve[ease_points]
        anchor_end = curve[49 - ease_points]
        for i in range(ease_points):
            frac = i / ease_points
            curve[i] = baseline * (1 - frac) + anchor_start * frac
        for i in range(50 - ease_points, 50):
            frac = (49 - i) / ease_points
            curve[i] = baseline * (1 - frac) + anchor_end * frac

        # Primary emotion = most frequent dominant chord across windows
        from collections import Counter
        counts = Counter(chord_at_point)
        primary, primary_count = counts.most_common(1)[0]
        primary_score = round(primary_count / len(chord_at_point), 4)

        # Markers — sample 5 evenly-spaced points (matches the old Velma
        # chain's fixed step count, which the bottom strip/chip UI expects)
        # using the REAL measured dominant chord nearest each position,
        # not a synthetic progression. Guarantees a non-empty marker set
        # even when the audio is dominated by one or two repeating chords.
        NUM_MARKER_POINTS = 5
        markers = []
        for i in range(NUM_MARKER_POINTS):
            xfrac = i / (NUM_MARKER_POINTS - 1) if NUM_MARKER_POINTS > 1 else 0.5
            nearest_w = min(windows, key=lambda w: abs(w["t"] - xfrac))
            _ns = nearest_w["scores"]
            _marker_label = max(
                (k for k in _ns if k not in _SKIP_LABELS),
                key=lambda k: _ns[k],
                default=max(_ns, key=lambda k: _ns[k]),
            )
            chord_emotion = _E2V_TO_CHORD_ROUTE.get(_marker_label, "Serenity")
            idx = min(49, int(xfrac * 49))
            markers.append({
                "emotion": chord_emotion,
                "intensity": round(curve[idx], 4),
                "color": _EMOTION_COLOR.get(chord_emotion, "#60a5fa"),
                "xFrac": round(xfrac, 4),
            })

        return {
            "status": "ok",
            "primary_emotion": primary,
            "primary_score": primary_score,
            "chain": list(dict.fromkeys(chord_at_point)),  # dedupe, preserve order
            "curve": [round(v, 4) for v in curve],
            "markers": markers,
            "top_emotions": counts.most_common(8),
            "analysis_method": "emotion2vec-sliding-window",
            "window_count": len(windows),
        }

    except Exception as exc:
        logger.warning(f"[EMOTION2VEC-CHORD] analysis failed, falling back to Velma: {exc}")
        return None


@router.post("/emotion/analyze-segment/{job_id}", dependencies=[Depends(_dep_job_access)])
async def emotion_analyze_segment(job_id: str, body: SegmentAnalyzeRequest):
    """
    Build a 50-point emotion curve from Velma emotion labels on overlapping
    transcript segments, mapped to DubMaster's 50-chord model.
    """
    # Velma emotion label → chord emotion name
    _VELMA_TO_CHORD: Dict[str, str] = {
        "angry": "Anger", "anger": "Anger",
        "happy": "Excitement", "happiness": "Excitement", "excited": "Excitement",
        "joy": "Joy", "joyful": "Joy",
        "sad": "Sadness", "sadness": "Sadness", "sorrow": "Sadness",
        "fear": "Fear", "fearful": "Fear", "scared": "Fear",
        "surprised": "Surprise", "surprise": "Surprise",
        "disgusted": "Disgust", "disgust": "Disgust",
        "contempt": "Contempt",
        "neutral": "Serenity", "calm": "Serenity", "serenity": "Serenity",
        "concerned": "Anxiety", "worried": "Anxiety",
        "excited": "Excitement",
        "anxious": "Anxiety", "anxiety": "Anxiety",
        "frustrated": "Frustration", "frustration": "Frustration",
        "curious": "Curiosity", "curiosity": "Curiosity",
        "confused": "Confusion", "confusion": "Confusion",
        "determined": "Determination", "determination": "Determination",
        "hopeful": "Hope", "hope": "Hope",
        "loving": "Love", "love": "Love",
        "proud": "Pride", "pride": "Pride",
        "guilty": "Guilt", "guilt": "Guilt",
        "ashamed": "Shame", "shame": "Shame",
        "grateful": "Gratitude", "gratitude": "Gratitude",
        "bored": "Boredom", "boredom": "Boredom",
        "nostalgic": "Nostalgia", "nostalgia": "Nostalgia",
        "lonely": "Loneliness", "loneliness": "Loneliness",
        "enthusiastic": "Zeal", "zeal": "Zeal",
        "awe": "Awe", "amazed": "Awe",
        "relieved": "Relief", "relief": "Relief",
        "grief": "Grief", "grieving": "Grief",
        "melancholy": "Melancholy",
        "delight": "Delight", "delighted": "Delight",
        "longing": "Longing", "yearning": "Yearning",
        "pleading": "Pleading", "begging": "Pleading", "imploring": "Pleading",
        "desperate": "Desperation", "desperation": "Desperation", "frantic": "Desperation",
        # Velma-specific title-case labels (lowercased before lookup)
        "confident": "Confidence", "amused": "Delight",
        "afraid": "Fear", "contemptuous": "Contempt",
        "nervous": "Anxiety", "sarcastic": "Contempt",
        "excited": "Excitement", "indifferent": "Indifference",
        "sympathetic": "Compassion", "empathetic": "Empathy",
        "disappointed": "Sadness", "regretful": "Regret",
        "disgusted": "Disgust", "condescending": "Contempt",
    }

    job = await _get_or_rehydrate_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if float(body.end_time) - float(body.start_time) < 0.5:
        return {"status": "too_short", "reason": "Segment under 0.5s — too short to analyze"}

    # --- Try real frame-level analysis first: emotion2vec sliding window ---
    e2v_curve_result = await _analyze_segment_with_emotion2vec(
        job, float(body.start_time), float(body.end_time)
    )
    if e2v_curve_result:
        return e2v_curve_result

    # --- Fallback: synthesize curve from Velma's per-utterance labels ---
    # Build curve from Velma emotion labels on overlapping transcript segments
    chord_votes: Dict[str, float] = {}
    if job.transcript and job.transcript.segments:
        overlapping = [
            s for s in job.transcript.segments
            if s.velma_emotion and s.end > body.start_time and s.start < body.end_time
        ]
        for seg in overlapping:
            label = (seg.velma_emotion or "").lower().strip()
            chord_emotion = _VELMA_TO_CHORD.get(label)
            if chord_emotion:
                # Weight by how much of the segment overlaps
                overlap = min(seg.end, body.end_time) - max(seg.start, body.start_time)
                chord_votes[chord_emotion] = chord_votes.get(chord_emotion, 0.0) + overlap

    # Track provenance: a curve synthesized from real Velma labels is a weak but
    # genuine signal; the Excitement default below is not a reading of anything.
    # Both used to return status "ok" with no way for the caller to tell them
    # apart, so fabricated emotion reached the voice looking like analysis.
    analysis_method = "velma-labels"
    if not chord_votes:
        # No Velma emotion data — fall back to Excitement as neutral starting point
        logger.warning(f"[VELMA-CHORD] No velma_emotion found for {job_id} [{body.start_time}-{body.end_time}], using Excitement fallback")
        chord_votes = {"Excitement": 1.0}
        analysis_method = "no-data-fallback"

    # Normalise votes to scores
    total = sum(chord_votes.values()) or 1.0
    chord_scores: Dict[str, float] = {k: round(v / total, 4) for k, v in chord_votes.items()}

    # Primary emotion = highest weighted chord emotion
    primary = max(chord_scores, key=lambda k: chord_scores[k])
    primary_score = chord_scores[primary]

    # Build 5-step progression chain
    chain = _build_progression(primary, steps=5)

    # Build gaussian curve (50 points, one additive peak per chord)
    import math
    n = len(chain)
    positions = [0.5 if n == 1 else 0.10 + (i / (n - 1)) * 0.80 for i in range(n)]
    sigma = 0.055
    curve = [0.05] * 50
    for chord_emotion, xfrac in zip(chain, positions):
        target = _EMOTION_INTENSITY.get(chord_emotion, 0.5)
        for idx in range(50):
            t = idx / 49
            dist = t - xfrac
            w = math.exp(-(dist * dist) / (2 * sigma * sigma))
            curve[idx] = min(1.0, curve[idx] + w * target)

    # Build markers
    markers = []
    for i, chord_emotion in enumerate(chain):
        xfrac = positions[i]
        pos_idx = xfrac * 49
        lo = int(pos_idx)
        hi = min(lo + 1, 49)
        frac = pos_idx - lo
        intensity = curve[lo] * (1 - frac) + curve[hi] * frac
        markers.append({
            "emotion": chord_emotion,
            "intensity": round(intensity, 4),
            "color": _EMOTION_COLOR.get(chord_emotion, "#60a5fa"),
            "xFrac": round(xfrac, 4),
        })

    return {
        "status": "ok",
        "primary_emotion": primary,
        "primary_score": round(primary_score, 4),
        "chain": chain,
        "curve": [round(v, 4) for v in curve],
        "markers": markers,
        "top_emotions": sorted(chord_scores.items(), key=lambda x: x[1], reverse=True)[:8],
        # Was hardcoded "velma", which credited Velma even when the Excitement
        # default fired and nothing had been analysed at all.
        "analysis_method": analysis_method,
    }


@router.post("/dub/remix/{job_id}", dependencies=[Depends(_dep_job_access)])
async def remix_dub(job_id: str, request: Request):
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.removeprefix("Bearer ").strip()
    user_id = verify_jwt(token)

    # Sync committed segment manifest from Supabase to disk
    # before remix pipeline reads segments.json
    try:
        from app.services.supabase_client import sync_committed_segments_to_disk
        from app.config import get_settings as _get_settings
        _settings = _get_settings()
        segments_path = os.path.join(
            _settings.DUBBED_DIR, job_id, "segments.json"
        )
        await sync_committed_segments_to_disk(
            job_id=job_id,
            segments_path=segments_path,
            dubbed_dir=_settings.DUBBED_DIR,
        )
    except Exception as _exc:
        logger.warning(f"Job {job_id}: pre-remix sync failed: {_exc}")

    try:
        result = await dubbing_service.remix_dub(job_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    # The retention clock starts HERE — at render completion, not at upload and
    # not at save. Once the film exists, the customer has what they came for and
    # we hold their source material, dialogue and audio for a bounded window and
    # no longer. Nothing is exempt: no plan tier, no "saved project" status.
    # Re-rendering restamps it, so a film the user is still working on does not
    # expire underneath them.
    _stamp_purge_deadline(job_id)
    return result


@router.post("/jobs/{job_id}/retranslate", dependencies=[Depends(_dep_job_access)])
async def retranslate_job(job_id: str, request: Request):
    """Re-run translation only against the existing Velma transcript stored in Supabase.

    Does NOT trigger TTS or audio rebuild. Updates translated_text, adapted_text,
    and committed_adapted_text on every segment so the next remix picks up the
    corrected script. Returns the updated segment array in ~10 seconds.
    """
    import json as _json
    from app.services.supabase_client import supabase, supabase_writer, verify_jwt
    from app.services.translation_service import translation_service as _ts

    auth_header = request.headers.get("Authorization", "")
    token = auth_header.removeprefix("Bearer ").strip()
    verify_jwt(token)

    # 1. Load job for language info and character profiles
    job = await _get_or_rehydrate_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    target_lang = normalize_language_code(
        getattr(job, "target_language", None) or "en"
    )

    # Determine source language — prefer the on-disk transcript's detected language
    # over the job object's stored value, since Velma's direct detection is more
    # accurate than what the UI might have stored (e.g. "zh-TW" vs "yue").
    _transcript_lang = None
    _tr_lang_path = os.path.join("data", "transcripts", f"{job_id}.json")
    if os.path.exists(_tr_lang_path):
        try:
            with open(_tr_lang_path, "r", encoding="utf-8") as _tlf:
                _tr_lang_data = _json.load(_tlf)
            _transcript_lang = _tr_lang_data.get("language") or _tr_lang_data.get("source_language")
        except Exception:
            pass

    _job_source = getattr(job, "source_language", None)
    _raw_source = _transcript_lang or _job_source or "yue"
    source_lang = normalize_language_code(_raw_source, allow_auto=True)

    # If normalized to generic "zh" but transcript explicitly detected Cantonese,
    # upgrade to "yue" so the LLM path triggers correctly.
    if source_lang == "zh" and _transcript_lang and "yue" in _transcript_lang.lower():
        source_lang = "yue"

    logger.info(f"[RETRANSLATE] job={job_id} source: transcript={_transcript_lang!r} job={_job_source!r} → using {source_lang!r}")

    if source_lang == target_lang:
        raise HTTPException(
            status_code=400,
            detail=f"Source and target language are the same ({source_lang}); nothing to translate"
        )

    # 2. Load Cantonese source from the on-disk transcript (authoritative source).
    # NOTE: Supabase segments.source_text holds the post-translation English because
    # upsert_segments is called after TTS, not before — so we MUST read the original
    # transcript file to get the CJK source text for re-translation.
    _transcript_path = os.path.join("data", "transcripts", f"{job_id}.json")
    _segments_path = os.path.join(settings.DUBBED_DIR, job_id, "segments.json")

    segments = []

    if os.path.exists(_transcript_path):
        try:
            with open(_transcript_path, "r", encoding="utf-8") as tf:
                _tr = _json.load(tf)
            _tr_segs = _tr.get("segments", [])
            for i, s in enumerate(_tr_segs):
                src = s.get("text", "").strip()
                if not src:
                    continue
                segments.append({
                    "segment_id": str(i),
                    "text": src,
                    "source_text": src,
                    "start": s.get("start", 0.0),
                    "end": s.get("end", 0.0),
                    "speaker": s.get("speaker", "speaker-1"),
                    "velma_emotion": s.get("velma_emotion"),
                    "velma_accent": s.get("velma_accent"),
                })
            logger.info(f"[RETRANSLATE] Loaded {len(segments)} source segments from transcript file")
        except Exception as exc:
            logger.warning(f"[RETRANSLATE] Could not load transcript file: {exc}")

    if not segments:
        raise HTTPException(
            status_code=404,
            detail="No source transcript found for this job. Re-run the full pipeline first."
        )

    # 3. Load Velma context if available (feeds character/scene context into prompt)
    velma_context = None
    _velma_path = os.path.join("data", "velma", f"{job_id}.json")
    if os.path.exists(_velma_path):
        try:
            with open(_velma_path, "r", encoding="utf-8") as vf:
                velma_context = _json.load(vf)
        except Exception:
            pass

    # 4. Run translation
    logger.info(f"[RETRANSLATE] job={job_id} segments={len(segments)} {source_lang}→{target_lang}")
    try:
        translated = await _ts.translate_segments(
            segments,
            source_lang,
            target_lang,
            character_profiles=getattr(job, "character_profiles", None),
            velma_context=velma_context,
        )
    except Exception as exc:
        logger.error(f"[RETRANSLATE] Translation failed for job {job_id}: {exc}")
        raise HTTPException(status_code=500, detail=f"Translation failed: {exc}")

    # Sentence split: expand multi-sentence segments into one per sentence.
    # Build the original-id → sub-segments map BEFORE re-indexing so we can
    # reconstruct segments.json correctly.
    from app.services.translation_service import split_translated_sentences
    _pre_split = len(translated)
    translated = split_translated_sentences(translated)
    _orig_to_new: dict = {}
    for _seg in translated:
        _orig_id = _seg.get("original_segment_id") or _seg.get("segment_id", "")
        try:
            _orig_idx = int(str(_orig_id))
        except (ValueError, TypeError):
            _orig_idx = -1
        if _orig_idx >= 0:
            _orig_to_new.setdefault(_orig_idx, []).append(_seg)
    if len(translated) != _pre_split:
        logger.info(f"[RETRANSLATE] Sentence split: {_pre_split} → {len(translated)} segments")
    # Re-index sequentially after split so Supabase sequence numbers are contiguous
    for _i, _seg in enumerate(translated):
        _seg["segment_id"] = str(_i)

    # Locked corrections keyed by ORIGINAL transcript_index, read before 5a runs.
    # 5b keys its rows by the post-split sequential segment_id assigned just
    # above, which diverges from transcript_index the moment one utterance
    # splits — so 5b cannot find a correction by its own row index without this.
    _locked_by_ti: Dict[Any, str] = {}
    try:
        if os.path.exists(_segments_path):
            with open(_segments_path, "r", encoding="utf-8") as _cf:
                for _s in _json.load(_cf).get("segments", []):
                    if _s.get("text_locked") and _s.get("committed_adapted_text"):
                        _locked_by_ti[_s.get("transcript_index")] = _s["committed_adapted_text"]
    except Exception as _exc:
        logger.warning(f"[RETRANSLATE] Could not read locked text: {_exc}")

    _new_id_to_orig: Dict[int, Any] = {}
    for _oti, _subs in _orig_to_new.items():
        for _s in _subs:
            try:
                _new_id_to_orig[int(_s["segment_id"])] = _oti
            except (ValueError, KeyError, TypeError):
                pass

    # 5a. Rebuild on-disk segments.json — replace split parent entries with sub-segments
    # so the editor sees one bubble per sentence without waiting for a full rebuild.
    #
    # Group by transcript_index rather than raw list position. Every sub-segment
    # born from one original utterance's split carries that utterance's
    # transcript_index (see the fan-out below), so after the FIRST retranslate
    # ever splits an utterance, one original index occupies N consecutive list
    # slots instead of exactly one — enumerate()-based position matching then
    # permanently misaligns with _orig_to_new's utterance-indexed keys. A
    # second retranslate would insert a freshly-recalculated split at the
    # correct utterance's position while leaving the FIRST split's now-stale
    # entries (still carrying their old start/end) orphaned elsewhere in the
    # list — exactly the false "overlapping segments" seen in the editor,
    # since those orphans' old timestamps collide with the new ones.
    try:
        if os.path.exists(_segments_path):
            with open(_segments_path, "r", encoding="utf-8") as sf:
                _seg_data = _json.load(sf)
            _disk_segs = _seg_data.get("segments", [])
            _groups: Dict[Any, list] = {}
            for disk_seg in _disk_segs:
                _groups.setdefault(disk_seg.get("transcript_index"), []).append(disk_seg)

            # Re-translated text invalidates whatever audio a segment carries: that
            # clip was synthesised for the OLD text, at the OLD index. Leaving it
            # attached makes the editor PLAY and MAKE MOVIE RENDER a line whose
            # audio says something else — observed as "go go" (TTS reading the
            # untranslated Cantonese) and lines borrowed from elsewhere in the film.
            # Clearing it turns a silent corruption into a visible regenerate-me state.
            def _invalidate_audio(_d: dict) -> dict:
                _d["path"] = ""
                _d["committed_audio_url"] = None
                _d["audio_url"] = None
                _d["rpt_dirty"] = True
                return _d

            new_disk_segs: list = []
            for _ti, _group in _groups.items():
                sub_segs = _orig_to_new.get(_ti)
                if not sub_segs:
                    new_disk_segs.extend(_group)
                    continue
                # A committed human correction outranks retranslation. Skip the
                # whole group rather than refreshing text or timing piecemeal:
                # re-splitting a hand-written line along the AI's new sentence
                # boundaries is incoherent, and freezing text while refreshing
                # timing would re-open the text/timing desync this rebuild exists
                # to prevent. Frozen together, the pair stays self-consistent.
                if any(s.get("text_locked") for s in _group):
                    new_disk_segs.extend(_group)
                    continue
                base = _group[0]
                _old_text = base.get("text", "")
                if len(sub_segs) == 1 and not sub_segs[0].get("auto_split"):
                    # No split — update text AND timing in place, dropping any
                    # stale siblings this group may still be carrying from a
                    # prior split. Timing must be refreshed too, not just text:
                    # if an earlier retranslate/manual transcript edit shifted
                    # where this utterance falls (e.g. splitting an earlier
                    # segment shifted every later transcript_index by one),
                    # the disk entry's old start/end no longer corresponds to
                    # the utterance this text describes — only updating text
                    # would silently re-desync text from timing again, exactly
                    # the bug this whole rebuild exists to prevent.
                    base["text"] = sub_segs[0].get("text", base.get("text", ""))
                    base["start"] = sub_segs[0].get("start", base.get("start"))
                    base["end"] = sub_segs[0].get("end", base.get("end"))
                    base["original_text"] = base.get("original_text") or base["text"]
                    if base["text"] != _old_text:
                        _invalidate_audio(base)
                    new_disk_segs.append(base)
                else:
                    # Sentence was split — replace the ENTIRE group (fresh split
                    # and any stale siblings from a prior split alike) with one
                    # disk entry per current sub-sentence.
                    for sub in sub_segs:
                        # A split ALWAYS changes text: every child would otherwise
                        # inherit the parent's single clip, so three sentences would
                        # all play the same wrong audio.
                        new_disk_segs.append(_invalidate_audio({
                            **base,
                            "text":       sub.get("text", ""),
                            "start":      sub.get("start", base.get("start")),
                            "end":        sub.get("end",   base.get("end")),
                            "auto_split": True,
                        }))
            _seg_data["segments"] = new_disk_segs
            atomic_write_json(_segments_path, _seg_data)
            logger.info(f"[RETRANSLATE] Rebuilt segments.json: {len(_disk_segs)} → {len(new_disk_segs)} entries")
    except Exception as exc:
        logger.warning(f"[RETRANSLATE] Could not update segments.json: {exc}")

    # 5b. Upsert to Supabase with correct source_text (CJK) and new translated_text
    try:
        rows = []
        for seg in translated:
            idx = int(seg.get("segment_id", -1))
            if idx < 0:
                continue
            new_text = seg.get("text") or ""
            src_text = seg.get("source_text") or seg.get("original_text") or ""
            _locked = _locked_by_ti.get(_new_id_to_orig.get(idx))
            rows.append({
                "job_id": job_id,
                "sequence": idx,
                "source_text": src_text,
                "translated_text": new_text,
                "adapted_text": new_text,
                # Never clobber a locked correction: sync_committed_segments_to_disk
                # would faithfully restore the AI line onto disk on the next remix,
                # turning the committed-wins path into the delivery mechanism.
                "committed_adapted_text": _locked or new_text,
                "start_time": seg.get("start", 0.0),
                "end_time": seg.get("end", 0.0),
                "speaker": seg.get("speaker", "speaker-1"),
            })
        if rows:
            supabase_writer.table("segments").upsert(
                rows, on_conflict="job_id,sequence"
            ).execute()
        logger.info(f"[RETRANSLATE] Upserted {len(rows)} segments to Supabase")
    except Exception as exc:
        logger.warning(f"[RETRANSLATE] Supabase write failed (non-fatal): {exc}")

    return {
        "job_id": job_id,
        "source_language": source_lang,
        "target_language": target_lang,
        "segments_updated": len(translated),
        "segments": translated,
    }


class ExportRequest(BaseModel):
    resolution: str = "1080p"   # "720p" | "1080p" | "4k"
    aspect: str = "widescreen"  # "widescreen" | "fill"
    format: str = "mp4"         # "mp4" | "mov" | "avi" | "mkv"


# In-memory export progress store: export_id → {status, pct, filename, download_url, job_id}
_export_progress: Dict[str, Dict] = {}

RESOLUTION_MAP = {
    "720p":  (1280, 720),
    "1080p": (1920, 1080),
    "4k":    (3840, 2160),
}

FORMAT_MAP = {
    "mp4": {"ext": "mp4",  "vcodec": "libx264", "acodec": "aac",  "extra": ["-movflags", "+faststart"]},
    "mov": {"ext": "mov",  "vcodec": "libx264", "acodec": "aac",  "extra": []},
    "avi": {"ext": "avi",  "vcodec": "mpeg4",   "acodec": "libmp3lame", "extra": []},
    "mkv": {"ext": "mkv",  "vcodec": "libx264", "acodec": "aac",  "extra": []},
}


@router.post("/dub/export/{job_id}", dependencies=[Depends(_dep_job_access)])
async def export_video(job_id: str, body: ExportRequest, request: Request):
    """Export the dubbed video — stream-copies when no re-encode is needed, re-encodes otherwise."""
    import subprocess as _sp
    import json as _json
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.removeprefix("Bearer ").strip()
    verify_jwt(token)

    output_dir = os.path.join(settings.DUBBED_DIR, job_id)
    if not os.path.isdir(output_dir):
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    candidates = [
        f for f in os.listdir(output_dir)
        if f.startswith("dubbed_") and f.endswith(".mp4")
        and not f.startswith("dubbed_rpt_")
    ]
    if not candidates:
        raise HTTPException(status_code=404, detail="No dubbed video found")

    src = os.path.join(output_dir, candidates[0])

    res = body.resolution.lower().replace(" ", "")
    if res not in RESOLUTION_MAP:
        raise HTTPException(status_code=400, detail=f"Unknown resolution: {body.resolution}")
    w, h = RESOLUTION_MAP[res]

    fmt = body.format.lower()
    if fmt not in FORMAT_MAP:
        raise HTTPException(status_code=400, detail=f"Unknown format: {body.format}")
    fmap = FORMAT_MAP[fmt]

    out_filename = f"export_{res}_{body.aspect}.{fmap['ext']}"
    out_path = os.path.join(output_dir, out_filename)

    # ── Probe source dimensions and codec ───────────────────────────────────
    src_w, src_h, src_vcodec = 0, 0, ""
    try:
        probe = await asyncio.to_thread(
            _sp.run,
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height,codec_name",
             "-of", "json", src],
            capture_output=True, text=True, timeout=30,
        )
        streams = _json.loads(probe.stdout).get("streams", [{}])
        if streams:
            src_w      = streams[0].get("width", 0)
            src_h      = streams[0].get("height", 0)
            src_vcodec = streams[0].get("codec_name", "")
    except Exception as _pe:
        logger.warning(f"[EXPORT] ffprobe failed ({_pe}), falling back to re-encode")

    # ── Decide: stream copy vs re-encode ────────────────────────────────────
    # Stream copy is safe when:
    #   1. Requested dimensions match the source (no scaling needed)
    #   2. Output container accepts H264/AAC streams (mp4/mov/mkv — not avi/webm)
    #   3. Source video is H264 (the standard output from our pipeline)
    _COPY_SAFE_FORMATS = {"mp4", "mov", "mkv"}
    dimensions_match = (src_w == w and src_h == h)
    format_compatible = fmt in _COPY_SAFE_FORMATS
    codec_compatible  = src_vcodec in ("h264", "hevc", "")

    use_stream_copy = dimensions_match and format_compatible and codec_compatible

    if use_stream_copy:
        cmd = [
            "ffmpeg", "-y", "-i", src,
            "-vcodec", "copy",
            "-acodec", "copy",
        ] + fmap["extra"] + [out_path]
        logger.info(f"[EXPORT] job={job_id} stream-copy → {out_filename} "
                    f"(src={src_w}×{src_h} {src_vcodec})")
    else:
        # Re-encode with ultrafast preset and CRF 23 (broadcast quality, fast)
        if body.aspect == "fill":
            vf = f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h}"
        else:
            vf = f"scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2"
        cmd = [
            "ffmpeg", "-y", "-i", src,
            "-vf", vf,
            "-vcodec", fmap["vcodec"],
            "-acodec", fmap["acodec"],
            "-preset", "ultrafast",
            "-crf", "23",
        ] + fmap["extra"] + [out_path]
        logger.info(f"[EXPORT] job={job_id} re-encode {res} {body.aspect} → {out_filename} "
                    f"(src={src_w}×{src_h} {src_vcodec}, copy={use_stream_copy})")

    # Get source duration for progress percentage calculation
    src_duration = 0.0
    try:
        dur_probe = await asyncio.to_thread(
            _sp.run,
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "json", src],
            capture_output=True, text=True, timeout=30,
        )
        src_duration = float(_json.loads(dur_probe.stdout).get("format", {}).get("duration", 0))
    except Exception:
        pass

    # Write ffmpeg progress to a temp file so we can track it without piping
    import tempfile as _tmp
    progress_file = _tmp.mktemp(suffix=".txt")
    full_cmd = cmd[:-1] + ["-progress", progress_file, "-nostats"] + [cmd[-1]]

    export_id = str(uuid.uuid4())
    _export_progress[export_id] = {
        "status": "preparing", "pct": 0,
        "filename": out_filename,
        "download_url": f"/api/dub/export/download/{job_id}/{out_filename}",
        "job_id": job_id,
    }

    async def _run_export():
        try:
            _export_progress[export_id]["status"] = "exporting"
            proc = await asyncio.to_thread(
                _sp.run, full_cmd, capture_output=True, text=True, timeout=600
            )
            if proc.returncode != 0:
                logger.error(f"[EXPORT] ffmpeg failed: {proc.stderr[-300:]}")
                _export_progress[export_id]["status"] = "error"
                _export_progress[export_id]["error"] = "FFmpeg encode failed"
            else:
                _export_progress[export_id]["status"] = "done"
                _export_progress[export_id]["pct"] = 100
        except Exception as exc:
            _export_progress[export_id]["status"] = "error"
            _export_progress[export_id]["error"] = str(exc)
        finally:
            try:
                os.unlink(progress_file)
            except OSError:
                pass

    async def _poll_progress():
        while _export_progress.get(export_id, {}).get("status") in ("preparing", "exporting"):
            await asyncio.sleep(0.5)
            try:
                if os.path.exists(progress_file) and src_duration > 0:
                    with open(progress_file, "r") as pf:
                        content = pf.read()
                    for line in reversed(content.splitlines()):
                        if line.startswith("out_time_ms="):
                            ms = int(line.split("=")[1])
                            pct = min(95, int(ms / (src_duration * 1000) * 100))
                            _export_progress[export_id]["pct"] = pct
                            break
            except Exception:
                pass

    asyncio.create_task(_run_export())
    asyncio.create_task(_poll_progress())

    return {"export_id": export_id, "filename": out_filename}


@router.get("/dub/export/progress/{export_id}", dependencies=[Depends(_dep_auth)])
async def export_progress(export_id: str):
    """Poll export progress. Returns status, pct, filename, download_url."""
    info = _export_progress.get(export_id)
    if info is None:
        raise HTTPException(status_code=404, detail="Export not found")
    return info


@router.delete("/dub/export/progress/{export_id}", dependencies=[Depends(_dep_auth)])
async def cancel_export(export_id: str):
    """Cancel an in-progress export."""
    info = _export_progress.get(export_id)
    if info and info.get("status") in ("preparing", "exporting"):
        _export_progress[export_id]["status"] = "cancelled"
        # Remove output file if partial
        try:
            out = os.path.join(settings.DUBBED_DIR, info["job_id"], info["filename"])
            if os.path.exists(out):
                os.unlink(out)
        except OSError:
            pass
    return {"status": "cancelled"}


@router.get("/dub/export/download/{job_id}/{filename}", dependencies=[Depends(_dep_job_access)])
async def download_export(job_id: str, filename: str):
    """Serve the exported file as a download attachment."""
    safe = os.path.basename(filename)
    file_path = os.path.join(settings.DUBBED_DIR, job_id, safe)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Export file not found")
    return FileResponse(
        file_path,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{safe}"'},
    )


@router.get("/segments/{job_id}", dependencies=[Depends(_dep_job_access)])
async def get_segments(job_id: str):
    segments_path = os.path.join(settings.DUBBED_DIR, job_id, "segments.json")
    if not os.path.exists(segments_path):
        raise HTTPException(status_code=404, detail=f"segments.json not found for job {job_id}")
    with open(segments_path, "r", encoding="utf-8") as f:
        data = _json.load(f)
    # Retention state travels with the segments the editor already loads, so the
    # countdown card needs no extra request and cannot show a stale deadline.
    data["retention"] = _retention_state(job_id)
    return data


@router.put("/scenes/{job_id}", dependencies=[Depends(_dep_job_access)])
async def update_scenes(job_id: str, body: Dict[str, Any] = Body(default={})):
    """Persist the video scene boundary list to segments.json.

    Scenes are contiguous ranges covering the video with per-scene fade handles.
    The render pipeline reads them to apply fade-to-black transitions.
    """
    segments_path = os.path.join(settings.DUBBED_DIR, job_id, "segments.json")
    if not os.path.exists(segments_path):
        raise HTTPException(status_code=404, detail=f"segments.json not found for job {job_id}")
    scenes = body.get("scenes")
    if not isinstance(scenes, list):
        raise HTTPException(status_code=422, detail="scenes must be a list")
    lock = await dubbing_service._get_segments_file_lock(job_id)
    async with lock:

        def _update_scenes() -> None:
            with open(segments_path, "r", encoding="utf-8") as f:
                data = _json.load(f)
            data["scenes"] = scenes
            atomic_write_json(segments_path, data)

        await asyncio.to_thread(_update_scenes)
    return {"status": "ok", "job_id": job_id, "scenes": scenes}


@router.post("/render/scene/{job_id}/{scene_id}", dependencies=[Depends(_dep_job_access)])
async def render_scene_preview(job_id: str, scene_id: str, background_tasks: BackgroundTasks):
    """Render a single scene with dubbed audio and video fades applied.

    The output is a temporary preview file in the job directory. It is not the
    final export; it lets the user review one scene before moving on.
    """
    segments_path = os.path.join(settings.DUBBED_DIR, job_id, "segments.json")
    if not os.path.exists(segments_path):
        raise HTTPException(status_code=404, detail=f"segments.json not found for job {job_id}")
    with open(segments_path, "r", encoding="utf-8") as f:
        data = _json.load(f)
    scenes = data.get("scenes") or []
    scene = next((s for s in scenes if s.get("id") == scene_id), None)
    if not scene:
        raise HTTPException(status_code=404, detail=f"Scene {scene_id} not found")

    output_dir = os.path.join(settings.DUBBED_DIR, job_id)
    output_path = os.path.join(output_dir, f"scene_{scene_id}_preview.mp4")
    try:
        dubbing_service.render_scene_preview(
            job_id=job_id,
            scene=scene,
            output_path=output_path,
        )
    except Exception as e:
        logger.error(f"Scene render failed for {job_id}/{scene_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e)) from e

    return {
        "status": "ok",
        "job_id": job_id,
        "scene_id": scene_id,
        "url": f"/media/{job_id}/{os.path.basename(output_path)}",
    }


@router.get("/segments/{job_id}/snapshot", dependencies=[Depends(_dep_job_access)])
async def get_segments_snapshot(job_id: str):
    """Return the original pipeline snapshot — never modified by user edits."""
    dubbed_dir = os.path.join(settings.DUBBED_DIR, job_id)
    snapshot_path = os.path.join(dubbed_dir, "segments_snapshot.json")
    fallback_path = os.path.join(dubbed_dir, "segments.json")
    path = snapshot_path if os.path.exists(snapshot_path) else fallback_path
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"segments not found for job {job_id}")
    with open(path, "r", encoding="utf-8") as f:
        return _json.load(f)


@router.patch("/segment/commit/{job_id}/{index}", dependencies=[Depends(_dep_job_access)])
async def commit_segment_timing(job_id: str, index: int, body: dict, request: Request):
    """Save committed timing and audio URL for a single segment to Supabase and segments.json.

    `index` is the segment's transcript_index, a stable id — NOT its current array
    position. A split can insert a segment anywhere in the array while giving it a
    transcript_index far outside its neighbors (see sync_segments below), so array
    position drifts from transcript_index over a job's life. Matching by raw
    `segs[index]` here used to silently write these fields onto whatever segment
    happened to sit at that array slot, not the one the user actually edited.
    """
    from app.services.supabase_client import supabase_writer
    committed_start_time = body.get("committed_start_time")
    committed_end_time = body.get("committed_end_time")
    committed_audio_url = body.get("committed_audio_url")
    committed_adapted_text = body.get("committed_adapted_text")
    committed_voice_id = body.get("committed_voice_id")
    committed_speed = body.get("committed_speed")
    committed_emotion = body.get("committed_emotion")
    fade_in = body.get("fade_in")
    fade_out = body.get("fade_out")
    flag_status = body.get("flag_status")
    correction_type = body.get("correction_type")
    locked = body.get("locked")
    text = body.get("text")
    text_locked = body.get("text_locked")
    paired_with_next = body.get("paired_with_next")
    # Chunk-lens staged-take promotion: the path of an auditioned-but-uncommitted
    # take (segment_NNNN_staged*.mp3) the user has chosen to keep. Sets BOTH
    # `path` (which remix_dub merges from) and `committed_audio_url` — a staged
    # take written only to committed_audio_url would be silently absent from
    # the next rebuild.
    staged_path = body.get("staged_path")
    if staged_path is not None:
        dubbed_dir_abs = os.path.abspath(settings.DUBBED_DIR)
        staged_abs = os.path.abspath(staged_path)
        if not staged_abs.startswith(dubbed_dir_abs + os.sep) or not os.path.exists(staged_abs):
            raise HTTPException(status_code=400, detail=f"Invalid staged_path: {staged_path}")
    # Update Supabase — sequence stores transcript_index (see upsert_segments docstring)
    update_data = {"sequence": index}
    if locked is not None:
        update_data["locked"] = locked
    if text is not None:
        update_data["text"] = text
    if text_locked is not None:
        update_data["text_locked"] = text_locked
    if paired_with_next is not None:
        update_data["paired_with_next"] = paired_with_next
    if committed_start_time is not None:
        update_data["committed_start_time"] = committed_start_time
    if committed_end_time is not None:
        update_data["committed_end_time"] = committed_end_time
    if committed_audio_url is not None:
        update_data["committed_audio_url"] = committed_audio_url
    if staged_path is not None:
        # Supabase stores the served URL form elsewhere; here the disk path is
        # what the rebuild merge consumes, same as segments.json below.
        update_data["committed_audio_url"] = staged_path
    if committed_adapted_text is not None:
        update_data["committed_adapted_text"] = committed_adapted_text
    if committed_voice_id is not None:
        update_data["committed_voice_id"] = committed_voice_id
    if committed_speed is not None:
        update_data["committed_speed"] = committed_speed
    if committed_emotion is not None:
        update_data["committed_emotion"] = committed_emotion
    if fade_in is not None:
        update_data["fade_in"] = fade_in
    if fade_out is not None:
        update_data["fade_out"] = fade_out
    if flag_status is not None:
        update_data["flag_status"] = flag_status
    if "correction_type" in body:
        update_data["correction_type"] = correction_type
    try:
        supabase_writer.table("segments").update(update_data).eq("job_id", job_id).eq("sequence", index).execute()
    except Exception as e:
        logger.warning(f"Supabase segment commit failed: {e}")
    # Also update segments.json on disk — matched by transcript_index, not array position.
    # This is the authoritative copy: regenerate_segment and reset_segment both read
    # from disk, not Supabase, so a Supabase-only write (e.g. if a column above doesn't
    # exist yet) must never be mistaken for a successful save.
    segments_path = os.path.join(settings.DUBBED_DIR, job_id, "segments.json")
    if not os.path.exists(segments_path):
        raise HTTPException(status_code=404, detail=f"segments.json not found for job {job_id}")
    with open(segments_path, "r", encoding="utf-8") as f:
        data = _json.load(f)
    segs = data.get("segments", [])
    seg = next((s for s in segs if s.get("transcript_index") == index), None)
    if seg is None:
        raise HTTPException(status_code=404, detail=f"Segment {index} not found")
    if committed_start_time is not None:
        seg["committed_start_time"] = committed_start_time
    if committed_end_time is not None:
        seg["committed_end_time"] = committed_end_time
    if committed_audio_url is not None:
        seg["committed_audio_url"] = committed_audio_url
    if staged_path is not None:
        seg["path"] = staged_path
        seg["committed_audio_url"] = staged_path
    if committed_adapted_text is not None:
        seg["committed_adapted_text"] = committed_adapted_text
    if committed_voice_id is not None:
        seg["committed_voice_id"] = committed_voice_id
    if committed_speed is not None:
        seg["committed_speed"] = committed_speed
    if committed_emotion is not None:
        seg["committed_emotion"] = committed_emotion
    if fade_in is not None:
        seg["fade_in"] = fade_in
    if fade_out is not None:
        seg["fade_out"] = fade_out
    if flag_status is not None:
        seg["flag_status"] = flag_status
    if "correction_type" in body:
        seg["correction_type"] = correction_type
    if locked is not None:
        seg["locked"] = locked
    if text is not None:
        seg["text"] = text
    if text_locked is not None:
        seg["text_locked"] = text_locked
    if paired_with_next is not None:
        seg["paired_with_next"] = paired_with_next
    data["segments"] = segs
    atomic_write_json(segments_path, data)
    return {"status": "ok", "job_id": job_id, "index": index}


@router.post("/dub/discard-staged/{job_id}", dependencies=[Depends(_dep_job_access)])
async def discard_staged_takes(job_id: str, body: Dict[str, Any] = Body(default={})):
    """Delete staged take files the user chose not to keep.

    Staged renders are real files on disk (segment_XXXX_staged*.mp3) and they
    are the ONE artifact with no other cleanup path: committed audio is replaced
    on the next regen, but an abandoned audition take would otherwise sit there
    until the whole job is purged. Discarding a chunk has to remove them, or
    "discard" would only mean "forget in the browser".

    Body: {"transcript_indices": [3, 7]} — omit to discard every staged take
    for the job.
    """
    import glob as _glob
    output_dir = os.path.join(settings.DUBBED_DIR, job_id)
    if not os.path.isdir(output_dir):
        raise HTTPException(status_code=404, detail=f"No output directory for job {job_id}")

    indices = body.get("transcript_indices")
    if indices:
        patterns = [
            os.path.join(output_dir, f"segment_{int(i):04d}_staged*")
            for i in indices
        ]
    else:
        patterns = [os.path.join(output_dir, "segment_*_staged*")]

    removed = []
    for pattern in patterns:
        for path in _glob.glob(pattern):
            try:
                os.remove(path)
                removed.append(os.path.basename(path))
            except OSError as exc:
                # Best-effort per file: one locked take must not strand the rest.
                logger.warning(f"[STAGED] {job_id}: could not delete {path}: {exc}")

    logger.info(f"[STAGED] {job_id}: discarded {len(removed)} staged file(s)")
    return {"status": "ok", "job_id": job_id, "removed": len(removed), "files": removed}


@router.post("/dub/chunk-status/{job_id}", dependencies=[Depends(_dep_job_access)])
async def set_chunk_status(job_id: str, body: dict):
    """Record per-chunk editor state for the chunk-lens UI (long videos).

    Stored as a top-level `chunk_status` map in segments.json —
    {"<chunk_index>": "saved"} — so it survives reloads and rides along with
    the existing GET segments payload. Chunk indexes are display windows
    (300s), not the analysis-stage chunk files.
    """
    chunk_index = body.get("chunk_index")
    status = body.get("status")
    if not isinstance(chunk_index, int) or chunk_index < 0:
        raise HTTPException(status_code=400, detail="chunk_index must be a non-negative int")
    if status not in ("saved", "dirty"):
        raise HTTPException(status_code=400, detail="status must be 'saved' or 'dirty'")

    segments_path = os.path.join(settings.DUBBED_DIR, job_id, "segments.json")
    if not os.path.exists(segments_path):
        raise HTTPException(status_code=404, detail=f"segments.json not found for job {job_id}")
    with open(segments_path, "r", encoding="utf-8") as f:
        data = _json.load(f)
    chunk_status = data.setdefault("chunk_status", {})
    chunk_status[str(chunk_index)] = status
    atomic_write_json(segments_path, data)
    return {"status": "ok", "job_id": job_id, "chunk_status": chunk_status}


class SyncSegmentsRequest(BaseModel):
    segments: List[dict]


@router.post("/segment/sync/{job_id}", dependencies=[Depends(_dep_job_access)])
async def sync_segments(job_id: str, body: SyncSegmentsRequest):
    """Persist the frontend's current segment layout to segments.json.

    Called after structural changes (split, add, delete). Assigns
    transcript_index to new segments, merges updates onto existing ones,
    and removes segments the frontend deleted.
    """
    segments_path = os.path.join(settings.DUBBED_DIR, job_id, "segments.json")
    if not os.path.exists(segments_path):
        raise HTTPException(status_code=404, detail=f"segments.json not found for job {job_id}")

    with open(segments_path, "r", encoding="utf-8") as f:
        data = _json.load(f)

    existing_segs = data.get("segments", [])

    # Safety: reject if incoming is less than half the existing count —
    # likely a frontend bug sending a partial array, not an intentional bulk delete.
    if len(existing_segs) > 2 and len(body.segments) < len(existing_segs) // 2:
        raise HTTPException(
            status_code=422,
            detail=f"Sync rejected: incoming {len(body.segments)} segments vs {len(existing_segs)} existing — looks like a partial array"
        )

    # Safety: reject if the incoming payload has a transcript_index appearing more
    # than once. The merge loop below matches each incoming segment onto the
    # existing one sharing its transcript_index and appends a fresh merged record
    # for every incoming entry — if the same transcript_index shows up twice, this
    # silently produces two separate output segments with the identical identity,
    # each merged from the same stale base. That's a confirmed real corruption
    # (duplicate transcript_index found live in production data), not a
    # theoretical risk — reject outright rather than let it happen again.
    incoming_tis = [s.get("transcript_index") for s in body.segments if s.get("transcript_index") is not None]
    dup_tis = {ti for ti in incoming_tis if incoming_tis.count(ti) > 1}
    if dup_tis:
        raise HTTPException(
            status_code=422,
            detail=f"Sync rejected: incoming payload has duplicate transcript_index value(s) {sorted(dup_tis)} — "
                   f"each must appear at most once"
        )

    existing_by_ti = {s["transcript_index"]: s for s in existing_segs if "transcript_index" in s}

    # Voice per speaker, from the existing segments — used to give a new
    # split/added segment the same voice as its speaker (it arrives with no
    # voice_id, and synthesis produces no vocals without one).
    voice_by_speaker: dict = {}
    for s in existing_segs:
        spk, vid = s.get("speaker"), s.get("voice_id")
        if spk and vid and spk not in voice_by_speaker:
            voice_by_speaker[spk] = vid

    max_ti = max((s.get("transcript_index", -1) for s in existing_segs), default=-1)

    FRONTEND_FIELDS = {
        "id", "start_time", "end_time", "start", "end",
        "speaker_id", "speaker_label", "speaker_gender",
        "source_text", "target_text", "active_text", "preview_text",
        "committed_adapted_text", "committed_start_time", "committed_end_time",
        "committed_audio_url", "committed_voice_id", "committed_emotion",
        "committed_speed", "audio_url", "status",
        "fade_in", "fade_out",
    }

    result = []
    for incoming in body.segments:
        ti = incoming.get("transcript_index")

        if ti is not None and ti in existing_by_ti:
            merged = dict(existing_by_ti[ti])
            for key in FRONTEND_FIELDS:
                if key in incoming:
                    merged[key] = incoming[key]
            merged["start"] = incoming.get("start_time", merged.get("start", 0))
            merged["end"] = incoming.get("end_time", merged.get("end", 0))
            # A structural edit (split/merge) sets rpt_dirty when the segment's
            # inherited audio no longer matches its new text/span. sync runs only on
            # structural edits, so honor that flag on the changed segment:
            #  1. Persist the new target text into both `text` (what the editor page
            #     loader reads back) and `committed_adapted_text` (what Generate Speech
            #     renders from — see dubbing_service `use_text = committed_adapted_text
            #     or text`). Without this a split half reverts to the parent's text on
            #     refresh and regenerates the parent's line.
            #  2. Drop the stale rendered clip (path + committed_audio_url) so the
            #     loader can't rebuild audio_url from `path`, leaving the half silent
            #     until the next Generate Speech re-renders it.
            # Gated on rpt_dirty so untouched segments in the same payload (a full
            # sync sends every segment) keep their audio and any distinct adaptation.
            if incoming.get("rpt_dirty") is True:
                new_text = incoming.get("target_text")
                if new_text is not None:
                    merged["text"] = new_text
                    merged["committed_adapted_text"] = new_text
                merged["path"] = None
                merged["committed_audio_url"] = None
                merged.pop("audio_url", None)
            result.append(merged)
        else:
            max_ti += 1
            new_seg = {k: v for k, v in incoming.items() if v is not None}
            new_seg["transcript_index"] = max_ti
            new_seg["start"] = incoming.get("start_time", 0)
            new_seg["end"] = incoming.get("end_time", 0)
            new_seg.setdefault("path", None)
            new_seg.setdefault("voice_id", None)
            new_seg.setdefault("speed", 1.0)
            new_seg.setdefault("edit_history", [])
            # New segments (split right half, Add Segment) carry their text only in
            # target_text; mirror it into `text`/`committed_adapted_text` so it survives
            # reload (loader reads `text`) and Generate Speech renders the right line.
            nt = incoming.get("target_text")
            if nt is not None:
                new_seg.setdefault("text", nt)
                new_seg.setdefault("committed_adapted_text", nt)
            # The loader derives the speaker chip from the backend `speaker` field,
            # but the frontend only carries `speaker_id`/`speaker_label`. Without this
            # a split/added segment reloads as the default "Speaker 1" instead of
            # inheriting its parent's speaker.
            sp = incoming.get("speaker_id") or incoming.get("speaker_label")
            if sp is not None:
                new_seg.setdefault("speaker", sp)
            # Inherit the speaker's voice so Generate Speech has something to render
            # with. Prefer an explicit committed_voice_id from the editor, else the
            # voice already in use by this speaker's other segments.
            if not new_seg.get("voice_id"):
                new_seg["voice_id"] = (
                    incoming.get("committed_voice_id")
                    or voice_by_speaker.get(new_seg.get("speaker"))
                )
            result.append(new_seg)

    from datetime import datetime as _dt
    data["segments"] = result
    data["synced_at"] = _dt.utcnow().isoformat() + "Z"

    atomic_write_json(segments_path, data)

    from app.services.segment_validation import validate_segments
    validate_segments(job_id, result)

    response_segments = []
    for seg in result:
        response_segments.append({
            "id": seg.get("id"),
            "transcript_index": seg["transcript_index"],
            "start_time": seg.get("start", seg.get("start_time", 0)),
            "end_time": seg.get("end", seg.get("end_time", 0)),
            "speaker_id": seg.get("speaker_id"),
            "source_text": seg.get("source_text", ""),
            "target_text": seg.get("target_text", ""),
            "active_text": seg.get("active_text", ""),
            "committed_adapted_text": seg.get("committed_adapted_text"),
            "committed_audio_url": seg.get("committed_audio_url"),
            "committed_voice_id": seg.get("committed_voice_id"),
            "audio_url": seg.get("audio_url"),
            "path": seg.get("path"),
            "status": seg.get("status", "auto"),
        })

    return {"status": "ok", "segments": response_segments}


@router.post("/segment/reset/{job_id}/{index}", dependencies=[Depends(_dep_job_access)])
async def reset_segment(job_id: str, index: int):
    """Clear all editor overrides on a segment — drops emotion + committed_* keys from segments.json.

    Leaves pipeline-set fields (voice_id, speed, path) untouched; the frontend's staged-* maps
    being empty means the next Generate will use whatever those currently hold, which is the
    pipeline default unless the user has previously regenerated.
    """
    from app.services.supabase_client import supabase_writer
    segments_path = os.path.join(settings.DUBBED_DIR, job_id, "segments.json")
    if not os.path.exists(segments_path):
        raise HTTPException(status_code=404, detail=f"segments.json not found for job {job_id}")
    with open(segments_path, "r", encoding="utf-8") as f:
        data = _json.load(f)
    segs = data.get("segments", [])
    seg = next((s for s in segs if s.get("transcript_index") == index), None)
    if seg is None:
        raise HTTPException(status_code=404, detail=f"Segment {index} not found")
    for key in (
        "emotion",
        "attached_traits",
        "committed_audio_url", "committed_adapted_text",
        "committed_start_time", "committed_end_time",
        "committed_voice_id", "committed_speed", "committed_pitch",
    ):
        seg.pop(key, None)
    data["segments"] = segs
    atomic_write_json(segments_path, data)
    try:
        supabase_writer.table("segments").update({
            "emotion_tag": None,
            "committed_audio_url": None,
            "adapted_text": None,
            "committed_start_time": None,
            "committed_end_time": None,
        }).eq("job_id", job_id).eq("sequence", index).execute()
    except Exception as e:
        logger.warning(f"Supabase reset failed: {e}")
    return {"status": "ok", "job_id": job_id, "index": index}


@router.get("/respeecher/voices")
async def list_respeecher_voices(request: Request):
    """Respeecher's voice catalogue for the editor panel.

    Free call — listing is not metered, so this works even when the account has
    no generation balance. Cached in the service after the first fetch.
    Returns [] when no API key is configured, so the panel degrades to an empty
    state instead of erroring.

    Professional only, matching the engine itself.
    """
    _require_plan(request, ("professional",), "Respeecher")
    voices = await respeecher_tts.get_voices()
    return {"voices": voices, "enabled": respeecher_tts.enabled}


@router.post("/segment/regenerate/{job_id}/{index}", dependencies=[Depends(_dep_job_access)])
async def regenerate_segment(job_id: str, index: int, body: RegenerateRequest, request: Request):
    # Respeecher is Professional-only: each generate races three takes, so every
    # use is three billable vendor requests. Gated on the REQUESTED engine, not
    # on the segment's stored one — a Premium user must still be able to
    # regenerate a segment that was previously rendered on Respeecher, which
    # falls through to Fish.
    if (body.engine or "").lower() == "respeecher":
        _require_plan(request, ("professional",), "Respeecher")
    try:
        voice_id = body.voice_id
        speed = body.speed
        speed_ratio = None
        target_duration = None
        sync_offset_ms = None

        # Resolve canonical voice key (e.g. "male-1") to Fish Audio reference_id.
        # Fall through to body.voice_key directly if unresolved — it may already
        # be a Fish Audio UUID dragged from the Voice Library.
        # Respeecher voice ids are plain slugs from its own catalogue ("neal",
        # "marta"), so they must NOT pass through Fish's key map — that would
        # rewrite a valid Respeecher id into an unrelated Fish reference_id.
        if body.voice_key and not voice_id:
            if (body.engine or "").lower() == "respeecher":
                voice_id = body.voice_key
            else:
                resolved = fish_audio_tts.get_voice_id(body.voice_key)
                voice_id = resolved or body.voice_key

        if getattr(body, "voice_params", None):
            if body.voice_params.voice_id is not None:
                voice_id = body.voice_params.voice_id
            if body.voice_params.speed is not None:
                speed = body.voice_params.speed
            speed_ratio = body.voice_params.speed_ratio
            target_duration = body.voice_params.target_duration
            sync_offset_ms = body.voice_params.sync_offset_ms

        seg = await dubbing_service.regenerate_segment(
            job_id=job_id,
            segment_index=index,
            voice_id=voice_id,
            speed=speed,
            speed_ratio=speed_ratio,
            target_duration=target_duration,
            sync_offset_ms=sync_offset_ms,
            emotion=body.emotion,
            traits=body.traits,
            pitch=body.pitch,
            force_timing=body.force_timing,
            nuances=body.nuances,
            nuance_markers=body.nuance_markers,
            custom_nuance=body.custom_nuance,
            tts_text=body.tts_text,
            engine=body.engine,
            sampling_params=body.sampling_params,
            seed=body.seed,
            reroll=body.reroll,
            live_segment_start=body.live_segment_start,
            live_segment_end=body.live_segment_end,
            live_next_segment_start=body.live_next_segment_start,
            live_prev_segment_end=body.live_prev_segment_end,
            stage=body.stage,
            text=body.text,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        # Locked segment — 423 Locked. The editor already blocks this client-side;
        # this makes it authoritative for any bulk/auto/direct caller.
        raise HTTPException(status_code=423, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"status": "ok", "segment": seg}


@router.get("/elevenlabs/voices", dependencies=[Depends(_dep_auth)])
async def get_elevenlabs_voices(refresh: bool = False):
    """Target voices for the Voice Changer panel.

    Everything the account can reach: the stock `premade` voices plus every
    voice added to the user's ElevenLabs library (`professional` and any clones,
    which need a paid plan). `category` is passed through so the panel can group
    "your voices" apart from the stock ones.

    The service caches for the process lifetime, so `refresh=true` is what picks
    up a voice added to the ElevenLabs account since the backend started —
    otherwise it stays invisible until a restart.
    """
    voices = await elevenlabs_tts.get_voices(refresh=refresh)
    out = []
    for v in voices:
        lab = v.get("labels") or {}
        out.append({
            "id": v.get("voice_id"),
            "name": v.get("name"),
            "gender": lab.get("gender"),
            "accent": lab.get("accent"),
            "description": lab.get("description") or v.get("description"),
            "preview_url": v.get("preview_url"),
            "category": v.get("category"),
        })
    out.sort(key=lambda v: (v.get("name") or "").lower())
    return {"voices": out, "enabled": elevenlabs_tts.enabled}


@router.post("/segment/perform/{job_id}/{index}", dependencies=[Depends(_dep_job_access)])
async def perform_segment(
    job_id: str,
    index: int,
    request: Request,
    file: UploadFile = File(...),
    voice_id: str = Form(...),
    model_id: str = Form("eleven_english_sts_v2"),
    remove_background_noise: bool = Form(False),
):
    """Render a segment from a recorded performance instead of from its text.

    `index` is the segment's transcript_index — a stable id, NOT its array
    position (see commit_segment_timing).

    The uploaded performance is STORED beside the segment and becomes its
    source of truth, the way text is for the TTS engines. Without that, any
    later re-render — a speed tweak, a bulk pass — would have nothing to
    convert and would silently fall back to a different engine.

    Gated to Professional, matching Custom Voices: each call spends ElevenLabs
    credits, so it can't be reachable by hitting the API directly either.
    """
    _require_plan(request, ("professional",), "Voice Changer")

    dubbed_dir = os.path.join(settings.DUBBED_DIR, job_id)
    segments_path = os.path.join(dubbed_dir, "segments.json")
    if not os.path.exists(segments_path):
        raise HTTPException(status_code=404, detail=f"segments.json not found for job {job_id}")

    with open(segments_path, "r", encoding="utf-8") as f:
        data = _json.load(f)
    seg = next((s for s in data.get("segments", []) if s.get("transcript_index") == index), None)
    if seg is None:
        raise HTTPException(status_code=404, detail=f"Segment with transcript_index={index} not found")
    # Same choke point as regenerate: a locked segment's audio is frozen.
    if seg.get("locked"):
        raise HTTPException(status_code=423, detail=f"Segment {index} is locked — unlock it to change its audio")

    audio = await file.read()
    if not audio:
        raise HTTPException(status_code=422, detail="Empty audio upload")

    os.makedirs(dubbed_dir, exist_ok=True)
    ext = os.path.splitext(file.filename or "")[1].lower() or ".mp3"
    perf_path = os.path.join(dubbed_dir, f"segment_{index:04d}_perf{ext}")
    with open(perf_path, "wb") as f:
        f.write(audio)

    audio_path = os.path.join(dubbed_dir, f"segment_{index:04d}_regen.mp3")
    payload = await elevenlabs_tts.speech_to_speech(
        audio_bytes=audio,
        voice_id=voice_id,
        output_path=audio_path,
        model_id=model_id,
        remove_background_noise=remove_background_noise,
        filename=os.path.basename(perf_path),
    )
    if payload is None:
        raise HTTPException(status_code=502, detail="ElevenLabs speech-to-speech failed — see server log")

    seg["path"] = audio_path
    seg["engine"] = "elevenlabs-sts"
    seg["voice_id"] = voice_id
    seg["perf_path"] = perf_path
    seg["perf_model_id"] = model_id
    # Stored so a re-render reproduces THIS conversion. Without it a take made
    # with isolation on would quietly come back without it — the same shape of
    # bug as sampling params that didn't survive a seed replay.
    seg["perf_denoise"] = bool(remove_background_noise)
    seg["audio_duration"] = dubbing_service._get_audio_duration(audio_path)
    # Take metadata describes Respeecher audio that is no longer live.
    for _k in ("respeecher_takes", "respeecher_take_seeds",
               "respeecher_fits", "respeecher_duration"):
        seg.pop(_k, None)

    atomic_write_json(segments_path, data)

    logger.info(
        f"[PERFORM] job {job_id} seg {index}: {os.path.basename(perf_path)} "
        f"-> {voice_id} denoise={remove_background_noise} "
        f"({seg['audio_duration']:.2f}s)"
    )
    return {"status": "ok", "segment": seg}


@router.post("/elevenlabs/sts-preview")
async def elevenlabs_sts_preview(
    request: Request,
    file: UploadFile = File(...),
    voice_id: str = Form(...),
    model_id: str = Form("eleven_english_sts_v2"),
    seed: Optional[int] = Form(None),
    remove_background_noise: bool = Form(False),
):
    """Convert a performance onto a target voice and return the audio directly.

    Deliberately stateless: no job, no segment, nothing written to
    segments.json — this is the audition, and /segment/perform is the commit.

    Gated like perform: a preview spends the same ElevenLabs credits as the
    real thing, so an ungated audition endpoint would be a free hole through
    a paid feature.
    """
    _require_plan(request, ("professional",), "Voice Changer")

    audio = await file.read()
    if not audio:
        raise HTTPException(status_code=422, detail="Empty audio upload")

    result = await elevenlabs_tts.speech_to_speech(
        audio_bytes=audio,
        voice_id=voice_id,
        model_id=model_id,
        seed=seed,
        remove_background_noise=remove_background_noise,
        filename=file.filename or "performance.wav",
    )
    if result is None:
        raise HTTPException(
            status_code=502,
            detail="ElevenLabs speech-to-speech failed — see server log",
        )
    return Response(content=result, media_type="audio/mpeg")


@router.delete("/segment/seed/{job_id}/{index}/{seed}", dependencies=[Depends(_dep_job_access)])
async def delete_seed_history_entry(job_id: str, index: int, seed: int):
    """Drop one take from a segment's Respeecher seed library.

    `index` is the segment's transcript_index — a stable id, NOT its array
    position, which drifts as segments are split (see commit_segment_timing).

    Deleting is only ever a library edit: the seed identifies a take that can be
    re-rendered, so removing the entry discards the ability to recall that read,
    not any audio. The segment's CURRENT audio and its pinned `respeecher_seed`
    are left alone even when they happen to share this seed — the live take is
    still live, it just stops being listed.
    """
    segments_path = os.path.join(settings.DUBBED_DIR, job_id, "segments.json")
    if not os.path.exists(segments_path):
        raise HTTPException(status_code=404, detail=f"segments.json not found for job {job_id}")

    with open(segments_path, "r", encoding="utf-8") as f:
        data = _json.load(f)

    seg = next((s for s in data.get("segments", []) if s.get("transcript_index") == index), None)
    if seg is None:
        raise HTTPException(status_code=404, detail=f"Segment with transcript_index={index} not found")

    history = list(seg.get("respeecher_seed_history") or [])
    remaining = [e for e in history if e.get("seed") != seed]
    if len(remaining) == len(history):
        raise HTTPException(status_code=404, detail=f"Seed {seed} not in this segment's history")

    seg["respeecher_seed_history"] = remaining
    atomic_write_json(segments_path, data)

    logger.info(f"[SEEDS] job {job_id} seg {index}: removed seed {seed} ({len(remaining)} left)")
    return {"status": "ok", "respeecher_seed_history": remaining}


@router.patch("/segment/seed/{job_id}/{index}/{seed}", dependencies=[Depends(_dep_job_access)])
async def set_seed_kept(job_id: str, index: int, seed: int, body: dict):
    """Lock or unlock one take in a segment's seed library.

    A locked entry is exempt from the SEED_HISTORY_MAX cap — it is never evicted
    to make room for newer takes. This is the only way to guarantee a read stays
    recallable, since four more races would otherwise push it off the end.

    Locking does NOT protect the entry from an explicit delete: that is the user
    saying so directly, and a lock that could not be undone by deleting would be
    a trap rather than a safeguard.
    """
    kept = bool(body.get("kept"))
    segments_path = os.path.join(settings.DUBBED_DIR, job_id, "segments.json")
    if not os.path.exists(segments_path):
        raise HTTPException(status_code=404, detail=f"segments.json not found for job {job_id}")

    with open(segments_path, "r", encoding="utf-8") as f:
        data = _json.load(f)

    seg = next((s for s in data.get("segments", []) if s.get("transcript_index") == index), None)
    if seg is None:
        raise HTTPException(status_code=404, detail=f"Segment with transcript_index={index} not found")

    history = seg.get("respeecher_seed_history") or []
    entry = next((e for e in history if e.get("seed") == seed), None)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"Seed {seed} not in this segment's history")

    entry["kept"] = kept
    atomic_write_json(segments_path, data)

    logger.info(f"[SEEDS] job {job_id} seg {index}: seed {seed} kept={kept}")
    return {"status": "ok", "respeecher_seed_history": history}


def _in_window(seg: dict, start: Optional[float], end: Optional[float]) -> bool:
    """True when a segment belongs to the chunk window, or when no window is
    given. Ownership is by start time — the same rule the editor's chunk bar
    uses — so a line straddling the boundary belongs to one window only."""
    if start is None or end is None:
        return True
    s = seg.get("committed_start_time")
    if s is None:
        s = seg.get("start", 0) or 0
    return start <= s < end


class ApplyVoiceRequest(BaseModel):
    speaker_id: str
    voice_id: str = ""
    voice_key: str = ""
    # Optional overrides. Omitted -> per-segment values are preserved as before,
    # so existing 3-field callers are unchanged.
    traits: Optional[List[str]] = None
    pitch: Optional[int] = None
    # Chunk lens: confine the change to the window being edited. Omitted -> the
    # whole film, so existing callers behave exactly as before. A voice chosen
    # while reviewing one 5-minute window should not silently rewrite the
    # speaker's lines across the other two hours.
    window_start: Optional[float] = None
    window_end: Optional[float] = None


@router.post("/segments/apply-voice/{job_id}", dependencies=[Depends(_dep_job_access)])
async def apply_voice_to_speaker(job_id: str, body: ApplyVoiceRequest):
    """Set ONE voice across every segment of a speaker, server-side and atomically.

    The old client-side per-segment regen loop was unreliable (skipped locked
    segments, dropped failed calls, slow), so a speaker's segments drifted onto
    different voices. This regenerates all of a speaker's segments here with the
    same voice while preserving each segment's own text/emotion/speed and its
    position, so a voice assignment is applied consistently and persisted in
    one call. Lock is positional, so locked segments are regenerated too.
    """
    voice_id = body.voice_id
    if body.voice_key and not voice_id:
        resolved = fish_audio_tts.get_voice_id(body.voice_key)
        voice_id = resolved or body.voice_key
    if not voice_id:
        raise HTTPException(status_code=422, detail="voice_id or voice_key is required")

    segments_path = os.path.join(settings.DUBBED_DIR, job_id, "segments.json")
    if not os.path.exists(segments_path):
        raise HTTPException(status_code=404, detail=f"segments.json not found for job {job_id}")
    with open(segments_path, "r", encoding="utf-8") as f:
        data = _json.load(f)
    # Snapshot each target's preserved attributes up front — regenerate_segment
    # rewrites segments.json on every call, so read what we need before looping.
    targets = [
        {
            "ti": s.get("transcript_index"),
            "speed": s.get("speed"),
            "emotion": s.get("emotion"),
            "traits": s.get("attached_traits"),
            "nuances": s.get("nuances"),
            "nuance_markers": s.get("nuance_markers"),
        }
        for s in data.get("segments", [])
        if s.get("speaker") == body.speaker_id
        and s.get("transcript_index") is not None
        and _in_window(s, body.window_start, body.window_end)
    ]
    logger.info(
        "apply-voice: job %s speaker %s -> %d segment(s)%s",
        job_id, body.speaker_id, len(targets),
        f" in window {body.window_start:.0f}-{body.window_end:.0f}s"
        if body.window_start is not None and body.window_end is not None else " (whole film)",
    )

    regenerated, skipped_locked, failed = [], [], []
    for t in targets:
        try:
            seg = await dubbing_service.regenerate_segment(
                job_id=job_id,
                segment_index=t["ti"],
                voice_id=voice_id,
                # Preserve everything but the voice.
                speed=t["speed"],
                emotion=t["emotion"],
                # Caller-supplied traits win; [] deliberately clears them.
                traits=body.traits if body.traits is not None else t["traits"],
                pitch=body.pitch,
                nuances=t["nuances"],
                nuance_markers=t["nuance_markers"],
            )
            regenerated.append({
                "transcript_index": t["ti"],
                "voice_id": seg.get("voice_id"),
                "path": seg.get("path"),
                "committed_audio_url": seg.get("committed_audio_url"),
            })
        except Exception as e:
            logger.warning("apply-voice: segment %s failed: %s", t["ti"], e)
            failed.append({"transcript_index": t["ti"], "error": str(e)})

    return {
        "status": "ok",
        "voice_id": voice_id,
        "regenerated": regenerated,
        "skipped_locked": [],
        "failed": failed,
    }


class AskAIRequest(BaseModel):
    prompt: str = Field(..., max_length=2000)
    model: str = "sonnet"
    source_text: str = Field("", max_length=4000)
    dubbed_text: str = Field("", max_length=4000)
    source_language: str = "zh"
    target_language: str = "en"
    speaker_label: str = ""
    speaker_gender: str = "male"


# Simple in-memory per-user sliding-window rate limit for /ask-ai — this endpoint
# makes a real, unmetered call to a paid external LLM API on every request, so it
# needs a floor even without a shared cache/Redis in this deployment.
_ASK_AI_RATE_LIMIT_MAX = 10
_ASK_AI_RATE_LIMIT_WINDOW_SECONDS = 60
_ask_ai_request_times: Dict[str, list] = {}

def _check_ask_ai_rate_limit(user_id: str) -> None:
    now = time.monotonic()
    window_start = now - _ASK_AI_RATE_LIMIT_WINDOW_SECONDS
    times = [t for t in _ask_ai_request_times.get(user_id, []) if t > window_start]
    if len(times) >= _ASK_AI_RATE_LIMIT_MAX:
        raise HTTPException(status_code=429, detail="Too many Ask AI requests — please wait a moment and try again")
    times.append(now)
    _ask_ai_request_times[user_id] = times


@router.post("/ask-ai")
async def ask_ai(body: AskAIRequest, request: Request):
    """Ask Claude to improve a dubbed segment based on a user prompt.

    Premium/professional only (matches FEATURE_MATRIX.askAI in the frontend's
    plan-features.ts) — mirrors the auth pattern used by every other endpoint
    in this file (see /emotional-library, /ei/curves).
    """
    import httpx, re as _re

    auth_header = request.headers.get("Authorization", "")
    token = auth_header.removeprefix("Bearer ").strip()
    user_id = verify_jwt(token)

    from app.services.supabase_client import supabase_writer
    sub_result = supabase_writer.table("subscriptions") \
        .select("plan_type") \
        .eq("user_id", user_id) \
        .in_("status", ["active", "trialing"]) \
        .limit(1) \
        .execute()
    plan_type = sub_result.data[0]["plan_type"] if sub_result.data else None
    if plan_type not in ("premium", "professional"):
        raise HTTPException(status_code=403, detail="Ask AI requires a Premium or Professional plan")

    _check_ask_ai_rate_limit(user_id)

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="AI not configured")

    _model_map = {
        "haiku":  "claude-haiku-4-5-20251001",
        "sonnet": "claude-sonnet-4-6",
        "opus":   "claude-opus-4-8",
    }
    claude_model = _model_map.get(body.model, "claude-sonnet-4-6")

    system_prompt = (
        "You are an expert dubbing editor and dialogue writer. "
        "Your job is to improve dubbed dialogue so it sounds natural, "
        "matches the character's emotion, fits lip-sync timing, and reads well when spoken aloud.\n\n"
        "IMPORTANT: performance direction (emotion + delivery) is applied SEPARATELY by the "
        "editor through emotion pills and Nuance controls — do NOT embed bracket tags, stage "
        "directions, or emotion words like [excited] in your suggestion. Return only clean "
        "spoken dialogue. If a delivery change would help, name the relevant emotion pill, "
        "nuance control, or the Delivery Script (the write-in, where the user places inline "
        "[tags] in the line) in the explanation instead of altering the dialogue. If the line "
        "is a question, make sure it ends with '?' so it rises naturally.\n\n"
        "Reference — the editor's controls that shape delivery (you do not write these, they are "
        "set by the user; use them to inform your wording and explanation):\n"
        "Emotion pills (pill -> delivery the voice receives): Neutral (none); Happy (warm, bright, "
        "smiling); Excited (breathless, eager, rising pitch); Calm (slow, steady, soothing); Sad "
        "(heavy, subdued, downward trailing); Angry (tense, forceful, clipped); Fearful (shaky, "
        "hushed, uneven breaths); Surprised (sharp pitch rise, disbelief); Disgusted (recoiling, "
        "sneering); Professional (clear, measured, confident); Casual (relaxed, conversational); "
        "Formal (poised, precise); Intimate (soft, close, breathy warmth); Defiant (firm, "
        "unyielding, challenging); Confused (hesitant, inquisitive rising ending); Whisper (hushed "
        "small voice); Shout (loud, projected, urgent); Sarcastic (dry, mocking, flat); Hopeful "
        "(gentle rising pitch, warm anticipation); Melancholic (wistful, slow, trailing).\n"
        "Nuance controls (each acts at both ends; center = neutral): Pace (rushed<->deliberate), "
        "Weight (light<->heavy), Breath (tight<->breathy), Delivery (intimate<->projected), Tail "
        "(clipped<->trailing), Prosody (flat<->expressive), Pitch Contour (flat<->melodic), Volume "
        "Dynamics (compressed<->dynamic), Tempo (slower<->faster), Breath Sounds (minimal<->"
        "audible), Voice Quality (smooth<->gravelly), Micro Intonation (robotic<->human), Pauses "
        "(fewer<->more), plus inline Rise/Drop/Stress/Whisper/Pause/Breathy word markers.\n\n"
        "Always respond with valid JSON only — no markdown, no extra text."
    )

    user_prompt = f"""Dubbing context:
- Source language: {body.source_language}
- Target language: {body.target_language}
- Speaker: {body.speaker_label or 'Unknown'} ({body.speaker_gender})
- Original text: "{body.source_text}"
- Current dubbed text: "{body.dubbed_text}"

User request: "{body.prompt}"

Respond with JSON: {{"suggestion": "<improved dubbed text>", "explanation": "<one sentence why this is better>"}}"""

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": claude_model,
                    "max_tokens": 512,
                    "system": system_prompt,
                    "messages": [{"role": "user", "content": user_prompt}],
                },
            )
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail="AI request failed")

        text = resp.json().get("content", [{}])[0].get("text", "")
        cleaned = _re.sub(r"^```json\s*", "", text.strip())
        cleaned = _re.sub(r"\s*```$", "", cleaned)
        data = _json.loads(cleaned)
        return {"status": "ok", "suggestion": data.get("suggestion", ""), "explanation": data.get("explanation", "")}
    except _json.JSONDecodeError:
        return {"status": "ok", "suggestion": text.strip(), "explanation": ""}
    except Exception as e:
        logger.error(f"[ASK-AI] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─── Ask AI Chat (general help — separate feature from /ask-ai above) ───────

_ASK_AI_CHAT_KNOWLEDGE_PATH = os.path.join(os.path.dirname(__file__), "..", "knowledge", "dubmaster_help.md")
try:
    with open(_ASK_AI_CHAT_KNOWLEDGE_PATH, "r", encoding="utf-8") as _f:
        _ASK_AI_CHAT_KNOWLEDGE = _f.read()
except FileNotFoundError:
    logger.warning("Ask AI Chat knowledge doc not found at %s", _ASK_AI_CHAT_KNOWLEDGE_PATH)
    _ASK_AI_CHAT_KNOWLEDGE = ""

_ASK_AI_CHAT_SYSTEM_PROMPT = (
    "You are DubMaster's in-app help assistant. Answer only using the reference "
    "material below — it is the ground truth for what DubMaster's features actually "
    "do today. If a question isn't covered by it, say you're not sure rather than "
    "guessing or inventing behavior. Keep answers short and practical. Do not discuss "
    "topics unrelated to using DubMaster.\n\n"
    "When the user asks to see the full range/list/chart/graph of emotions (or the "
    "nuance controls), reproduce the relevant table from the reference material IN "
    "FULL as a GitHub-flavored Markdown table (pipe `|` syntax with a `---` separator "
    "row). The chat renders Markdown tables on screen, so present the actual table "
    "rather than describing it or trimming rows — this is the one case where a long "
    "answer is expected. You may add a one-line intro above it.\n\n"
    "--- DubMaster reference material ---\n"
    f"{_ASK_AI_CHAT_KNOWLEDGE}"
)


class AskAIChatMessage(BaseModel):
    role: str
    # Assistant replies are free-form, multi-paragraph help answers — this cap must
    # be generous enough to hold the assistant's own prior turn when it's echoed
    # back as history on the next request, not just a single short user message.
    content: str = Field(..., max_length=6000)


class AskAIChatRequest(BaseModel):
    message: str = Field(..., max_length=1000)
    history: List[AskAIChatMessage] = Field(default_factory=list, max_length=20)


# Separate in-memory rate limit from /ask-ai — different feature, different usage
# pattern (a help chat is naturally more chatty/turn-heavy than a one-shot rewrite).
_ASK_AI_CHAT_RATE_LIMIT_MAX = 15
_ASK_AI_CHAT_RATE_LIMIT_WINDOW_SECONDS = 60
_ask_ai_chat_request_times: Dict[str, list] = {}

def _check_ask_ai_chat_rate_limit(user_id: str) -> None:
    now = time.monotonic()
    window_start = now - _ASK_AI_CHAT_RATE_LIMIT_WINDOW_SECONDS
    times = [t for t in _ask_ai_chat_request_times.get(user_id, []) if t > window_start]
    if len(times) >= _ASK_AI_CHAT_RATE_LIMIT_MAX:
        raise HTTPException(status_code=429, detail="Too many messages — please wait a moment and try again")
    times.append(now)
    _ask_ai_chat_request_times[user_id] = times


@router.post("/ask-ai-chat")
async def ask_ai_chat(body: AskAIChatRequest, request: Request):
    """General "how do I use DubMaster" help chat. Separate from /ask-ai (which
    rewrites a segment's dialogue text) — available to all plan tiers, no tier
    check, but still requires login so this doesn't repeat the same unmetered/
    unauthenticated exposure /ask-ai had before its fix.
    """
    import httpx

    auth_header = request.headers.get("Authorization", "")
    token = auth_header.removeprefix("Bearer ").strip()
    user_id = verify_jwt(token)

    _check_ask_ai_chat_rate_limit(user_id)

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="AI not configured")

    messages = [{"role": m.role, "content": m.content} for m in body.history]
    messages.append({"role": "user", "content": body.message})

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": "claude-sonnet-4-6",
                    "max_tokens": 400,
                    "system": _ASK_AI_CHAT_SYSTEM_PROMPT,
                    "messages": messages,
                },
            )
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail="AI request failed")

        text = resp.json().get("content", [{}])[0].get("text", "")
        return {"status": "ok", "reply": text.strip()}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[ASK-AI-CHAT] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─── Emotional Intelligence Library ──────────────────────────────────────────

@router.get("/emotional-library")
async def get_emotional_library(request: Request):
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.removeprefix("Bearer ").strip()
    user_id = verify_jwt(token)
    from app.services.supabase_client import supabase_writer
    result = supabase_writer.table("emotional_library") \
        .select("*") \
        .eq("user_id", user_id) \
        .order("created_at", desc=True) \
        .execute()
    return {"chords": result.data or []}

@router.post("/emotional-library")
async def save_emotional_chord(request: Request):
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.removeprefix("Bearer ").strip()
    user_id = verify_jwt(token)
    body = await request.json()
    from app.services.supabase_client import supabase_writer
    result = supabase_writer.table("emotional_library").insert({
        "user_id": user_id,
        "name": body.get("name", "Unnamed"),
        "emotion": body["emotion"],
        "state": body["state"],
        "trait": body["trait"],
        "intensity": body.get("intensity", 0.5),
    }).execute()
    return result.data[0] if result.data else {}

@router.delete("/emotional-library/{chord_id}")
async def delete_emotional_chord(chord_id: str, request: Request):
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.removeprefix("Bearer ").strip()
    user_id = verify_jwt(token)
    from app.services.supabase_client import supabase_writer
    supabase_writer.table("emotional_library") \
        .delete() \
        .eq("id", chord_id) \
        .eq("user_id", user_id) \
        .execute()
    return {"status": "ok"}

@router.delete("/emotional-library")
async def clear_emotional_library(request: Request):
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.removeprefix("Bearer ").strip()
    user_id = verify_jwt(token)
    from app.services.supabase_client import supabase_writer
    supabase_writer.table("emotional_library") \
        .delete() \
        .eq("user_id", user_id) \
        .execute()
    return {"status": "ok"}


@router.post("/ei/curves")
async def save_ei_curve(request: Request):
    """Save a named emotion curve to the user's EI library."""
    from datetime import datetime as _dt
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.removeprefix("Bearer ").strip()
    user_id = verify_jwt(token)
    body = await request.json()
    from app.services.supabase_client import supabase_writer
    core_emotion = body.get("core_emotion", "") or "neutral"
    result = supabase_writer.table("emotional_library").insert({
        "user_id": user_id,
        "name": body.get("name", "Unnamed Curve"),
        "emotion": core_emotion,
        "state": "",
        "trait": "",
        "intensity": 0.5,
        "curve": body.get("curve", []),
        "duration": body.get("duration", 0),
        "core_emotion": core_emotion,
        "source_segment_text": body.get("source_segment_text", ""),
        "tags": body.get("tags", []),
        "description": body.get("description", ""),
        "created_at": _dt.utcnow().isoformat() + "Z",
    }).execute()
    return result.data[0] if result.data else {}


@router.get("/ei/curves")
async def list_ei_curves(request: Request):
    """Return all saved emotion curves for the authenticated user."""
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.removeprefix("Bearer ").strip()
    user_id = verify_jwt(token)
    from app.services.supabase_client import supabase_writer
    result = supabase_writer.table("emotional_library") \
        .select("id, name, curve, duration, core_emotion, source_segment_text, tags, description, created_at") \
        .eq("user_id", user_id) \
        .not_.is_("curve", "null") \
        .order("created_at", desc=True) \
        .execute()
    return {"curves": result.data or []}


@router.delete("/ei/curves/{curve_id}")
async def delete_ei_curve(curve_id: str, request: Request):
    """Delete a saved emotion curve by ID."""
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.removeprefix("Bearer ").strip()
    user_id = verify_jwt(token)
    from app.services.supabase_client import supabase_writer
    supabase_writer.table("emotional_library") \
        .delete() \
        .eq("id", curve_id) \
        .eq("user_id", user_id) \
        .execute()
    return {"status": "ok"}


@router.get("/jobs/{job_id}/character-profiles", dependencies=[Depends(_dep_job_access)])
async def get_character_profiles(job_id: str, request: Request):
    """Return the per-job character profiles."""
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.removeprefix("Bearer ").strip()
    verify_jwt(token)
    job = await job_manager.get_job(job_id)
    return {"character_profiles": job.character_profiles or []}


@router.put("/jobs/{job_id}/character-profiles", dependencies=[Depends(_dep_job_access)])
async def save_character_profiles(job_id: str, request: Request):
    """Save per-job character profiles. Body: {character_profiles: [{name, traits, speech_style}]}"""
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.removeprefix("Bearer ").strip()
    verify_jwt(token)
    body = await request.json()
    profiles = body.get("character_profiles", [])
    job = await job_manager.get_job(job_id)
    job.character_profiles = profiles
    job_manager._jobs[job_id] = job
    import json, os
    settings = get_settings()
    meta_path = os.path.join(settings.DUBBED_DIR, job_id, "character_profiles.json")
    os.makedirs(os.path.dirname(meta_path), exist_ok=True)
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(profiles, f, ensure_ascii=False, indent=2)
    return {"status": "ok", "count": len(profiles)}
