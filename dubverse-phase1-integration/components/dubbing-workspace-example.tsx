/**
 * EXAMPLE: Updated Dubbing Workspace Component
 * This shows how to integrate your existing dubbing-workspace.tsx with real backend status
 * 
 * INSTRUCTIONS FOR INTEGRATION:
 * 1. Add the useJobStatus hook to your actual dubbing-workspace.tsx
 * 2. Replace simulated speaker detection with real status display
 * 3. Keep your existing video player and UI components
 */

"use client"

import { useJobStatus } from "@/hooks/use-job-status"
import { getStatusMessage } from "@/lib/api-client"
import { VideoSource } from "@/app/dashboard"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { CheckCircle2, XCircle, Loader2, X } from "lucide-react"

interface DubbingWorkspaceProps {
  video: VideoSource
  onClose: () => void
}

export function DubbingWorkspace({ video, onClose }: DubbingWorkspaceProps) {
  /**
   * This hook automatically polls the backend for job status
   * It updates every 2 seconds until the job is complete or failed
   */
  const { status, loading, error } = useJobStatus({
    jobId: video.id, // This is the job_id from the upload response
    pollInterval: 2000, // Poll every 2 seconds
    onComplete: (finalStatus) => {
      console.log("Processing complete!", finalStatus)
      // Could show success toast, play sound, etc.
    },
    onError: (errorMessage) => {
      console.error("Processing failed:", errorMessage)
      // Show error toast
    },
  })

  /**
   * Render the appropriate UI based on current status
   */
  const renderStatusContent = () => {
    // Initial loading state
    if (loading && !status) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
          <p className="text-lg">Connecting to server...</p>
        </div>
      )
    }

    // Error state
    if (error) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
          <XCircle className="h-12 w-12 text-destructive" />
          <p className="text-lg font-semibold">Processing Error</p>
          <p className="text-muted-foreground">{error}</p>
          <Button onClick={onClose}>Back to Dashboard</Button>
        </div>
      )
    }

    // No status yet
    if (!status) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[400px]">
          <p className="text-muted-foreground">No status available</p>
        </div>
      )
    }

    // Processing state
    if (status.status === 'pending' || status.status === 'extracting' || status.status === 'chunking') {
      return (
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold">{video.title}</h2>
              <p className="text-muted-foreground">Processing your video</p>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Processing Status */}
          <div className="bg-muted rounded-lg p-6 space-y-4">
            <div className="flex items-center space-x-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <div className="flex-1">
                <p className="font-semibold">{getStatusMessage(status.status)}</p>
                <p className="text-sm text-muted-foreground">{status.current_step}</p>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Progress</span>
                <span>{status.progress}%</span>
              </div>
              <Progress value={status.progress} className="h-2" />
            </div>

            {/* Processing Steps */}
            <div className="space-y-2 pt-4 border-t">
              <ProcessingStep 
                name="Extracting Audio" 
                completed={status.status !== 'pending'} 
                active={status.status === 'extracting'}
              />
              <ProcessingStep 
                name="Chunking Video" 
                completed={status.status === 'completed'} 
                active={status.status === 'chunking'}
              />
              <ProcessingStep 
                name="Ready for Dubbing" 
                completed={status.status === 'completed'} 
                active={false}
              />
            </div>
          </div>

          {/* Video Preview (if available) */}
          {video.url && (
            <div className="rounded-lg overflow-hidden">
              <video
                src={video.url}
                controls
                className="w-full"
                style={{ maxHeight: '400px' }}
              />
            </div>
          )}
        </div>
      )
    }

    // Completed state - Ready for Phase 2 (speaker detection, dubbing, etc.)
    if (status.status === 'completed') {
      return (
        <div className="space-y-6">
          {/* Success Message */}
          <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-6 space-y-4">
            <div className="flex items-center space-x-3">
              <CheckCircle2 className="h-6 w-6 text-green-500" />
              <div>
                <p className="font-semibold">Processing Complete!</p>
                <p className="text-sm text-muted-foreground">
                  Your video has been processed into {status.chunks?.length || 0} chunks
                </p>
              </div>
            </div>
          </div>

          {/* Chunks Information */}
          {status.chunks && status.chunks.length > 0 && (
            <div className="bg-muted rounded-lg p-6">
              <h3 className="font-semibold mb-4">Video Segments</h3>
              <div className="space-y-2">
                {status.chunks.map((chunk, index) => (
                  <div key={chunk.chunk_id} className="flex items-center justify-between text-sm">
                    <span>Chunk {index + 1}</span>
                    <span className="text-muted-foreground">
                      {formatTime(chunk.start_time)} - {formatTime(chunk.end_time)} 
                      ({formatDuration(chunk.duration)})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Next Steps (Phase 2) */}
          <div className="bg-muted rounded-lg p-6">
            <h3 className="font-semibold mb-2">Ready for Next Phase</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Phase 1 complete! When Verdant delivers Phase 2, you'll see:
            </p>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>• Speaker detection (male, female, children)</li>
              <li>• Voice selection interface</li>
              <li>• Translation options</li>
              <li>• Dubbing generation controls</li>
            </ul>
          </div>
        </div>
      )
    }

    // Failed state
    if (status.status === 'failed') {
      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
          <XCircle className="h-12 w-12 text-destructive" />
          <p className="text-lg font-semibold">Processing Failed</p>
          <p className="text-muted-foreground">{status.error || 'Unknown error occurred'}</p>
          <Button onClick={onClose}>Back to Dashboard</Button>
        </div>
      )
    }

    return null
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-4xl mx-auto">
        {renderStatusContent()}
      </div>
    </div>
  )
}

/**
 * Helper component for processing steps
 */
function ProcessingStep({ 
  name, 
  completed, 
  active 
}: { 
  name: string
  completed: boolean
  active: boolean
}) {
  return (
    <div className="flex items-center space-x-3">
      {completed ? (
        <CheckCircle2 className="h-5 w-5 text-green-500" />
      ) : active ? (
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      ) : (
        <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30" />
      )}
      <span className={completed ? "text-foreground" : active ? "text-primary font-medium" : "text-muted-foreground"}>
        {name}
      </span>
    </div>
  )
}

/**
 * Utility functions
 */
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}m ${secs}s`
}

/**
 * KEY CHANGES FROM MOCK TO REAL:
 * 
 * BEFORE (Mock):
 * - const detectedVoices = [...hardcoded mock data...]
 * 
 * AFTER (Real):
 * - const { status } = useJobStatus({ jobId: video.id })
 * - Display real status, progress, chunks from backend
 * - Automatically updates every 2 seconds
 * - Stops polling when complete
 * 
 * The workspace now shows:
 * - Real processing status from backend
 * - Actual progress percentage
 * - Chunk information when complete
 * - Error messages if processing fails
 */
