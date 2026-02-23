/**
 * DubVerse API Client
 * Handles all communication with the FastAPI backend
 * 
 * IMPORTANT: Update the API_BASE_URL in .env.local when Verdant provides the backend URL
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
  upload_time?: string
}

export interface JobStatus {
  job_id: string
  status: 'pending' | 'extracting' | 'chunking' | 'completed' | 'failed'
  progress: number // 0-100
  current_step: string
  chunks?: ChunkManifest[]
  error?: string
  metadata?: {
    duration?: number
    format?: string
    resolution?: string
  }
}

export interface ChunkManifest {
  chunk_id: string
  sequence: number
  start_time: number
  end_time: number
  duration: number
  file_path: string
}

export interface APIError {
  message: string
  code?: string
  details?: any
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
    const formData = new FormData()
    formData.append('video', file)

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()

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
          reject(new Error(`Upload failed: ${xhr.statusText}`))
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
      throw new Error(`Failed to fetch status: ${response.statusText}`)
    }

    return response.json()
  }

  /**
   * Get the chunk manifest for a completed job
   * @param jobId - The job ID
   * @returns Array of chunk information
   */
  async getChunks(jobId: string): Promise<ChunkManifest[]> {
    const response = await fetch(`${this.baseURL}/api/chunks/${jobId}`)
    
    if (!response.ok) {
      throw new Error(`Failed to fetch chunks: ${response.statusText}`)
    }

    const data = await response.json()
    return data.chunks || []
  }

  /**
   * Cancel and cleanup a job
   * @param jobId - The job ID to cancel
   */
  async cancelJob(jobId: string): Promise<void> {
    const response = await fetch(`${this.baseURL}/api/job/${jobId}`, {
      method: 'DELETE',
    })

    if (!response.ok) {
      throw new Error(`Failed to cancel job: ${response.statusText}`)
    }
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
    extracting: 'Extracting audio from video...',
    chunking: 'Splitting video into segments...',
    completed: 'Processing complete!',
    failed: 'Processing failed'
  }
  return messages[status] || 'Unknown status'
}

/**
 * Validate video file before upload
 */
export function validateVideoFile(file: File): { valid: boolean; error?: string } {
  const maxSize = 10 * 1024 * 1024 * 1024 // 10GB
  const maxDuration = 2 * 60 * 60 // 2 hours in seconds
  const allowedFormats = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska', 'video/webm']

  if (file.size > maxSize) {
    return { valid: false, error: 'File size exceeds 10GB limit' }
  }

  if (!allowedFormats.includes(file.type)) {
    return { valid: false, error: 'Invalid format. Supported: MP4, MOV, AVI, MKV, WebM' }
  }

  return { valid: true }
}

// ============================================================================
// ERROR HANDLING
// ============================================================================

export class DubVerseAPIError extends Error {
  constructor(
    message: string,
    public code?: string,
    public details?: any
  ) {
    super(message)
    this.name = 'DubVerseAPIError'
  }
}

/**
 * Handle API errors consistently
 */
export function handleAPIError(error: unknown): string {
  if (error instanceof DubVerseAPIError) {
    return error.message
  }
  
  if (error instanceof Error) {
    return error.message
  }

  return 'An unexpected error occurred'
}
