from datetime import datetime
from typing import Optional, Dict, Any, List
from pydantic import BaseModel, Field
from enum import Enum


class JobStatus(str, Enum):
    PENDING = "pending"
    UPLOADING = "uploading"
    PROCESSING = "processing"
    CHUNKING = "chunking"
    EXTRACTING_AUDIO = "extracting_audio"
    DIARIZING = "diarizing"
    TRANSCRIBING = "transcribing"
    READY_FOR_VOICE_SELECTION = "ready_for_voice_selection"
    READY_FOR_REVIEW = "ready_for_review"
    TRANSLATING = "translating"
    SYNTHESIZING = "synthesizing"
    LIP_SYNCING = "lip_syncing"
    REASSEMBLING = "reassembling"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class VideoChunk(BaseModel):
    chunk_id: str
    sequence: int
    start_time: float
    end_time: float
    duration: float
    chunk_path: str
    audio_path: Optional[str] = None
    status: JobStatus = JobStatus.PENDING


class WordAlignment(BaseModel):
    word: str
    start: float
    end: float
    confidence: float = 0.5


class TranscriptSegment(BaseModel):
    text: str
    start: float
    end: float
    speaker: str = "speaker-1"
    confidence: Optional[float] = None
    confidence_tier: Optional[str] = None
    words: Optional[List[WordAlignment]] = None
    velma_emotion: Optional[str] = None
    velma_accent: Optional[str] = None
    velma_deepfake_score: Optional[float] = None
    # True for subtitle/credit/narration segments that should not be dubbed.
    is_credit: bool = False


class Transcript(BaseModel):
    language: str = "en"
    duration: float = 0.0
    text: str = ""
    segments: List[TranscriptSegment] = []
    speaker_profiles: Optional[Dict[str, Dict[str, float]]] = None


class Job(BaseModel):
    job_id: str
    user_id: str
    status: JobStatus
    progress: int = Field(ge=0, le=100, default=0)
    current_stage: Optional[str] = None
    runpod_job_id: Optional[str] = None
    
    video_filename: str
    video_path: str
    video_duration: Optional[float] = None
    video_size: int
    # Cost accounting. RunPod bills per millisecond of EXECUTION; queue wait is
    # free but recorded because it's the number that decides whether a bigger,
    # pricier GPU tier is worth it. Paired with video_duration these give a real
    # GPU cost per source minute instead of an estimate.
    gpu_execution_seconds: Optional[float] = None
    gpu_queue_seconds: Optional[float] = None
    # Minutes reserved from the user's monthly pool when this job was accepted.
    # Cleared once refunded, so a job that fails twice — or a retried status
    # update — can't return the same minutes more than once.
    minutes_charged: Optional[int] = None
    # 0 means "not specified — let diarization decide". It must NOT default to a
    # real speaker count: the clamp in routes.py reads any value in 1..10 as an
    # explicit user choice and forces pyannote to exactly that many speakers.
    # With a default of 2, "auto-detect" was indistinguishable from "the user
    # said 2", and every scene was capped at two speakers however many spoke.
    expected_speakers: int = 0
    source_language: Optional[str] = None  # ISO code (e.g. "yue", "en") or None for auto-detect
    target_language: Optional[str] = None  # ISO code (e.g. "en", "es") set at upload time
    
    chunks: List[VideoChunk] = []
    total_chunks: int = 0
    processed_chunks: int = 0
    
    transcript: Optional[Transcript] = None
    speaker_genders: Optional[Dict[str, str]] = None   # e.g. {"speaker-1": "male", "speaker-2": "female"}
    voice_mapping: Optional[Dict[str, str]] = None     # e.g. {"speaker-1": "male-2", "speaker-2": "female-1"}
    traits_mapping: Optional[Dict[str, List[str]]] = None  # e.g. {"speaker-1": ["calm", "weary", "paternal"]}
    character_profiles: Optional[List[Dict]] = None  # per-job character profiles [{name, traits, speech_style}]

    dubbed_video_url: Optional[str] = None
    tts_engine: Optional[str] = None
    segment_tts_engines: Optional[List[Optional[str]]] = None
    dubbing_engine: Optional[str] = None  # "dubmaster" or "vozo"

    error_message: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime] = None


class UploadResponse(BaseModel):
    job_id: str
    status: str
    message: str
    video_filename: str
    video_size: int


class StatusResponse(BaseModel):
    job_id: str
    status: JobStatus
    progress: int
    current_stage: Optional[str]
    video_filename: str
    video_url: Optional[str] = None
    video_duration: Optional[float]
    total_chunks: int
    processed_chunks: int
    chunks: List[VideoChunk]
    source_language: Optional[str] = None
    dubbed_video_url: Optional[str] = None
    tts_engine: Optional[str] = None
    segment_tts_engines: Optional[List[Optional[str]]] = None
    expected_speakers: int = 0   # 0 = not specified; see Job.expected_speakers
    speaker_genders: Optional[Dict[str, str]] = None
    voice_mapping: Optional[Dict[str, str]] = None
    traits_mapping: Optional[Dict[str, List[str]]] = None
    error_message: Optional[str]
    created_at: datetime
    updated_at: datetime


