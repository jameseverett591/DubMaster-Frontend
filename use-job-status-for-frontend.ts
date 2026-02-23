/**
 * useJobStatus Hook
 * Automatically polls the backend for job status updates
 * Stops polling when job is completed or failed
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { apiClient, JobStatus } from '@/lib/api-client'

interface UseJobStatusOptions {
  jobId: string | null
  pollInterval?: number // milliseconds, default 2000 (2 seconds)
  enabled?: boolean // whether to start polling, default true
  onComplete?: (status: JobStatus) => void
  onError?: (error: string) => void
}

interface UseJobStatusReturn {
  status: JobStatus | null
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
  stopPolling: () => void
  startPolling: () => void
}

export function useJobStatus({
  jobId,
  pollInterval = 2000,
  enabled = true,
  onComplete,
  onError,
}: UseJobStatusOptions): UseJobStatusReturn {
  const [status, setStatus] = useState<JobStatus | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [isPolling, setIsPolling] = useState<boolean>(enabled)
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const isMountedRef = useRef<boolean>(true)

  // Fetch status from API
  const fetchStatus = useCallback(async () => {
    if (!jobId) return

    try {
      setLoading(true)
      setError(null)
      
      const jobStatus = await apiClient.getJobStatus(jobId)
      
      if (!isMountedRef.current) return

      setStatus(jobStatus)

      // Stop polling if job is complete or failed
      if (jobStatus.status === 'completed' || jobStatus.status === 'failed') {
        stopPolling()
        
        if (jobStatus.status === 'completed' && onComplete) {
          onComplete(jobStatus)
        }
        
        if (jobStatus.status === 'failed' && onError) {
          onError(jobStatus.error || 'Job processing failed')
        }
      }
    } catch (err) {
      if (!isMountedRef.current) return
      
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch status'
      setError(errorMessage)
      
      if (onError) {
        onError(errorMessage)
      }
      
      // Stop polling on error
      stopPolling()
    } finally {
      if (isMountedRef.current) {
        setLoading(false)
      }
    }
  }, [jobId, onComplete, onError])

  // Start polling
  const startPolling = useCallback(() => {
    setIsPolling(true)
  }, [])

  // Stop polling
  const stopPolling = useCallback(() => {
    setIsPolling(false)
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  // Set up polling interval
  useEffect(() => {
    if (!jobId || !isPolling) {
      return
    }

    // Initial fetch
    fetchStatus()

    // Set up interval
    intervalRef.current = setInterval(fetchStatus, pollInterval)

    // Cleanup
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [jobId, isPolling, pollInterval, fetchStatus])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false
      stopPolling()
    }
  }, [stopPolling])

  return {
    status,
    loading,
    error,
    refetch: fetchStatus,
    stopPolling,
    startPolling,
  }
}
