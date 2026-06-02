'use client'

import { useState, useEffect, useMemo } from 'react'
import { Gauge, AlertCircle, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Segment } from '@/lib/editor-types'

interface QCTickerProps {
  segment: Segment | null
  onApplyFix?: () => void
}

type TickerState = 'score' | 'problem' | 'fix'

const CYCLE_INTERVAL = 12000 // ms per state

function scoreColor(score: number | undefined) {
  if (score === undefined || score === null) return 'text-slate-400'
  if (score >= 80) return 'text-emerald-400'
  if (score >= 60) return 'text-yellow-400'
  return 'text-red-400'
}

export function QCTicker({ segment, onApplyFix }: QCTickerProps) {
  const [state, setState] = useState<TickerState>('score')
  const [visible, setVisible] = useState(true)

  const states: TickerState[] = useMemo(() => {
    const arr: TickerState[] = []
    if (segment?.qc_score !== undefined && segment.qc_score !== null) arr.push('score')
    if (segment?.qc_problem) arr.push('problem')
    if (segment?.qc_fix) arr.push('fix')
    if (arr.length === 0) arr.push('score')
    return arr
  }, [segment])

  const currentIndex = states.indexOf(state)

  useEffect(() => {
    if (states.length <= 1) return

    const interval = setInterval(() => {
      setVisible(false)
      setTimeout(() => {
        setState(prev => {
          const idx = states.indexOf(prev)
          return states[(idx + 1) % states.length]
        })
        setVisible(true)
      }, 400) // fade-out duration before switching
    }, CYCLE_INTERVAL)

    return () => clearInterval(interval)
  }, [states])

  // Reset to first relevant state when segment changes
  useEffect(() => {
    const first = states[0] ?? 'score'
    setState(first)
    setVisible(true)
  }, [segment?.id])

  if (!segment) {
    return (
      <span className="text-xs text-slate-600 flex items-center gap-1.5">
        <Gauge className="h-3 w-3" />
        Select a segment to view QC
      </span>
    )
  }

  return (
    <div className="flex items-center gap-2 min-w-0">
      <div
        className={cn(
          'flex items-center gap-2 transition-opacity duration-400',
          visible ? 'opacity-100' : 'opacity-0'
        )}
      >
        {state === 'score' && (
          <>
            <Gauge className={cn('h-3.5 w-3.5 shrink-0', scoreColor(segment.qc_score))} />
            <span className={cn('text-xs font-semibold tabular-nums', scoreColor(segment.qc_score))}>
              {segment.qc_score ?? '—'}/100
            </span>
            {segment.qc_score !== undefined && segment.qc_score !== null && (
              <span className="text-[10px] text-slate-400">
                {segment.qc_score >= 80 ? 'Excellent' : segment.qc_score >= 60 ? 'Fair' : 'Poor'}
              </span>
            )}
          </>
        )}

        {state === 'problem' && segment.qc_problem && (
          <>
            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
            <span className="text-xs text-red-300 truncate max-w-[280px]">
              {segment.qc_problem}
            </span>
          </>
        )}

        {state === 'fix' && segment.qc_fix && (
          <>
            <Wrench className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
            <span className="text-xs text-emerald-300 truncate max-w-[200px]">
              {segment.qc_fix}
            </span>
            {onApplyFix && (
              <button
                onClick={(e) => { e.stopPropagation(); onApplyFix() }}
                className="text-[10px] px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white transition-colors shrink-0"
              >
                Apply
              </button>
            )}
          </>
        )}
      </div>

      {/* Dots indicator */}
      {states.length > 1 && (
        <div className="flex items-center gap-1 shrink-0">
          {states.map((s) => (
            <span
              key={s}
              className={cn(
                'w-1 h-1 rounded-full transition-colors',
                s === state ? 'bg-amber-400' : 'bg-slate-700'
              )}
            />
          ))}
        </div>
      )}
    </div>
  )
}
