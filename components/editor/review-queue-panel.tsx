'use client'

import { useMemo } from 'react'
import { X, ArrowRight, CheckCircle, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Segment } from '@/lib/editor-types'

interface ReviewQueuePanelProps {
  segments: Segment[]
  onClose: () => void
  onJumpToSegment: (index: number) => void
  onMarkOk: (index: number) => void
}

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function confidenceColor(score: number | null | undefined): string {
  if (score === null || score === undefined) return 'text-slate-400'
  if (score < 0.35) return 'text-red-400'
  if (score < 0.5) return 'text-amber-400'
  return 'text-yellow-300'
}

export function ReviewQueuePanel({
  segments,
  onClose,
  onJumpToSegment,
  onMarkOk,
}: ReviewQueuePanelProps) {
  const flagged = useMemo(
    () =>
      segments.filter(
        (s) =>
          s.flags && s.flags.length > 0 && s.flag_status === 'unreviewed'
      ),
    [segments]
  )

  const reviewed = useMemo(
    () =>
      segments.filter(
        (s) => s.flags && s.flags.length > 0 && s.flag_status !== 'unreviewed'
      ),
    [segments]
  )

  return (
    <div className="fixed inset-0 bg-black/60 flex items-start justify-end z-50 pt-16 pr-4">
      <div className="bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl w-[400px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-700 shrink-0">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <span className="text-sm font-semibold text-white">Review Queue</span>
            {flagged.length > 0 && (
              <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                {flagged.length} unreviewed
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-3 space-y-2">
          {flagged.length === 0 && reviewed.length === 0 && (
            <div className="text-center py-10 text-neutral-500 text-sm">
              No flagged segments — pipeline confidence looks good.
            </div>
          )}

          {flagged.length === 0 && reviewed.length > 0 && (
            <div className="flex items-center gap-2 text-emerald-400 text-sm py-3 justify-center">
              <CheckCircle className="h-4 w-4" />
              All flagged segments reviewed.
            </div>
          )}

          {flagged.map((seg) => {
            const flag = seg.flags![0]
            const score = flag.score
            return (
              <div
                key={seg.index}
                className="rounded-md border border-amber-500/25 bg-amber-500/5 p-3 space-y-2"
              >
                {/* Top row: timestamp + badge */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-neutral-500 font-mono">
                    {formatTime(seg.start_time)} — {seg.speaker_label || seg.speaker_id}
                  </span>
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-300 uppercase tracking-wide">
                    low confidence
                  </span>
                </div>

                {/* Segment text */}
                <p className="text-sm text-neutral-200 leading-snug">
                  {seg.target_text || seg.source_text}
                </p>

                {/* Confidence score */}
                <p className={cn('text-xs font-mono', confidenceColor(score))}>
                  Velma confidence: {score !== null && score !== undefined ? score.toFixed(3) : 'N/A'}
                  {' / '}threshold {flag.threshold.toFixed(2)}
                </p>

                {/* Actions */}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => onJumpToSegment(seg.index)}
                    className="flex items-center gap-1 text-xs px-2.5 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white transition-colors border border-neutral-700"
                  >
                    <ArrowRight className="h-3 w-3" />
                    Jump
                  </button>
                  <button
                    onClick={() => onMarkOk(seg.index)}
                    className="flex items-center gap-1 text-xs px-2.5 py-1 rounded bg-neutral-800 hover:bg-emerald-900/50 text-neutral-300 hover:text-emerald-300 transition-colors border border-neutral-700 hover:border-emerald-700"
                  >
                    <CheckCircle className="h-3 w-3" />
                    Mark OK
                  </button>
                </div>
              </div>
            )
          })}

          {/* Reviewed section (collapsed summary) */}
          {reviewed.length > 0 && (
            <div className="pt-2 border-t border-neutral-800">
              <p className="text-xs text-neutral-600 px-1">
                {reviewed.length} segment{reviewed.length !== 1 ? 's' : ''} already reviewed
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
