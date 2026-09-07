"use client"

import { FileText, Clock, Globe, BarChart3 } from "lucide-react"
import type { InlineSegment, InlineSpeaker, SegmentLanguage } from "./types"

interface SelectedSegmentPanelProps {
  segment: InlineSegment | null
  speaker: InlineSpeaker | null
}

const LANGUAGE_LABELS: Record<SegmentLanguage, string> = {
  cantonese: "Cantonese",
  mandarin: "Mandarin",
  english: "English",
  mixed: "Mixed",
}

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 100)
  return `${mins}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`
}

export function SelectedSegmentPanel({ segment, speaker }: SelectedSegmentPanelProps) {
  return (
    <div className="rounded-lg bg-gray-900/60 border border-gray-800 overflow-hidden">
      <div className="px-4 py-3 bg-gray-800 border-b border-gray-700">
        <h3 className="text-sm font-medium text-[#94A3B8] flex items-center gap-2">
          <FileText size={16} />
          Selected Segment
        </h3>
      </div>
      <div className="p-4">
        {segment && speaker ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: speaker.color }} />
              <span className="text-sm font-medium text-white">{speaker.name}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-[#64748B]">
              <Clock size={12} />
              <span className="font-mono">{formatTime(segment.start)} - {formatTime(segment.end)}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-[#64748B]">
              <Globe size={12} />
              <span>{LANGUAGE_LABELS[segment.language]}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-[#64748B]">
              <BarChart3 size={12} />
              <span>Confidence: {(segment.confidence * 100).toFixed(0)}%</span>
            </div>
            <p className="text-sm text-[#E2E8F0] leading-relaxed border-t border-gray-800 pt-3 mt-3">
              {segment.text}
            </p>
          </div>
        ) : (
          <p className="text-sm text-[#64748B]">Select a segment to view details</p>
        )}
      </div>
    </div>
  )
}
