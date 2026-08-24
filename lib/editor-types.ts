// Editor Types for QC-Driven Dubbing Editor

export type SegmentStatus = 'auto' | 'edited' | 'locked'

export type SidebarTab = 'speech' | 'subtitles' | 'brand' | 'lip-sync' | 'qc' | 'adaptation'

export type PlaybackMode = 'original' | 'dubbed' | 'preview'

export type RebuildStatus = 'idle' | 'processing' | 'complete' | 'error'

export type QCFindingType = 'timing' | 'translation' | 'delivery' | 'sync' | 'pronunciation'

export type QCSeverity = 'error' | 'warning' | 'info'

export interface QCFinding {
  id: string
  segment_index: number
  type: QCFindingType
  severity: QCSeverity
  message: string
  suggestion?: string
  timestamp_start: number
  timestamp_end: number
  details?: Record<string, unknown>
}

export type NuanceMarkerType = 'rise' | 'drop' | 'stress' | 'whisper' | 'pause_before' | 'breathy'

export interface NuanceMarker {
  id: string
  startChar: number
  endChar: number
  type: NuanceMarkerType
  intensity: number
}

export const NUANCE_MARKER_META: Record<NuanceMarkerType, { label: string; icon: string; color: string }> = {
  rise: { label: 'Rise', icon: '🔺', color: 'text-yellow-400' },
  drop: { label: 'Drop', icon: '🔻', color: 'text-blue-400' },
  stress: { label: 'Stress', icon: '⚡', color: 'text-orange-400' },
  whisper: { label: 'Whisper', icon: '🤫', color: 'text-gray-400' },
  pause_before: { label: 'Pause', icon: '⏸', color: 'text-violet-400' },
  breathy: { label: 'Breathy', icon: '💨', color: 'text-cyan-400' },
}

export interface SegmentNuances {
  // Tier 1 — Basic (0=left, 1=center, 2=right)
  pace: number
  weight: number
  breath: number
  delivery: number
  tail: number
  // Tier 2 — Advanced (0-100)
  prosody: number
  pitchContour: number
  volumeDynamics: number
  tempoPacing: number
  pauses: number
  breathSounds: number
  voiceQuality: number
  microIntonation: number
}

export const DEFAULT_NUANCES: SegmentNuances = {
  pace: 1, weight: 1, breath: 1, delivery: 1, tail: 1,
  prosody: 50, pitchContour: 50, volumeDynamics: 50, tempoPacing: 50,
  pauses: 50, breathSounds: 50, voiceQuality: 50, microIntonation: 50,
}

export interface Segment {
  id: string
  index: number
  transcript_index?: number
  status: SegmentStatus
  start_time: number
  end_time: number
  source_text: string
  target_text: string
  active_text?: string
  variant_text?: string
  isUserEdited?: boolean
  preview_text?: string | null
  isPreviewing?: boolean
  speaker_id: string
  speaker_label?: string
  speaker_gender?: 'male' | 'female' | 'child'
  audio_url?: string
  original_audio_snapshot?: string
  locked_at?: string
  qc_findings: QCFinding[]
  qc_score?: number
  qc_problem?: string
  qc_fix?: string
  rpt_dirty?: boolean
  // Persisted pairing: true when this segment is paired with the one to its right.
  paired_with_next?: boolean
  committed_voice_id?: string
  committed_pitch?: number
  committed_emotion?: string
  committed_speed?: number
  committed_audio_url?: string
  committed_start_time?: number
  committed_end_time?: number
  // User-defined fade handles on the Preview Audio / dubbed track, in seconds.
  // 0 = no explicit fade; the RPT engine falls back to overlap-based crossfade.
  fade_in?: number
  fade_out?: number
  committed_adapted_text?: string
  // True only when a human committed a text correction. Never written by any
  // pipeline path, so it — unlike committed_adapted_text, which Generate Speech
  // and initRPTFromSegments both populate — is evidence of authorship.
  text_locked?: boolean
  committed_at?: string
  emotionalCurve?: EmotionalCurve
  attached_traits?: string[] | null
  velma_emotion?: string
  velma_accent?: string
  velma_deepfake_score?: number
  velma_emotion_curve?: number[]
  velma_progression?: Array<{ emotion: string; intensity: number; color: string }>
  dubEmotion?: string
  voiceAccent?: string
  was_truncated?: boolean
  nuances?: Partial<SegmentNuances>
  nuance_markers?: NuanceMarker[]
  custom_nuance?: string   // free-text write-in directive from the Nuances panel
  tts_text?: string        // Delivery Script: verbatim line + inline [tags] sent to TTS
  flags?: Array<{ code: string; score: number | null; threshold: number; reason?: string | null }>
  flag_status?: 'unreviewed' | 'reviewed_no_change' | 'reviewed_corrected'
  correction_type?: 'timing' | 'text' | 'voice' | 'emotion' | null
  // TTS engine that actually rendered this segment, after the child/availability
  // fallbacks — not necessarily the one requested. "fish-audio" | "respeecher".
  engine?: string
  // Respeecher only. Duration is unstable (a 70% spread on identical input with
  // no parameter to constrain it), so several takes are raced and the closest to
  // the slot wins. takes[0] is the live one and equals the segment's path.
  respeecher_takes?: string[]
  // False when even the best take overruns the slot by more than time-stretch
  // can absorb cleanly — surface it rather than squashing the audio to fit.
  respeecher_fits?: boolean
  respeecher_duration?: number
  // Seed + params that produced this exact take. Replaying them re-renders it
  // byte-for-byte, so an approved delivery survives any later regeneration.
  // Null when the reproducible re-render failed — better no promise than a false one.
  respeecher_seed?: number | null
  respeecher_sampling_params?: Record<string, number> | null
  // Parallel to respeecher_takes: the seed behind each take.
  respeecher_take_seeds?: number[]
  // Audition history across races, newest first. Seeds rather than audio: a
  // pinned seed re-renders its take byte-for-byte, so this survives later
  // renders that would overwrite the take files. voice + params ride along
  // because a seed only reproduces its take under the same two.
  respeecher_seed_history?: Array<{
    seed: number
    voice: string
    params: Record<string, number> | null
    /** Locked by the user: exempt from the history cap, never evicted. */
    kept?: boolean
  }>
  // Set when a segment is driven by a RECORDING rather than by its text.
  // perf_path is the stored performance and is the segment's source of truth —
  // re-renders convert from it, so editing the text does not change the audio.
  // The text still drives the subtitle, QC and timing.
  perf_path?: string
  perf_model_id?: string
  perf_denoise?: boolean
}

