'use client'

import { useMemo } from 'react'
import { Gauge, AlertCircle, Wrench, RotateCcw, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Segment, QCReport, QCFinding } from '@/lib/editor-types'

interface SegmentQCPanelProps {
  segment: Segment | null
  report: QCReport | null
  onRecalculate?: () => void
  onAutoFix?: () => void
  onRegenerateDub?: () => void
}

function severityColor(severity: QCFinding['severity']) {
  switch (severity) {
    case 'error':
      return 'border-red-500/40 text-red-300 bg-red-500/10'
    case 'warning':
      return 'border-yellow-500/40 text-yellow-300 bg-yellow-500/10'
    case 'info':
    default:
      return 'border-blue-500/40 text-blue-300 bg-blue-500/10'
  }
}

function severityDot(severity: QCFinding['severity']) {
  switch (severity) {
    case 'error':
      return 'bg-red-500'
    case 'warning':
      return 'bg-yellow-500'
    case 'info':
    default:
      return 'bg-blue-400'
  }
}

function gradeColor(grade: QCReport['grade']) {
  switch (grade) {
    case 'A':
      return 'border-emerald-500 text-emerald-400 bg-emerald-500/10'
    case 'B':
      return 'border-lime-500 text-lime-400 bg-lime-500/10'
    case 'C':
      return 'border-yellow-500 text-yellow-400 bg-yellow-500/10'
    case 'D':
      return 'border-orange-500 text-orange-400 bg-orange-500/10'
    case 'F':
    default:
      return 'border-red-500 text-red-400 bg-red-500/10'
  }
}

export function SegmentQCPanel({ segment, report, onRecalculate, onAutoFix, onRegenerateDub }: SegmentQCPanelProps) {
  const segmentFindings = useMemo(() => {
    if (!segment) return []
    return segment.qc_findings
  }, [segment])

  if (!segment) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-500 text-sm p-6">
        <Gauge className="h-8 w-8 mb-2 opacity-40" />
        <p>Select a segment to view QC details.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 p-3 overflow-y-auto h-full bg-slate-900 text-white">
      {/* Score header */}
      <div className="rounded-xl border border-slate-800 bg-slate-800/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-white">Segment QC</div>
          {report && (
            <span className={cn('text-[10px] px-2 py-0.5 rounded-full border font-medium', gradeColor(report.grade))}>
              Grade {report.grade} · {report.overall}/100
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold border-2',
              segment.qc_score
                ? segment.qc_score >= 80
                  ? 'border-emerald-500 text-emerald-400 bg-emerald-500/10'
                  : segment.qc_score >= 60
                    ? 'border-yellow-500 text-yellow-400 bg-yellow-500/10'
                    : 'border-red-500 text-red-400 bg-red-500/10'
                : 'border-slate-600 text-slate-400 bg-slate-800'
            )}
          >
            {segment.qc_score ?? '—'}
          </div>
          <div>
            <div className="text-xs text-slate-400">Score</div>
            <div className="text-xs text-slate-500">/100</div>
          </div>
        </div>
      </div>

      {/* Problem */}
      {segment.qc_problem && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
          <div className="flex items-center gap-2 mb-1.5">
            <AlertCircle className="h-3.5 w-3.5 text-red-400" />
            <span className="text-xs font-semibold text-red-300 uppercase tracking-wider">Problem</span>
          </div>
          <p className="text-sm text-slate-200 leading-relaxed">{segment.qc_problem}</p>
        </div>
      )}

      {/* Fix */}
      {segment.qc_fix && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
          <div className="flex items-center gap-2 mb-1.5">
            <Wrench className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-xs font-semibold text-emerald-300 uppercase tracking-wider">Suggested Fix</span>
          </div>
          <p className="text-sm text-emerald-200 leading-relaxed">{segment.qc_fix}</p>
        </div>
      )}

      {/* Findings */}
      {segmentFindings.length > 0 && (
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Findings ({segmentFindings.length})</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {segmentFindings.map((finding, i) => (
              <div
                key={finding.id ?? i}
                className={cn(
                  'flex items-start gap-2 rounded px-2 py-1.5 text-xs border-l-2',
                  severityColor(finding.severity)
                )}
              >
                <span className={cn('w-2 h-2 rounded-full mt-0.5 shrink-0', severityDot(finding.severity))} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="font-medium capitalize">{finding.type}</span>
                    <span className="text-[10px] opacity-70 uppercase">{finding.severity}</span>
                  </div>
                  <p className="text-slate-300 leading-relaxed">{finding.message}</p>
                  {finding.suggestion && (
                    <p className="text-slate-400 mt-0.5 italic">{finding.suggestion}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Velma Metadata Section */}
      {(segment.velma_emotion || segment.velma_accent || typeof segment.velma_deepfake_score === 'number') && (
        <div className="mt-4 p-3 rounded bg-slate-900 border border-slate-800">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Original Performance (Velma)</h3>

          {segment.velma_emotion && (
            <div className="flex items-center justify-between mb-1">
              <span className="text-slate-400 text-xs">Emotion</span>
              <span className="px-2 py-0.5 text-xs rounded bg-slate-800 text-slate-200">
                {segment.velma_emotion}
              </span>
            </div>
          )}

          {segment.velma_accent && (
            <div className="flex items-center justify-between mb-1">
              <span className="text-slate-400 text-xs">Accent</span>
              <span className="px-2 py-0.5 text-xs rounded bg-slate-700 text-slate-300">
                {segment.velma_accent}
              </span>
            </div>
          )}

          {typeof segment.velma_deepfake_score === 'number' && (
            <div className="flex items-center justify-between mt-2">
              <span className="text-slate-400 text-xs">Deepfake Score</span>
              <span
                className={`px-2 py-0.5 text-xs rounded ${
                  segment.velma_deepfake_score > 0.55
                    ? 'bg-red-700 text-red-100'
                    : segment.velma_deepfake_score > 0.35
                    ? 'bg-yellow-700 text-yellow-100'
                    : 'bg-green-700 text-green-100'
                }`}
              >
                {segment.velma_deepfake_score.toFixed(2)}
              </span>
            </div>
          )}

          {typeof segment.velma_deepfake_score === 'number' && segment.velma_deepfake_score > 0.55 && (
            <>
              <div className="mt-3 p-2 rounded bg-red-900 text-red-100 text-xs">
                This dub sounds synthetic. Consider regenerating the audio.
              </div>
              <button
                type="button"
                onClick={onRegenerateDub}
                className="mt-2 w-full px-3 py-1.5 text-xs rounded bg-red-700 hover:bg-red-600 text-white transition-colors"
              >
                Regenerate Dub
              </button>
            </>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-2 mt-auto pt-2 border-t border-slate-700">
        <button
          onClick={onRecalculate}
          className="w-full flex items-center justify-center gap-2 rounded-md border border-slate-600 px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 transition-colors"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Recalculate QC
        </button>
        {segment.qc_fix && (
          <button
            onClick={onAutoFix}
            className="w-full flex items-center justify-center gap-2 rounded-md bg-emerald-600 hover:bg-emerald-700 px-3 py-2 text-xs text-white transition-colors"
          >
            <Wrench className="h-3.5 w-3.5" />
            Auto-Fix
          </button>
        )}
      </div>
    </div>
  )
}
