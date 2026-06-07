from typing import Optional, Dict, List
from pydantic import BaseModel
import fastapi
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks, Request, Body
from fastapi.responses import JSONResponse, FileResponse, Response
import uuid
import os
import json as _json
from pathlib import Path
import logging
import asyncio
import torchaudio
import re
import hashlib
import traceback

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
    RegenerateRequest,
)
from app.config import get_settings
from app.storage.manager import StorageManager
from app.services.job_manager import job_manager
from app.services.supabase_client import verify_jwt
from app.pipeline.chunk_video import VideoChunker
from app.pipeline.extract_audio import extract_audio
from app.pipeline.diarize_audio import diarize_audio
from app.pipeline.transcribe_audio import transcribe_audio
from app.pipeline.velma_diarize import velma_diarize
from app.pipeline.classify_speakers import classify_speakers
from app.services.dubbing_service import dubbing_service
from app.services.lipsync_service import lipsync_service
from app.services.transcription_service import transcription_service
from app.services.elevenlabs_tts import elevenlabs_tts
from app.services.fish_audio_tts import fish_audio_tts
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
    upload_dir = Path(settings.UPLOAD_DIR) / job_id
    if not upload_dir.exists():
        return None

    files = [p for p in upload_dir.iterdir() if p.is_file()]
    if not files:
        return None

    for file_path in files:
        if file_path.suffix.lower() in settings.ALLOWED_VIDEO_FORMATS:
            return file_path.name, str(file_path)

    # Fallback: pick the first file if no known extension matches.
    fallback = files[0]
    return fallback.name, str(fallback)