/**
 * Chunk-lens staged edit — work the user has auditioned but NOT saved.
 * Keyed by transcript_index in the store's stagedEdits map. Nothing here
 * exists server-side until Save commits it (staged_path promotion).
 */
export interface StagedEdit {
  /** Staged text (spoken on next regen; becomes committed_adapted_text on Save) */
  text?: string
  /** Staged timing (becomes committed_start_time/committed_end_time on Save) */
  start_time?: number
  end_time?: number
  /** Served URL of the staged take file — used for audition playback */
  stagedAudioUrl?: string
  /** Server disk path of the staged take — sent as staged_path on Save */
  stagedPath?: string
  /** Engine that rendered the staged take */
  engine?: string
  /** Staged take couldn't fit its window — needs user intervention */
  timing_exclusion?: boolean
}

/** Per-chunk persisted status from segments.json chunk_status. */
export type ChunkStatus = 'saved' | 'dirty'

export interface QCScore {
  overall: number
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  components: {
    timing: number
    translation: number
    delivery: number
    sync: number
    pronunciation: number
  }
  total_findings: number
  errors: number
  warnings: number
  info: number
}

export interface QCReport {
  job_id: string
  generated_at: string
  // Top-level grade
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  overall: number
  // Sub-scores (0-100)
  components: {
    timing: number
    speed: number
    loudness: number
    silences: number
    emotion_variance: number
    emotion_intensity: number
    lip_sync: number
    emotion_preservation: number
  }
  // Provider for emotion analysis
  emotion_provider?: 'emotion2vec' | string
  // Section data
  timing: { status: 'ok' | 'warn' | 'fail'; details?: string }
  speed: { status: 'ok' | 'warn' | 'fail'; mean: number; std_dev: number }
  silence_gaps: {
    unexpected_count: number
    gaps: { start: number; end: number; duration: number }[]
  }
  loudness: {
    within_spec: boolean
    lufs: number
    peak_db: number
    range_lu: number
  }
  emotion: {
    label: 'Calm' | 'Moderate' | 'Intense' | string
    variance: number
    intensity: number
    top: { name: string; pct: number }[]
  }
  retranscription: {
    segment_count: number
    items: { start: number; text: string; confidence: number }[]
  }
  // Findings drive timeline markers and click-to-fix
  findings: QCFinding[]
}

// ── Emotional Curve ──────────────────────────────────────────────
export interface EmotionalCurvePoint {
  x: number // normalized time 0–1 within the segment
  y: number // emotional intensity 0–1
  cp1?: { x: number; y: number } // Bezier handle 1
  cp2?: { x: number; y: number } // Bezier handle 2
}

export interface EmotionalCurve {
  combined: EmotionalCurvePoint[]
  locked: boolean
  analysis: {
    facial: number[] // sampled 0–1 values
    vocal: number[]
    scene: number[]
  }
}

/** A video scene boundary. Scenes are contiguous ranges covering the video.
 *  video_fade_in / video_fade_out are seconds of fade from/to black at the
 *  scene's start and end. */
