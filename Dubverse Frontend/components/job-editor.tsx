"use client"

import { useRef, useState, useCallback, useEffect } from "react"
import { Badge } from "@/components/ui/badge"
import type { Segment, Transcript } from "@/lib/api-client"
import { useT } from '@/lib/use-t'

// ── helpers ──────────────────────────────────────────────────────────────────

function langName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code
  } catch {
    return code
  }
}

function fmtSpeaker(speaker: string): string {
  const n = speaker.match(/\d+/)
  return n ? `Speaker ${parseInt(n[0], 10) + 1}` : speaker
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

const SPEAKER_COLORS = [
  "bg-blue-500/15 text-blue-400 border-blue-500/30",
  "bg-amber-500/15 text-amber-400 border-amber-500/30",
  "bg-green-500/15 text-green-400 border-green-500/30",
  "bg-purple-500/15 text-purple-400 border-purple-500/30",
  "bg-rose-500/15 text-rose-400 border-rose-500/30",
]

// ── component ─────────────────────────────────────────────────────────────────

interface JobEditorProps {
  jobId: string
  dubbedVideoUrl: string
  videoDuration: number
  segments: Segment[]
  segmentsLanguage: string
  transcript: Transcript | null
}

export function JobEditor({
  dubbedVideoUrl,
  segments,
  segmentsLanguage,
  transcript,
}: JobEditorProps) {
  const t = useT()
  const [leftPct, setLeftPct] = useState(50)
  const containerRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging.current || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const pct = ((e.clientX - rect.left) / rect.width) * 100
    setLeftPct(Math.max(25, Math.min(75, pct)))
  }, [])

  const onMouseUp = useCallback(() => {
    isDragging.current = false
  }, [])

  useEffect(() => {
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
    return () => {
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }
  }, [onMouseMove, onMouseUp])

  // Source text lookup by transcript_index
  const sourceByIndex = new Map(
    (transcript?.segments ?? []).map((seg, i) => [i, seg.text])
  )

  // Speaker → stable color assignment
  const speakerIds = [...new Set(segments.map((s) => s.speaker))]
  const speakerColor = (speaker: string) =>
    SPEAKER_COLORS[speakerIds.indexOf(speaker) % SPEAKER_COLORS.length]

  const sourceLang = transcript?.language ? langName(transcript.language) : "Source"
  const targetLang = langName(segmentsLanguage)

  return (
    <div
      ref={containerRef}
      className="flex h-screen bg-background overflow-hidden select-none"
    >
      {/* ── Left panel: video ─────────────────────────────────────────────── */}
      <div
        className="flex flex-col border-r border-border shrink-0"
        style={{ width: `${leftPct}%` }}
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {t('Dubbed Video')}
          </span>
          <Badge variant="outline" className="text-[10px] h-5">
            {targetLang}
          </Badge>
        </div>
        <div className="flex-1 flex items-center justify-center bg-black min-h-0 p-4">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            src={dubbedVideoUrl}
            controls
            className="max-h-full max-w-full rounded-md"
          />
        </div>
      </div>

      {/* ── Drag handle ───────────────────────────────────────────────────── */}
      <div
        className="w-1 shrink-0 cursor-col-resize bg-border hover:bg-primary/50 transition-colors"
        onMouseDown={() => {
          isDragging.current = true
        }}
      />

      {/* ── Right panel: transcript ───────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Column headers */}
        <div
          className="grid shrink-0 border-b border-border"
          style={{ gridTemplateColumns: "1fr 1fr" }}
        >
          <div className="px-4 py-2 border-r border-border">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {sourceLang}
            </span>
          </div>
          <div className="px-4 py-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {targetLang}
            </span>
          </div>
        </div>

        {/* Segment rows */}
        <div className="flex-1 overflow-y-auto">
          {segments.map((seg, i) => (
            <div
              key={i}
              className="grid border-b border-border/50 hover:bg-muted/30 transition-colors"
              style={{ gridTemplateColumns: "1fr 1fr" }}
            >
              {/* Source column */}
              <div className="px-4 py-3 border-r border-border/50">
                <div className="flex items-center gap-2 mb-1.5">
                  <Badge
                    variant="outline"
                    className={`text-[10px] h-4 shrink-0 ${speakerColor(seg.speaker)}`}
                  >
                    {fmtSpeaker(seg.speaker)}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {fmtTime(seg.start)} – {fmtTime(seg.end)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {sourceByIndex.get(seg.transcript_index) ?? "—"}
                </p>
              </div>

              {/* Dubbed column */}
              <div className="px-4 py-3">
                <p className="text-xs text-foreground leading-relaxed mt-6">
                  {seg.text}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