def _load_transcript_from_disk(job_id: str) -> Transcript | None:
    transcript_path = Path("data/transcripts") / f"{job_id}.json"
    if not transcript_path.exists():
        return None

    try:
        import json

        with open(transcript_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        segments = [
            TranscriptSegment(
                text=seg.get("text", ""),
                start=seg.get("start", 0),
                end=seg.get("end", 0),
                speaker=seg.get("speaker", "speaker-1"),
            )
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
        return None

    video_name, video_path = video_info
    video_size = os.path.getsize(video_path)

    await job_manager.create_job(
        job_id=job_id,
        video_filename=video_name,
        video_path=video_path,
        video_size=video_size,
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

        # Restore dubbed video URL if a dubbed file exists on disk
        dubbed_dir = os.path.join(settings.DUBBED_DIR, job_id)
        if os.path.isdir(dubbed_dir):
            import glob as _glob
            dubbed_files = _glob.glob(os.path.join(dubbed_dir, "dubbed_*.mp4"))
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
        assigned.append(
            TranscriptSegment(
                text=seg.get("text", ""),
                start=seg.get("start", 0),
                end=seg.get("end", 0),
                speaker=speaker or "speaker-1",
            )
        )

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
            )
            merge_counts[-1] += 1
        else:
            merged.append(seg)
            merge_counts.append(1)

    return merged

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

async def _run_diarization_with_heartbeat(job_id: str, extract_result: dict, timeout_sec: int) -> dict:
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
        asyncio.to_thread(diarize_audio, extract_result, job_id)
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
    Return a publicly accessible URL for the video file so RunPod can download it.

    Prefers Cloudflare R2 (stable, no tunnel required).
    Raises RuntimeError if R2 is not configured or all upload attempts fail.
    """
    r2_bucket   = os.getenv("R2_BUCKET_NAME", "")
    r2_key_id   = os.getenv("R2_ACCESS_KEY_ID", "")
    r2_secret   = os.getenv("R2_SECRET_ACCESS_KEY", "")
    r2_account  = os.getenv("R2_ACCOUNT_ID", "")
    r2_pub_url  = os.getenv("R2_PUBLIC_URL", "").rstrip("/")

    if r2_bucket and r2_key_id and r2_secret and r2_account:
        import re
        import boto3
        from botocore.config import Config

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
        object_key = f"{job_id}/{safe_name}"
        last_r2_err = None

        for attempt in range(1, 4):
            try:
                logger.info(f"Job {job_id}: uploading video to R2 (attempt {attempt}/3) → {r2_bucket}/{object_key}")
                await asyncio.get_event_loop().run_in_executor(
                    None,
                    lambda: s3.upload_file(
                        video_path,
                        r2_bucket,
                        object_key,
                        ExtraArgs={"ContentType": "video/mp4"},
                    ),
                )
                url = s3.generate_presigned_url(
                    "get_object",
                    Params={"Bucket": r2_bucket, "Key": object_key},
                    ExpiresIn=7200,
                )
                logger.info(f"Job {job_id}: R2 upload complete, presigned URL generated")
                return url
            except Exception as r2_err:
                last_r2_err = r2_err
                logger.warning(f"Job {job_id}: R2 upload attempt {attempt}/3 failed: {r2_err}")
                if attempt < 3:
                    await asyncio.sleep(2)

        raise RuntimeError(f"R2 upload failed after 3 attempts: {last_r2_err}")

    raise RuntimeError(
        "No video URL available for RunPod: configure R2_BUCKET_NAME / R2_ACCESS_KEY_ID / "
        "R2_SECRET_ACCESS_KEY / R2_ACCOUNT_ID in .env."
    )


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
            # Disable VAD for Cantonese — fight-scene audio triggers aggressive speech filtering
            # that removes all dialogue. large-v3 with no VAD is more reliable for mixed content.
            gpu_env_vars.setdefault("VAD_THRESHOLD", "0")

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

    result = await runpod_service.poll_until_complete(
        runpod_job_id=runpod_job_id,
        timeout=runpod_poll_timeout,
        progress_callback=_progress_cb,
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

    diarization_segments = (result.get("diarization", {}) or {}).get("segments", [])

    # Fetch expected speakers once — used by both Velma and F0 fallback below
    _job_for_f0 = await job_manager.get_job(job_id)
    _exp_spk_f0 = (_job_for_f0.expected_speakers if _job_for_f0 else 0) or 0

    # Try Velma diarization first (primary source)
    velma_audio_path = video_path
    velma_result = None
    if os.getenv("MODULATE_API_KEY") and velma_audio_path:
        try:
            logger.info(f"Job {job_id}: RunPod path — attempting Velma diarization (primary)")
            velma_result = await asyncio.to_thread(
                velma_diarize, velma_audio_path, job_id, _exp_spk_f0
            )
        except Exception as _velma_err:
            logger.warning(f"Job {job_id}: Velma diarization failed: {_velma_err}")

    if velma_result and velma_result.get("status") == "ok":
        diarization_segments = velma_result.get("segments", [])
        logger.info(
            f"Job {job_id}: using Velma diarization (primary) — "
            f"{len(diarization_segments)} segments, {velma_result.get('unique_speakers', '?')} speakers"
        )
    # else: keep diarization_segments from RunPod as fallback (already set above)

    segments = [
        TranscriptSegment(
            text=seg.get("text", ""),
            start=seg.get("start", 0),
            end=seg.get("end", 0),
            speaker=seg.get("speaker", "speaker-1"),
            velma_emotion=seg.get("velma_emotion"),
            velma_accent=seg.get("velma_accent"),
            velma_deepfake_score=seg.get("velma_deepfake_score"),
        )
        for seg in segments_data
        if seg.get("text", "").strip()
    ]

    if not segments and transcript_data.get("segments"):
        for seg in transcript_data["segments"]:
            segments.append(
                TranscriptSegment(
                    text=seg.get("text", ""),
                    start=seg.get("start", 0),
                    end=seg.get("end", 0),
                    speaker=seg.get("speaker", "speaker-1"),
                )
            )

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
                    _f0_extract = await asyncio.to_thread(extract_audio, video_path)
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

    # Quality gate: some worker versions can return an empty transcript (0
    # segments) even though the job ran. For Cantonese jobs, fall back to local
    # transcription so the user can still dub.
    if (not segments) and whisper_language and whisper_language.lower() in ("yue", "zh-yue", "yue-hk", "zh-hk"):
        logger.warning(
            f"Job {job_id}: GPU transcript is empty for lang={whisper_language!r}. "
            "Falling back to local transcription."
        )
        try:
            from app.pipeline.transcribe_cantonese import transcribe_cantonese

            prev_lang = os.environ.get("WHISPER_LANGUAGE")
            os.environ["WHISPER_LANGUAGE"] = whisper_language or "yue"
            extract_result = extract_audio(video_path)
            local_result = transcribe_cantonese(extract_result, job_id=job_id)
            if prev_lang is None:
                os.environ.pop("WHISPER_LANGUAGE", None)
            else:
                os.environ["WHISPER_LANGUAGE"] = prev_lang

            local_segments_raw = (local_result or {}).get("segments") or []
            if local_segments_raw:
                segments = [
                    TranscriptSegment(
                        text=(s.get("text") or "").strip(),
                        start=s.get("start", 0),
                        end=s.get("end", 0),
                        speaker=s.get("speaker", "speaker-1"),
                    )
                    for s in local_segments_raw
                    if (s.get("text") or "").strip()
                ]

                # RunPod handler doesn't return diarization data — run it locally now
                # so speaker labels are assigned before the transcript is saved.
                if not diarization_segments and extract_result:
                    try:
                        local_diarize = diarize_audio(extract_result, job_id=job_id)
                        if local_diarize.get("status") == "ok":
                            diarization_segments = local_diarize.get("segments", [])
                            logger.info(
                                f"Job {job_id}: local diarization (empty-transcript fallback) "
                                f"found {len(diarization_segments)} speaker turns"
                            )
                    except Exception as diar_err:
                        logger.warning(f"Job {job_id}: local diarization failed in empty-transcript fallback: {diar_err}")

                if diarization_segments and segments:
                    raw_segments = [
                        {"text": s.text, "start": s.start, "end": s.end, "speaker": s.speaker}
                        for s in segments
                    ]
                    reassigned = _assign_speakers_from_diarization(raw_segments, diarization_segments)
                    reassigned = _smooth_speaker_assignments(reassigned)
                    reassigned = _normalize_speaker_labels(reassigned)
                    if reassigned:
                        segments = reassigned

                logger.info(
                    f"Job {job_id}: local transcription fallback (empty transcript) succeeded "
                    f"(segments={len(segments)})."
                )
            else:
                logger.warning(f"Job {job_id}: local transcription fallback returned no segments")
        except Exception as e:
            logger.error(f"Job {job_id}: local transcription fallback failed: {e}")

    # Quality gate: if GPU transcript is CJK character-soup (tons of 1–2 char
    # segments), fall back to local transcription which previously produced
    # sentence-level output.
    if _is_low_quality_cjk_transcript(segments, whisper_language):
        logger.warning(
            f"Job {job_id}: GPU transcript is low-quality CJK character soup for lang={whisper_language!r}. "
            "Falling back to local transcription."
        )
        try:
            from app.pipeline.extract_audio import extract_audio
            from app.pipeline.transcribe_cantonese import transcribe_cantonese

            prev_lang = os.environ.get("WHISPER_LANGUAGE")
            os.environ["WHISPER_LANGUAGE"] = whisper_language or "yue"
            extract_result = extract_audio(video_path)
            local_result = transcribe_cantonese(extract_result, job_id=job_id)
            if prev_lang is None:
                os.environ.pop("WHISPER_LANGUAGE", None)
            else:
                os.environ["WHISPER_LANGUAGE"] = prev_lang

            local_segments_raw = (local_result or {}).get("segments") or []
            if local_segments_raw:
                segments = [
                    TranscriptSegment(
                        text=(s.get("text") or "").strip(),
                        start=s.get("start", 0),
                        end=s.get("end", 0),
                        speaker=s.get("speaker", "speaker-1"),
                    )
                    for s in local_segments_raw
                    if (s.get("text") or "").strip()
                ]

                # RunPod handler doesn't return diarization data — run it locally now
                # so speaker labels are assigned before the transcript is saved.
                if not diarization_segments and extract_result:
                    try:
                        local_diarize = diarize_audio(extract_result, job_id=job_id)
                        if local_diarize.get("status") == "ok":
                            diarization_segments = local_diarize.get("segments", [])
                            logger.info(
                                f"Job {job_id}: local diarization (CJK-quality fallback) "
                                f"found {len(diarization_segments)} speaker turns"
                            )
                    except Exception as diar_err:
                        logger.warning(f"Job {job_id}: local diarization failed in CJK-quality fallback: {diar_err}")

                if diarization_segments and segments:
                    raw_segments = [
                        {"text": s.text, "start": s.start, "end": s.end, "speaker": s.speaker}
                        for s in segments
                    ]
                    reassigned = _assign_speakers_from_diarization(raw_segments, diarization_segments)
                    reassigned = _smooth_speaker_assignments(reassigned)
                    reassigned = _normalize_speaker_labels(reassigned)
                    if reassigned:
                        segments = reassigned

                logger.info(
                    f"Job {job_id}: local transcription fallback (low-quality CJK) succeeded "
                    f"(segments={len(segments)})."
                )
            else:
                logger.warning(f"Job {job_id}: local transcription fallback returned no segments")
        except Exception as e:
            logger.error(f"Job {job_id}: local transcription fallback failed: {e}")

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
            )
            for s in segments
            if (s.text or "").strip()
        ]
        segments = _merge_close_transcript_segments(segments)
        after = len(segments)
        if after != before:
            logger.info(f"Job {job_id}: merged micro-fragments after CJK cleanup: {before} -> {after}")

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
            enriched_segments.append(TranscriptSegment(
                text=txt,
                start=s_start,
                end=s_end,
                speaker=spkr,
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
            from app.pipeline.extract_audio import extract_audio
            from app.pipeline.classify_speakers import classify_speakers as _classify

            logger.info(f"Job {job_id}: speaker_genders empty from GPU — running local F0 classification")
            extract_result = extract_audio(video_path)
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
                cloud_transcribe, vocals_path, whisper_language or "yue", job_id
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
                expected_speakers = job.expected_speakers if job and hasattr(job, "expected_speakers") else 3

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
                velma_audio_path = vocals_path or video_path
                if os.getenv("MODULATE_API_KEY") and velma_audio_path:
                    try:
                        logger.info(f"Job {job_id}: attempting Velma diarization")
                        velma_result = await asyncio.to_thread(
                            velma_diarize, velma_audio_path, job_id, _exp_spk
                        )
                    except Exception as _velma_err:
                        logger.warning(f"Job {job_id}: Velma diarization failed: {_velma_err}")

                if velma_result and velma_result.get("status") == "ok":
                    diarization_segments = velma_result.get("segments", [])
                    logger.info(f"Job {job_id}: using Velma diarization — {len(diarization_segments)} segments")
                else:
                    # Fall back to existing pyannote/cloud diarization
                    if is_cloud_enabled() and vocals_path:
                        logger.info(f"Job {job_id}: using CLOUD GPU for diarization")
                        diarization_result = await asyncio.to_thread(
                            cloud_diarize, vocals_path, min_speakers, max_speakers, job_id
                        )
                        if diarization_result.get("status") != "ok":
                            logger.warning(f"Job {job_id}: cloud diarization failed, falling back to local")
                            diarization_result = await _run_diarization_with_heartbeat(
                                job_id, diarize_input, diarization_timeout_sec,
                            )
                    else:
                        logger.info(
                            f"Job {job_id}: diarization using "
                            f"{'separated vocals' if diarize_input is not extract_result else 'original audio'}"
                        )
                        diarization_result = await _run_diarization_with_heartbeat(
                            job_id, diarize_input, diarization_timeout_sec,
                        )

                    if diarization_result.get("status") == "ok":
                        diarization_segments = diarization_result.get("segments", [])
                    else:
                        logger.info(
                            f"Diarization skipped: {diarization_result.get('reason', 'unknown')}"
                        )

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
                        segments.append(
                            TranscriptSegment(
                                text=seg.get("text", ""),
                                start=seg.get("start", 0),
                                end=seg.get("end", 0),
                                speaker=f"speaker-{speaker_idx + 1}"
                            )
                        )
                
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


@router.post("/upload", response_model=UploadResponse)
async def upload_video(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    source_language: Optional[str] = Form(None),
    num_speakers: Optional[int] = Form(None),
):
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.removeprefix("Bearer ").strip()
    user_id = verify_jwt(token)

    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in settings.ALLOWED_VIDEO_FORMATS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file format. Allowed: {', '.join(settings.ALLOWED_VIDEO_FORMATS)}"
        )

    # Normalize source language. "auto"/empty → leave as None so detection runs.
    src_lang: Optional[str] = None
    if source_language:
        normalized = normalize_language_code(source_language, allow_auto=True)
        if normalized and normalized != "auto":
            src_lang = normalized

    # Heuristic default: if user didn't pick a source language, but the filename
    # strongly suggests Cantonese, persist yue so the UI doesn't show "none".
    if not src_lang:
        try:
            fn = (file.filename or "").lower()
            if "canton" in fn or "cantonese" in fn or " yue" in fn or "_yue" in fn or "-yue" in fn:
                src_lang = "yue"
        except Exception:
            pass

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

        # Persist source language and expected speaker count on the job so
        # the transcription and diarization stages can use them.
        if src_lang or (num_speakers is not None and 1 <= num_speakers <= 10):
            job_for_lang = await job_manager.get_job(job_id)
            if job_for_lang:
                if src_lang:
                    job_for_lang.source_language = src_lang
                    logger.info(f"Job {job_id}: source_language set to {src_lang!r} from upload request")
                if num_speakers is not None and 1 <= num_speakers <= 10:
                    job_for_lang.expected_speakers = num_speakers
                    logger.info(f"Job {job_id}: expected_speakers set to {num_speakers} from upload request")
        
        await job_manager.update_job_status(
            job_id,
            JobStatus.UPLOADING,
            progress=5,
            current_stage="Uploading file"
        )
        
        file_size = 0
        with open(video_path, "wb") as f:
            while chunk := await file.read(1024 * 1024):
                f.write(chunk)
                file_size += len(chunk)
                
                if file_size > settings.MAX_UPLOAD_SIZE:
                    os.remove(video_path)
                    await job_manager.delete_job(job_id)
                    raise HTTPException(
                        status_code=413,
                        detail=f"File too large. Max size: {settings.MAX_UPLOAD_SIZE / (1024**3):.1f}GB"
                    )
        
        job = await job_manager.get_job(job_id)
        if job:
            job.video_size = file_size
        
        logger.info(f"File uploaded: {file.filename} ({file_size} bytes) -> Job {job_id}")
        
        background_tasks.add_task(process_video_pipeline, job_id, video_path)
        
        return UploadResponse(
            job_id=job_id,
            status="accepted",
            message="Video uploaded successfully, processing started",
            video_filename=file.filename,
            video_size=file_size
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Upload failed: {e}")
        await job_manager.delete_job(job_id)
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")


@router.get("/status/{job_id}", response_model=StatusResponse)
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
        expected_speakers=getattr(job, "expected_speakers", 2),
        speaker_genders=job.speaker_genders,
        voice_mapping=job.voice_mapping,
        traits_mapping=job.traits_mapping,
        error_message=job.error_message,
        created_at=job.created_at,
        updated_at=job.updated_at
    )


@router.get("/chunks/{job_id}", response_model=ChunkManifest)
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


@router.get("/transcript/export/{job_id}")
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


@router.get("/transcript/{job_id}")
async def get_transcript(job_id: str):
    job = await _get_or_rehydrate_job(job_id)
    
    if job and job.transcript:
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

    # Clear in-memory jobs — user-scoped only
    cleared_ids: list[str] = []
    if force:
        for jid, job in list(job_manager._jobs.items()):
            if job.user_id == user_id:
                cleared_ids.append(jid)
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
            job_manager._jobs.pop(jid, None)

    # Delete from Supabase — scoped to this user (CASCADE removes segments + speakers)
    if cleared_ids:
        try:
            from app.services.supabase_client import supabase
            for jid in cleared_ids:
                supabase.table("jobs").delete().eq(
                    "job_id", jid
                ).eq("user_id", user_id).execute()
        except Exception as exc:
            logger.warning(f"[CLEAR-ALL] Supabase delete failed: {exc}")

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


@router.delete("/job/{job_id}")
@router.delete("/jobs/{job_id}")
async def delete_job(job_id: str, request: Request):
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.removeprefix("Bearer ").strip()
    user_id = verify_jwt(token)

    # Verify ownership before deleting
    job = await job_manager.get_job(job_id)
    if job and job.user_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Delete from Supabase (CASCADE removes segments + job_speakers)
    try:
        from app.services.supabase_client import supabase
        supabase.table("jobs").delete().eq(
            "job_id", job_id
        ).eq("user_id", user_id).execute()
    except Exception as exc:
        logger.warning(f"Job {job_id}: Supabase delete failed: {exc}")

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

    return {"message": f"Job {job_id} deleted successfully"}


@router.patch("/jobs/{job_id}/voice-mapping", status_code=204)
async def update_voice_mapping(job_id: str, body: Dict[str, str] = Body(...)):
    """Persist a speaker_id → voice_key mapping for this job."""
    job = await _get_or_rehydrate_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    job.voice_mapping = body
    logger.info(f"[VOICE MAP] Job {job_id} voice mapping updated: {body}")


@router.patch("/jobs/{job_id}/traits-mapping", status_code=204)
async def update_traits_mapping(job_id: str, body: Dict[str, List[str]] = Body(...)):
    """Persist a speaker_id → traits[] mapping for this job. Applied on regenerate
    via segment.attached_traits, and on initial batch dub via Job.traits_mapping."""
    job = await _get_or_rehydrate_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    job.traits_mapping = body
    logger.info(f"[TRAITS MAP] Job {job_id} traits mapping updated: {body}")


@router.patch("/jobs/{job_id}/speaker-reassign", status_code=204)
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


@router.post("/jobs/{job_id}/cancel")
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


@router.get("/projects")
async def list_projects():
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
                    projects.append(_json.load(f))
                continue
            except Exception:
                pass
        projects.append({"project_id": entry.name})
    projects.sort(key=lambda p: p.get("updated_at") or p.get("created_at") or "", reverse=True)
    return {"total": len(projects), "projects": projects}


@router.post("/projects/save/{job_id}")
async def save_project(job_id: str):
    job = await job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    from datetime import datetime

    project_id = job_id
    base = _projects_base_dir() / project_id
    base.mkdir(parents=True, exist_ok=True)

    now = datetime.utcnow().isoformat()
    meta = {
        "project_id": project_id,
        "job_id": job_id,
        "video_filename": getattr(job, "video_filename", None),
        "source_language": getattr(job, "source_language", None),
        "created_at": now,
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
async def delete_project(project_id: str):
    import shutil
    base = _projects_base_dir() / project_id
    if not base.exists():
        raise HTTPException(status_code=404, detail="Project not found")
    shutil.rmtree(base)
    return {"deleted": True, "project_id": project_id}


@router.post("/cleanup")
async def cleanup_old_files():
    try:
        storage.cleanup_old_files()
        return {"message": "Cleanup completed successfully"}
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
async def run_adaptation(request: AdaptRequest):
    """
    On-demand: generate 3 adaptation variants (faithful / performable / sync_fit)
    for the provided segments. Called by the editor when the Adaptation Panel is
    opened. Does NOT trigger TTS — variants are stored in editor state only.
    Always returns HTTP 200; sets fallback=True if the LLM was unavailable.
    """
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
async def dub_video(request: DubRequest, background_tasks: BackgroundTasks):
    job = await _get_or_rehydrate_job(request.job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Job not found. Please upload the video first.")

    req_speakers = set((seg.speaker or "speaker-1") for seg in (request.transcript or []))
    job_segments = (job.transcript.segments if job and job.transcript and job.transcript.segments else [])
    job_speakers = set((seg.speaker or "speaker-1") for seg in job_segments)

    # CRITICAL: Always use request.transcript, never fall back to cached job_segments.
    # The previous fallback (if req_speakers <= 1 and job_speakers > 1) caused
    # cross-job contamination: fresh dub requests would inherit stale segments
    # from previously cached jobs still in memory, resulting in old translated
    # text being written to the fresh job's segments.json.
    transcript_source = request.transcript

    transcript_dicts = [
        {
            "text": seg.text,
            "start": seg.start,
            "end": seg.end,
            "speaker": seg.speaker,
            "velma_emotion": seg.velma_emotion,
            "velma_accent": seg.velma_accent,
            "velma_deepfake_score": seg.velma_deepfake_score,
        }
        for seg in transcript_source
    ]

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

    target_lang = normalize_language_code(request.target_language)
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
    )

    return DubResponse(
        job_id=request.job_id,
        status="processing",
        dubbed_video_url=None,
        tts_engine=None,
        dubbing_engine="dubmaster",
        message="Dubbing started, poll /api/status for progress"
    )


@router.get("/download/{job_id}/{language}")
async def download_dubbed_video(job_id: str, language: str):
    dubbed_path = os.path.join(settings.DUBBED_DIR, job_id, f"dubbed_{language}.mp4")
    
    if not os.path.exists(dubbed_path):
        raise HTTPException(status_code=404, detail="Dubbed video not found")
    
    return FileResponse(
        dubbed_path,
        media_type="video/mp4",
        headers={"Content-Disposition": "inline"},
    )


@router.get("/media/{job_id}/video")
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
    return FileResponse(job.video_path, media_type=media_types.get(ext, "video/mp4"))


@router.get("/media/{job_id}/audio/{filename}")
async def serve_job_audio(job_id: str, filename: str):
    """Serve a dubbed audio file so Sync.Labs can fetch it by URL."""
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    audio_path = os.path.join(settings.DUBBED_DIR, job_id, filename)
    if not os.path.exists(audio_path):
        raise HTTPException(status_code=404, detail="Audio file not found")
    ext = Path(filename).suffix.lower()
    media_types = {".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4"}
    return FileResponse(audio_path, media_type=media_types.get(ext, "audio/mpeg"))


@router.get("/media/{job_id}/separated/{audio_type}")
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


@router.get("/media/{job_id}/{filename}")
async def serve_job_audio_legacy(job_id: str, filename: str):
    """Backwards-compat: serve segment audio without the /audio/ sub-path.
    Resolves stale URLs persisted in client localStorage before the /audio/
    sub-path was introduced to the getAudioFileUrl helper."""
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    audio_path = os.path.join(settings.DUBBED_DIR, job_id, filename)
    if not os.path.exists(audio_path):
        raise HTTPException(status_code=404, detail="Audio file not found")
    ext = Path(filename).suffix.lower()
    media_types = {".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4"}
    return FileResponse(audio_path, media_type=media_types.get(ext, "audio/mpeg"))


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


@router.get("/pipeline/{job_id}")
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


@router.post("/worker-stage")
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


@router.get("/gpu-status")
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


@router.get("/tts-provider")
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


@router.post("/tts-provider")
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


@router.get("/voices")
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


@router.get("/voice-preview/{voice_id:path}")
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


@router.get("/voices/by-id/{voice_id:path}")
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
# Quality Analysis endpoints
# ---------------------------------------------------------------------------

@router.post("/analyze/{job_id}/{language}")
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


@router.get("/analysis/{job_id}/{language}")
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


@router.post("/dub/remix/{job_id}")
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
    return result


class ExportRequest(BaseModel):
    resolution: str = "1080p"   # "720p" | "1080p" | "4k"
    aspect: str = "widescreen"  # "widescreen" | "fill"
    format: str = "mp4"         # "mp4" | "mov" | "avi" | "mkv"


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


@router.post("/dub/export/{job_id}")
async def export_video(job_id: str, body: ExportRequest, request: Request):
    """Re-encode the dubbed video with selected resolution, aspect and format."""
    import subprocess as _sp
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.removeprefix("Bearer ").strip()
    verify_jwt(token)

    output_dir = os.path.join(settings.DUBBED_DIR, job_id)
    if not os.path.isdir(output_dir):
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    # Find master dubbed video
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

    # Build vf filter
    if body.aspect == "fill":
        vf = f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h}"
    else:
        vf = f"scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2"

    out_filename = f"export_{res}_{body.aspect}.{fmap['ext']}"
    out_path = os.path.join(output_dir, out_filename)

    cmd = [
        "ffmpeg", "-y", "-i", src,
        "-vf", vf,
        "-vcodec", fmap["vcodec"],
        "-acodec", fmap["acodec"],
        "-preset", "fast",
        "-crf", "18",
    ] + fmap["extra"] + [out_path]

    try:
        proc = await asyncio.to_thread(
            _sp.run, cmd, capture_output=True, text=True, timeout=600
        )
        if proc.returncode != 0:
            logger.error(f"[EXPORT] ffmpeg failed: {proc.stderr[-500:]}")
            raise RuntimeError("FFmpeg encode failed")
    except _sp.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Export timed out")
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    logger.info(f"[EXPORT] job={job_id} res={res} aspect={body.aspect} fmt={fmt}")
    return {
        "job_id": job_id,
        "download_url": f"/api/dub/export/download/{job_id}/{out_filename}",
        "filename": out_filename,
    }


@router.get("/dub/export/download/{job_id}/{filename}")
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


@router.get("/segments/{job_id}")
async def get_segments(job_id: str):
    segments_path = os.path.join(settings.DUBBED_DIR, job_id, "segments.json")
    if not os.path.exists(segments_path):
        raise HTTPException(status_code=404, detail=f"segments.json not found for job {job_id}")
    with open(segments_path, "r", encoding="utf-8") as f:
        data = _json.load(f)
    return data


@router.get("/segments/{job_id}/snapshot")
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


@router.patch("/segment/commit/{job_id}/{index}")
async def commit_segment_timing(job_id: str, index: int, body: dict, request: Request):
    """Save committed timing and audio URL for a single segment to Supabase and segments.json."""
    from app.services.supabase_client import supabase_writer
    committed_start_time = body.get("committed_start_time")
    committed_end_time = body.get("committed_end_time")
    committed_audio_url = body.get("committed_audio_url")
    committed_adapted_text = body.get("committed_adapted_text")
    # Update Supabase
    update_data = {"sequence": index}
    if committed_start_time is not None:
        update_data["committed_start_time"] = committed_start_time
    if committed_end_time is not None:
        update_data["committed_end_time"] = committed_end_time
    if committed_audio_url is not None:
        update_data["committed_audio_url"] = committed_audio_url
    if committed_adapted_text is not None:
        update_data["committed_adapted_text"] = committed_adapted_text
    try:
        supabase_writer.table("segments").update(update_data).eq("job_id", job_id).eq("sequence", index).execute()
    except Exception as e:
        logger.warning(f"Supabase segment commit failed: {e}")
    # Also update segments.json on disk
    segments_path = os.path.join(settings.DUBBED_DIR, job_id, "segments.json")
    if os.path.exists(segments_path):
        with open(segments_path, "r", encoding="utf-8") as f:
            data = _json.load(f)
        segs = data.get("segments", [])
        if index < len(segs):
            if committed_start_time is not None:
                segs[index]["committed_start_time"] = committed_start_time
            if committed_end_time is not None:
                segs[index]["committed_end_time"] = committed_end_time
            if committed_audio_url is not None:
                segs[index]["committed_audio_url"] = committed_audio_url
            if committed_adapted_text is not None:
                segs[index]["committed_adapted_text"] = committed_adapted_text
            data["segments"] = segs
            with open(segments_path, "w", encoding="utf-8") as f:
                _json.dump(data, f, indent=2, ensure_ascii=False)
    return {"status": "ok", "job_id": job_id, "index": index}


@router.post("/segment/reset/{job_id}/{index}")
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
    with open(segments_path, "w", encoding="utf-8") as f:
        _json.dump(data, f, indent=2, ensure_ascii=False)
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


@router.post("/segment/regenerate/{job_id}/{index}")
async def regenerate_segment(job_id: str, index: int, body: RegenerateRequest):
    try:
        voice_id = body.voice_id
        speed = body.speed
        speed_ratio = None
        target_duration = None

        # Resolve canonical voice key (e.g. "male-1") to Fish Audio reference_id
        if body.voice_key and not voice_id:
            resolved = fish_audio_tts.get_voice_id(body.voice_key)
            if resolved:
                voice_id = resolved

        if getattr(body, "voice_params", None):
            if body.voice_params.voice_id is not None:
                voice_id = body.voice_params.voice_id
            if body.voice_params.speed is not None:
                speed = body.voice_params.speed
            speed_ratio = body.voice_params.speed_ratio
            target_duration = body.voice_params.target_duration

        seg = await dubbing_service.regenerate_segment(
            job_id=job_id,
            segment_index=index,
            voice_id=voice_id,
            speed=speed,
            speed_ratio=speed_ratio,
            target_duration=target_duration,
            emotion=body.emotion,
            traits=body.traits,
            pitch=body.pitch,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"status": "ok", "segment": seg}


class AskAIRequest(BaseModel):
    prompt: str
    source_text: str = ""
    dubbed_text: str = ""
    source_language: str = "zh"
    target_language: str = "en"
    speaker_label: str = ""
    speaker_gender: str = "male"


@router.post("/ask-ai")
async def ask_ai(body: AskAIRequest):
    """Ask Claude to improve a dubbed segment based on a user prompt."""
    import httpx, re as _re

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="AI not configured")

    system_prompt = (
        "You are an expert dubbing editor and dialogue writer. "
        "Your job is to improve dubbed dialogue so it sounds natural, "
        "matches the character's emotion, fits lip-sync timing, and reads well when spoken aloud. "
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
                    "model": "claude-haiku-4-5-20251001",
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
