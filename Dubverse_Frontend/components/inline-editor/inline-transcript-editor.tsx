"use client"

import { useState, useCallback, useMemo } from "react"
import { EditorHeader } from "./editor-header"
import { WaveformTimeline } from "./waveform-timeline"
import { InlineToolbar } from "./inline-toolbar"
import { InlineSegmentEditor } from "./inline-segment-editor"
import { InlineSpeakerPanel } from "./inline-speaker-panel"
import { SelectedSegmentPanel } from "./selected-segment-panel"
import type { InlineSegment, InlineSpeaker, WordAlignment, SegmentStatus, SegmentLanguage } from "./types"

const SPEAKER_COLORS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EC4899",
  "#8B5CF6", "#EF4444", "#06B6D4", "#F97316",
]

export interface InlineTranscriptEditorProps {
  projectName?: string
  rawSegments: Array<{
    text: string
    start: number
    end: number
    speaker: string
    confidence?: number
    confidence_tier?: "high" | "medium" | "low"
    language?: string
    words?: Array<{ word: string; start: number; end: number; confidence: number }>
  }>
  duration?: number
  speakerGenders?: Record<string, string>
  speakerAges?: Record<string, number>
  onSegmentsChange?: (segments: InlineSegment[]) => void
  onConfirm: (segments: InlineSegment[]) => void
  onExport?: (segments: InlineSegment[]) => void
  confirmLabel?: string
}

function detectLanguage(text: string): SegmentLanguage {
  const cjk = text.match(/[一-鿿぀-ゟ゠-ヿ]/g)?.length ?? 0
  const latin = text.match(/[a-zA-Z]/g)?.length ?? 0
  const total = Math.max(cjk + latin, 1)
  if (cjk / total > 0.7) return "cantonese"
  if (latin / total > 0.7) return "english"
  if (cjk > 0 && latin > 0) return "mixed"
  return "english"
}

function deriveConfidenceTier(confidence: number): "high" | "medium" | "low" {
  if (confidence >= 0.8) return "high"
  if (confidence >= 0.5) return "medium"
  return "low"
}

function buildSegments(
  rawSegments: InlineTranscriptEditorProps["rawSegments"]
): InlineSegment[] {
  return rawSegments.map((seg, i) => {
    const confidence = seg.confidence ?? 0.85
    return {
      id: `seg_${String(i).padStart(3, "0")}`,
      text: seg.text,
      original_text: seg.text,
      start: seg.start,
      end: seg.end,
      speaker_id: seg.speaker,
      language: (seg.language as SegmentLanguage) || detectLanguage(seg.text),
      confidence,
      confidence_tier: seg.confidence_tier ?? deriveConfidenceTier(confidence),
      words: (seg.words ?? []).map((w) => ({
        word: w.word,
        start: w.start,
        end: w.end,
        confidence: w.confidence,
      })),
      is_edited: false,
      status: "pending" as const,
    }
  })
}

function estimateAge(gender: string, speakerIndex: number): number | undefined {
  const ages = [45, 35, 50, 8, 30, 60, 25, 40]
  return ages[speakerIndex % ages.length]
}

function buildSpeakers(
  segments: InlineSegment[],
  genders?: Record<string, string>,
  ages?: Record<string, number>
): InlineSpeaker[] {
  const seen = new Map<string, InlineSpeaker>()
  for (const seg of segments) {
    if (!seen.has(seg.speaker_id)) {
      const idx = seen.size
      const rawGender = genders?.[seg.speaker_id] ?? "unknown"
      const gender = rawGender === "male" || rawGender === "female" ? rawGender : "unknown"
      seen.set(seg.speaker_id, {
        id: seg.speaker_id,
        name: `Speaker ${idx + 1}`,
        gender,
        age_estimate: ages?.[seg.speaker_id] ?? estimateAge(gender, idx),
        color: SPEAKER_COLORS[idx % SPEAKER_COLORS.length],
      })
    }
  }
  return Array.from(seen.values())
}

