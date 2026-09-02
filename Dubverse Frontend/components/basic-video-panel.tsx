"use client"

import { useEffect, useRef, useState } from "react"
import { Download, Loader2, AlertCircle, CheckCircle2, Play } from "lucide-react"
import { apiClient, JobNotFoundError, type JobStatusValue } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { InlineTranscriptEditor, type InlineSegment } from "@/components/inline-editor"
import { useT } from '@/lib/use-t'

interface BasicVideoPanelProps {
  jobId: string
  onStale?: () => void
  onReviewingChange?: (isReviewing: boolean) => void
}

type Phase = "transcribing" | "ready" | "reviewing" | "translating" | "reviewing_translation" | "dubbing" | "complete" | "error"

function statusToPhase(status: JobStatusValue): Phase {
  if (status === "completed") return "complete"
  if (status === "failed" || status === "cancelled") return "error"
  if (status === "ready_for_voice_selection") return "ready"
  if (status === "ready_for_review") return "reviewing_translation"
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
  ready_for_review:          "Translation complete — review before rendering",
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

export function BasicVideoPanel({ jobId, onStale, onReviewingChange }: BasicVideoPanelProps) {
  const t = useT()
  const [phase, setPhase]             = useState<Phase>("transcribing")
  const [progress, setProgress]       = useState(0)
  const [stageLabel, setStageLabel]   = useState("Preparing your video...")
  const [dubbedUrl, setDubbedUrl]     = useState<string | null>(null)
  const [targetLang, setTargetLang]   = useState("en")
  const [launching, setLaunching]     = useState(false)
  const [errorMsg, setErrorMsg]       = useState<string | null>(null)
  const [rawTranscript, setRawTranscript] = useState<Array<{ text: string; start: number; end: number; speaker: string; confidence?: number; confidence_tier?: "high" | "medium" | "low"; words?: Array<{ word: string; start: number; end: number; confidence: number }> }> | null>(null)
  const [speakerGenders, setSpeakerGenders] = useState<Record<string, string>>({})
  const [editedSegments, setEditedSegments] = useState<InlineSegment[] | null>(null)
  const [translatedSegments, setTranslatedSegments] = useState<Array<{ text: string; start: number; end: number; speaker: string; source_text?: string; segment_id?: string }> | null>(null)
  const [sourceLang, setSourceLang] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Counts polls seen in the "completed but no URL yet" window, so the wait
  // for a late URL is bounded rather than indefinite.
  const completedNoUrlRef = useRef(0)

  useEffect(() => {
    const poll = async () => {
      try {
        const s = await apiClient.getJobStatus(jobId)
        setProgress(s.progress ?? 0)
        setStageLabel(s.current_stage ?? STAGE_LABELS[s.status] ?? "Processing...")

        if (s.status === "completed") {
          if (s.dubbed_video_url) {
            const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
            const url = s.dubbed_video_url
            setDubbedUrl(url.startsWith("http") ? url : `${apiBase}${url}`)
            setPhase("complete")
            clearInterval(intervalRef.current!)
            return
          }

          // Completed, but the dubbed URL is not in the payload yet: the job
          // flips to "completed" a moment before that URL is persisted.
          // Previously this stopped polling anyway, leaving the panel stuck on
          // "Generating dubbed audio..." until the user refreshed — the refresh
          // was the only thing that ever recovered it. Keep polling instead,
          // bounded so a URL that never arrives can't spin forever.
          completedNoUrlRef.current += 1
          if (completedNoUrlRef.current >= 15) {   // ~60s at the 4s interval
            setPhase(prev => prev === "dubbing" || prev === "reviewing" ? prev : "ready")
            clearInterval(intervalRef.current!)
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
        // Don't regress from active phases back to 'ready' if polling catches an intermediate state
        const activePhases: Phase[] = ["dubbing", "reviewing", "translating", "reviewing_translation"]
        setPhase(prev => (activePhases.includes(prev) && next === "ready") ? prev : next)
      } catch (err) {
        if (err instanceof JobNotFoundError) {
          clearInterval(intervalRef.current!)
          onStale?.()  // tell parent to remove the stale file — panel will unmount
          return
        }
        // other errors: silently retry on network hiccup
      }
    }

    poll()
    intervalRef.current = setInterval(poll, 4000)
    return () => clearInterval(intervalRef.current!)
  }, [jobId])

  const fetchTranscript = async () => {
    let transcript: typeof rawTranscript = null
    let genders: Record<string, string> = {}
    try {
      const segData = await apiClient.getSegments(jobId)
      const segAny = segData as unknown as { segments: Array<Record<string, unknown>>; speaker_genders?: Record<string, string> }
      transcript = segAny.segments.map((seg) => ({
        text:    String(seg.text ?? ""),
        start:   Number(seg.start ?? 0),
        end:     Number(seg.end ?? 0),
        speaker: String(seg.speaker ?? "SPEAKER_0"),
        confidence: typeof seg.confidence === "number" ? seg.confidence : undefined,
        confidence_tier: seg.confidence_tier as "high" | "medium" | "low" | undefined,
        words: Array.isArray(seg.words) ? (seg.words as Array<{ word: string; start: number; end: number; confidence: number }>) : undefined,
      }))
      genders = segAny.speaker_genders ?? {}
    } catch {
      const txData = await apiClient.getTranscript(jobId)
      const txAny = txData as unknown as { segments: Array<Record<string, unknown>> }
      transcript = txAny.segments.map((seg) => ({
        text:    String(seg.text ?? ""),
        start:   Number(seg.start ?? 0),
        end:     Number(seg.end ?? 0),
        speaker: String(seg.speaker ?? "SPEAKER_0"),
        confidence: typeof seg.confidence === "number" ? seg.confidence : undefined,
        confidence_tier: seg.confidence_tier as "high" | "medium" | "low" | undefined,
        words: Array.isArray(seg.words) ? (seg.words as Array<{ word: string; start: number; end: number; confidence: number }>) : undefined,
      }))
    }
    return { transcript, genders }
  }

  const handleReviewTranscript = async () => {
    setLaunching(true)
    try {
      const { transcript, genders } = await fetchTranscript()
      if (transcript) {
        setRawTranscript(transcript)
        setSpeakerGenders(genders)
        setPhase("reviewing")
        onReviewingChange?.(true)
        if (intervalRef.current) clearInterval(intervalRef.current)
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to load transcript.")
      setPhase("error")
    } finally {
      setLaunching(false)
    }
  }

  const handleTranslateAndReview = async () => {
    setLaunching(true)
    try {
      const { transcript } = await fetchTranscript()
      if (!transcript) throw new Error("No transcript available")

      setPhase("translating")
      setStageLabel("Translating dialogue...")

      const result = await apiClient.translateOnly({
        job_id:          jobId,
        target_language: targetLang,
        transcript,
        voice_mapping:   {},
      })

      setTranslatedSegments(result.segments)
      setSourceLang(result.source_language)
      if (result.speaker_genders) setSpeakerGenders(result.speaker_genders)
      setPhase("reviewing_translation")
      onReviewingChange?.(true)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Translation failed.")
      setPhase("error")
    } finally {
      setLaunching(false)
    }
  }

  const handleConfirmAndTranslate = async (segments: InlineSegment[]) => {
    setEditedSegments(segments)
    setLaunching(true)
    onReviewingChange?.(false)
    try {
      const transcript = segments
        .filter((s) => s.status !== "rejected")
        .map((s) => ({
          text:    s.text,
          start:   s.start,
          end:     s.end,
          speaker: s.speaker_id,
        }))

      setPhase("translating")
      setStageLabel("Translating dialogue...")

      const result = await apiClient.translateOnly({
        job_id:          jobId,
        target_language: targetLang,
        transcript,
        voice_mapping:   {},
      })

      setTranslatedSegments(result.segments)
      setSourceLang(result.source_language)
      setPhase("reviewing_translation")
      onReviewingChange?.(true)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Translation failed.")
      setPhase("error")
    } finally {
      setLaunching(false)
    }
  }

  const handleConfirmAndRender = async (segments: InlineSegment[]) => {
    setLaunching(true)
    onReviewingChange?.(false)
    try {
      const transcript = segments
        .filter((s) => s.status !== "rejected")
        .map((s) => ({
          text:    s.text,
          start:   s.start,
          end:     s.end,
          speaker: s.speaker_id,
        }))

      await apiClient.startRender({
        job_id:          jobId,
        target_language: targetLang,
        source_language: sourceLang ?? undefined,
        transcript,
        voice_mapping:   {},
      })

      setPhase("dubbing")
      setStageLabel("Generating dubbed audio...")
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Render failed.")
      setPhase("error")
    } finally {
      setLaunching(false)
    }
  }

  const handleBeginDubbing = async () => {
    setLaunching(true)
    try {
      const { transcript } = await fetchTranscript()
      if (!transcript) throw new Error("No transcript available")

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
    phase === "complete"               ? <CheckCircle2 className="h-4 w-4 text-green-400" />
    : phase === "error"                ? <AlertCircle  className="h-4 w-4 text-red-400" />
    : phase === "ready"                ? <CheckCircle2 className="h-4 w-4 text-[#22D3EE]" />
    : phase === "reviewing"            ? <CheckCircle2 className="h-4 w-4 text-[#A855F7]" />
    : phase === "reviewing_translation" ? <CheckCircle2 className="h-4 w-4 text-[#A855F7]" />
    : <Loader2 className="h-4 w-4 text-[#A855F7] animate-spin" />

  const headerText =
    phase === "complete"               ? "Your Dub is Ready"
    : phase === "error"                ? "Processing Failed"
    : phase === "ready"                ? "Ready to Dub"
    : phase === "reviewing"            ? "Review Transcript"
    : phase === "reviewing_translation" ? "Review Translation"
    : phase === "translating"          ? "Translating..."
    : phase === "dubbing"              ? "Dubbing in Progress"
    : "Transcribing Video"

  return (
    <div className="w-full rounded-2xl bg-gradient-to-br from-[#0F172A]/80 to-[#1E293B]/80 backdrop-blur-xl border border-[#A855F7]/30 shadow-[0_0_40px_rgba(168,85,247,0.15)] overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#A855F7]/20">
        <div className="flex items-center gap-2">
          {headerIcon}
          <span className="text-sm font-semibold text-white">{headerText}</span>
        </div>
        {(phase === "transcribing" || phase === "translating" || phase === "dubbing") && (
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
              className="w-full rounded-xl border border-[#A855F7]/20 bg-black min-h-[460px] object-contain"
            />
            <Button
              asChild
              className="w-full bg-gradient-to-r from-[#A855F7] to-[#22D3EE] text-white font-semibold hover:opacity-90 transition-opacity"
            >
              {/* ?attachment=1 rather than the `download` attribute: that
                  attribute is ignored cross-origin, and the API is on a
                  different port, so the link only ever played the video.
                  Content-Disposition from the server is what saves it. */}
              <a
                href={`${dubbedUrl}${dubbedUrl.includes("?") ? "&" : "?"}attachment=1`}
                download
              >
                <Download className="mr-2 h-4 w-4" />
                {t('Download Dubbed Video')}
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

        {/* ── Ready — Translate & Review ────────────────────────────────── */}
        {phase === "ready" && (
          <div className="flex flex-col items-center gap-5 py-6">
            <div className="relative flex items-center justify-center">
              <div className="relative h-14 w-14 rounded-full bg-gradient-to-br from-[#22D3EE] to-[#A855F7] flex items-center justify-center shadow-[0_0_30px_rgba(34,211,238,0.4)]">
                <CheckCircle2 className="h-7 w-7 text-white" />
              </div>
            </div>

            <div className="text-center">
              <p className="text-sm font-semibold text-white mb-1">{t('Transcription complete')}</p>
              <p className="text-xs text-[#64748B]">{t('Choose a target language to translate and review before rendering')}</p>
            </div>

            <div className="w-full space-y-3">
              <label className="text-xs font-medium text-[#94A3B8] uppercase tracking-wider">
                {t('Target Language')}
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
                onClick={handleTranslateAndReview}
                disabled={launching}
                className="w-full bg-gradient-to-r from-[#A855F7] to-[#22D3EE] text-white font-semibold hover:opacity-90 transition-opacity shadow-[0_0_20px_rgba(168,85,247,0.4)]"
              >
                {launching ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t('Translating...')}</>
                ) : (
                  <><Play className="mr-2 h-4 w-4" />Translate &amp; Review</>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* ── Reviewing — Inline transcript editor ─────────────────────── */}
        {phase === "reviewing" && rawTranscript && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-[#94A3B8]">
                {t('Double-click text to edit. Reject bad segments before dubbing.')}
              </p>
              <div className="flex items-center gap-3">
                <span className="text-xs text-[#64748B]">Target:</span>
                <Select value={targetLang} onValueChange={setTargetLang}>
                  <SelectTrigger className="w-36 h-8 bg-[#0F172A]/60 border-[#A855F7]/30 text-white text-sm">
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
              </div>
            </div>
            <InlineTranscriptEditor
              projectName={`Job ${jobId}`}
              rawSegments={rawTranscript}
              speakerGenders={speakerGenders}
              onConfirm={handleConfirmAndTranslate}
              onExport={(segs) => {
                const blob = new Blob([JSON.stringify(segs, null, 2)], { type: "application/json" })
                const url = URL.createObjectURL(blob)
                const a = document.createElement("a")
                a.href = url
                a.download = `transcript-${jobId}.json`
                a.click()
                URL.revokeObjectURL(url)
              }}
            />
          </div>
        )}

        {/* ── Reviewing translation — Inline editor with translated text ── */}
        {phase === "reviewing_translation" && translatedSegments && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-[#94A3B8]">
                {t('Review the translated text. Edit or reject segments before rendering.')}
              </p>
            </div>
            <InlineTranscriptEditor
              projectName={`Job ${jobId}`}
              rawSegments={translatedSegments}
              speakerGenders={speakerGenders}
              onConfirm={handleConfirmAndRender}
              confirmLabel="Confirm & Render"
              onExport={(segs) => {
                const blob = new Blob([JSON.stringify(segs, null, 2)], { type: "application/json" })
                const url = URL.createObjectURL(blob)
                const a = document.createElement("a")
                a.href = url
                a.download = `translation-${jobId}.json`
                a.click()
                URL.revokeObjectURL(url)
              }}
            />
          </div>
        )}

        {/* ── Transcribing / Translating / Dubbing progress ──────────── */}
        {(phase === "transcribing" || phase === "translating" || phase === "dubbing") && (
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
              {phase === "transcribing" ? "Usually takes 1–2 minutes" : phase === "translating" ? "Usually takes 30–60 seconds" : "Usually takes 3–8 minutes"}
            </p>
          </div>
        )}

      </div>

    </div>
  )
}
