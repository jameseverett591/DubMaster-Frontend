'use client'
/**
 * DubVerse API Client
 * Handles all communication with the FastAPI backend
 */

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export interface CharacterProfile {
  name: string
  traits: string[]
  speech_style: string
}

// ============================================================================
// CUSTOM ERRORS
// ============================================================================

export class JobNotFoundError extends Error {
  constructor(jobId: string) {
    super(`Job ${jobId} not found — it may have been deleted.`)
    this.name = 'JobNotFoundError'
  }
}

// ============================================================================
// TYPE DEFINITIONS (matching backend models exactly)
// ============================================================================

export interface UploadResponse {
  job_id: string
  status: string
  message: string
  video_filename: string
  video_size: number
}

export type JobStatusValue =
  | 'pending'
  | 'uploading'
  | 'processing'
  | 'chunking'
  | 'extracting_audio'
  | 'diarizing'
  | 'transcribing'
  | 'ready_for_voice_selection'
  | 'ready_for_review'
  | 'translating'
  | 'synthesizing'
  | 'lip_syncing'
  | 'reassembling'
  | 'vozo_processing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface ChunkInfo {
  chunk_id: string
  sequence: number
  start_time: number
  end_time: number
  duration: number
  chunk_path: string
  audio_path?: string
  status?: string
}

export interface JobStatus {
  job_id: string
  status: JobStatusValue
  progress: number
  current_stage: string | null
  video_filename: string
  video_duration: number | null
  total_chunks: number
  processed_chunks: number
  chunks: ChunkInfo[]
  dubbed_video_url: string | null
  tts_engine: string | null
  segment_tts_engines: (string | null)[] | null
  speaker_genders: Record<string, string> | null
  voice_mapping: Record<string, string> | null
  source_language: string | null
  error_message: string | null
  created_at: string
  updated_at: string
}

export interface TranscriptSegment {
  text: string
  start: number
  end: number
  speaker: string
}

export interface Transcript {
  job_id?: string
  language: string
  duration: number
  text: string
  segments: TranscriptSegment[]
}

export interface Segment {
  transcript_index: number
  text: string
  speaker: string
  voice_id: string
  speed: number
  path: string
  start: number
  end: number
  duration: number
  locked: boolean
  candidates: string[]
  edit_history: unknown[]
  qc_findings: unknown[]
  velma_emotion?: string
  velma_accent?: string
  velma_deepfake_score?: number
}

export interface SegmentsData {
  job_id: string
  language: string
  generated_at: string
  video_path: string
  accompaniment_path: string
  video_duration: number
  segments: Segment[]
  // Chunk-lens editor state: {"<chunk_index>": "saved" | "dirty"}
  chunk_status?: Record<string, string>
  /** When this job's work is deleted, and why. Travels with the segments the
   *  editor already loads so the countdown card needs no extra request. */
  retention?: RetentionState
}

export interface RetentionState {
  deadline: string
  /** "rendered" = 30 days from MAKE MOVIE. "abandoned" = 4 months of editor
   *  work never rendered, extendable via Advanced ▸ Resubmit. */
  kind: 'rendered' | 'abandoned'
  days_left: number
  expired: boolean
  /** True once inside the warning window — the editor shows the countdown. */
  warn: boolean
  warn_days: number
}

export interface Voice {
  voice_id: string
  name: string
  category: string
  labels: Record<string, string>
  preview_url: string
  description: string
  tags?: string[]
  task_count?: number
  like_count?: number
  visibility?: string
}

export interface CustomVoice {
  voice_id: string
  provider: 'fish-audio' | 'elevenlabs'
  name: string
  tags?: string[]
  custom?: boolean
  /** Extension of the stored source clip. Absent on voices cloned before the
   *  upload was kept — those have no sample to preview. */
  sample_ext?: string
}

export interface DubRequest {
  job_id: string
  target_language: string
  transcript: TranscriptSegment[]
  voice_mapping: Record<string, string>
  voice_settings?: Record<string, {
    stability?: number
    similarity_boost?: number
    style?: number
    pitch?: number  // semitone shift, e.g. +8 for child-like voice
  }>
  source_language?: string
  dubbing_engine?: 'dubmaster' | 'vozo'
  vozo_user_prompt?: string
}

export interface DubResponse {
  job_id: string
  status: string
  dubbed_video_url?: string
  tts_engine?: string
  dubbing_engine?: string
  message: string
}

/** A voice from Respeecher's catalogue. `sampling_params` describes how the voice
 *  was tuned server-side — it is NOT settable. The public generation endpoint
 *  silently ignores temperature/top_p/seed sent on a request (verified by probe:
 *  a nonsense field returns 200, and three runs at a fixed seed give three
 *  different durations). Surface it as metadata, never as controls. */
export interface RespeecherVoice {
  id: string
  full_name?: string
  gender?: string
  accent?: string
  is_best?: boolean
  sampling_params?: Record<string, number>
}

export interface RegenerateSegmentRequest {
  text?: string
  voice_id?: string
  voice_key?: string
  speed?: number
  pitch?: number
  emotion?: string
  traits?: string[]
  emotionIntensity?: number
  force_timing?: boolean
  nuances?: Record<string, number>
  nuance_markers?: Array<{ id: string; startChar: number; endChar: number; type: string; intensity: number }>
  custom_nuance?: string
  tts_text?: string
  // "fish-audio" (default) | "respeecher". Omitted keeps the segment's stored
  // engine, so callers that never set it are unaffected.
  engine?: string
  // Respeecher tuning. The backend nests these inside the voice object — sent at
  // the top level of the vendor request they are silently dropped.
  sampling_params?: Record<string, number>
  // Pin generation so a re-render reproduces the approved take byte-for-byte.
  // Omitted falls back to the segment's stored seed.
  seed?: number
  // Force a fresh race, discarding the segment's stored seed. Required to escape
  // a take you don't want — an omitted seed alone would just replay it.
  reroll?: boolean
  // Live timeline boundaries at the moment of regen — segments.json can go stale
  // after a split/resize whose commitSegmentTiming call hasn't landed yet (it's
  // fire-and-forget). Backend validates these before trusting them.
  live_segment_start?: number
  live_segment_end?: number
  live_next_segment_start?: number
  live_prev_segment_end?: number
  // Chunk-lens staged mode: render the take for audition only — the backend
  // writes the file but does NOT commit it to segments.json/Supabase. The take
  // is promoted via commitSegmentTiming's staged_path when the chunk is saved.
  stage?: boolean
}

