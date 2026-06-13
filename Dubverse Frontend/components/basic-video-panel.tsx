"use client"

import { useEffect, useRef, useState } from "react"
import { Download, Loader2, AlertCircle, CheckCircle2, Play } from "lucide-react"
import { apiClient, JobNotFoundError, type JobStatusValue } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface BasicVideoPanelProps {
  jobId: string
}

type Phase = "transcribing" | "ready" | "dubbing" | "complete" | "error"

function statusToPhase(status: JobStatusValue): Phase {
  if (status === "completed") return "complete"
  if (status === "failed" || status === "cancelled") return "error"
  if (status === "ready_for_voice_selection" || status === "ready") return "ready"
  if (["translating", "synthesizing", "lip_syncing", "reassembling", "vozo_processing"].includes(status))
    return "dubbing"
  return "transcribing"
}

const STAGE_LABELS: Partial<Record<JobStatusValue, string>> = {
  pending:                   "Preparing your video...",
  uploading:                 "Uploading...",
  processing:                "Processing on GPU...",
  chunking:                  "Analysing video...",
  extracting_audio:          "Extracting audio...",
  diarizing:                 "Detecting speakers...",
  transcribing:              "Transcribing dialogue...",
  ready_for_voice_selection: "Transcription complete",
  ready:                     "Ready to dub",
  translating:               "Translating dialogue...",
  synthesizing:              "Generating dubbed audio...",
  lip_syncing:               "Syncing lips...",
  reassembling:              "Assembling final video...",
  vozo_processing:           "Finalising...",
}

const TARGET_LANGUAGES = [
  { code: "en", name: "English",    flag: "🇺🇸" },
  { code: "es", name: "Spanish",    flag: "🇪🇸" },
  { code: "fr", name: "French",     flag: "🇫🇷" },
  { code: "de", name: "German",     flag: "🇩🇪" },
  { code: "pt", name: "Portuguese", flag: "🇵🇹" },
  { code: "ja", name: "Japanese",   flag: "🇯🇵" },
  { code: "ko", name: "Korean",     flag: "🇰🇷" },
  { code: "zh", name: "Mandarin",   flag: "🇨🇳" },
]

