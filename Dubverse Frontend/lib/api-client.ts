'use client'
/**
 * DubVerse API Client
 * Handles all communication with the FastAPI backend
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

// ============================================================================
// TYPE DEFINITIONS (matching Verdant's backend responses)
// ============================================================================

export interface UploadResponse {
  job_id: string
  filename: string
  size: number
  status: 'pending' | 'processing' | 'completed' | 'failed'
  created_at?: string
}

export interface JobStatus {
  job_id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  progress: number // 0-100
  current_step: string
  chunks?: ChunkInfo[]
  error?: string
  metadata?: {
    duration?: number
    format?: string
    size?: number
  }
}

export interface ChunkInfo {
  chunk_id: string
  sequence: number
  start_time: number
  end_time: number
  duration: number
  file_path: string
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

      // Track upload progress
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) {
          const progress = Math.round((e.loaded / e.total) * 100)
          onProgress(progress)
        }
      })

      // Handle completion
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText)
            resolve(response)
          } catch (error) {
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

      // Handle errors
      xhr.addEventListener('error', () => {
        reject(new Error('Network error during upload'))
      })

      xhr.addEventListener('abort', () => {
        reject(new Error('Upload cancelled'))
      })

      // Send request
      xhr.open('POST', `${this.baseURL}/api/upload`)
      xhr.send(formData)
    })
  }

  /**
   * Get the current status of a processing job
   * @param jobId - The job ID returned from uploadVideo
   * @returns JobStatus with current progress
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
   * Get the chunk manifest for a job
   * @param jobId - The job ID
   * @returns Array of chunk information
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
   * @param jobId - The job ID to delete
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
   * @returns true if backend is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseURL}/health`, {
        method: 'GET',
      })
      return response.ok
    } catch {
      return false
    }
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const apiClient = new DubVerseAPIClient()

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes'

  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
}

/**
 * Format duration in seconds to MM:SS
 */
export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

/**
 * Get user-friendly status message
 */
export function getStatusMessage(status: JobStatus['status']): string {
  const messages = {
    pending: 'Waiting to process...',
    processing: 'Processing video...',
    completed: 'Processing complete!',
    failed: 'Processing failed'
  }
  return messages[status] || 'Unknown status'
}

/**
 * Validate video file before upload
 */
export function validateVideoFile(file: File): { valid: boolean; error?: string } {
  const maxSize = 5 * 1024 * 1024 * 1024 // 5GB (matching Verdant's backend)
  const allowedFormats = [
    'video/mp4',
    'video/quicktime',
    'video/x-msvideo',
    'video/x-matroska',
    'video/webm'
  ]

  if (file.size > maxSize) {
    return { valid: false, error: 'File size exceeds 5GB limit' }
  }

  if (!allowedFormats.includes(file.type)) {
    return { valid: false, error: 'Invalid format. Supported: MP4, MOV, AVI, MKV, WebM' }
  }

  return { valid: true }
}

/**
 * Handle API errors consistently
 */
export function handleAPIError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return 'An unexpected error occurred'
}