export interface RegenerateSegmentResponse {
  status: string
  segment: {
    path: string
    text: string
    voice_id: string
    speed: number
    transcript_index: number
    speaker: string
    start: number
    end: number
    duration: number
    locked: boolean
    audio_duration?: number
    // Engine actually used, after the backend's child / availability / unknown-voice
    // fallbacks — not necessarily the one requested. The caller MUST read these off
    // the response rather than assuming its request took effect.
    engine?: string
    respeecher_takes?: string[]
    respeecher_take_seeds?: number[]
    respeecher_fits?: boolean
    respeecher_duration?: number
    respeecher_seed?: number | null
    respeecher_sampling_params?: Record<string, number> | null
    respeecher_seed_history?: Array<{
      seed: number
      voice: string
      params: Record<string, number> | null
      kept?: boolean
    }>
    // True when the take was rendered in staged mode — path points at the
    // uncommitted _staged file, and nothing in segments.json changed.
    staged?: boolean
  }
}

export interface RemixResponse {
  job_id: string
  dubbed_video_url: string
  duration_seconds: number
  status: string
  remix_duration_ms: number
  segments_used: number
}

export interface RetranslateResponse {
  job_id: string
  source_language: string
  target_language: string
  segments_updated: number
  segments: Array<Record<string, unknown>>
}

// Quality Analysis types
export interface TimingIssue {
  segment: number
  text: string
  original_start?: number
  dubbed_start?: number
  offset?: number
  original_duration?: number
  dubbed_duration?: number
  type?: string
  overlap_seconds?: number
  severity: 'low' | 'medium' | 'high'
}

export interface SilenceGap {
  start: number
  end: number
  duration: number
  expected_speech: boolean
  severity: 'info' | 'high'
}

export interface SpeedAnomaly {
  segment: number
  text: string
  speed_ratio: number
  tts_duration?: number
  slot_duration?: number
  mean_speed?: number
  deviation?: number
  type: 'too_fast' | 'inconsistent'
  severity: 'low' | 'medium' | 'high'
}

export interface LoudnessAnalysis {
  status: string
  integrated_loudness_lufs?: number
  true_peak_dbfs?: number
  loudness_range_lu?: number
  target_lufs?: number
  within_spec?: boolean
  deviation_from_target?: number
  reason?: string
}

export interface RetranscribedSegment {
  start: number
  end: number
  text: string
  confidence: number
}

export interface ScreenAppInsight {
  status: string
  label?: string
  summary?: string
  segments?: Array<{ start: number; end: number; text: string }>
  speakers?: Array<{ id: string; name?: string }>
  key_moments?: Array<{ time: number; description: string }>
  confidence_scores?: Array<{ start: number; end: number; confidence: number }>
  reason?: string
}

export interface EmotionAnalysis {
  status: string
  emotion_variance?: number
  emotion_intensity?: number
  top_emotions?: Array<{ name: string; score: number }>
  segment_count?: number
  reason?: string
}

export interface PronunciationAssessment {
  status: string
  fluency_score?: number
  prosody_score?: number
  accuracy_score?: number
  completeness_score?: number
  reason?: string
}

export interface TranslationError {
  segment: number
  original: string
  translated: string
  issue: string
  severity: 'critical' | 'major' | 'minor'
}

export interface MissingDialogue {
  start: number
  end: number
  original_text: string
}

export interface TranslationQuality {
  status: string
  translation_score?: number
  coverage_percent?: number
  summary?: string
  errors?: TranslationError[]
  missing_dialogue?: MissingDialogue[]
  reason?: string
}

export interface AnalysisSummary {
  score: number
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  component_scores: Record<string, number>
  weights_used: Record<string, number>
  services_available?: Record<string, boolean>
  screenapp_available?: boolean
}

export interface QualityAnalysis {
  job_id: string
  target_language: string
  dubbed_video: string
  retranscription: {
    status: string
    language?: string
    segment_count?: number
    segments?: RetranscribedSegment[]
    reason?: string
  }
  timing: {
    status: string
    total_segments?: number
    issues_found?: number
    issues?: TimingIssue[]
    reason?: string
  }
  silences: {
    status: string
    total_silences?: number
    unexpected_silences?: number
    silences?: SilenceGap[]
    reason?: string
  }
  speed: {
    status: string
    total_segments?: number
    anomalies_found?: number
    mean_speed_ratio?: number
    speed_std_dev?: number
    anomalies?: SpeedAnomaly[]
    reason?: string
  }
  loudness: LoudnessAnalysis
  screenapp_original: ScreenAppInsight | null
  screenapp_dubbed: ScreenAppInsight | null
  emotion?: EmotionAnalysis
  pronunciation?: PronunciationAssessment
  translation?: TranslationQuality
  summary: AnalysisSummary
}

export type AnalysisStatus = 'idle' | 'running' | 'complete' | 'error'

export interface AnalysisResponse {
  status: 'started' | 'running' | 'complete'
  message?: string
  analysis?: QualityAnalysis
}

export interface EmotionalChord {
  id: string
  user_id: string
  name: string
  emotion: string
  state: string
  trait: string
  intensity: number
  created_at: string
}

// ============================================================================
// API CLIENT CLASS
// ============================================================================

class DubVerseAPIClient {
  private baseURL: string
  private _token: string | null = null

  setToken(token: string | null): void {
    this._token = token
  }

  private _authHeaders(): Record<string, string> {
    return this._token
      ? { Authorization: `Bearer ${this._token}` }
      : {}
  }

  /** Auth headers for callers outside this class (components, hooks).
   *  Every backend route except /api/dubbing-engines and /health now requires
   *  a token, so a bare this._fetch() to the API will 401.
   *
   *  Prefer ensureAuthHeaders() — this sync version returns empty headers if
   *  the token has not been set yet. */
  authHeaders(): Record<string, string> {
    return this._authHeaders()
  }

  /** Auth headers, hydrating the token from Supabase first if it is missing.
   *
   *  setToken() is called from four separate components, each with its own
   *  onAuthStateChange. A component that mounts before its page's setter
   *  resolves would otherwise send no token and get a 401 — which is exactly
   *  what the status/pipeline pollers did. */
  async ensureAuthHeaders(): Promise<Record<string, string>> {
    await this._ensureToken()
    return this._authHeaders()
  }