export function BasicVideoPanel({ jobId }: BasicVideoPanelProps) {
  const [phase, setPhase]             = useState<Phase>("transcribing")
  const [progress, setProgress]       = useState(0)
  const [stageLabel, setStageLabel]   = useState("Preparing your video...")
  const [dubbedUrl, setDubbedUrl]     = useState<string | null>(null)
  const [targetLang, setTargetLang]   = useState("en")
  const [launching, setLaunching]     = useState(false)
  const [errorMsg, setErrorMsg]       = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const poll = async () => {
      try {
        const s = await apiClient.getJobStatus(jobId)
        setProgress(s.progress ?? 0)
        setStageLabel(s.current_stage ?? STAGE_LABELS[s.status] ?? "Processing...")

        if (s.status === "completed") {
          if (s.dubbed_video_url) {
            // Dubbing pipeline is fully done
            setDubbedUrl(s.dubbed_video_url)
            setPhase("complete")
            clearInterval(intervalRef.current!)
          } else {
            // Transcription done, dubbing not yet started — show Begin Dubbing
            setPhase("ready")
          }
          return
        }

        if (s.status === "failed" || s.status === "cancelled") {
          setErrorMsg(s.error_message ?? "Something went wrong. Please try again.")
          setPhase("error")
          clearInterval(intervalRef.current!)
          return
        }

        const next = statusToPhase(s.status)
        // Don't regress from 'dubbing' back to 'ready' if polling catches an intermediate state
        setPhase(prev => (prev === "dubbing" && next === "ready") ? "dubbing" : next)
      } catch (err) {
        if (err instanceof JobNotFoundError) {
          setErrorMsg("This job no longer exists. Clear the list and upload again.")
          setPhase("error")
          clearInterval(intervalRef.current!)
        }
        // other errors: silently retry on network hiccup
      }
    }

    poll()
    intervalRef.current = setInterval(poll, 4000)
    return () => clearInterval(intervalRef.current!)
  }, [jobId])

  const handleBeginDubbing = async () => {
    setLaunching(true)
    try {
      const segData = await apiClient.getSegments(jobId)
      const transcript = segData.segments.map((seg) => ({
        text:    seg.text,
        start:   seg.start,
        end:     seg.end,
        speaker: seg.speaker,
      }))

      await apiClient.startDubbing({
        job_id:          jobId,
        target_language: targetLang,
        transcript,
        voice_mapping:   {},
      })

      setPhase("dubbing")
      setStageLabel("Translating dialogue...")
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to start dubbing.")
      setPhase("error")
    } finally {
      setLaunching(false)
    }
  }

  // ── Header label ────────────────────────────────────────────────────────────
  const headerIcon =
    phase === "complete"    ? <CheckCircle2 className="h-4 w-4 text-green-400" />
    : phase === "error"     ? <AlertCircle  className="h-4 w-4 text-red-400" />
    : phase === "ready"     ? <CheckCircle2 className="h-4 w-4 text-[#22D3EE]" />
    : <Loader2 className="h-4 w-4 text-[#A855F7] animate-spin" />

  const headerText =
    phase === "complete"    ? "Your Dub is Ready"
    : phase === "error"     ? "Processing Failed"
    : phase === "ready"     ? "Ready to Dub"
    : phase === "dubbing"   ? "Dubbing in Progress"
    : "Transcribing Video"

  return (
    <div className="w-full rounded-2xl bg-gradient-to-br from-[#0F172A]/80 to-[#1E293B]/80 backdrop-blur-xl border border-[#A855F7]/30 shadow-[0_0_40px_rgba(168,85,247,0.15)] overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#A855F7]/20">
        <div className="flex items-center gap-2">
          {headerIcon}
          <span className="text-sm font-semibold text-white">{headerText}</span>
        </div>
        {(phase === "transcribing" || phase === "dubbing") && (
          <span className="text-xs font-bold text-[#A855F7]">{Math.round(progress)}%</span>
        )}
      </div>

      {/* Body */}
      <div className="p-5">

        {/* ── Complete ────────────────────────────────────────────────── */}
        {phase === "complete" && dubbedUrl && (
          <div className="space-y-4">
            <video
              src={dubbedUrl}
              controls
              className="w-full rounded-xl border border-[#A855F7]/20 bg-black aspect-video"
            />
            <Button
              asChild
              className="w-full bg-gradient-to-r from-[#A855F7] to-[#22D3EE] text-white font-semibold hover:opacity-90 transition-opacity"
            >
              <a href={dubbedUrl} download>
                <Download className="mr-2 h-4 w-4" />
                Download Dubbed Video
              </a>
            </Button>
          </div>
        )}

        {/* ── Error ───────────────────────────────────────────────────── */}
        {phase === "error" && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <AlertCircle className="h-10 w-10 text-red-400" />
            <p className="text-sm text-[#94A3B8]">{errorMsg ?? "Something went wrong. Please try again."}</p>
          </div>
        )}

        {/* ── Ready — Begin Dubbing ────────────────────────────────────── */}
        {phase === "ready" && (
          <div className="flex flex-col items-center gap-5 py-6">
            <div className="relative flex items-center justify-center">
              <div className="relative h-14 w-14 rounded-full bg-gradient-to-br from-[#22D3EE] to-[#A855F7] flex items-center justify-center shadow-[0_0_30px_rgba(34,211,238,0.4)]">
                <CheckCircle2 className="h-7 w-7 text-white" />
              </div>
            </div>

            <div className="text-center">
              <p className="text-sm font-semibold text-white mb-1">Transcription complete</p>
              <p className="text-xs text-[#64748B]">Choose a target language and begin dubbing</p>
            </div>

            <div className="w-full space-y-3">
              <label className="text-xs font-medium text-[#94A3B8] uppercase tracking-wider">
                Target Language
              </label>
              <Select value={targetLang} onValueChange={setTargetLang}>
                <SelectTrigger className="w-full h-10 bg-[#0F172A]/60 border-[#A855F7]/30 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TARGET_LANGUAGES.map((l) => (
                    <SelectItem key={l.code} value={l.code}>
                      <span className="mr-2">{l.flag}</span>{l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                onClick={handleBeginDubbing}
                disabled={launching}
                className="w-full bg-gradient-to-r from-[#A855F7] to-[#22D3EE] text-white font-semibold hover:opacity-90 transition-opacity shadow-[0_0_20px_rgba(168,85,247,0.4)]"
              >
                {launching ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Starting...</>
                ) : (
                  <><Play className="mr-2 h-4 w-4" />Begin Dubbing</>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* ── Transcribing / Dubbing progress ─────────────────────────── */}
        {(phase === "transcribing" || phase === "dubbing") && (
          <div className="flex flex-col items-center gap-5 py-8">
            <div className="relative flex items-center justify-center">
              <div className="absolute h-20 w-20 rounded-full bg-[#A855F7]/20 animate-ping" />
              <div className="relative h-14 w-14 rounded-full bg-gradient-to-br from-[#A855F7] to-[#22D3EE] flex items-center justify-center shadow-[0_0_30px_rgba(168,85,247,0.5)]">
                <Loader2 className="h-7 w-7 text-white animate-spin" />
              </div>
            </div>

            <p className="text-sm font-medium text-white text-center">{stageLabel}</p>

            <div className="w-full">
              <div className="h-1.5 w-full rounded-full bg-[#0F172A] border border-[#334155] overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#A855F7] via-[#C084FC] to-[#22D3EE] transition-all duration-700 shadow-[0_0_10px_rgba(168,85,247,0.6)]"
                  style={{ width: `${Math.max(4, progress)}%` }}
                />
              </div>
            </div>

            <p className="text-xs text-[#64748B]">
              {phase === "transcribing" ? "Usually takes 1–2 minutes" : "Usually takes 3–8 minutes"}
            </p>
          </div>
        )}

      </div>
    </div>
  )
}
