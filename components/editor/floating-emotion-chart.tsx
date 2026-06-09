'use client'

import React, { useState, useCallback, useRef, useEffect } from 'react'
import type { Segment } from '@/lib/editor-types'

const SVG_W = 560
const SVG_H = 280
const HEADER_H = 40
const FOOTER_H = 30
const NUM_CHORDS = 50

interface Chord { trait: string; state: string; emotion: string }

const CHORDS: Chord[] = [
  { trait: 'Confidence',        state: 'Determination',   emotion: 'Anger' },
  { trait: 'Confidence',        state: 'Empowerment',     emotion: 'Pride' },
  { trait: 'Confidence',        state: 'Focus',           emotion: 'Trust' },
  { trait: 'Assertiveness',     state: 'Defiance',        emotion: 'Contempt' },
  { trait: 'Assertiveness',     state: 'Determination',   emotion: 'Disgust' },
  { trait: 'Impulsivity',       state: 'Defiance',        emotion: 'Anger' },
  { trait: 'Impulsivity',       state: 'Excitement',      emotion: 'Anticipation' },
  { trait: 'Impulsivity',       state: 'Overwhelm',       emotion: 'Fear' },
  { trait: 'Resilience',        state: 'Focus',           emotion: 'Trust' },
  { trait: 'Resilience',        state: 'Determination',   emotion: 'Anger' },
  { trait: 'Resilience',        state: 'Serenity',        emotion: 'Joy' },
  { trait: 'Patience',          state: 'Serenity',        emotion: 'Trust' },
  { trait: 'Patience',          state: 'Resignation',     emotion: 'Sadness' },
  { trait: 'Patience',          state: 'Focus',           emotion: 'Anticipation' },
  { trait: 'Empathy',           state: 'Vulnerability',   emotion: 'Sadness' },
  { trait: 'Empathy',           state: 'Overwhelm',       emotion: 'Fear' },
  { trait: 'Empathy',           state: 'Longing',         emotion: 'Love' },
  { trait: 'Empathy',           state: 'Nostalgia',       emotion: 'Sadness' },
  { trait: 'Sensitivity',       state: 'Vulnerability',   emotion: 'Fear' },
  { trait: 'Sensitivity',       state: 'Dread',           emotion: 'Fear' },
  { trait: 'Sensitivity',       state: 'Longing',         emotion: 'Love' },
  { trait: 'Sensitivity',       state: 'Overwhelm',       emotion: 'Sadness' },
  { trait: 'Warmth',            state: 'Longing',         emotion: 'Love' },
  { trait: 'Warmth',            state: 'Nostalgia',       emotion: 'Joy' },
  { trait: 'Warmth',            state: 'Serenity',        emotion: 'Trust' },
  { trait: 'Optimism',          state: 'Excitement',      emotion: 'Joy' },
  { trait: 'Optimism',          state: 'Anticipation',    emotion: 'Anticipation' },
  { trait: 'Optimism',          state: 'Flow',            emotion: 'Joy' },
  { trait: 'Openness',          state: 'Curiosity',       emotion: 'Surprise' },
  { trait: 'Openness',          state: 'Inquisitiveness', emotion: 'Anticipation' },
  { trait: 'Openness',          state: 'Awe',             emotion: 'Surprise' },
  { trait: 'Openness',          state: 'Flow',            emotion: 'Joy' },
  { trait: 'Conscientiousness', state: 'Focus',           emotion: 'Trust' },
  { trait: 'Conscientiousness', state: 'Anxiety',         emotion: 'Fear' },
  { trait: 'Conscientiousness', state: 'Perfectionism',   emotion: 'Disgust' },
  { trait: 'Perfectionism',     state: 'Anxiety',         emotion: 'Fear' },
  { trait: 'Perfectionism',     state: 'Overwhelm',       emotion: 'Anger' },
  { trait: 'Stubbornness',      state: 'Defiance',        emotion: 'Contempt' },
  { trait: 'Stubbornness',      state: 'Determination',   emotion: 'Anger' },
  { trait: 'Suspiciousness',    state: 'Suspicion',       emotion: 'Disgust' },
  { trait: 'Suspiciousness',    state: 'Vigilance',       emotion: 'Fear' },
  { trait: 'Suspiciousness',    state: 'Indecision',      emotion: 'Anticipation' },
  { trait: 'Pessimism',         state: 'Resignation',     emotion: 'Sadness' },
  { trait: 'Pessimism',         state: 'Dread',           emotion: 'Fear' },
  { trait: 'Pessimism',         state: 'Indecision',      emotion: 'Disgust' },
  { trait: 'Guilt',             state: 'Vulnerability',   emotion: 'Shame' },
  { trait: 'Guilt',             state: 'Overwhelm',       emotion: 'Sadness' },
  { trait: 'Envy',              state: 'Suspicion',       emotion: 'Contempt' },
  { trait: 'Envy',              state: 'Indecision',      emotion: 'Disgust' },
  { trait: 'Longing',           state: 'Nostalgia',       emotion: 'Sadness' },
]

