'use client'
/**
 * DubVerse API Client
 * Handles all communication with the FastAPI backend
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

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
  voice_settings?: Record<string, Record<string, number>>
  source_language?: string
}

export interface DubResponse {
  job_id: string
  status: string
  dubbed_video_url?: string
  tts_engine?: string
  message: string
}

// ============================================================================
// API CLIENT CLASS
// ============================================================================

class DubVerseAPIClient {
  private baseURL: string

  constructor(baseURL: string = API_BASE_URL) {
    this.baseURL = baseURL
  }

  /**
   * Upload a video file to the backend
   * @param file - The video file to upload
   * @param onProgress - Optional callback for upload progress (0-100)
   * @returns UploadResponse with job_id
   */
  async uploadVideo(
    file: File,
    onProgress?: (progress: number) => void
  ): Promise<UploadResponse> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      const formData = new FormData()
      formData.append('file', file)

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
      xhr.send(formData)
    })
  }

  /**
   * Get the current status of a processing job
   */
  async getJobStatus(jobId: string): Promise<JobStatus> {
    const response = await fetch(`${this.baseURL}/api/status/${jobId}`)
    if (!response.ok) {
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
   * Get available ElevenLabs voices
   */
  async getVoices(): Promise<Voice[]> {
    const response = await fetch(`${this.baseURL}/api/voices`)
    if (!response.ok) {
      throw new Error(`Failed to fetch voices: ${response.statusText}`)
    }
    const data = await response.json()
    return data.voices || []
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
    const response = await fetch(`${this.baseURL}/api/jobs`)
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
