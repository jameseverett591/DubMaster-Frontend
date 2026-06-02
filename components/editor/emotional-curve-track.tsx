'use client'

import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import { Lock, Unlock, RotateCcw } from 'lucide-react'
import type { EmotionalCurve, EmotionalCurvePoint, Segment } from '@/lib/editor-types'
import { cn } from '@/lib/utils'

interface EmotionalCurveTrackProps {
  segment: Segment
  segmentIndex: number
  zoom: number
  width: number
  height?: number
  onUpdateCurve: (index: number, points: EmotionalCurvePoint[]) => void
  onToggleLock: (index: number) => void
  onResetCurve: (index: number) => void
}

function areEqual(prev: EmotionalCurveTrackProps, next: EmotionalCurveTrackProps) {
  if (prev.segmentIndex !== next.segmentIndex) return false
  if (prev.zoom !== next.zoom) return false
  if (prev.width !== next.width) return false
  if (prev.height !== next.height) return false
  const pc = prev.segment.emotionalCurve
  const nc = next.segment.emotionalCurve
  if (pc?.locked !== nc?.locked) return false
  if (JSON.stringify(pc?.combined) !== JSON.stringify(nc?.combined)) return false
  if (JSON.stringify(pc?.analysis) !== JSON.stringify(nc?.analysis)) return false
  return true
}

const TRACK_HEIGHT = 96
const PADDING = { top: 12, bottom: 12, left: 8, right: 8 }

function buildBezierPath(points: EmotionalCurvePoint[], width: number, height: number): string {
  if (points.length === 0) return ''
  const sorted = [...points].sort((a, b) => a.x - b.x)
  const sx = (x: number) => PADDING.left + x * (width - PADDING.left - PADDING.right)
  const sy = (y: number) => PADDING.top + (1 - y) * (height - PADDING.top - PADDING.bottom)

  if (sorted.length === 1) {
    return `M ${sx(sorted[0].x)} ${sy(sorted[0].y)}`
  }

  let d = `M ${sx(sorted[0].x)} ${sy(sorted[0].y)}`

  for (let i = 0; i < sorted.length - 1; i++) {
    const p0 = sorted[i]
    const p1 = sorted[i + 1]
    const range = p1.x - p0.x
    if (range === 0) continue

    const x0 = sx(p0.x)
    const y0 = sy(p0.y)
    const x3 = sx(p1.x)
    const y3 = sy(p1.y)

    if (p0.cp2 && p1.cp1) {
      const x1 = sx(p0.x + p0.cp2.x * range)
      const y1 = sy(p0.y + p0.cp2.y * (p1.y - p0.y))
      const x2 = sx(p1.x - p1.cp1.x * range)
      const y2 = sy(p1.y - p1.cp1.y * (p1.y - p0.y))
      d += ` C ${x1} ${y1}, ${x2} ${y2}, ${x3} ${y3}`
    } else {
      d += ` L ${x3} ${y3}`
    }
  }

  return d
}

function buildAnalysisPath(samples: number[], width: number, height: number): string {
  if (samples.length === 0) return ''
  const step = width / Math.max(samples.length - 1, 1)
  const sy = (y: number) => PADDING.top + (1 - y) * (height - PADDING.top - PADDING.bottom)
  let d = `M ${PADDING.left} ${sy(samples[0])}`
  for (let i = 1; i < samples.length; i++) {
    d += ` L ${PADDING.left + i * step} ${sy(samples[i])}`
  }
  return d
}