function hudGlowColor(intensity: number): string {
  if (intensity < 0.33) return 'rgba(59,130,246,0.65)'
  if (intensity < 0.66) return 'rgba(245,158,11,0.70)'
  if (intensity < 0.80) return 'rgba(239,68,68,0.75)'
  return 'rgba(153,27,27,0.85)'
}

function boxGlowColor(intensity: number): string {
  if (intensity < 0.33) return 'rgba(59,130,246,0.40)'
  if (intensity < 0.66) return 'rgba(245,158,11,0.45)'
  if (intensity < 0.80) return 'rgba(239,68,68,0.50)'
  return 'rgba(153,27,27,0.55)'
}

function pulseDuration(intensity: number): string {
  if (intensity < 0.4) return '2s'
  if (intensity < 0.7) return '1.2s'
  return '0.7s'
}

function intensityColor(intensity: number): string {
  if (intensity < 0.33) return '#60A5FA'
  if (intensity < 0.66) return '#FCD34D'
  return '#F87171'
}

function interpolateCurve(data: number[], xFrac: number): number {
  if (data.length === 0) return 0
  if (data.length === 1) return data[0]
  const pos = xFrac * (data.length - 1)
  const lo = Math.floor(pos)
  const hi = Math.min(lo + 1, data.length - 1)
  return data[lo] * (1 - (pos - lo)) + data[hi] * (pos - lo)
}

interface Marker { chordIndex: number; chord: Chord; intensity: number; t: number }

interface HudState {
  clientX: number; clientY: number
  svgX: number
  chordIndex: number
  intensity: number
  t: number
}

interface FloatingEmotionChartProps {
  segment: Segment
  segmentIndex: number
  jobId: string
  onClose: () => void
  onCommitEmotion: (segmentIndex: number, emotion: string, intensity: number) => void
  onUpdateCurve: (segmentIndex: number, curve: number[]) => void
}