class ChunkManifest(BaseModel):
    job_id: str
    total_chunks: int
    total_duration: float
    chunks: List[VideoChunk]


class DubRequest(BaseModel):
    job_id: str
    target_language: str
    transcript: List[TranscriptSegment]
    voice_mapping: Dict[str, str]
    voice_settings: Optional[Dict[str, Dict[str, float]]] = None
    source_language: Optional[str] = None
    dubbing_engine: Optional[str] = None  # "dubmaster" (default) or "vozo"
    vozo_user_prompt: Optional[str] = None  # translation guidance for Vozo
    adaptation_selections: Optional[Dict[str, str]] = None  # segment_id → "faithful"|"performable"|"sync_fit"
    character_profiles: Optional[List[Dict]] = None  # [{name, traits, speech_style}]


class AdaptVariant(BaseModel):
    variant_type: str
    text: str
    rationale: str
    estimated_duration_ratio: float
    syllable_count: int


class AdaptRequest(BaseModel):
    job_id: str
    segments: List[Dict[str, Any]]
    scene_context: Optional[str] = None


class AdaptResponse(BaseModel):
    job_id: str
    fallback: bool = False
    adapted_segments: List[Dict[str, Any]]


class DubResponse(BaseModel):
    job_id: str
    status: str
    dubbed_video_url: Optional[str] = None
    tts_engine: Optional[str] = None
    dubbing_engine: Optional[str] = None
    message: str


class VoiceParams(BaseModel):
    voice_id: Optional[str] = None
    speed: Optional[float] = None
    speed_ratio: Optional[float] = None
    target_duration: Optional[float] = None
    # Signed lip-sync offset in ms from the QC lip-sync analysis (positive = audio
    # leads video, negative = video leads audio). Resolved against the segment's
    # own authoritative `duration` inside regenerate_segment, since the caller
    # (frontend) has no reliable client-side duration value to compute this from.
    sync_offset_ms: Optional[float] = None


class RegenerateRequest(BaseModel):
    voice_id: Optional[str] = None
    voice_key: Optional[str] = None   # canonical key e.g. "male-1", "female-1" — resolved to voice_id by backend
    # Which engine synthesises this segment: "fish-audio" (default) or "respeecher".
    # None keeps the segment's stored engine, then falls back to Fish — so existing
    # clients that never send this field are completely unaffected.
    engine: Optional[str] = None
    # Respeecher tuning. Sent nested inside the voice object by the service —
    # at the top level the API silently drops it and still returns 200.
    sampling_params: Optional[Dict] = None
    # Pin generation so a re-render reproduces the approved take byte-for-byte.
    # None races several random seeds and returns the winner's.
    seed: Optional[int] = None
    # Force a fresh race, discarding the segment's stored seed. Without this an
    # omitted seed falls back to the stored one, so a bad take could never be
    # escaped — "re-roll" would silently replay the take you were trying to leave.
    reroll: Optional[bool] = None
    speed: Optional[float] = None
    pitch: Optional[int] = None       # semitones: -12 to +12
    emotion: Optional[str] = None
    traits: Optional[List[str]] = None
    voice_params: Optional[VoiceParams] = None
    force_timing: Optional[bool] = None
    nuances: Optional[Dict] = None
    nuance_markers: Optional[List[Dict]] = None
    custom_nuance: Optional[str] = None   # free-text write-in from the Nuances panel
    # Delivery Script: the user-authored line + inline [tags], synthesized VERBATIM
    # in place of the composed directive. FISH ONLY — the tags are Fish directives,
    # and Respeecher (which has no directive language) speaks the text bubble
    # instead, ignoring this field entirely. The editor sends engine="fish-audio"
    # alongside it so a Respeecher segment moves to Fish rather than silently
    # dropping the script. The segment's display text / subtitle / timing keep
    # using the clean `text`.
    tts_text: Optional[str] = None
    # Live timeline boundaries from the frontend at the moment of regen — see
    # dubbing_service.regenerate_segment for why these can beat segments.json.
    live_segment_start: Optional[float] = None
    live_segment_end: Optional[float] = None
    live_next_segment_start: Optional[float] = None
    # The previous segment's live end. next_start has had a live override for a
    # while; prev_end did not, so backward growth used the backend's own copy —
    # which lags a fire-and-forget commitSegmentTiming. That asymmetry let a
    # segment be moved earlier into a neighbour that had already been extended,
    # producing a silent overlap neither regen could detect.
    live_prev_segment_end: Optional[float] = None
    # Staged mode (chunk-lens editor): render the take and return it for
    # audition, but do NOT mutate segments.json or Supabase. The take is
    # promoted to committed audio only when the user saves the chunk (see
    # commit_segment_timing's staged_path).
    stage: bool = False
    # Explicit text override for what gets synthesized. The frontend has always
    # sent this; it was silently dropped before, so a regen after an
    # uncommitted text edit spoke the old line. Staged editing makes that flow
    # normal, so it is now honored.
    text: Optional[str] = None