export interface Scene {
  id: string
  // Timeline position: where this scene plays in the final output.
  start: number
  end: number
  // Source position: where the scene content comes from in the original video.
  // When absent, the scene is assumed to start/end at the same time as the
  // timeline position (i.e., it is not retimed/moved).
  source_start?: number
  source_end?: number
  /** Parked on the layover track: lifted out of the picture but kept.
   *
   *  Cutting a section to fix lip sync should not mean losing it. A parked scene
   *  holds its source range and its fades, takes no time on the timeline, and is
   *  skipped by the render — so it can be dropped back in later or discarded once
   *  the sync around it is settled. */
  parked?: boolean
  /** Where it sat before being lifted, so it can be dropped straight back. */
  parked_from_start?: number
  parked_from_end?: number
  video_fade_in?: number
  video_fade_out?: number
}

export interface EditorJob {
  id: string
  title: string
  source_language: string
  target_language: string
  video_url: string
  dubbed_video_url?: string
  video_duration: number
  segments: Segment[]
  scenes?: Scene[]
  qc_score?: QCScore
  created_at: string
  updated_at: string
}

// Speaker colors for visual distinction
export const SPEAKER_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  'speaker-1': { bg: 'bg-blue-500/20', border: 'border-blue-500', text: 'text-blue-400' },
  'speaker-2': { bg: 'bg-purple-500/20', border: 'border-purple-500', text: 'text-purple-400' },
  'speaker-3': { bg: 'bg-emerald-500/20', border: 'border-emerald-500', text: 'text-emerald-400' },
  'speaker-4': { bg: 'bg-amber-500/20', border: 'border-amber-500', text: 'text-amber-400' },
  'speaker-5': { bg: 'bg-rose-500/20', border: 'border-rose-500', text: 'text-rose-400' },
  'speaker-6': { bg: 'bg-cyan-500/20', border: 'border-cyan-500', text: 'text-cyan-400' },
}

export function getSpeakerColor(speakerId: string) {
  const index = parseInt((speakerId ?? '').replace(/\D/g, '')) || 1
  const key = `speaker-${((index - 1) % 6) + 1}`
  return SPEAKER_COLORS[key] || SPEAKER_COLORS['speaker-1']
}

// QC severity colors
export const QC_SEVERITY_COLORS: Record<QCSeverity, { bg: string; border: string; text: string; icon: string }> = {
  error: { bg: 'bg-red-500/20', border: 'border-red-500', text: 'text-red-400', icon: 'text-red-500' },
  warning: { bg: 'bg-yellow-500/20', border: 'border-yellow-500', text: 'text-yellow-400', icon: 'text-yellow-500' },
  info: { bg: 'bg-blue-500/20', border: 'border-blue-500', text: 'text-blue-400', icon: 'text-blue-500' },
}

// Status colors
export const STATUS_COLORS: Record<SegmentStatus, { bg: string; border: string }> = {
  auto: { bg: 'bg-slate-700', border: 'border-slate-600' },
  edited: { bg: 'bg-amber-500/20', border: 'border-amber-500' },
  locked: { bg: 'bg-emerald-500/20', border: 'border-emerald-500' },
}