export function InlineTranscriptEditor({
  projectName = "Untitled Project",
  rawSegments,
  duration: durationProp,
  speakerGenders,
  speakerAges,
  onSegmentsChange,
  onConfirm,
  onExport,
  confirmLabel = "Continue to Dubbing",
}: InlineTranscriptEditorProps) {
  const [segments, setSegments] = useState<InlineSegment[]>(() => buildSegments(rawSegments))
  const [speakers, setSpeakers] = useState<InlineSpeaker[]>(() =>
    buildSpeakers(buildSegments(rawSegments), speakerGenders, speakerAges)
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [filterSpeaker, setFilterSpeaker] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<"all" | SegmentStatus>("all")
  const [showLowConfidence, setShowLowConfidence] = useState(false)

  const duration = durationProp ?? (segments.length > 0 ? Math.max(...segments.map((s) => s.end)) : 0)

  const updateSegment = useCallback((segId: string, updates: Partial<InlineSegment>) => {
    setSegments((prev) => {
      const next = prev.map((s) => (s.id === segId ? { ...s, ...updates } : s))
      onSegmentsChange?.(next)
      return next
    })
  }, [onSegmentsChange])

  const updateSpeaker = useCallback((speakerId: string, updates: Partial<InlineSpeaker>) => {
    setSpeakers((prev) => prev.map((sp) => (sp.id === speakerId ? { ...sp, ...updates } : sp)))
  }, [])

  const segmentCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const seg of segments) {
      counts[seg.speaker_id] = (counts[seg.speaker_id] || 0) + 1
    }
    return counts
  }, [segments])

  const filteredSegments = useMemo(() => {
    return segments.filter((seg) => {
      if (searchQuery && !seg.text.toLowerCase().includes(searchQuery.toLowerCase())) return false
      if (filterSpeaker && seg.speaker_id !== filterSpeaker) return false
      if (filterStatus !== "all" && seg.status !== filterStatus) return false
      if (showLowConfidence && seg.confidence >= 0.6 && seg.confidence_tier !== "low") return false
      return true
    })
  }, [segments, searchQuery, filterSpeaker, filterStatus, showLowConfidence])

  const stats = useMemo(() => ({
    total: segments.length,
    edited: segments.filter((s) => s.is_edited).length,
    approved: segments.filter((s) => s.status === "approved").length,
    pending: segments.filter((s) => s.status === "pending").length,
    rejected: segments.filter((s) => s.status === "rejected").length,
    lowConfidence: segments.filter((s) => s.confidence < 0.6 || s.confidence_tier === "low").length,
  }), [segments])

  const selectedSegment = segments.find((s) => s.id === selectedId) ?? null
  const selectedSpeaker = selectedSegment
    ? speakers.find((sp) => sp.id === selectedSegment.speaker_id) ?? null
    : null

  const handleApproveAll = () => {
    setSegments((prev) => {
      const next = prev.map((s) => ({ ...s, status: "approved" as const }))
      onSegmentsChange?.(next)
      return next
    })
  }

  const handleSkipBack = () => {
    const idx = segments.findIndex((s) => s.id === selectedId)
    if (idx > 0) {
      setSelectedId(segments[idx - 1].id)
      setCurrentTime(segments[idx - 1].start)
    } else if (segments.length > 0) {
      setSelectedId(segments[0].id)
      setCurrentTime(segments[0].start)
    }
  }

  const handleSkipForward = () => {
    const idx = segments.findIndex((s) => s.id === selectedId)
    if (idx >= 0 && idx < segments.length - 1) {
      setSelectedId(segments[idx + 1].id)
      setCurrentTime(segments[idx + 1].start)
    } else if (segments.length > 0) {
      setSelectedId(segments[segments.length - 1].id)
      setCurrentTime(segments[segments.length - 1].start)
    }
  }

  const handleTimeClick = (time: number) => {
    setCurrentTime(time)
  }

  const handleSegmentClickFromTimeline = (segId: string) => {
    setSelectedId(segId)
    const seg = segments.find((s) => s.id === segId)
    if (seg) setCurrentTime(seg.start)
  }

  const handleExport = onExport ? () => onExport(segments) : undefined

  return (
    <div className="flex flex-col bg-[#111827] rounded-lg overflow-hidden border border-gray-800" style={{ maxHeight: "80vh" }}>
      {/* Header */}
      <EditorHeader
        projectName={projectName}
        isPlaying={isPlaying}
        onPlayPause={() => setIsPlaying(!isPlaying)}
        onSkipBack={handleSkipBack}
        onSkipForward={handleSkipForward}
        onApproveAll={handleApproveAll}
        onExport={handleExport}
      />

      {/* Timeline */}
      <WaveformTimeline
        segments={segments}
        speakers={speakers}
        duration={duration}
        currentTime={currentTime}
        selectedSegmentId={selectedId}
        onTimeClick={handleTimeClick}
        onSegmentClick={handleSegmentClickFromTimeline}
      />

      {/* Toolbar */}
      <div className="px-4 pt-4">
        <InlineToolbar
          speakers={speakers}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          filterSpeaker={filterSpeaker}
          onFilterSpeakerChange={setFilterSpeaker}
          filterStatus={filterStatus}
          onFilterStatusChange={setFilterStatus}
          showLowConfidence={showLowConfidence}
          onShowLowConfidenceChange={setShowLowConfidence}
          stats={stats}
        />
      </div>

      {/* Main content: segments + sidebar */}
      <div className="flex flex-1 gap-4 p-4 min-h-0 overflow-hidden">
        {/* Segment list */}
        <div className="flex-1 space-y-2 overflow-y-auto pr-1 min-h-0">
          {filteredSegments.length === 0 ? (
            <div className="py-12 text-center text-sm text-[#64748B]">
              No segments match your filters.
            </div>
          ) : (
            filteredSegments.map((seg) => {
              const speaker = speakers.find((sp) => sp.id === seg.speaker_id) ?? {
                id: seg.speaker_id,
                name: seg.speaker_id,
                gender: "unknown" as const,
                color: "#6B7280",
              }
              return (
                <InlineSegmentEditor
                  key={seg.id}
                  segment={seg}
                  speaker={speaker}
                  isSelected={selectedId === seg.id}
                  onSelect={() => {
                    setSelectedId(seg.id)
                    setCurrentTime(seg.start)
                  }}
                  onUpdate={(updates) => updateSegment(seg.id, updates)}
                  onApprove={() => updateSegment(seg.id, { status: "approved" })}
                  onReject={() => updateSegment(seg.id, { status: "rejected" })}
                />
              )
            })
          )}
        </div>

        {/* Right sidebar — hidden on narrow panels, shown on wide */}
        <div className="hidden xl:block w-56 flex-shrink-0 space-y-4 overflow-y-auto">
          <InlineSpeakerPanel
            speakers={speakers}
            onUpdateSpeaker={updateSpeaker}
            segmentCounts={segmentCounts}
          />
          <SelectedSegmentPanel
            segment={selectedSegment}
            speaker={selectedSpeaker}
          />
        </div>
      </div>

      {/* Bottom action bar — Continue to Dubbing */}
      <div className="flex items-center justify-end px-5 py-3 border-t border-gray-800 bg-gray-900">
        <button
          type="button"
          onClick={() => onConfirm(segments)}
          className="px-6 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  )
}
