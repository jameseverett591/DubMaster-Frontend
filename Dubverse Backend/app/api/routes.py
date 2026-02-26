from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse, FileResponse
import uuid
import os
from pathlib import Path
import logging
import asyncio

from app.models import (
    UploadResponse,
    StatusResponse,
    ChunkManifest,
    JobStatus,
    DubRequest,
    DubResponse,
    Transcript,
    TranscriptSegment,
)
from app.config import get_settings
from app.storage.manager import StorageManager
from app.services.job_manager import job_manager
from app.pipeline.chunk_video import VideoChunker
from app.pipeline.extract_audio import extract_audio
from app.pipeline.diarize_audio import diarize_audio
from app.pipeline.transcribe_audio import transcribe_audio
from app.pipeline.classify_speakers import classify_speakers
from app.services.dubbing_service import dubbing_service
from app.services.lipsync_service import lipsync_service
from app.services.transcription_service import transcription_service
from app.services.elevenlabs_tts import elevenlabs_tts
from app.utils.language import normalize_language_code

logger = logging.getLogger(__name__)
router = APIRouter()

settings = get_settings()
storage = StorageManager()
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
    existing = await job_manager.get_job(job_id)
    if existing:
        return existing

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


def _assign_speakers_from_diarization(raw_segments, diarization_segments):
    if not diarization_segments:
        return None

    diarization_sorted = sorted(diarization_segments, key=lambda x: x.get("start", 0))

    speaker_map = {}
    for seg in diarization_sorted:
        speaker = seg.get("speaker")
        if speaker and speaker not in speaker_map:
            speaker_map[speaker] = f"speaker-{len(speaker_map) + 1}"

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
    for i in range(1, len(segments) - 1):
        seg = segments[i]
        prev_seg = segments[i - 1]
        next_seg = segments[i + 1]
        dur = max(0.0, (seg.end or 0) - (seg.start or 0))
        if dur <= 0.8 and prev_seg.speaker == next_seg.speaker:
            seg.speaker = prev_seg.speaker

    # Pass 2: merge very short rare speakers into nearest neighbor.
    counts = {}
    durations = {}
    for seg in segments:
        counts[seg.speaker] = counts.get(seg.speaker, 0) + 1
        durations[seg.speaker] = durations.get(seg.speaker, 0.0) + max(0.0, seg.end - seg.start)

    for i, seg in enumerate(segments):
        if counts.get(seg.speaker, 0) <= 1 and durations.get(seg.speaker, 0.0) < 2.0:
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
    Run diarization in a worker thread while pulsing progress (86-89) so
    the UI doesn't appear frozen during long diarization passes.
    """
    loop = asyncio.get_running_loop()
    start_time = loop.time()
    pulse_progress = [86, 87, 88, 89]
    pulse_index = 0

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

        await job_manager.update_job_status(
            job_id,
            JobStatus.DIARIZING,
            progress=pulse_progress[pulse_index % len(pulse_progress)],
            current_stage="Identifying speakers",
        )
        pulse_index += 1
        await asyncio.sleep(5)

async def process_video_pipeline(job_id: str, video_path: str):
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
        
        await job_manager.update_job_status(
            job_id,
            JobStatus.TRANSCRIBING,
            progress=60,
            current_stage="Transcribing audio with Whisper"
        )
        
        transcribe_result = await asyncio.to_thread(transcribe_audio, extract_result, job_id)
        
        if transcribe_result["status"] == "ok":
            import json
            transcript_path = transcribe_result.get("transcript_path")
            if transcript_path:
                with open(transcript_path, "r", encoding="utf-8") as f:
                    transcript_data = json.load(f)

                job = await job_manager.get_job(job_id)
                expected_speakers = job.expected_speakers if job and hasattr(job, "expected_speakers") else 3

                raw_segments = transcript_data.get("segments", [])

                await job_manager.update_job_status(
                    job_id,
                    JobStatus.DIARIZING,
                    progress=85,
                    current_stage="Identifying speakers"
                )

                diarization_segments = []
                diarization_timeout_sec = int(os.getenv("DIARIZATION_TIMEOUT_SEC", "120"))
                diarization_result = await _run_diarization_with_heartbeat(
                    job_id,
                    extract_result,
                    diarization_timeout_sec,
                )
                if diarization_result.get("status") == "ok":
                    diarization_segments = diarization_result.get("segments", [])
                else:
                    logger.info(
                        f"Diarization skipped: {diarization_result.get('reason', 'unknown')}"
                    )

                segments = _assign_speakers_from_diarization(raw_segments, diarization_segments)
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

                # Classify each speaker's gender/age from pitch (Fix 2).
                try:
                    speaker_genders = classify_speakers(
                        audio=extract_result["audio"],
                        sample_rate=extract_result["sample_rate"],
                        segments=segments,
                    )
                    if speaker_genders:
                        await job_manager.update_job_speaker_genders(job_id, speaker_genders)
                        logger.info(f"Job {job_id}: speaker genders = {speaker_genders}")
                except Exception as cls_err:
                    logger.warning(f"Job {job_id}: speaker classification failed: {cls_err}")

                transcript = Transcript(
                    language=transcript_data.get("language", "en"),
                    duration=transcript_data.get("duration", 0.0),
                    text=transcript_data.get("text", ""),
                    segments=segments
                )
                
                await job_manager.update_job_transcript(job_id, transcript)
                logger.info(f"Job {job_id}: Transcription complete with {len(segments)} segments")
        else:
            logger.warning(f"Transcription skipped: {transcribe_result.get('reason')}")

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
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...)
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")
    
    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in settings.ALLOWED_VIDEO_FORMATS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file format. Allowed: {', '.join(settings.ALLOWED_VIDEO_FORMATS)}"
        )
    
    job_id = str(uuid.uuid4())
    
    try:
        video_path = storage.get_upload_path(job_id, file.filename)
        
        await job_manager.create_job(
            job_id=job_id,
            video_filename=file.filename,
            video_path=video_path,
            video_size=0
        )
        
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
        video_duration=job.video_duration,
        total_chunks=job.total_chunks,
        processed_chunks=job.processed_chunks,
        chunks=job.chunks,
        dubbed_video_url=job.dubbed_video_url,
        tts_engine=job.tts_engine,
        segment_tts_engines=job.segment_tts_engines,
        speaker_genders=job.speaker_genders,
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
                    "speaker": seg.speaker
                }
                for seg in job.transcript.segments
            ]
        }
    
    import json
    transcript_file = Path("data/transcripts") / f"{job_id}.json"
    if not transcript_file.exists():
        transcript_file = Path("data/transcripts/transcript.json")
    if transcript_file.exists():
        try:
            with open(transcript_file, "r", encoding="utf-8") as f:
                transcript_data = json.load(f)
            
            raw_segments = transcript_data.get("segments", [])
            expected_speakers = 3
            total_segments = len(raw_segments)
            segments_per_speaker = max(1, total_segments // expected_speakers) if total_segments > 0 else 1
            
            segments = []
            for i, seg in enumerate(raw_segments):
                speaker_idx = min(i // segments_per_speaker, expected_speakers - 1)
                segments.append({
                    "text": seg.get("text", ""),
                    "start": seg.get("start", 0),
                    "end": seg.get("end", 0),
                    "speaker": f"speaker-{speaker_idx + 1}"
                })
            
            return {
                "job_id": job_id,
                "language": transcript_data.get("language", "en"),
                "duration": transcript_data.get("duration", 0),
                "text": transcript_data.get("text", ""),
                "segments": segments
            }
        except Exception as e:
            logger.error(f"Error reading transcript file: {e}")
    
    raise HTTPException(status_code=404, detail="Transcript not available yet")


@router.delete("/job/{job_id}")
async def delete_job(job_id: str):
    job = await _get_or_rehydrate_job(job_id)
    
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    storage.delete_job_files(job_id)
    
    deleted = await job_manager.delete_job(job_id)
    
    if deleted:
        return {"message": f"Job {job_id} deleted successfully"}
    else:
        raise HTTPException(status_code=500, detail="Failed to delete job")


@router.get("/jobs")
async def list_all_jobs():
    jobs = await job_manager.list_jobs()
    return {
        "total": len(jobs),
        "jobs": [
            {
                "job_id": job.job_id,
                "status": job.status,
                "progress": job.progress,
                "video_filename": job.video_filename,
                "created_at": job.created_at,
                "updated_at": job.updated_at
            }
            for job in jobs
        ]
    }


@router.post("/cleanup")
async def cleanup_old_files():
    try:
        storage.cleanup_old_files()
        return {"message": "Cleanup completed successfully"}
    except Exception as e:
        logger.error(f"Cleanup failed: {e}")
        raise HTTPException(status_code=500, detail=f"Cleanup failed: {str(e)}")


async def process_dubbing_pipeline(
    job_id: str,
    video_path: str,
    transcript_dicts: list,
    target_lang: str,
    source_lang: str,
    voice_mapping: dict,
    voice_settings: dict | None,
    speaker_genders: dict | None = None,
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


@router.post("/dub", response_model=DubResponse)
async def dub_video(request: DubRequest, background_tasks: BackgroundTasks):
    job = await _get_or_rehydrate_job(request.job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Job not found. Please upload the video first.")

    transcript_dicts = [
        {
            "text": seg.text,
            "start": seg.start,
            "end": seg.end,
            "speaker": seg.speaker,
        }
        for seg in request.transcript
    ]

    detected_lang = job.transcript.language if job and job.transcript else None

    source_lang = request.source_language
    if (not source_lang) or normalize_language_code(source_lang, allow_auto=True) == "auto":
        if detected_lang:
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

    # Reset dubbing-related fields before starting
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
    )

    return DubResponse(
        job_id=request.job_id,
        status="processing",
        dubbed_video_url=None,
        tts_engine=None,
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
        filename=f"dubbed_{language}.mp4"
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


@router.get("/voices")
async def get_available_voices():
    try:
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
            })
        return {"voices": formatted_voices}
    except Exception as e:
        logger.error(f"Failed to fetch voices: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch voices")


@router.get("/voice-preview/{voice_id}")
async def get_voice_preview(voice_id: str):
    """Generate and serve a voice preview sample using ElevenLabs TTS"""
    preview_dir = Path("data/voice_previews")
    preview_dir.mkdir(parents=True, exist_ok=True)
    
    preview_path = preview_dir / f"{voice_id}.mp3"
    
    if preview_path.exists():
        return FileResponse(
            str(preview_path),
            media_type="audio/mpeg",
            filename=f"{voice_id}_preview.mp3"
        )
    
    voices = await elevenlabs_tts.get_voices()
    voice_info = next((v for v in voices if v.get("voice_id") == voice_id), None)
    
    if not voice_info:
        raise HTTPException(status_code=404, detail="Voice not found")
    
    voice_name = voice_info.get("name", "This voice")
    gender = voice_info.get("labels", {}).get("gender", "")
    accent = voice_info.get("labels", {}).get("accent", "")
    
    preview_text = f"Hello, I'm {voice_name}. "
    if gender and accent:
        preview_text += f"I'm a {gender} voice with a {accent} accent. "
    preview_text += "I can help bring your videos to life with natural, expressive dubbing."
    
    result = await elevenlabs_tts.text_to_speech(
        text=preview_text,
        voice_id=voice_id,
        output_path=str(preview_path),
        model_id="eleven_multilingual_v2",
        stability=0.3,
        similarity_boost=0.9,
        style=0.5,
        use_speaker_boost=True,
        language="en",
    )
    
    if result and preview_path.exists():
        return FileResponse(
            str(preview_path),
            media_type="audio/mpeg",
            filename=f"{voice_id}_preview.mp3"
        )
    else:
        raise HTTPException(status_code=500, detail="Failed to generate voice preview")