// Helper to format time as MM:SS.ms
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 10)
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms}`
}

// Helper to parse time string to seconds
export function parseTime(timeStr: string): number {
  const [minSec, ms] = timeStr.split('.')
  const [mins, secs] = minSec.split(':').map(Number)
  return mins * 60 + secs + (parseInt(ms) || 0) / 10
}

/**
 * A segment's permanent identity. Assigned once at creation, persisted through
 * sync, and never derived from array position.
 *
 * The loader used to rebuild ids as `segment-${idx}`, which meant a segment's
 * identity silently changed whenever anything above it was deleted — and
 * because segment.id is also the React key, every row below a deletion
 * remounted. transcript_index remains the BACKEND identity, used only at API
 * boundaries; this is the client-side one.
 */
export function newSegmentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // crypto.randomUUID needs a secure context; fall back for anything else.
  return `seg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function newSceneId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `scene-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function defaultScenes(videoDuration: number): Scene[] {
  if (!Number.isFinite(videoDuration) || videoDuration <= 0) return []
  return [{ id: newSceneId(), start: 0, end: videoDuration, source_start: 0, source_end: videoDuration }]
}

/** Compute the black overlay opacity for a video frame at a given time.
 *  0 = fully visible video, 1 = fully black. */
export function computeVideoFadeOpacity(time: number, scenes: Scene[]): number {
  if (!scenes.length) return 0
  const scene = scenes.find(s => s.start <= time && time < s.end)
    ?? scenes[scenes.length - 1]
  if (!scene) return 0
  const fadeIn = scene.video_fade_in ?? 0
  const fadeOut = scene.video_fade_out ?? 0
  const duration = scene.end - scene.start
  if (duration <= 0) return 0
  const relative = time - scene.start

  let gain = 1
  if (fadeIn > 0 && relative < fadeIn && fadeIn > 0) {
    gain = Math.sin((relative / fadeIn) * Math.PI / 2)
  } else if (fadeOut > 0 && relative > duration - fadeOut) {
    const remaining = scene.end - time
    gain = Math.sin((remaining / fadeOut) * Math.PI / 2)
  }
  return 1 - gain
}

/** Force a scene list back into a clean partition of the timeline.
 *
 * Scenes must tile the timeline: sorted, contiguous, no gaps, no overlaps. Drags
 * only ever wrote the scene being dragged, so moving one boundary left the
 * neighbour where it was — producing overlapping scenes whose fade ramps both
 * draw, stacked, in the overlap. Real data from one session: a scene ending at
 * 324.95 while the next began at 320.38, plus two gaps and an unsorted list.
 *
 * A fade that outlived the boundary it was drawn for is dropped: a fade longer
 * than the scene it now belongs to is meaningless, and keeping it is what leaves
 * a ramp sitting in the middle of otherwise continuous footage.
 */
export function normalizeScenes(scenes: Scene[], videoDuration: number): Scene[] {
  if (!scenes.length) return scenes
  // Parked scenes are not part of the picture, so they take no part in tiling it.
  // They keep their source range untouched and are re-appended afterwards.
  const parked = scenes.filter(s => s.parked)
  const sorted = scenes
    .filter(s => !s.parked && Number.isFinite(s.start) && Number.isFinite(s.end))
    .map(s => ({ ...s }))
    .sort((a, b) => a.start - b.start)

  const out: Scene[] = []
  for (let i = 0; i < sorted.length; i++) {
    const cur = { ...sorted[i] }
    // GAPS ARE LEFT ALONE. Lifting a section to the layover track opens a hole on
    // purpose: it is working space, held while the footage either side is adjusted,
    // until the cut is dropped back in or discarded. Closing it automatically would
    // undo the edit the moment anything persisted. Gaps render as black.
    //
    // Overlaps are always wrong, though — two scenes claiming the same instant have
    // no meaning, and their fade ramps draw stacked over each other. So a scene is
    // only ever TRIMMED back to where the next one begins, never moved.
    if (out.length > 0 && cur.start < out[out.length - 1].end) {
      cur.start = out[out.length - 1].end
    }
    cur.start = Math.max(0, cur.start)
    const nextStart = i + 1 < sorted.length ? sorted[i + 1].start : videoDuration
    cur.end = Math.max(cur.start, Math.min(cur.end, nextStart, videoDuration))
    if (cur.end - cur.start < 0.01) continue   // collapsed to nothing
    const dur = cur.end - cur.start
    if ((cur.video_fade_in ?? 0) > dur) cur.video_fade_in = 0
    if ((cur.video_fade_out ?? 0) > dur) cur.video_fade_out = 0
    out.push(cur)
  }
  return [...out, ...parked]
}
/** Map a timeline time to the corresponding source video time for a scene.
 *  Returns null if the timeline time is not inside any scene (gap). */
export function timelineToSourceTime(time: number, scenes: Scene[]): number | null {
  const scene = scenes.find(s => s.start <= time && time < s.end)
  if (!scene) return null
  const sourceStart = scene.source_start ?? scene.start
  const sourceEnd = scene.source_end ?? scene.end
  const duration = scene.end - scene.start
  if (duration <= 0) return sourceStart
  const ratio = (time - scene.start) / duration
  return sourceStart + ratio * (sourceEnd - sourceStart)
}

/** Map a source video time back to timeline time. Returns null if the source time
 *  does not belong to any scene (gap). */
export function sourceToTimelineTime(sourceTime: number, scenes: Scene[]): number | null {
  const scene = scenes.find((s) => {
    const ss = s.source_start ?? s.start
    const se = s.source_end ?? s.end
    return ss <= sourceTime && sourceTime < se
  })
  if (!scene) return null
  const sourceStart = scene.source_start ?? scene.start
  const sourceEnd = scene.source_end ?? scene.end
  const sourceDuration = sourceEnd - sourceStart
  if (sourceDuration <= 0) return scene.start
  const ratio = (sourceTime - sourceStart) / sourceDuration
  return scene.start + ratio * (scene.end - scene.start)
}

/**
 * The key for every piece of per-segment transient state (staged voices,
 * emotions, speeds, pitches, nuances, locks, pairs, lock glow).
 *
 * Always go through this rather than reading `.id` directly — if identity ever
 * changes again, this is the only place that needs to know.
 */
export function getSegmentKey(segment: Pick<Segment, 'id'>): string {
  return segment.id
}