  private async _ensureToken(): Promise<void> {
    // Always re-read the session; never trust the cached token.
    //
    // This used to return early whenever _token was set, which meant the very
    // first token was kept for the life of the page. Supabase access tokens
    // expire (~1h) and are rotated, so after an hour every authenticated
    // request went out with a dead token: regenerated audio came back 401 and
    // played as silence, and the editor threw "Failed to load job" and would
    // not open at all — while the UI still showed the user as signed in.
    //
    // getSession() reads from local storage and refreshes only when the token
    // is near expiry, so this is cheap to call per request.
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const { data } = await createClient().auth.getSession()
      if (data.session?.access_token) {
        this._token = data.session.access_token
      }
    } catch {
      // No session available — keep whatever we have and let the request 401;
      // the caller handles it. Clearing here would break a working page just
      // because one session read failed.
    }
  }

  /** this._fetch() with the bearer token always attached.
   *
   *  Most endpoints used to be public, so ~26 call sites here sent no token at
   *  all and started returning 401 the moment the routes were guarded. Rather
   *  than sprinkle _authHeaders() through call sites with three different
   *  shapes (no init, init without headers, init with headers), everything
   *  goes through here. Caller-supplied headers still win.
   */
  private async _fetch(input: string, init: RequestInit = {}): Promise<Response> {
    await this._ensureToken()
    const headers = {
      ...this._authHeaders(),
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    }
    return fetch(input, { ...init, headers })
  }

  /** Build a media URL carrying the auth token in the query string.
   *
   *  <video src> and <audio src> cannot send an Authorization header, so the
   *  backend accepts `access_token` as an alternative on media routes. Every
   *  media/download URL must go through here — a plain URL now returns 401.
   */
  private _mediaUrl(path: string): string {
    const url = `${this.baseURL}${path}`
    if (!this._token) return url
    const sep = path.includes('?') ? '&' : '?'
    return `${url}${sep}access_token=${encodeURIComponent(this._token)}`
  }

  /** Public form of _mediaUrl: resolves the token first.
   *
   *  Callers outside this class (the voice library modal, for one) were building
   *  media URLs by hand and getting 401 on every request, because the token is
   *  in-memory on this singleton and may not be set yet on a fresh page load.
   *  Awaiting _ensureToken here is the difference between a working URL and a
   *  silent 401.
   */
  async mediaUrl(path: string): Promise<string> {
    await this._ensureToken()
    return this._mediaUrl(path)
  }

  constructor(baseURL: string = API_BASE_URL) {
    this.baseURL = baseURL
  }

  /**
   * Upload a video file to the backend
   * @param file - The video file to upload
   * @param onProgress - Optional callback for upload progress (0-100)
   * @param sourceLanguage - Optional ISO code (e.g. "yue") to override Whisper auto-detect
   * @returns UploadResponse with job_id
   */

  /**
   * Get the current status of a processing job
   */
  async getJobStatus(jobId: string): Promise<JobStatus> {
    const response = await this._fetch(`${this.baseURL}/api/status/${jobId}`)
    if (!response.ok) {
      if (response.status === 404) {
        throw new JobNotFoundError(jobId)
      }
      const error = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(error.detail || `Failed to fetch status: ${response.statusText}`)
    }
    return response.json()
  }

  /**
   * Get the transcript for a job (includes speaker-labeled segments)
   */
  async getTranscript(jobId: string): Promise<Transcript> {
    const response = await this._fetch(`${this.baseURL}/api/transcript/${jobId}`)
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(error.detail || `Failed to fetch transcript: ${response.statusText}`)
    }
    return response.json()
  }

  /**
   * Get the segment state for a dubbed job (segments.json)
   */
  async getSegments(jobId: string): Promise<SegmentsData> {
    const response = await this._fetch(`${this.baseURL}/api/segments/${jobId}`)
    if (!response.ok) {
      if (response.status === 404) throw new JobNotFoundError(jobId)
      const error = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(error.detail || `Failed to fetch segments: ${response.statusText}`)
    }
    return response.json()
  }

  /**
   * Transcribe a video without dubbing (GPU-backed async flow).
   * Returns {ref_job_id, status: "processing"} immediately for RunPod path,
   * or {ref_job_id, status: "complete", segments: [...]} for the local CPU fallback.
   * Poll getRefTranscript() every 3s until status === "complete".
   */
  async transcribeVideo(
    file: File,
    language?: string,
  ): Promise<{
    ref_job_id: string
    status: string
    detected_language: string
    segment_count?: number
    segments: Array<{
      id: string
      index: number
      start: number
      end: number
      text: string
      speaker_id: string
    }>
  }> {
    const form = new FormData()
    form.append('file', file)
    if (language) form.append('language', language)
    const response = await this._fetch(`${this.baseURL}/api/transcribe-video`, {
      method: 'POST',
      body: form,
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(error.detail || `Transcription failed: ${response.statusText}`)
    }
    return response.json()
  }

  /**
   * Poll for reference transcription result. Returns:
   * - {status: "processing"} while RunPod is working
   * - {status: "complete", segments: [...], detected_language: "en"} when done
   * - {status: "error", error: "..."} on failure
   */
  async getRefTranscript(refJobId: string): Promise<{
    status: string
    ref_job_id: string
    detected_language?: string
    segment_count?: number
    segments: Array<{
      id: string
      index: number
      start: number
      end: number
      text: string
      speaker_id: string
    }>
    error?: string
  }> {
    const response = await this._fetch(`${this.baseURL}/api/ref-transcript/${refJobId}`)
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(error.detail || `Poll failed: ${response.statusText}`)
    }
    return response.json()
  }

  /**
   * Start the dubbing pipeline for a job
   */
  async startDubbing(request: DubRequest): Promise<DubResponse> {
    const response = await this._fetch(`${this.baseURL}/api/dub`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(error.detail || `Failed to start dubbing: ${response.statusText}`)
    }
    return response.json()
  }

  async translateOnly(request: DubRequest): Promise<{
    job_id: string
    status: string
    target_language: string
    source_language: string
    speaker_genders?: Record<string, string>
    segments: Array<{
      text: string
      start: number
      end: number
      speaker: string
      source_text?: string
      segment_id?: string
      confidence?: number
      confidence_tier?: string
      words?: Array<{ word: string; start: number; end: number; confidence: number }>
    }>
  }> {
    const response = await this._fetch(`${this.baseURL}/api/translate-only`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(error.detail || `Translation failed: ${response.statusText}`)
    }
    return response.json()
  }

  async startRender(request: DubRequest): Promise<DubResponse> {
    const response = await this._fetch(`${this.baseURL}/api/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(error.detail || `Render failed: ${response.statusText}`)
    }
    return response.json()
  }

  /**
   * Get available voices from the active TTS provider
   */
  /** voice_id -> friendly label for the configured FISH_VOICE_* presets.
   *  The public catalog has no lookup-by-id, and preset voices are assigned at
   *  dub time without the client ever seeing their names — so the speakers
   *  strip could only say "(voice set)". The backend knows them from env. */
  async getPresetVoiceLabels(): Promise<Record<string, string>> {
    try {
      const res = await this._fetch(`${this.baseURL}/api/voices/presets`, {
        headers: this._authHeaders(),
      })
      if (!res.ok) return {}
      const data = await res.json()
      return (data?.presets ?? {}) as Record<string, string>
    } catch {
      return {}
    }
  }

  async getVoices(opts?: {
    page?: number
    pageSize?: number
    tag?: string
    gender?: string
    language?: string
    search?: string
    sortBy?: string
  }): Promise<{
    voices: Voice[]
    provider: string
    total?: number | null
    page?: number
    page_size?: number
  }> {
    const params = new URLSearchParams()
    if (opts?.page) params.set('page', String(opts.page))
    if (opts?.pageSize) params.set('page_size', String(opts.pageSize))
    if (opts?.tag) params.set('tag', opts.tag)
    if (opts?.gender) params.set('gender', opts.gender)
    if (opts?.language) params.set('language', opts.language)
    if (opts?.search) params.set('search', opts.search)
    if (opts?.sortBy) params.set('sort_by', opts.sortBy)
    const url = params.toString()
      ? `${this.baseURL}/api/voices?${params}`
      : `${this.baseURL}/api/voices`
    const response = await this._fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch voices: ${response.statusText}`)
    }
    const data = await response.json()
    return {
      voices: data.voices || [],
      provider: data.provider || 'fish-audio',
      total: data.total ?? null,
      page: data.page,
      page_size: data.page_size,
    }
  }

  // ── Custom voices (user-added Fish Audio / ElevenLabs voices) ──────────────
  async getCustomVoices(): Promise<CustomVoice[]> {
    const res = await this._fetch(`${this.baseURL}/api/voices/custom`)
    if (!res.ok) return []
    const data = await res.json()
    return (data.voices || []) as CustomVoice[]
  }

  async addCustomVoice(provider: 'fish-audio' | 'elevenlabs', voiceId: string, name?: string): Promise<CustomVoice> {
    const res = await this._fetch(`${this.baseURL}/api/voices/custom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this._authHeaders() },
      body: JSON.stringify({ provider, voice_id: voiceId, name: name ?? '' }),
    })
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detail?.detail || `Failed to add voice (${res.status})`)
    }
    return res.json()
  }

  // Clone a voice from an uploaded audio sample (no API keys — cloned under
  // DubMaster's own account) and add it to the library.
  async cloneVoice(file: File, name: string): Promise<CustomVoice> {
    const form = new FormData()
    form.append('file', file)
    form.append('name', name)
    const res = await this._fetch(`${this.baseURL}/api/voices/clone`, {
      method: 'POST',
      headers: { ...this._authHeaders() },
      body: form,
    })
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detail?.detail || `Voice cloning failed (${res.status})`)
    }
    return res.json()
  }

  async deleteCustomVoice(voiceId: string, provider?: string): Promise<void> {
    const q = provider ? `?provider=${encodeURIComponent(provider)}` : ''
    await this._fetch(`${this.baseURL}/api/voices/custom/${encodeURIComponent(voiceId)}${q}`, {
      method: 'DELETE',
      headers: { ...this._authHeaders() },
    })
  }

  /**
   * Get available dubbing engines and their status
   */
  async getDubbingEngines(): Promise<{
    engines: Record<string, {
      available: boolean
      description: string
      features: string[]
      requires_public_url?: boolean
      public_url_set?: boolean
    }>
  }> {
    const response = await this._fetch(`${this.baseURL}/api/dubbing-engines`)
    if (!response.ok) return { engines: {} }
    return response.json()
  }

  /**
   * Get the active TTS provider info
   */
  async getTTSProvider(): Promise<{ active: string; providers: Record<string, { available: boolean; voice_cloning?: boolean }> }> {
    const response = await this._fetch(`${this.baseURL}/api/tts-provider`)
    if (!response.ok) {
      return { active: "elevenlabs", providers: {} }
    }
    return response.json()
  }

  /**
   * Switch the active TTS provider
   */
  async setTTSProvider(provider: string): Promise<{ active: string; providers: Record<string, { available: boolean; voice_cloning?: boolean }> }> {
    const response = await this._fetch(`${this.baseURL}/api/tts-provider`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider }),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(error.detail || `Failed to switch provider: ${response.statusText}`)
    }
    return response.json()
  }

  /**
   * Get the chunk manifest for a job
   */
  async getChunks(jobId: string): Promise<ChunkInfo[]> {
    const response = await this._fetch(`${this.baseURL}/api/chunks/${jobId}`)
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(error.detail || `Failed to fetch chunks: ${response.statusText}`)
    }
    const data = await response.json()
    return data.chunks || []
  }

  /**
   * Delete a job and its associated files
   */
  async deleteJob(jobId: string): Promise<void> {
    const response = await this._fetch(`${this.baseURL}/api/job/${jobId}`, {
      method: 'DELETE',
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(error.detail || `Failed to delete job: ${response.statusText}`)
    }
  }

  /**
   * List all jobs
   */
  async listJobs(): Promise<JobStatus[]> {
    const response = await this._fetch(`${this.baseURL}/api/jobs`, {
      headers: this._authHeaders(),
    })
    if (!response.ok) {
      throw new Error(`Failed to list jobs: ${response.statusText}`)
    }
    const data = await response.json()
    return data.jobs || []
  }

  /**
   * Health check to verify backend is running
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this._fetch(`${this.baseURL}/health`, { method: 'GET' })
      return response.ok
    } catch {
      return false
    }
  }

  /**
   * Build the URL for downloading a dubbed video
   */
  getDubDownloadURL(jobId: string, language: string): string {
    return this._mediaUrl(`/api/download/${jobId}/${language}`)
  }

  /**
   * Trigger quality analysis for a dubbed video
   */
  async triggerAnalysis(jobId: string, language: string): Promise<AnalysisResponse> {
    const response = await this._fetch(`${this.baseURL}/api/analyze/${jobId}/${language}`, {
      method: 'POST',
    })
    if (!response.ok && response.status !== 202) {
      const error = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(error.detail || `Failed to trigger analysis: ${response.statusText}`)
    }
    return response.json()
  }

  /**
   * Get quality analysis results
   * Returns { status: 'running' } if still processing,
   * { status: 'complete', analysis: {...} } if done
   */
  async getAnalysis(jobId: string, language: string): Promise<AnalysisResponse> {
    const response = await this._fetch(`${this.baseURL}/api/analysis/${jobId}/${language}`)
    if (response.status === 202) {
      return { status: 'running', message: 'Analysis in progress' }
    }
    if (response.status === 404) {
      return { status: 'started', message: 'Analysis not yet triggered' }
    }
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(error.detail || `Failed to fetch analysis: ${response.statusText}`)
    }
    return response.json()
  }

  /**
   * Analyze a segment's audio via Hume AI and return a 5-chord progression
   */
  async analyzeSegmentEmotion(
    jobId: string,
    startTime: number,
    endTime: number,
  ): Promise<{
    status: string
    primary_emotion: string
    primary_score: number
    chain: string[]
    curve: number[]
    markers: Array<{ emotion: string; intensity: number; color: string; xFrac: number }>
    top_emotions: Array<[string, number]>
    // How the curve was produced: real frame-level analysis, a curve synthesized
    // from Velma's per-utterance labels, or the hardcoded Excitement default when
    // there was nothing to analyse at all.
    analysis_method?: 'emotion2vec-sliding-window' | 'velma-labels' | 'no-data-fallback' | string
  }> {
    const response = await this._fetch(`${this.baseURL}/api/emotion/analyze-segment/${jobId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start_time: startTime, end_time: endTime }),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(error.detail || `Emotion analysis failed: ${response.statusText}`)
    }
    return response.json()
  }

  async rediarizeWithVelma(jobId: string): Promise<{
    status: string
    job_id: string
    velma_utterances: number
    segments_patched: number
    total_segments: number
  }> {
    const response = await this._fetch(`${this.baseURL}/api/jobs/${jobId}/rediarize-velma`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(error.detail || `Velma re-diarization failed: ${response.statusText}`)
    }
    return response.json()
  }

  async getCharacterProfiles(jobId: string): Promise<CharacterProfile[]> {
    const response = await this._fetch(`${this.baseURL}/api/jobs/${jobId}/character-profiles`, {
      headers: this._authHeaders(),
    })
    if (!response.ok) throw new Error('Failed to load character profiles')
    const data = await response.json()
    return data.character_profiles ?? []
  }

  async saveCharacterProfiles(jobId: string, profiles: CharacterProfile[]): Promise<void> {
    const response = await this._fetch(`${this.baseURL}/api/jobs/${jobId}/character-profiles`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...this._authHeaders() },
      body: JSON.stringify({ character_profiles: profiles }),
    })
    if (!response.ok) throw new Error('Failed to save character profiles')
  }

  async regenerateSegment(
    jobId: string,
    index: number,
    request: RegenerateSegmentRequest
  ): Promise<RegenerateSegmentResponse> {
    const response = await this._fetch(
      `${this.baseURL}/api/segment/regenerate/${jobId}/${index}`,
      {
        method: 'POST',
        // Token always sent: the backend only checks it when engine is
        // "respeecher", but the client can't know that here.
        headers: { 'Content-Type': 'application/json', ...this._authHeaders() },
        body: JSON.stringify(request),
      }
    )
    if (!response.ok) {
      if (response.status === 404) throw new JobNotFoundError(jobId)
      const error = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(error.detail || `Failed to regenerate segment: ${response.statusText}`)
    }
    return response.json()
  }

  /**
   * Target voices for the Voice Changer panel: stock `premade` voices plus
   * everything in the user's ElevenLabs library.
   * `refresh` bypasses the backend's process-lifetime cache — needed to see a
   * voice added to the ElevenLabs account since the backend started.
   */
  async listElevenLabsVoices(refresh = false): Promise<{
    voices: Array<{
      id: string
      name: string
      gender: string | null
      accent: string | null
      description: string | null
      preview_url: string | null
      category: string | null
    }>
    enabled: boolean
  }> {
    const url = `${this.baseURL}/api/elevenlabs/voices${refresh ? '?refresh=true' : ''}`
    const res = await this._fetch(url)
    if (!res.ok) return { voices: [], enabled: false }
    return res.json()
  }

  /**
   * Audition a performance against a target voice WITHOUT touching any segment.
   * Returns the converted audio as a Blob for local playback.
   */
  async previewSts(
    file: File,
    voiceId: string,
    opts?: { modelId?: string; removeBackgroundNoise?: boolean }
  ): Promise<Blob> {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('voice_id', voiceId)
    fd.append('model_id', opts?.modelId ?? 'eleven_english_sts_v2')
    fd.append('remove_background_noise', String(opts?.removeBackgroundNoise ?? true))
    const res = await this._fetch(`${this.baseURL}/api/elevenlabs/sts-preview`, {
      method: 'POST',
      headers: { ...this._authHeaders() },
      body: fd,
    })
    if (!res.ok) {
      const e = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(e.detail || `Preview failed: ${res.status}`)
    }
    return res.blob()
  }

  /**
   * Apply a recorded performance to a segment via ElevenLabs speech-to-speech.
   * `index` is the segment's transcript_index, not its row position.
   * No Content-Type header: the browser must set the multipart boundary itself.
   */
  async performSegment(
    jobId: string,
    index: number,
    file: File,
    voiceId: string,
    opts?: { modelId?: string; removeBackgroundNoise?: boolean }
  ): Promise<{ status: string; segment: Record<string, unknown> }> {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('voice_id', voiceId)
    fd.append('model_id', opts?.modelId ?? 'eleven_english_sts_v2')
    fd.append('remove_background_noise', String(opts?.removeBackgroundNoise ?? true))
    const res = await this._fetch(`${this.baseURL}/api/segment/perform/${jobId}/${index}`, {
      method: 'POST',
      headers: { ...this._authHeaders() },
      body: fd,
    })
    if (!res.ok) {
      const e = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(e.detail || `Perform failed: ${res.status}`)
    }
    return res.json()
  }

  /**
   * Remove one take from a segment's Respeecher seed library.
   * `index` is the segment's transcript_index, not its row position.
   */
  async deleteSeedHistoryEntry(
    jobId: string,
    index: number,
    seed: number
  ): Promise<{ status: string; respeecher_seed_history: Array<{ seed: number; voice: string; params: Record<string, number> | null; kept?: boolean }> }> {
    const res = await this._fetch(`${this.baseURL}/api/segment/seed/${jobId}/${index}/${seed}`, {
      method: 'DELETE',
    })
    if (!res.ok) throw new Error(`Failed to delete seed: ${res.status}`)
    return res.json()
  }

  /**
   * Lock or unlock a take in the seed library. A locked entry is exempt from the
   * history cap and is never evicted to make room for newer takes.
   */
  async setSeedKept(
    jobId: string,
    index: number,
    seed: number,
    kept: boolean
  ): Promise<{ status: string }> {
    const res = await this._fetch(`${this.baseURL}/api/segment/seed/${jobId}/${index}/${seed}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kept }),
    })
    if (!res.ok) throw new Error(`Failed to update seed: ${res.status}`)
    return res.json()
  }

  async resetSegment(jobId: string, index: number): Promise<{ status: string }> {
    const response = await this._fetch(
      `${this.baseURL}/api/segment/reset/${jobId}/${index}`,
      { method: 'POST' }
    )
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(error.detail || `Reset failed: ${response.statusText}`)
    }
    return await response.json()
  }

  /** Respeecher's voice catalogue. Listing is not metered, so this succeeds even
   *  when the account has no generation balance. Returns [] when the backend has
   *  no API key configured, letting the panel show an empty state. */
  async listRespeecherVoices(): Promise<RespeecherVoice[]> {
    // Auth required: this endpoint is Professional-gated. Without the token it
    // returns 401 and the panel shows "Missing authentication token".
    const response = await this._fetch(`${this.baseURL}/api/respeecher/voices`, {
      headers: this._authHeaders(),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(error.detail || `Failed to load Respeecher voices: ${response.statusText}`)
    }
    const data = await response.json()
    return data.voices ?? []
  }

  /** Build a media URL for a segment audio file.
   *
   *  Pass cacheBust when the file was just rewritten on disk under a name it
   *  has held before (regens, staged takes) and the browser would otherwise
   *  serve the previous body. The buster is appended INSIDE _mediaUrl's path
   *  so it goes through the same `?`/`&` separator logic as access_token —
   *  callers that concatenated `?ts=` onto the returned string produced a
   *  second `?`, which folded the buster into the token value and 401'd. */
  /** URL of the clip a voice was cloned from. Goes through _mediaUrl so the
   *  access_token rides along — an <audio> element cannot send a header. */
  getCustomVoiceSampleUrl(voiceId: string): string {
    return this._mediaUrl(`/api/voices/custom/${encodeURIComponent(voiceId)}/sample`)
  }

  getAudioFileUrl(jobId: string, filename: string, cacheBust = false): string {
    const bust = cacheBust ? `?ts=${Date.now()}` : ''
    return this._mediaUrl(`/api/media/${jobId}/audio/${filename}${bust}`)
  }

  /** Rebuild a stored audio URL with the current token.
   *
   *  Stored segment URLs may carry an expired access_token baked in from a
   *  previous call to getAudioFileUrl(). When Supabase refreshes the JWT,
   *  this._token updates but the stored URL keeps the old token and 401s.
   *  This strips the query string (removing the stale token) and rebuilds
   *  via getAudioFileUrl so the URL always carries the current token. */
  refreshAudioUrl(jobId: string, url: string | undefined): string | undefined {
    if (!url) return url
    const filename = url.split('?')[0].split('/').pop()
    return filename ? this.getAudioFileUrl(jobId, filename) : url
  }

  async exportVideo(
    jobId: string,
    resolution: '720p' | '1080p' | '4k',
    aspect: 'widescreen' | 'fill',
    format: 'mp4' | 'mov' | 'avi' | 'mkv',
  ): Promise<{ export_id: string; filename: string }> {
    const res = await this._fetch(`${this.baseURL}/api/dub/export/${jobId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this._authHeaders() },
      body: JSON.stringify({ resolution, aspect, format }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(body.detail || `Export failed: ${res.status}`)
    }
    return res.json()
  }

  getExportDownloadUrl(jobId: string, filename: string): string {
    return this._mediaUrl(`/api/dub/export/download/${jobId}/${filename}`)
  }

  async getExportProgress(exportId: string): Promise<{
    status: 'preparing' | 'exporting' | 'done' | 'error' | 'cancelled'
    pct: number
    filename: string
    download_url: string
    job_id: string
    error?: string
  }> {
    const res = await this._fetch(`${this.baseURL}/api/dub/export/progress/${exportId}`)
    if (!res.ok) throw new Error('Export not found')
    return res.json()
  }

  async cancelExport(exportId: string): Promise<void> {
    await this._fetch(`${this.baseURL}/api/dub/export/progress/${exportId}`, { method: 'DELETE' })
  }

  /** Upload a video straight to the backend and start processing.
   *
   *  Restored with the direct-to-R2 path's removal. One request carries the
   *  bytes AND the job's language/speaker settings as form fields, so those
   *  cannot be lost between calls the way they were when this was replaced by
   *  presign + complete.
   *
   *  Awaits _ensureToken first: the token lives in memory on this singleton and
   *  is often unset on a fresh page load, which previously produced a silent
   *  401 while the browser was perfectly signed in.
   */
  async uploadVideo(
    file: File,
    onProgress?: (progress: number) => void,
    sourceLanguage?: string,
    numSpeakers?: number,
    targetLanguage?: string,
    signal?: AbortSignal,
  ): Promise<UploadResponse> {
    await this._ensureToken()
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      const formData = new FormData()
      formData.append('file', file)
      if (sourceLanguage && sourceLanguage !== 'auto') {
        formData.append('source_language', sourceLanguage)
      }
      if (numSpeakers && numSpeakers >= 1 && numSpeakers <= 10) {
        formData.append('num_speakers', String(numSpeakers))
      }
      if (targetLanguage) {
        formData.append('target_language', targetLanguage)
      }

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100))
        }
      })

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText))
          } catch {
            reject(new Error('Invalid response format'))
          }
        } else {
          try {
            const error = JSON.parse(xhr.responseText)
            reject(new Error(error.detail || `Upload failed: ${xhr.statusText}`))
          } catch {
            reject(new Error(`Upload failed: ${xhr.statusText}`))
          }
        }
      })

      xhr.addEventListener('error', () => reject(new Error('Network error during upload')))
      xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')))
      if (signal) {
        signal.addEventListener('abort', () => xhr.abort(), { once: true })
      }

      xhr.open('POST', `${this.baseURL}/api/upload`)
      if (this._token) {
        xhr.setRequestHeader('Authorization', `Bearer ${this._token}`)
      }
      xhr.send(formData)
    })
  }


  /** FastAPI puts the message in `detail`, which may be a string or an object. */
  private async _detail(res: Response): Promise<string> {
    try {
      const d = (await res.json()).detail
      if (typeof d === 'string') return d
      if (d?.message) return d.message
    } catch { /* non-JSON error body */ }
    return `HTTP ${res.status}`
  }

  async saveProject(jobId: string, meta: { title?: string; target_language?: string; thumbnail_url?: string }): Promise<void> {
    await this._fetch(`${this.baseURL}/api/projects/save/${jobId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this._authHeaders() },
      body: JSON.stringify(meta),
    })
  }

  async listProjects(): Promise<Array<{
    project_id: string
    job_id: string
    title: string
    video_filename: string | null
    source_language: string | null
    target_language: string | null
    thumbnail_url: string | null
    status: string
    progress: number
    created_at: string
    updated_at: string
    /** Retention date. null/absent = permanent (Professional). */
    expires_at?: string | null
  }>> {
    const res = await this._fetch(`${this.baseURL}/api/projects`, {
      headers: this._authHeaders(),
    })
    if (!res.ok) return []
    const data = await res.json()
    return data.projects ?? []
  }

  async retranslateJob(jobId: string): Promise<RetranslateResponse> {
    const response = await this._fetch(`${this.baseURL}/api/jobs/${jobId}/retranslate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this._authHeaders() },
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(error.detail || `Re-translate failed: ${response.statusText}`)
    }
    return response.json()
  }

  async remixDub(jobId: string): Promise<RemixResponse> {
    const response = await this._fetch(`${this.baseURL}/api/dub/remix/${jobId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this._authHeaders() },
    })
    if (!response.ok) {
      if (response.status === 404) throw new JobNotFoundError(jobId)
      const error = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(error.detail || `Failed to rebuild video: ${response.statusText}`)
    }
    return response.json()
  }

  async commitSegmentTiming(
    jobId: string,
    index: number,
    data: {
      committed_start_time?: number
      committed_end_time?: number
      committed_audio_url?: string
      committed_adapted_text?: string
      flag_status?: string
      correction_type?: string | null
      locked?: boolean
      paired_with_next?: boolean
      text?: string
      text_locked?: boolean
      // Promote a staged take: backend sets BOTH path and committed_audio_url
      // so the next rebuild merges the auditioned audio.
      staged_path?: string
    }
  ): Promise<void> {
    // Edits commit as they are made, so this call IS the save — a failure here
    // loses the user's work. _fetch resolves on 4xx/5xx like fetch does, so
    // without this check a rejected write looked identical to a successful one
    // and every caller's .catch stayed silent.
    const res = await this._fetch(`${this.baseURL}/api/segment/commit/${jobId}/${index}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...this._authHeaders() },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const detail = await this._detail(res).catch(() => res.statusText)
      // Announced globally as well as thrown: most call sites are
      // fire-and-forget, so throwing alone would leave the user with no signal
      // that their edit did not persist.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('segment-commit-failed', {
          detail: { jobId, index, error: detail },
        }))
      }
      throw new Error(detail)
    }
  }

  /** Reset the deletion countdown on unrendered work — "I'm still working on
   *  this". Rejected once a job has been rendered: that 30-day window is not
   *  extendable this way. */
  async resubmitRetention(jobId: string): Promise<RetentionState> {
    const res = await this._fetch(`${this.baseURL}/api/jobs/${jobId}/retention/resubmit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) throw new Error(await this._detail(res))
    return res.json()
  }

  /** Delete staged take files the user discarded. Omit indices to clear every
   *  staged take for the job. Without this, "discard" would only mean "forget
   *  in the browser" — the audition files would stay on disk. */
  async discardStagedTakes(jobId: string, transcriptIndices?: number[]): Promise<{ removed: number }> {
    const res = await this._fetch(`${this.baseURL}/api/dub/discard-staged/${jobId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(transcriptIndices ? { transcript_indices: transcriptIndices } : {}),
    })
    if (!res.ok) throw new Error(await this._detail(res))
    return res.json()
  }

  async setChunkStatus(
    jobId: string,
    chunkIndex: number,
    status: 'saved' | 'dirty'
  ): Promise<Record<string, string>> {
    const response = await this._fetch(`${this.baseURL}/api/dub/chunk-status/${jobId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this._authHeaders() },
      body: JSON.stringify({ chunk_index: chunkIndex, status }),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(error.detail || `Failed to set chunk status: ${response.statusText}`)
    }
    const data = await response.json()
    return data.chunk_status ?? {}
  }

  // Apply one voice across every segment of a speaker, server-side (reliable +
  // atomic). Returns which segments were regenerated / skipped (locked) / failed.
  async applyVoiceToSpeaker(
    jobId: string,
    speakerId: string,
    voiceId: string,
    /** Chunk lens: confine the change to this window. Omitted -> whole film. */
    window?: { start: number; end: number },
  ): Promise<{
    status: string
    voice_id: string
    regenerated: Array<{ transcript_index: number; voice_id: string; path: string; committed_audio_url?: string }>
    skipped_locked: number[]
    failed: Array<{ transcript_index: number; error: string }>
  }> {
    const res = await this._fetch(`${this.baseURL}/api/segments/apply-voice/${jobId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this._authHeaders() },
      body: JSON.stringify({
        speaker_id: speakerId,
        voice_id: voiceId,
        ...(window ? { window_start: window.start, window_end: window.end } : {}),
      }),
    })
    if (!res.ok) throw new Error(`apply-voice failed: ${res.status}`)
    return res.json()
  }

  async syncSegments(
    jobId: string,
    segments: Array<Record<string, unknown>>
  ): Promise<{ status: string; segments: Array<{ id: string; transcript_index: number; start_time: number; end_time: number; [key: string]: unknown }> }> {
    const response = await this._fetch(`${this.baseURL}/api/segment/sync/${jobId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this._authHeaders() },
      body: JSON.stringify({ segments }),
    })
    if (!response.ok) throw new Error(`Sync failed: ${response.statusText}`)
    return response.json()
  }

  async askAIChat(jobId: string, message: string, history: { role: 'user' | 'assistant'; content: string }[]): Promise<{ reply: string }> {
    const res = await this._fetch(`${this.baseURL}/api/ask-ai-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this._authHeaders() },
      body: JSON.stringify({ message, history }),
    })
    if (!res.ok) {
      let detail = `Ask AI request failed (${res.status})`
      try {
        const body = await res.json()
        if (body?.detail) detail = body.detail
      } catch {}
      throw new Error(detail)
    }
    return res.json()
  }

  async askAI(request: {
    prompt: string
    model?: 'haiku' | 'sonnet' | 'opus'
    source_text?: string
    dubbed_text?: string
    source_language?: string
    target_language?: string
    speaker_label?: string
    speaker_gender?: string
  }): Promise<{ status: string; suggestion: string; explanation: string }> {
    const response = await this._fetch(`${this.baseURL}/api/ask-ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this._authHeaders() },
      body: JSON.stringify(request),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(error.detail || 'Ask AI failed')
    }
    return response.json()
  }

  async updateVoiceMapping(jobId: string, voiceMapping: Record<string, string>): Promise<void> {
    await this._fetch(`${this.baseURL}/api/jobs/${jobId}/voice-mapping`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(voiceMapping),
    })
  }

  async getVoiceById(voiceId: string): Promise<{ voice_id: string; name: string; tags: string[] }> {
    const response = await this._fetch(`${this.baseURL}/api/voices/by-id/${encodeURIComponent(voiceId)}`)
    if (!response.ok) {
      throw new Error(`Voice ${voiceId} not found`)
    }
    return await response.json()
  }

  async updateTraitsMapping(jobId: string, traitsMapping: Record<string, string[]>): Promise<void> {
    await this._fetch(`${this.baseURL}/api/jobs/${jobId}/traits-mapping`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(traitsMapping),
    })
  }

  async reassignSpeaker(jobId: string, segmentIndex: number, newSpeakerId: string): Promise<void> {
    await this._fetch(`${this.baseURL}/api/jobs/${jobId}/speaker-reassign`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ segment_index: segmentIndex, new_speaker_id: newSpeakerId }),
    })
  }

  toAbsoluteUrl(url: string): string {
    if (!url) return ''
    if (url.startsWith('http://') || url.startsWith('https://')) return url
    const path = url.startsWith('/') ? url : `/${url}`
    // Media routes are owner-only now. They are consumed by <video>/<img>,
    // which cannot send headers, so the token rides in the query string.
    // transcript/export is included because it is opened as a browser
    // navigation (anchor download), which cannot carry an Authorization header
    // any more than <video src> can.
    if (/^\/api\/(media|download|transcript\/export|dub\/export\/download|projects\/[^/]+\/thumbnail)/.test(path)) {
      return this._mediaUrl(path)
    }
    return `${this.baseURL}${path}`
  }

  async getEmotionalLibrary(): Promise<EmotionalChord[]> {
    const response = await this._fetch(`${this.baseURL}/api/emotional-library`, {
      headers: { ...this._authHeaders() },
    })
    if (!response.ok) return []
    const data = await response.json()
    return data.chords ?? []
  }

  async saveEmotionalChord(chord: Omit<EmotionalChord, 'id' | 'user_id' | 'created_at'>): Promise<EmotionalChord | null> {
    const response = await this._fetch(`${this.baseURL}/api/emotional-library`, {
      method: 'POST',
      headers: { ...this._authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(chord),
    })
    if (!response.ok) return null
    return response.json()
  }

  async deleteEmotionalChord(id: string): Promise<void> {
    await this._fetch(`${this.baseURL}/api/emotional-library/${id}`, {
      method: 'DELETE',
      headers: { ...this._authHeaders() },
    })
  }

  async clearEmotionalLibrary(): Promise<void> {
    await this._fetch(`${this.baseURL}/api/emotional-library`, {
      method: 'DELETE',
      headers: { ...this._authHeaders() },
    })
  }

  async saveEmotionCurve(payload: {
    name: string
    description?: string
    tags?: string[]
    curve: unknown[]
    duration: number
    core_emotion: string
    source_segment_text?: string
  }): Promise<{ id: string; name: string }> {
    const res = await this._fetch(`${this.baseURL}/api/ei/curves`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this._authHeaders() },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error('Failed to save curve')
    return res.json()
  }

  async listEmotionCurves(): Promise<{ curves: Array<{
    id: string
    name: string
    description?: string
    tags?: string[]
    curve: unknown[]
    duration: number
    core_emotion: string
    source_segment_text?: string
    created_at: string
  }> }> {
    const res = await this._fetch(`${this.baseURL}/api/ei/curves`, {
      headers: { ...this._authHeaders() },
    })
    if (!res.ok) return { curves: [] }
    return res.json()
  }

  async deleteEmotionCurve(id: string): Promise<void> {
    await this._fetch(`${this.baseURL}/api/ei/curves/${id}`, {
      method: 'DELETE',
      headers: { ...this._authHeaders() },
    })
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const apiClient = new DubVerseAPIClient()

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function getStatusMessage(status: JobStatusValue): string {
  const messages: Record<JobStatusValue, string> = {
    pending: 'Waiting to process...',
    uploading: 'Uploading file...',
    processing: 'Processing video...',
    chunking: 'Splitting video into chunks...',
    extracting_audio: 'Extracting audio track...',
    diarizing: 'Identifying speakers...',
    transcribing: 'Transcribing with Whisper...',
    ready_for_voice_selection: 'Ready for voice selection',
    translating: 'Translating dialogue...',
    synthesizing: 'Generating dubbed audio...',
    lip_syncing: 'Syncing lip movements...',
    reassembling: 'Assembling final video...',
    vozo_processing: 'Vozo AI is processing...',
    completed: 'Processing complete!',
    failed: 'Processing failed',
    cancelled: 'Cancelled',
  }
  return messages[status] || 'Unknown status'
}

export function isTerminalStatus(status: JobStatusValue): boolean {
  return ['completed', 'failed', 'cancelled'].includes(status)
}

export function validateVideoFile(file: File): { valid: boolean; error?: string } {
  const maxSize = 5 * 1024 * 1024 * 1024 // 5GB
  const allowedFormats = [
    'video/mp4',
    'video/quicktime',
    'video/x-msvideo',
    'video/x-matroska',
    'video/webm',
  ]

  if (file.size > maxSize) {
    return { valid: false, error: 'File size exceeds 5GB limit' }
  }

  if (!allowedFormats.includes(file.type)) {
    return { valid: false, error: 'Invalid format. Supported: MP4, MOV, AVI, MKV, WebM' }
  }

  return { valid: true }
}

export function handleAPIError(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'An unexpected error occurred'
}
