"use client"

import { useState, useEffect, useRef, useCallback } from "react"

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

interface JobStatusData {
  job_id: string
  status: string
  progress: number
  current_stage?: string
  video_filename: string
  video_duration?: number
  total_chunks: number
  processed_chunks: number
  chunks: any[]
  dubbed_video_url?: string
  tts_engine?: string
  segment_tts_engines?: (string | null)[]
  speaker_genders?: Record<string, string>
  error_message?: string
  created_at: string
  updated_at: string
}

interface UseJobStatusOptions {
  jobId: string | null
  pollInterval?: number
  onComplete?: (data: JobStatusData) => void
  onError?: (error: string) => void
}

export function useJobStatus({ jobId, pollInterval = 2000, onComplete, onError }: UseJobStatusOptions) {
  const [status, setStatus] = useState<JobStatusData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)

  const fetchStatus = useCallback(async () => {
    if (!jobId) return
    try {
      const response = await fetch(`${BACKEND_URL}/api/status/${jobId}`)
      if (!response.ok) {
        if (response.status === 404) return
        throw new Error(`Failed to fetch status: ${response.statusText}`)
      }
      const data: JobStatusData = await response.json()
      if (!mountedRef.current) return

      setStatus(data)
      setLoading(false)
      setError(null)

      if (data.status === "completed") {
        if (intervalRef.current) clearInterval(intervalRef.current)
        onComplete?.(data)
      } else if (data.status === "failed") {
        if (intervalRef.current) clearInterval(intervalRef.current)
        onError?.(data.error_message || "Processing failed")
      }
    } catch (err: any) {
      if (!mountedRef.current) return
      setError(err.message)
      setLoading(false)
    }
  }, [jobId, onComplete, onError])

  useEffect(() => {
    mountedRef.current = true
    if (!jobId) { setLoading(false); return }
    fetchStatus()
    intervalRef.current = setInterval(fetchStatus, pollInterval)
    return () => {
      mountedRef.current = false
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [jobId, pollInterval, fetchStatus])

  return { status, loading, error }
}
