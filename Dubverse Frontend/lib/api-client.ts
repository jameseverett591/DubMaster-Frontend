'use client'
/**
 * DubVerse API Client
 * Handles all communication with the FastAPI backend
 */

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

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
}

export interface SegmentsData {
  job_id: string
  language: string
  generated_at: string
  video_path: string
  accompaniment_path: string
  video_duration: number
  segments: Segment[]
}

export interface Voice {
  voice_id: string
  name: string
  category: string
  labels: Record<string, string>
  preview_url: string
  description: string
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

export interface RegenerateSegmentRequest {
  text?: string
  voice_id?: string
  voice_key?: string
  speed?: number
  pitch?: number
  emotion?: string
  emotionIntensity?: number
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
  async uploadVideo(
    file: File,
    onProgress?: (progress: number) => void,
    sourceLanguage?: string,
    numSpeakers?: number,
  ): Promise<UploadResponse> {
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

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) {
          const progress = Math.round((e.loaded / e.total) * 100)
          onProgress(progress)
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

      xhr.open('POST', `${this.baseURL}/api/upload`)
      if (this._token) {
        xhr.setRequestHeader('Authorization', `Bearer ${this._token}`)
      }
      xhr.send(formData)
    })
  }

  /**
   * Get the current status of a processing job
   */
  async getJobStatus(jobId: string): Promise<JobStatus> {
    const response = await fetch(`${this.baseURL}/api/status/${jobId}`)
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
    const response = await fetch(`${this.baseURL}/api/transcript/${jobId}`)
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
    const response = await fetch(`${this.baseURL}/api/segments/${jobId}`)
    if (!response.ok) {
      if (response.status === 404) throw new JobNotFoundError(jobId)
      const error = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(error.detail || `Failed to fetch segments: ${response.statusText}`)
    }
    return response.json()
  }

  /**
   * Start the dubbing pipeline for a job
   */
  async startDubbing(request: DubRequest): Promise<DubResponse> {
    const response = await fetch(`${this.baseURL}/api/dub`, {
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

  /**
   * Get available voices from the active TTS provider
   */
  async getVoices(): Promise<{ voices: Voice[]; provider: string }> {
    const response = await fetch(`${this.baseURL}/api/voices`)
    if (!response.ok) {
      throw new Error(`Failed to fetch voices: ${response.statusText}`)
    }
    const data = await response.json()
    return { voices: data.voices || [], provider: data.provider || "elevenlabs" }
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
    const response = await fetch(`${this.baseURL}/api/dubbing-engines`)
    if (!response.ok) return { engines: {} }
    return response.json()
  }

  /**
   * Get the active TTS provider info
   */
  async getTTSProvider(): Promise<{ active: string; providers: Record<string, { available: boolean; voice_cloning?: boolean }> }> {
    const response = await fetch(`${this.baseURL}/api/tts-provider`)
    if (!response.ok) {
      return { active: "elevenlabs", providers: {} }
    }
    return response.json()
  }

  /**
   * Switch the active TTS provider
   */
  async setTTSProvider(provider: string): Promise<{ active: string; providers: Record<string, { available: boolean; voice_cloning?: boolean }> }> {
    const response = await fetch(`${this.baseURL}/api/tts-provider`, {
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
    const response = await fetch(`${this.baseURL}/api/chunks/${jobId}`)
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
    const response = await fetch(`${this.baseURL}/api/job/${jobId}`, {
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
    const response = await fetch(`${this.baseURL}/api/jobs`, {
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
      const response = await fetch(`${this.baseURL}/health`, { method: 'GET' })
      return response.ok
    } catch {
      return false
    }
  }

  /**
   * Build the URL for downloading a dubbed video
   */
  getDubDownloadURL(jobId: string, language: string): string {
    return `${this.baseURL}/api/download/${jobId}/${language}`
  }

  /**
   * Trigger quality analysis for a dubbed video
   */
  async triggerAnalysis(jobId: string, language: string): Promise<AnalysisResponse> {
    const response = await fetch(`${this.baseURL}/api/analyze/${jobId}/${language}`, {
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
    const response = await fetch(`${this.baseURL}/api/analysis/${jobId}/${language}`)
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

  async regenerateSegment(
    jobId: string,
    index: number,
    request: RegenerateSegmentRequest
  ): Promise<RegenerateSegmentResponse> {
    const response = await fetch(
      `${this.baseURL}/api/segment/regenerate/${jobId}/${index}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

  getAudioFileUrl(jobId: string, filename: string): string {
    return `${this.baseURL}/api/media/${jobId}/audio/${filename}`
  }

  async remixDub(jobId: string): Promise<RemixResponse> {
    const response = await fetch(`${this.baseURL}/api/dub/remix/${jobId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!response.ok) {
      if (response.status === 404) throw new JobNotFoundError(jobId)
      const error = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(error.detail || `Failed to rebuild video: ${response.statusText}`)
    }
    return response.json()
  }

  async askAI(request: {
    prompt: string
    source_text?: string
    dubbed_text?: string
    source_language?: string
    target_language?: string
    speaker_label?: string
    speaker_gender?: string
  }): Promise<{ status: string; suggestion: string; explanation: string }> {
    const response = await fetch(`${this.baseURL}/api/ask-ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(error.detail || 'Ask AI failed')
    }
    return response.json()
  }

  async updateVoiceMapping(jobId: string, voiceMapping: Record<string, string>): Promise<void> {
    await fetch(`${this.baseURL}/api/jobs/${jobId}/voice-mapping`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(voiceMapping),
    })
  }

  async reassignSpeaker(jobId: string, segmentIndex: number, newSpeakerId: string): Promise<void> {
    await fetch(`${this.baseURL}/api/jobs/${jobId}/speaker-reassign`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ segment_index: segmentIndex, new_speaker_id: newSpeakerId }),
    })
  }

  toAbsoluteUrl(url: string): string {
    if (!url) return ''
    if (url.startsWith('http://') || url.startsWith('https://')) return url
    return `${this.baseURL}${url.startsWith('/') ? url : `/${url}`}`
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