function EmotionalCurveTrackComponent({
  segment,
  segmentIndex,
  zoom,
  width,
  height = TRACK_HEIGHT,
  onUpdateCurve,
  onToggleLock,
  onResetCurve,
}: EmotionalCurveTrackProps) {
  const curve = segment.emotionalCurve
  const locked = curve?.locked ?? false
  const combined = curve?.combined ?? []
  const analysis = curve?.analysis ?? { facial: [], vocal: [], scene: [] }

  const svgRef = useRef<SVGSVGElement>(null)
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null)
  const [dragging, setDragging] = useState<{ type: 'point' | 'cp1' | 'cp2'; index: number } | null>(null)

  const effectiveWidth = Math.max(width, 100)

  // Zoom-based opacity for analysis curves
  const analysisOpacity = Math.min(1, Math.max(0.15, zoom * 0.4))
  const analysisColor = locked ? 'text-slate-500' : ''

  const combinedPath = useMemo(
    () => buildBezierPath(combined, effectiveWidth, height),
    [combined, effectiveWidth, height]
  )

  const facialPath = useMemo(
    () => buildAnalysisPath(analysis.facial, effectiveWidth, height),
    [analysis.facial, effectiveWidth, height]
  )
  const vocalPath = useMemo(
    () => buildAnalysisPath(analysis.vocal, effectiveWidth, height),
    [analysis.vocal, effectiveWidth, height]
  )
  const scenePath = useMemo(
    () => buildAnalysisPath(analysis.scene, effectiveWidth, height),
    [analysis.scene, effectiveWidth, height]
  )

  // Coordinate helpers
  const toSvgX = useCallback(
    (clientX: number) => {
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect) return 0
      const raw = (clientX - rect.left - PADDING.left) / (rect.width - PADDING.left - PADDING.right)
      return Math.max(0, Math.min(1, raw))
    },
    []
  )

  const toSvgY = useCallback(
    (clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect) return 0
      const raw = 1 - (clientY - rect.top - PADDING.top) / (rect.height - PADDING.top - PADDING.bottom)
      return Math.max(0, Math.min(1, raw))
    },
    []
  )

  // Add point
  const handleSvgClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (locked || dragging) return
      if (e.button !== 0) return
      // Don't add if clicking on existing point/handle (handled separately)
      const target = e.target as HTMLElement
      if (target.closest('[data-curve-point]')) return

      const x = toSvgX(e.clientX)
      const y = toSvgY(e.clientY)
      const newPoint: EmotionalCurvePoint = { x, y }
      const next = [...combined, newPoint].sort((a, b) => a.x - b.x)
      onUpdateCurve(segmentIndex, next)
      const newIdx = next.findIndex((p) => p.x === x && p.y === y)
      setSelectedPoint(newIdx >= 0 ? newIdx : null)
    },
    [locked, dragging, combined, toSvgX, toSvgY, onUpdateCurve, segmentIndex]
  )

  // Start drag
  const startDrag = useCallback(
    (type: 'point' | 'cp1' | 'cp2', index: number) => {
      if (locked) return
      setDragging({ type, index })
      if (type === 'point') setSelectedPoint(index)
    },
    [locked]
  )

  // Handle drag move
  useEffect(() => {
    if (!dragging) return

    const handleMove = (e: MouseEvent) => {
      const idx = dragging.index
      const next = [...combined]
      if (idx < 0 || idx >= next.length) return

      if (dragging.type === 'point') {
        next[idx] = { ...next[idx], x: toSvgX(e.clientX), y: toSvgY(e.clientY) }
      } else if (dragging.type === 'cp1') {
        const pt = next[idx]
        if (!pt.cp1) pt.cp1 = { x: 0.3, y: 0 }
        pt.cp1 = {
          x: Math.max(0, Math.min(1, toSvgX(e.clientX) - pt.x + 0.3)),
          y: toSvgY(e.clientY) - pt.y,
        }
      } else if (dragging.type === 'cp2') {
        const pt = next[idx]
        if (!pt.cp2) pt.cp2 = { x: 0.3, y: 0 }
        pt.cp2 = {
          x: Math.max(0, Math.min(1, toSvgX(e.clientX) - pt.x + 0.3)),
          y: toSvgY(e.clientY) - pt.y,
        }
      }
      onUpdateCurve(segmentIndex, next.sort((a, b) => a.x - b.x))
    }

    const handleUp = () => setDragging(null)

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [dragging, combined, toSvgX, toSvgY, onUpdateCurve, segmentIndex])

  // Delete point
  const deletePoint = useCallback(
    (e: React.MouseEvent, idx: number) => {
      e.preventDefault()
      e.stopPropagation()
      if (locked) return
      if (combined.length <= 2) return // keep at least 2 points
      const next = combined.filter((_, i) => i !== idx)
      onUpdateCurve(segmentIndex, next)
      setSelectedPoint(null)
    },
    [locked, combined, onUpdateCurve, segmentIndex]
  )

  const sx = (x: number) => PADDING.left + x * (effectiveWidth - PADDING.left - PADDING.right)
  const sy = (y: number) => PADDING.top + (1 - y) * (height - PADDING.top - PADDING.bottom)

  const sorted = useMemo(() => [...combined].sort((a, b) => a.x - b.x), [combined])

  return (
    <div className="relative w-full select-none" style={{ height }} onClick={(e) => e.stopPropagation()}>
      {/* Lock toggle + Reset */}
      <div className="absolute top-1 right-1 z-10 flex items-center gap-1">
        <button
          className={cn(
            'flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border transition-colors',
            locked
              ? 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
              : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
          )}
          onClick={() => onToggleLock(segmentIndex)}
          title={locked ? 'Unlock curve for editing' : 'Lock curve to prevent changes'}
        >
          {locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
          {locked ? 'Locked' : 'Edit'}
        </button>
        <button
          className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors"
          onClick={() => onResetCurve(segmentIndex)}
          title="Reset curve to default"
        >
          <RotateCcw className="h-3 w-3" />
          Reset
        </button>
      </div>

      <svg
        ref={svgRef}
        className={cn('w-full h-full', !locked && 'cursor-crosshair')}
        style={{ pointerEvents: 'all' }}
        viewBox={`0 0 ${effectiveWidth} ${height}`}
        onClick={handleSvgClick}
      >
        {/* Background grid */}
        <rect x={0} y={0} width={effectiveWidth} height={height} fill="transparent" />
        <line x1={PADDING.left} y1={sy(0.5)} x2={effectiveWidth - PADDING.right} y2={sy(0.5)} stroke="#334155" strokeWidth={0.5} strokeDasharray="4 4" />

        {/* Analysis curves */}
        {analysis.facial.length > 0 && (
          <path d={facialPath} fill="none" stroke={locked ? '#64748b' : '#22d3ee'} strokeWidth={1} opacity={analysisOpacity} />
        )}
        {analysis.vocal.length > 0 && (
          <path d={vocalPath} fill="none" stroke={locked ? '#64748b' : '#a78bfa'} strokeWidth={1} opacity={analysisOpacity} />
        )}
        {analysis.scene.length > 0 && (
          <path d={scenePath} fill="none" stroke={locked ? '#64748b' : '#f472b6'} strokeWidth={1} opacity={analysisOpacity} />
        )}

        {/* Combined curve fill */}
        {combined.length > 0 && (
          <path
            d={`${combinedPath} L ${effectiveWidth - PADDING.right} ${height - PADDING.bottom} L ${PADDING.left} ${height - PADDING.bottom} Z`}
            fill="rgba(251,191,36,0.08)"
          />
        )}

        {/* Combined curve stroke */}
        {combined.length > 0 && (
          <path
            d={combinedPath}
            fill="none"
            stroke={locked ? '#94a3b8' : '#fbbf24'}
            strokeWidth={locked ? 2 : 2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Control points & handles */}
        {sorted.map((pt, i) => {
          const isSelected = selectedPoint === i
          const px = sx(pt.x)
          const py = sy(pt.y)

          return (
            <g key={`pt-${i}-${pt.x.toFixed(4)}`} data-curve-point>
              {/* Bezier handle lines */}
              {isSelected && !locked && pt.cp1 && (() => {
                const prevPt = sorted[i - 1]
                const cp1x = sx(pt.x - (pt.cp1?.x ?? 0) * (pt.x - (prevPt?.x ?? pt.x)))
                const cp1y = sy(pt.y - (pt.cp1?.y ?? 0) * ((prevPt?.y ?? pt.y) - pt.y))
                return (
                  <>
                    <line x1={px} y1={py} x2={cp1x} y2={cp1y} stroke="#fbbf24" strokeWidth={0.5} opacity={0.5} />
                    <circle cx={cp1x} cy={cp1y} r={3} fill="#fbbf24" opacity={0.6} className="cursor-pointer" onMouseDown={(e) => { e.stopPropagation(); startDrag('cp1', i) }} />
                  </>
                )
              })()}
              {isSelected && !locked && pt.cp2 && (() => {
                const nextPt = sorted[i + 1]
                const cp2x = sx(pt.x + (pt.cp2?.x ?? 0) * ((nextPt?.x ?? pt.x) - pt.x))
                const cp2y = sy(pt.y + (pt.cp2?.y ?? 0) * ((nextPt?.y ?? pt.y) - pt.y))
                return (
                  <>
                    <line x1={px} y1={py} x2={cp2x} y2={cp2y} stroke="#fbbf24" strokeWidth={0.5} opacity={0.5} />
                    <circle cx={cp2x} cy={cp2y} r={3} fill="#fbbf24" opacity={0.6} className="cursor-pointer" onMouseDown={(e) => { e.stopPropagation(); startDrag('cp2', i) }} />
                  </>
                )
              })()}

              {/* Main point */}
              <circle
                cx={px}
                cy={py}
                r={isSelected ? 5 : 4}
                fill={locked ? '#64748b' : isSelected ? '#fbbf24' : '#f59e0b'}
                stroke="#0f172a"
                strokeWidth={1.5}
                className={locked ? '' : 'cursor-pointer'}
                onMouseDown={(e) => { e.stopPropagation(); startDrag('point', i) }}
                onContextMenu={(e) => deletePoint(e, i)}
              />
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export const EmotionalCurveTrack = React.memo(EmotionalCurveTrackComponent, areEqual)
