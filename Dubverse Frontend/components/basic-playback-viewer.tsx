"use client"

import { useEffect, useRef, useState } from "react"
import { Download, Loader2, AlertCircle, CheckCircle2 } from "lucide-react"
import { apiClient, type JobStatusValue } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { useT } from '@/lib/use-t'

interface BasicPlaybackViewerProps {
  jobId: string
}

const STAGE_LABELS: Partial<Record<JobStatusValue, string>> = {
  pending:                 "Preparing your video...",
  uploading:               "Uploading...",
  processing:              "Processing on GPU...",
  chunking:                "Analysing video...",
  extracting_audio:        "Extracting audio...",
  diarizing:               "Detecting speakers...",
  transcribing:            "Transcribing dialogue...",
  ready_for_voice_selection: "Ready for voice selection...",
  translating:             "Translating dialogue...",
  synthesizing:            "Generating dubbed audio...",
  lip_syncing:             "Syncing lips...",
  reassembling:            "Assembling final video...",
  vozo_processing:         "Finalising...",
}

export function BasicPlaybackViewer({ jobId }: BasicPlaybackViewerProps) {
  const t = useT()
  const [status, setStatus] = useState<JobStatusValue>("pending")
  const [progress, setProgress] = useState(0)
  const [stageLabel, setStageLabel] = useState("Preparing your video...")
  const [dubbedUrl, setDubbedUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const poll = async () => {
      try {
        const s = await apiClient.getJobStatus(jobId)
        setStatus(s.status)
        setProgress(s.progress ?? 0)
        setStageLabel(
          s.current_stage
            ?? STAGE_LABELS[s.status]
            ?? "Processing..."
        )

        if (s.status === "completed") {
          setDubbedUrl(s.dubbed_video_url)
          clearInterval(intervalRef.current!)
        } else if (s.status === "failed" || s.status === "cancelled") {
          setFailed(true)
          clearInterval(intervalRef.current!)
        }
      } catch {
        // silently retry on network hiccup
      }
    }

    poll()
    intervalRef.current = setInterval(poll, 4000)
    return () => clearInterval(intervalRef.current!)
  }, [jobId])

  const isComplete = status === "completed" && dubbedUrl

  return (
    <div className="w-full rounded-2xl bg-gradient-to-br from-[#0F172A]/80 to-[#1E293B]/80 backdrop-blur-xl border border-[#A855F7]/30 shadow-[0_0_40px_rgba(168,85,247,0.15)] overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#A855F7]/20">
        <div className="flex items-center gap-2">
          {isComplete ? (
            <CheckCircle2 className="h-4 w-4 text-green-400" />
          ) : failed ? (
            <AlertCircle className="h-4 w-4 text-red-400" />
          ) : (
            <Loader2 className="h-4 w-4 text-[#A855F7] animate-spin" />
          )}
          <span className="text-sm font-semibold text-white">
            {isComplete ? "Your Dub is Ready" : failed ? t('Processing Failed') : t('Dubbing in Progress')}
          </span>
        </div>
        {!failed && !isComplete && (
          <span className="text-xs font-bold text-[#A855F7]">{Math.round(progress)}%</span>
        )}
      </div>

      {/* Body */}
      <div className="p-5">
        {isComplete ? (
          /* ── Playback + Download ─────────────────────────────── */
          <div className="space-y-4">
            <video
              src={dubbedUrl!}
              controls
              className="w-full rounded-xl border border-[#A855F7]/20 bg-black aspect-video"
            />
            <Button
              asChild
              className="w-full bg-gradient-to-r from-[#A855F7] to-[#22D3EE] text-white font-semibold hover:opacity-90 transition-opacity"
            >
              <a href={dubbedUrl!} download>
                <Download className="mr-2 h-4 w-4" />
                {t('Download Dubbed Video')}
              </a>
            </Button>
          </div>
        ) : failed ? (
          /* ── Error ───────────────────────────────────────────── */
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <AlertCircle className="h-10 w-10 text-red-400" />
            <p className="text-sm text-[#94A3B8]">{t('Something went wrong. Please try again.')}</p>
          </div>
        ) : (
          /* ── Loading ─────────────────────────────────────────── */
          <div className="flex flex-col items-center gap-5 py-8">
            {/* Pulsing ring */}
            <div className="relative flex items-center justify-center">
              <div className="absolute h-20 w-20 rounded-full bg-[#A855F7]/20 animate-ping" />
              <div className="relative h-14 w-14 rounded-full bg-gradient-to-br from-[#A855F7] to-[#22D3EE] flex items-center justify-center shadow-[0_0_30px_rgba(168,85,247,0.5)]">
                <Loader2 className="h-7 w-7 text-white animate-spin" />
              </div>
            </div>

            {/* Stage label */}
            <p className="text-sm font-medium text-white text-center">{stageLabel}</p>

            {/* Progress bar */}
            <div className="w-full">
              <div className="h-1.5 w-full rounded-full bg-[#0F172A] border border-[#334155] overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#A855F7] via-[#C084FC] to-[#22D3EE] transition-all duration-700 shadow-[0_0_10px_rgba(168,85,247,0.6)]"
                  style={{ width: `${Math.max(4, progress)}%` }}
                />
              </div>
            </div>

            <p className="text-xs text-[#64748B]">This usually takes 3–8 minutes</p>
          </div>
        )}
      </div>
    </div>
  )
}
