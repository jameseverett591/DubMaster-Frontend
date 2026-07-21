"use client"

import { useState, useRef, useEffect } from "react"
import { Check, X, Pencil, AlertCircle, Clock, User, RotateCcw, Globe } from "lucide-react"
import type { InlineSegment, InlineSpeaker, SegmentLanguage } from "./types"

const LANGUAGE_LABELS: Record<SegmentLanguage, string> = {
  cantonese: "Cantonese",
  mandarin: "Mandarin",
  english: "English",
  mixed: "Mixed",
}

interface InlineSegmentEditorProps {
  segment: InlineSegment
  speaker: InlineSpeaker
  isSelected: boolean
  onSelect: () => void
  onUpdate: (updates: Partial<InlineSegment>) => void
  onApprove: () => void
  onReject: () => void
}

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 100)
  return `${mins}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`
}

function getConfidenceColor(confidence: number) {
  if (confidence >= 0.85) return "text-emerald-400"
  if (confidence >= 0.6) return "text-amber-400"
  return "text-red-400"
}

export function InlineSegmentEditor({
  segment,
  speaker,
  isSelected,
  onSelect,
  onUpdate,
  onApprove,
  onReject,
}: InlineSegmentEditorProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState(segment.text)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleSave = () => {
    if (editText.trim() !== segment.text) {
      onUpdate({ text: editText.trim(), is_edited: true })
    }
    setIsEditing(false)
  }

  const handleCancel = () => {
    setEditText(segment.text)
    setIsEditing(false)
  }

  const handleRevert = () => {
    setEditText(segment.original_text)
    onUpdate({ text: segment.original_text, is_edited: false })
    setIsEditing(false)
  }

  const hasChanges = segment.text !== segment.original_text
  const isLowConfidence = segment.confidence_tier === "low" || segment.confidence < 0.6

  return (
    <div
      className={`group relative rounded-lg transition-all cursor-pointer ${
        isSelected
          ? "bg-gray-800 ring-2 ring-blue-500 shadow-lg"
          : "bg-gray-900 hover:bg-gray-800/80"
      } ${isLowConfidence ? "border-l-4 border-red-500/60" : ""}`}
      onClick={onSelect}
    >
      <div className="flex items-start gap-3 p-4">
        <div
          className="flex-shrink-0 w-1 self-stretch min-h-[60px] rounded-full"
          style={{ backgroundColor: speaker.color }}
        />

        <div className="flex-1 min-w-0">
          {/* Header row */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <User size={14} className="text-[#94A3B8]" />
              <span className="text-sm font-medium" style={{ color: speaker.color }}>
                {speaker.name}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-[#64748B]">
              <Clock size={12} />
              <span className="font-mono">
                {formatTime(segment.start)} - {formatTime(segment.end)}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-[#64748B]">
              <Globe size={12} />
              <span>{LANGUAGE_LABELS[segment.language]}</span>
            </div>
            <div className="flex items-center gap-1 ml-auto">
              {segment.status === "approved" && (
                <span className="px-2 py-0.5 text-xs font-medium bg-emerald-500/20 text-emerald-400 rounded-full">
                  Approved
                </span>
              )}
              {segment.status === "rejected" && (
                <span className="px-2 py-0.5 text-xs font-medium bg-red-500/20 text-red-400 rounded-full">
                  Rejected
                </span>
              )}
              {segment.status === "pending" && (
                <span className="px-2 py-0.5 text-xs font-medium bg-gray-700/60 text-[#94A3B8] rounded-full">
                  Pending
                </span>
              )}
              {hasChanges && (
                <span className="px-2 py-0.5 text-xs font-medium bg-blue-500/20 text-blue-400 rounded-full">
                  Edited
                </span>
              )}
            </div>
          </div>

          {/* Text / Edit area */}
          {isEditing ? (
            <div className="space-y-2">
              <textarea
                ref={inputRef}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={2}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Escape") handleCancel()
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSave()
                }}
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); handleSave() }}
                  className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg transition-colors"
                >
                  <Check size={14} />
                  Save
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleCancel() }}
                  className="flex items-center gap-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium rounded-lg transition-colors"
                >
                  <X size={14} />
                  Cancel
                </button>
                {hasChanges && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRevert() }}
                    className="flex items-center gap-1 px-3 py-1.5 bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 text-xs font-medium rounded-lg transition-colors"
                  >
                    <RotateCcw size={14} />
                    Revert
                  </button>
                )}
              </div>
            </div>
          ) : (
            <p
              className="text-[#E2E8F0] leading-relaxed cursor-text"
              onDoubleClick={(e) => { e.stopPropagation(); setIsEditing(true) }}
            >
              {segment.words.length > 0 ? (
                segment.words.map((w, idx) => {
                  const isLow = w.confidence < 0.6
                  const isMed = w.confidence >= 0.6 && w.confidence < 0.85
                  return (
                    <span
                      key={idx}
                      className={
                        isLow
                          ? "bg-red-500/20 border-b border-red-500/50 cursor-help"
                          : isMed
                          ? "border-b border-amber-500/40 cursor-help"
                          : ""
                      }
                      title={isLow || isMed ? `Confidence: ${Math.round(w.confidence * 100)}%` : undefined}
                    >
                      {w.word}{" "}
                    </span>
                  )
                })
              ) : (
                segment.text
              )}
            </p>
          )}

          {/* Footer row */}
          <div className="flex items-center justify-between mt-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-[#64748B]">Confidence:</span>
                <span className={`text-xs font-medium ${getConfidenceColor(segment.confidence)}`}>
                  {(segment.confidence * 100).toFixed(0)}%
                </span>
              </div>
              {isLowConfidence && (
                <div className="flex items-center gap-1 text-xs text-red-400">
                  <AlertCircle size={12} />
                  <span>Needs review</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {!isEditing && (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); setIsEditing(true) }}
                    className="p-1.5 hover:bg-gray-700 rounded-md transition-colors"
                    title="Edit (double-click text)"
                  >
                    <Pencil size={16} className="text-[#94A3B8]" />
                  </button>
                  {segment.status !== "approved" && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onApprove() }}
                      className="p-1.5 hover:bg-emerald-600/20 rounded-md transition-colors"
                      title="Approve"
                    >
                      <Check size={16} className="text-emerald-400" />
                    </button>
                  )}
                  {segment.status !== "rejected" && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onReject() }}
                      className="p-1.5 hover:bg-red-600/20 rounded-md transition-colors"
                      title="Reject"
                    >
                      <X size={16} className="text-red-400" />
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