export function FloatingEmotionChart({
  segment,
  segmentIndex,
  onClose,
  onCommitEmotion,
  onUpdateCurve,
}: FloatingEmotionChartProps) {
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [ready, setReady] = useState(false)
  const draggingRef = useRef(false)
  const dragOffsetRef = useRef({ x: 0, y: 0 })
  const posRef = useRef(pos)
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  // Curve draw state
  const [curveState, setCurveState] = useState<number[]>(segment.velma_emotion_curve ?? [])
  const isDraggingRef = useRef(false)
  const didDragRef = useRef(false)

  useEffect(() => { posRef.current = pos }, [pos])

  useEffect(() => {
    setPos({
      x: Math.max(0, window.innerWidth / 2 - 280),
      y: Math.max(0, window.innerHeight / 2 - 190),
    })
    setReady(true)
    return () => { if (clickTimerRef.current) clearTimeout(clickTimerRef.current) }
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return
      setPos({
        x: Math.max(0, e.clientX - dragOffsetRef.current.x),
        y: Math.max(0, e.clientY - dragOffsetRef.current.y),
      })
    }
    const onUp = () => {
      draggingRef.current = false
      isDraggingRef.current = false
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  const handleHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    draggingRef.current = true
    dragOffsetRef.current = { x: e.clientX - posRef.current.x, y: e.clientY - posRef.current.y }
  }, [])

  const [markers, setMarkers] = useState<Marker[]>([])
  const [hud, setHud] = useState<HudState | null>(null)

  const trackDuration = Math.max(segment.end_time - segment.start_time, 0.01)
  const avg = curveState.length > 0 ? curveState.reduce((a, b) => a + b, 0) / curveState.length : 0
  const avgChord = CHORDS[Math.min(NUM_CHORDS - 1, Math.round(avg * (NUM_CHORDS - 1)))]

  const polylinePoints = curveState.length > 1
    ? curveState.map((v, i) => `${((i / (curveState.length - 1)) * SVG_W).toFixed(1)},${(SVG_H * (1 - v)).toFixed(1)}`).join(' ')
    : ''

  const areaPath = curveState.length > 1
    ? `M 0 ${SVG_H} ` +
      curveState.map((v, i) => `L ${((i / (curveState.length - 1)) * SVG_W).toFixed(1)} ${(SVG_H * (1 - v)).toFixed(1)}`).join(' ') +
      ` L ${SVG_W} ${SVG_H} Z`
    : ''

  const ZONE_H = SVG_H / 3

  const getSvgHud = useCallback((e: React.MouseEvent<SVGSVGElement>): HudState | null => {
    if (!svgRef.current) return null
    const rect = svgRef.current.getBoundingClientRect()
    const relX = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
    const xFrac = relX / rect.width
    return {
      clientX: e.clientX,
      clientY: e.clientY,
      svgX: xFrac * SVG_W,
      chordIndex: Math.max(0, Math.min(NUM_CHORDS - 1, Math.floor(xFrac * NUM_CHORDS))),
      intensity: interpolateCurve(curveState, xFrac),
      t: xFrac * trackDuration,
    }
  }, [curveState, trackDuration])

  const getCurveCoords = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return null
    const rect = svgRef.current.getBoundingClientRect()
    const relX = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
    const relY = Math.max(0, Math.min(e.clientY - rect.top, rect.height))
    const xFrac = relX / rect.width
    const col = Math.max(0, Math.min(curveState.length - 1, Math.floor(xFrac * curveState.length)))
    const intensity = Math.max(0, Math.min(1, 1 - relY / rect.height))
    return { col, intensity }
  }, [curveState.length])

  const handleSvgMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    e.preventDefault()
    isDraggingRef.current = true
    didDragRef.current = false
    const coords = getCurveCoords(e)
    if (!coords || curveState.length === 0) return
    setCurveState(prev => {
      const next = [...prev]
      next[coords.col] = coords.intensity
      return next
    })
  }, [getCurveCoords, curveState.length])

  const handleSvgMouseUp = useCallback(() => {
    isDraggingRef.current = false
  }, [])

  const handleSvgMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    setHud(getSvgHud(e))
    if (!isDraggingRef.current) return
    const coords = getCurveCoords(e)
    if (!coords) return
    didDragRef.current = true
    setCurveState(prev => {
      const next = [...prev]
      next[coords.col] = coords.intensity
      onUpdateCurve(segmentIndex, next)
      return next
    })
  }, [getSvgHud, getCurveCoords, segmentIndex, onUpdateCurve])

  const handleSvgMouseLeave = useCallback(() => setHud(null), [])

  const handleSvgClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (didDragRef.current) {
      didDragRef.current = false
      return
    }
    const h = getSvgHud(e)
    if (!h) return
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
    clickTimerRef.current = setTimeout(() => {
      const chord = CHORDS[h.chordIndex]
      setMarkers(prev => {
        const idx = prev.findIndex(m => m.chordIndex === h.chordIndex)
        if (idx >= 0) return prev.filter((_, i) => i !== idx)
        return [...prev, { chordIndex: h.chordIndex, chord, intensity: h.intensity, t: h.t }]
      })
      onCommitEmotion(segmentIndex, chord.emotion, h.intensity)
    }, 220)
  }, [getSvgHud, segmentIndex, onCommitEmotion])

  const handleSvgDoubleClick = useCallback(() => {
    if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null }
    onClose()
  }, [onClose])

  if (!ready) return null

  const hudVisible = !!hud
  const hudChord = hud ? CHORDS[hud.chordIndex] : null
  const hudGlow = hud ? hudGlowColor(hud.intensity) : 'transparent'
  const hudPulseDur = hud ? pulseDuration(hud.intensity) : '2s'
  const hudLeft = hud ? Math.min(hud.clientX - posRef.current.x + 16, 420) : 0
  const hudTop  = hud ? Math.max(hud.clientY - posRef.current.y - HEADER_H - 86, 4) : 0
  const hudCurveY = hud ? SVG_H * (1 - hud.intensity) : 0

  return (
    <div
      className="fixed z-50 rounded-xl flex flex-col"
      style={{
        left: pos.x, top: pos.y,
        width: 560, height: 380,
        background: 'rgba(0,8,14,0.82)',
        border: '1px solid rgba(0,206,209,0.15)',
        boxShadow: `0 0 22px 2px ${boxGlowColor(avg)}, 0 8px 40px rgba(0,0,0,0.6)`,
        backdropFilter: 'blur(14px)',
        animation: `emotion-pulse ${pulseDuration(avg)} ease-in-out infinite`,
      }}
    >
      {/* Header / drag handle */}
      <div
        className="shrink-0 flex items-center justify-between px-3 cursor-grab active:cursor-grabbing"
        style={{
          height: HEADER_H,
          background: 'rgba(0,5,10,0.65)',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          userSelect: 'none',
        }}
        onMouseDown={handleHeaderMouseDown}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[9px] text-slate-500 uppercase tracking-widest font-semibold shrink-0">Chord</span>
          <span className="text-[10px] font-bold text-red-400 shrink-0">{avgChord.emotion}</span>
          <span className="text-slate-700 text-[9px]">·</span>
          <span className="text-[10px] text-amber-400/80 shrink-0">{avgChord.state}</span>
          <span className="text-slate-700 text-[9px]">·</span>
          <span className="text-[10px] text-blue-400/70 truncate">{avgChord.trait}</span>
          {hud && (
            <>
              <span className="text-slate-700 text-[9px] shrink-0">@</span>
              <span className="text-[9px] text-slate-400 shrink-0">{hud.t.toFixed(2)}s</span>
            </>
          )}
        </div>
        <button
          type="button"
          className="text-slate-500 hover:text-slate-200 text-sm leading-none px-1.5 shrink-0 transition-colors"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => {
            const flat = Array.from({ length: 20 }, () => 0.25)
            setCurveState(flat)
            setMarkers([])
            onUpdateCurve(segmentIndex, flat)
          }}
        >
          ↺
        </button>
        <button
          type="button"
          className="text-slate-600 hover:text-slate-300 text-sm leading-none px-1 ml-2 shrink-0 transition-colors"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onClose}
        >
          ×
        </button>
      </div>

      {/* SVG chart */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
        <svg
          ref={svgRef}
          className="w-full h-full"
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          preserveAspectRatio="none"
          onMouseDown={handleSvgMouseDown}
          onMouseUp={handleSvgMouseUp}
          onMouseMove={handleSvgMouseMove}
          onMouseLeave={handleSvgMouseLeave}
          onClick={handleSvgClick}
          onDoubleClick={handleSvgDoubleClick}
          style={{ cursor: 'crosshair', display: 'block' }}
        >
          {/* Zone bands */}
          <rect x={0} y={0}          width={SVG_W} height={ZONE_H} fill="rgba(239,68,68,0.06)"  style={{ pointerEvents: 'none' }} />
          <rect x={0} y={ZONE_H}     width={SVG_W} height={ZONE_H} fill="rgba(245,158,11,0.06)" style={{ pointerEvents: 'none' }} />
          <rect x={0} y={ZONE_H * 2} width={SVG_W} height={ZONE_H} fill="rgba(59,130,246,0.06)" style={{ pointerEvents: 'none' }} />

          {/* Zone labels */}
          <text x={4} y={11}              fill="rgba(239,68,68,0.35)"  fontSize={7} fontFamily="monospace" fontWeight="bold" style={{ pointerEvents: 'none' }}>EMOTION</text>
          <text x={4} y={ZONE_H + 11}     fill="rgba(245,158,11,0.30)" fontSize={7} fontFamily="monospace" fontWeight="bold" style={{ pointerEvents: 'none' }}>STATE</text>
          <text x={4} y={ZONE_H * 2 + 11} fill="rgba(59,130,246,0.30)" fontSize={7} fontFamily="monospace" fontWeight="bold" style={{ pointerEvents: 'none' }}>TRAIT</text>

          {/* Horizontal zone boundary lines */}
          {[0, 1/3, 2/3, 1].map((frac, i) => (
            <line key={i} x1={0} y1={SVG_H * frac} x2={SVG_W} y2={SVG_H * frac}
              stroke="rgba(255,255,255,0.07)" strokeWidth={1} style={{ pointerEvents: 'none' }} />
          ))}

          {/* Vertical column dividers — 50 columns */}
          {Array.from({ length: NUM_CHORDS + 1 }).map((_, i) => (
            <line key={i}
              x1={(i / NUM_CHORDS) * SVG_W} y1={0}
              x2={(i / NUM_CHORDS) * SVG_W} y2={SVG_H}
              stroke="rgba(255,255,255,0.03)" strokeWidth={1}
              style={{ pointerEvents: 'none' }}
            />
          ))}

          {/* Area fill */}
          {areaPath && <path d={areaPath} fill="rgba(245,158,11,0.06)" style={{ pointerEvents: 'none' }} />}

          {/* Amber curve — glow + line */}
          {polylinePoints && (
            <g style={{ pointerEvents: 'none' }}>
              <polyline points={polylinePoints} fill="none" stroke="rgba(245,158,11,0.15)" strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />
              <polyline points={polylinePoints} fill="none" stroke="#F59E0B" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
            </g>
          )}

          {/* Hover column highlight */}
          {hud && (
            <rect
              x={(hud.chordIndex / NUM_CHORDS) * SVG_W} y={0}
              width={SVG_W / NUM_CHORDS} height={SVG_H}
              fill="rgba(255,255,255,0.03)" style={{ pointerEvents: 'none' }}
            />
          )}

          {/* Hover crosshair */}
          {hud && (
            <line x1={hud.svgX} y1={0} x2={hud.svgX} y2={SVG_H}
              stroke="rgba(255,255,255,0.12)" strokeWidth={1} strokeDasharray="3 3"
              style={{ pointerEvents: 'none' }} />
          )}

          {/* Hover dot on curve */}
          {hud && curveState.length > 0 && (
            <circle cx={hud.svgX} cy={hudCurveY} r={4} fill="#F59E0B" opacity={0.9}
              style={{ pointerEvents: 'none', filter: `drop-shadow(0 0 4px ${hudGlow})` }} />
          )}

          {/* Click markers */}
          {markers.map((m, i) => {
            const mx = ((m.chordIndex + 0.5) / NUM_CHORDS) * SVG_W
            const my = SVG_H * (1 - m.intensity)
            return (
              <g key={i} style={{ pointerEvents: 'none' }}>
                <line x1={mx} y1={0} x2={mx} y2={SVG_H} stroke="rgba(245,158,11,0.25)" strokeWidth={1} />
                <circle cx={mx} cy={my} r={5} fill="#F59E0B" opacity={0.85}
                  style={{ filter: 'drop-shadow(0 0 5px rgba(245,158,11,0.7))' }} />
                <text x={mx + 5} y={my - 5} fill="rgba(252,211,77,0.8)" fontSize={7} fontFamily="sans-serif">{m.chord.emotion}</text>
              </g>
            )
          })}
        </svg>

        {/* Floating HUD */}
        <div
          className="absolute pointer-events-none z-20"
          style={{
            left: hudLeft, top: hudTop,
            opacity: hudVisible ? 1 : 0,
            transition: 'opacity 0.12s ease',
          }}
        >
          {/* Pulsating glow circle */}
          <div style={{
            position: 'absolute', width: 90, height: 90, borderRadius: '50%',
            background: `radial-gradient(circle, ${hudGlow} 0%, transparent 68%)`,
            top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            animation: hudVisible ? `emotion-pulse ${hudPulseDur} ease-in-out infinite` : 'none',
            pointerEvents: 'none',
          }} />
          {/* HUD card */}
          <div
            className="relative rounded-lg px-2.5 py-2 backdrop-blur-sm"
            style={{
              background: 'rgba(0,8,16,0.88)',
              border: '1px solid rgba(255,255,255,0.07)',
              boxShadow: `0 0 16px ${hudGlow}`,
              minWidth: 116,
            }}
          >
            <div className="flex items-baseline gap-1.5 mb-0.5">
              <span className="text-[8px] text-red-500/55 uppercase font-semibold tracking-wide w-10 shrink-0">Emotion</span>
              <span className="text-[10px] font-bold text-red-400">{hudChord?.emotion}</span>
            </div>
            <div className="flex items-baseline gap-1.5 mb-0.5">
              <span className="text-[8px] text-amber-500/55 uppercase font-semibold tracking-wide w-10 shrink-0">State</span>
              <span className="text-[10px] font-semibold text-amber-400/90">{hudChord?.state}</span>
            </div>
            <div className="flex items-baseline gap-1.5 mb-1">
              <span className="text-[8px] text-blue-500/55 uppercase font-semibold tracking-wide w-10 shrink-0">Trait</span>
              <span className="text-[10px] font-semibold text-blue-400/90">{hudChord?.trait}</span>
            </div>
            <div className="border-t border-white/5 pt-1 flex items-center gap-2">
              <span className="text-[9px] font-bold" style={{ color: hud ? intensityColor(hud.intensity) : '#fff' }}>
                {hud ? Math.round(hud.intensity * 100) : 0}%
              </span>
              <span className="text-[9px] text-slate-500">@ {hud ? hud.t.toFixed(2) : '0.00'}s</span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div
        className="shrink-0 flex items-center gap-1.5 px-3 overflow-x-auto"
        style={{
          height: FOOTER_H,
          background: 'rgba(0,5,10,0.65)',
          borderTop: '1px solid rgba(255,255,255,0.05)',
        }}
      >
        {markers.length === 0 ? (
          <span className="text-[8px] text-slate-600 shrink-0">Draw curve · click to mark chord · double-click to close</span>
        ) : (
          markers.map((m, i) => (
            <span key={i} className="text-[8px] font-semibold leading-none px-1.5 py-0.5 rounded shrink-0"
              style={{ color: '#FCD34D', background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.25)' }}>
              {m.chord.emotion} · {m.chord.state} · {Math.round(m.intensity * 100)}%
            </span>
          ))
        )}
      </div>
    </div>
  )
}
