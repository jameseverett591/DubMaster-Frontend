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
  { trait: 'Assertiveness',  state: 'Defiance',        emotion: 'Anger' },
  { trait: 'Confidence',     state: 'Empowerment',     emotion: 'Pride' },
  { trait: 'Resilience',     state: 'Serenity',        emotion: 'Trust' },
  { trait: 'Stubbornness',   state: 'Disdain',         emotion: 'Contempt' },
  { trait: 'Perfectionism',  state: 'Aversion',        emotion: 'Disgust' },
  { trait: 'Optimism',       state: 'Excitement',      emotion: 'Anticipation' },
  { trait: 'Sensitivity',    state: 'Dread',           emotion: 'Fear' },
  { trait: 'Warmth',         state: 'Elation',         emotion: 'Joy' },
  { trait: 'Empathy',        state: 'Resignation',     emotion: 'Sadness' },
  { trait: 'Warmth',         state: 'Longing',         emotion: 'Love' },
  { trait: 'Openness',       state: 'Alertness',       emotion: 'Surprise' },
  { trait: 'Conscientiousness', state: 'Vulnerability', emotion: 'Shame' },
  { trait: 'Conscientiousness', state: 'Remorse',      emotion: 'Guilt' },
  { trait: 'Pessimism',      state: 'Resentment',      emotion: 'Envy' },
  { trait: 'Openness',       state: 'Wonder',          emotion: 'Awe' },
  { trait: 'Humility',       state: 'Appreciation',    emotion: 'Gratitude' },
  { trait: 'Optimism',       state: 'Yearning',        emotion: 'Hope' },
  { trait: 'Resilience',     state: 'Release',         emotion: 'Relief' },
  { trait: 'Apathy',         state: 'Indifference',    emotion: 'Boredom' },
  { trait: 'Impulsivity',    state: 'Tension',         emotion: 'Frustration' },
  { trait: 'Impulsivity',    state: 'Euphoria',        emotion: 'Excitement' },
  { trait: 'Sensitivity',    state: 'Overwhelm',       emotion: 'Anxiety' },
  { trait: 'Introversion',   state: 'Isolation',       emotion: 'Loneliness' },
  { trait: 'Sentimentality', state: 'Longing',         emotion: 'Nostalgia' },
  { trait: 'Patience',       state: 'Flow',            emotion: 'Serenity' },
  { trait: 'Warmth',         state: 'Compassion',      emotion: 'Empathy' },
  { trait: 'Insecurity',     state: 'Suspicion',       emotion: 'Jealousy' },
  { trait: 'Openness',       state: 'Inquisitiveness', emotion: 'Curiosity' },
  { trait: 'Impulsivity',    state: 'Indecision',      emotion: 'Confusion' },
  { trait: 'Assertiveness',  state: 'Determination',   emotion: 'Confidence' },
  { trait: 'Conscientiousness', state: 'Acceptance',   emotion: 'Humility' },
  { trait: 'Sensitivity',    state: 'Pensiveness',     emotion: 'Regret' },
  { trait: 'Resilience',     state: 'Focus',           emotion: 'Determination' },
  { trait: 'Sensitivity',    state: 'Openness',        emotion: 'Vulnerability' },
  { trait: 'Empathy',        state: 'Tenderness',      emotion: 'Compassion' },
  { trait: 'Stubbornness',   state: 'Bitterness',      emotion: 'Resentment' },
  { trait: 'Optimism',       state: 'Elation',         emotion: 'Euphoria' },
  { trait: 'Sensitivity',    state: 'Pensiveness',     emotion: 'Melancholy' },
  { trait: 'Warmth',         state: 'Affection',       emotion: 'Tenderness' },
  { trait: 'Introversion',   state: 'Detachment',      emotion: 'Indifference' },
  { trait: 'Conscientiousness', state: 'Enthusiasm',   emotion: 'Zeal' },
  { trait: 'Sensitivity',    state: 'Unease',          emotion: 'Apprehension' },
  { trait: 'Patience',       state: 'Serenity',        emotion: 'Contentment' },
  { trait: 'Pessimism',      state: 'Resignation',     emotion: 'Despair' },
  { trait: 'Warmth',         state: 'Excitement',      emotion: 'Delight' },
  { trait: 'Empathy',        state: 'Mourning',        emotion: 'Grief' },
  { trait: 'Impulsivity',    state: 'Agitation',       emotion: 'Irritation' },
  { trait: 'Openness',       state: 'Amazement',       emotion: 'Wonder' },
  { trait: 'Resilience',     state: 'Serenity',        emotion: 'Acceptance' },
  { trait: 'Confidence',     state: 'Determination',   emotion: 'Courage' },
]

// Natural peak intensity per emotion
const EMOTION_BASE_INTENSITY: Record<string, number> = {
  'Anger': 0.92,        'Frustration': 0.78,  'Resentment': 0.72,   'Contempt': 0.68,
  'Disgust': 0.70,      'Irritation': 0.65,   'Jealousy': 0.74,
  'Fear': 0.84,         'Anxiety': 0.76,      'Apprehension': 0.62, 'Confusion': 0.50,
  'Boredom': 0.22,      'Zeal': 0.80,         'Excitement': 0.82,   'Anticipation': 0.68,
  'Hope': 0.64,         'Surprise': 0.78,
  'Joy': 0.85,          'Delight': 0.80,      'Euphoria': 0.95,     'Love': 0.75,
  'Tenderness': 0.65,   'Compassion': 0.68,   'Empathy': 0.66,      'Gratitude': 0.72,
  'Trust': 0.58,        'Serenity': 0.55,     'Contentment': 0.60,  'Acceptance': 0.52,
  'Awe': 0.88,          'Wonder': 0.82,       'Curiosity': 0.70,    'Pride': 0.82,
  'Confidence': 0.78,   'Determination': 0.80,'Courage': 0.85,      'Humility': 0.48,
  'Relief': 0.60,
  'Sadness': 0.32,      'Grief': 0.28,        'Loneliness': 0.30,   'Melancholy': 0.35,
  'Nostalgia': 0.42,    'Regret': 0.38,       'Vulnerability': 0.40,'Shame': 0.42,
  'Guilt': 0.38,        'Despair': 0.20,      'Indifference': 0.25,
}

// Natural emotional progression arc
const NEXT_EMOTION: Record<string, string> = {
  'Anger':         'Frustration',
  'Frustration':   'Resentment',
  'Resentment':    'Contempt',
  'Contempt':      'Disgust',
  'Disgust':       'Sadness',
  'Irritation':    'Frustration',
  'Jealousy':      'Envy',
  'Envy':          'Resentment',
  'Fear':          'Anxiety',
  'Anxiety':       'Apprehension',
  'Apprehension':  'Confusion',
  'Confusion':     'Vulnerability',
  'Boredom':       'Indifference',
  'Zeal':          'Excitement',
  'Excitement':    'Anticipation',
  'Anticipation':  'Hope',
  'Hope':          'Joy',
  'Surprise':      'Curiosity',
  'Joy':           'Delight',
  'Delight':       'Euphoria',
  'Euphoria':      'Excitement',
  'Love':          'Tenderness',
  'Tenderness':    'Compassion',
  'Compassion':    'Empathy',
  'Empathy':       'Gratitude',
  'Gratitude':     'Trust',
  'Trust':         'Serenity',
  'Serenity':      'Contentment',
  'Contentment':   'Acceptance',
  'Acceptance':    'Serenity',
  'Awe':           'Wonder',
  'Wonder':        'Curiosity',
  'Curiosity':     'Surprise',
  'Pride':         'Confidence',
  'Confidence':    'Determination',
  'Determination': 'Courage',
  'Courage':       'Pride',
  'Humility':      'Acceptance',
  'Relief':        'Contentment',
  'Sadness':       'Grief',
  'Grief':         'Loneliness',
  'Loneliness':    'Melancholy',
  'Melancholy':    'Nostalgia',
  'Nostalgia':     'Regret',
  'Regret':        'Vulnerability',
  'Vulnerability': 'Humility',
  'Shame':         'Guilt',
  'Guilt':         'Regret',
  'Despair':       'Sadness',
  'Indifference':  'Boredom',
}

function findNextChord(emotion: string): Chord {
  const next = NEXT_EMOTION[emotion]
  if (!next) return CHORDS[0]
  return CHORDS.find(c => c.emotion === next) ?? CHORDS[0]
}

function buildProgressionChain(startChord: Chord, steps: number): Chord[] {
  const chain: Chord[] = [startChord]
  let current = startChord
  const seen = new Set<string>([startChord.emotion])
  for (let i = 1; i < steps; i++) {
    const next = findNextChord(current.emotion)
    chain.push(next)
    if (seen.has(next.emotion)) break
    seen.add(next.emotion)
    current = next
  }
  return chain
}

function applyGaussianPeak(curve: number[], xFrac: number, targetIntensity: number, sigma = 0.08): number[] {
  return curve.map((v, i) => {
    const t = i / (curve.length - 1)
    const dist = Math.abs(t - xFrac)
    const weight = Math.exp(-(dist * dist) / (2 * sigma * sigma))
    return Math.max(0, Math.min(1, v + weight * (targetIntensity - v) * 0.9))
  })
}

interface AutoMarker { chordIndex: number; chord: Chord; intensity: number; t: number; svgX: number; color: string }

// Emotion → color mapping (50 emotions, 5-color spectrum)
const EMOTION_COLOR: Record<string, string> = {
  // 🔴 Red — confrontational, high-arousal negative
  'Anger':         '#ef4444',
  'Contempt':      '#ef4444',
  'Disgust':       '#ef4444',
  'Frustration':   '#ef4444',
  'Resentment':    '#ef4444',
  'Irritation':    '#ef4444',
  'Jealousy':      '#ef4444',
  // 🟡 Amber — activating, uncertain, threat-response
  'Anticipation':  '#f59e0b',
  'Fear':          '#f59e0b',
  'Surprise':      '#f59e0b',
  'Excitement':    '#f59e0b',
  'Anxiety':       '#f59e0b',
  'Apprehension':  '#f59e0b',
  'Zeal':          '#f59e0b',
  'Boredom':       '#f59e0b',
  'Confusion':     '#f59e0b',
  'Hope':          '#f59e0b',
  // 🟢 Green — positive, connective, expansive
  'Joy':           '#22c55e',
  'Love':          '#22c55e',
  'Pride':         '#22c55e',
  'Trust':         '#22c55e',
  'Gratitude':     '#22c55e',
  'Euphoria':      '#22c55e',
  'Delight':       '#22c55e',
  'Contentment':   '#22c55e',
  'Serenity':      '#22c55e',
  'Awe':           '#22c55e',
  'Wonder':        '#22c55e',
  'Acceptance':    '#22c55e',
  'Courage':       '#22c55e',
  'Confidence':    '#22c55e',
  'Relief':        '#22c55e',
  'Empathy':       '#22c55e',
  'Compassion':    '#22c55e',
  'Tenderness':    '#22c55e',
  'Determination': '#22c55e',
  'Humility':      '#22c55e',
  // 🟣 Lavender — melancholic, vulnerable, introspective
  'Sadness':       '#a78bfa',
  'Shame':         '#a78bfa',
  'Guilt':         '#a78bfa',
  'Envy':          '#a78bfa',
  'Loneliness':    '#a78bfa',
  'Nostalgia':     '#a78bfa',
  'Regret':        '#a78bfa',
  'Melancholy':    '#a78bfa',
  'Vulnerability': '#a78bfa',
  'Despair':       '#a78bfa',
  'Grief':         '#a78bfa',
  'Indifference':  '#a78bfa',
}
function emotionColor(emotion: string): string { return EMOTION_COLOR[emotion] ?? '#60a5fa' }

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
  svgX: number; svgY: number
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
  onSaveChord?: (name: string, chord: Chord, intensity: number) => void
  onUpdateProgression?: (segmentIndex: number, markers: Array<{ emotion: string; intensity: number; color: string }>) => void
  /** When true, renders inline (fills container) instead of as a floating overlay */
  embedded?: boolean
}

export function FloatingEmotionChart({
  segment,
  segmentIndex,
  onClose,
  onCommitEmotion,
  onUpdateCurve,
  onSaveChord,
  onUpdateProgression,
  embedded = false,
}: FloatingEmotionChartProps) {
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [ready, setReady] = useState(false)
  const draggingRef = useRef(false)
  const dragOffsetRef = useRef({ x: 0, y: 0 })
  const posRef = useRef(pos)
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const [curveState, setCurveState] = useState<number[]>(
    segment.velma_emotion_curve?.length ? segment.velma_emotion_curve : Array(50).fill(0.25)
  )
  const isDraggingRef = useRef(false)
  const didDragRef = useRef(false)
  const mouseDownPosRef = useRef({ x: 0, y: 0 })

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
  const [autoMarkers, setAutoMarkers] = useState<AutoMarker[]>([])
  const [hud, setHud] = useState<HudState | null>(null)
  const [clickFlash, setClickFlash] = useState<{ svgX: number; svgY: number; chord: Chord; id: number } | null>(null)
  const [pendingChord, setPendingChord] = useState<{ chordIndex: number; chord: Chord; intensity: number; t: number } | null>(null)
  const [chordName, setChordName] = useState('')

  const trackDuration = Math.max(segment.end_time - segment.start_time, 0.01)
  const avg = curveState.length > 0 ? curveState.reduce((a, b) => a + b, 0) / curveState.length : 0
  const avgChord = CHORDS[Math.min(NUM_CHORDS - 1, Math.round(avg * (NUM_CHORDS - 1)))]

  const smoothCurvePath = curveState.length > 1 ? (() => {
    const pts = curveState.map((v, i) => ({
      x: (i / (curveState.length - 1)) * SVG_W,
      y: SVG_H * (1 - v),
    }))
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`
    for (let i = 1; i < pts.length; i++) {
      const cpx = (pts[i - 1].x + pts[i].x) / 2
      d += ` C ${cpx.toFixed(1)} ${pts[i-1].y.toFixed(1)}, ${cpx.toFixed(1)} ${pts[i].y.toFixed(1)}, ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`
    }
    return d
  })() : ''

  const areaPath = smoothCurvePath ? `${smoothCurvePath} L ${SVG_W} ${SVG_H} L 0 ${SVG_H} Z` : ''

  const ZONE_H = SVG_H / 3

  const getSvgHud = useCallback((e: React.MouseEvent<SVGSVGElement>): HudState | null => {
    if (!svgRef.current) return null
    const rect = svgRef.current.getBoundingClientRect()
    const relX = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
    const relY = Math.max(0, Math.min(e.clientY - rect.top, rect.height))
    const xFrac = relX / rect.width
    const svgY = (relY / rect.height) * SVG_H
    return {
      clientX: e.clientX,
      clientY: e.clientY,
      svgX: xFrac * SVG_W,
      svgY,
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
    mouseDownPosRef.current = { x: e.clientX, y: e.clientY }
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
    const dx = e.clientX - mouseDownPosRef.current.x
    const dy = e.clientY - mouseDownPosRef.current.y
    if (!didDragRef.current && dx * dx + dy * dy < 16) return  // < 4px — still a click
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

    const startChord = CHORDS[h.chordIndex] ?? CHORDS[0]

    // Colored flash dot at click position
    setClickFlash({ svgX: h.svgX, svgY: SVG_H * (1 - h.intensity), chord: startChord, id: Date.now() })

    if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
    clickTimerRef.current = setTimeout(() => {
      // Build natural progression chain from clicked emotion
      const chain = buildProgressionChain(startChord, 5)
      const n = chain.length
      const positions = chain.map((_, i) => n === 1 ? 0.5 : 0.05 + (i / (n - 1)) * 0.90)

      // Build 50-point curve with one gaussian peak per chord
      let newCurve = Array(50).fill(0.05) as number[]
      chain.forEach((chord, i) => {
        const intensity = EMOTION_BASE_INTENSITY[chord.emotion] ?? 0.5
        newCurve = applyGaussianPeak(newCurve, positions[i], intensity, 0.06)
      })

      // Snap each marker to the actual curve peak
      const newMarkers: AutoMarker[] = chain.map((chord, i) => {
        const xFrac = positions[i]
        return {
          chordIndex: Math.round(xFrac * NUM_CHORDS),
          chord,
          intensity: interpolateCurve(newCurve, xFrac),
          t: xFrac * trackDuration,
          svgX: xFrac * SVG_W,
          color: emotionColor(chord.emotion),
        }
      })

      setCurveState(newCurve)
      setAutoMarkers(newMarkers)
      setMarkers([])
      onUpdateCurve(segmentIndex, newCurve)
      onUpdateProgression?.(segmentIndex, newMarkers.map(m => ({ emotion: m.chord.emotion, intensity: m.intensity, color: m.color })))
      setPendingChord({ chordIndex: newMarkers[0].chordIndex, chord: startChord, intensity: newMarkers[0].intensity, t: newMarkers[0].t })
      setChordName('')
      onCommitEmotion(segmentIndex, startChord.emotion, newMarkers[0].intensity)
    }, 220)
  }, [getSvgHud, segmentIndex, onCommitEmotion, trackDuration])

  const handleSvgDoubleClick = useCallback(() => {
    if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null }
    onClose()
  }, [onClose])

  if (!ready && !embedded) return null

  const hudVisible = !!hud
  const hudChord = hud ? CHORDS[hud.chordIndex] : null
  const hudGlow = hud ? hudGlowColor(hud.intensity) : 'transparent'
  const hudPulseDur = hud ? pulseDuration(hud.intensity) : '2s'
  const hudLeft = hud ? Math.min(hud.clientX - (embedded ? 0 : posRef.current.x) + 16, 420) : 0
  const hudTop  = hud ? Math.max(hud.clientY - (embedded ? 0 : posRef.current.y + HEADER_H) - 86, 4) : 0
  const hudCurveY = hud ? SVG_H * (1 - hud.intensity) : 0

  return (
    <div
      className={embedded ? 'w-full h-full flex flex-col' : 'fixed z-50 rounded-xl flex flex-col'}
      style={embedded ? {
        background: 'rgba(0,8,14,0.92)',
        animation: `emotion-pulse ${pulseDuration(avg)} ease-in-out infinite`,
      } : {
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
        className={`shrink-0 flex items-center justify-between px-3 ${embedded ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'}`}
        style={{
          height: HEADER_H,
          background: 'rgba(0,5,10,0.65)',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          userSelect: 'none',
        }}
        onMouseDown={embedded ? undefined : handleHeaderMouseDown}
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
            const flat = Array.from({ length: 50 }, () => 0.25)
            setCurveState(flat)
            setMarkers([])
            setAutoMarkers([])
            setClickFlash(null)
            setPendingChord(null)
            onUpdateCurve(segmentIndex, flat)
          }}
        >↺</button>
        <button
          type="button"
          className="text-slate-600 hover:text-slate-300 text-sm leading-none px-1 ml-2 shrink-0 transition-colors"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onClose}
        >×</button>
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
          style={{ cursor: 'pointer', display: 'block' }}
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

          {/* Vertical column dividers */}
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

          {/* Amber curve — glow + smooth bezier */}
          {smoothCurvePath && (
            <g style={{ pointerEvents: 'none' }}>
              <path d={smoothCurvePath} fill="none" stroke="rgba(245,158,11,0.18)" strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />
              <path d={smoothCurvePath} fill="none" stroke="#F59E0B" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
            </g>
          )}

          {/* Hover column highlight */}
          {hud && (
            <rect
              x={(hud.chordIndex / NUM_CHORDS) * SVG_W} y={0}
              width={SVG_W / NUM_CHORDS} height={SVG_H}
              fill="rgba(255,255,255,0.04)" style={{ pointerEvents: 'none' }}
            />
          )}

          {/* Hover crosshair */}
          {hud && (
            <line x1={hud.svgX} y1={0} x2={hud.svgX} y2={SVG_H}
              stroke="rgba(255,255,255,0.10)" strokeWidth={1} strokeDasharray="3 3"
              style={{ pointerEvents: 'none' }} />
          )}

          {/* Hover dot on curve */}
          {hud && curveState.length > 0 && (
            <circle cx={hud.svgX} cy={hudCurveY} r={4} fill="#F59E0B" opacity={0.9}
              style={{ pointerEvents: 'none', filter: `drop-shadow(0 0 4px ${hudGlow})` }} />
          )}

          {/* Inline hover label — only the zone the cursor is in */}
          {hud && hudChord && (() => {
            const zone = hud.svgY < ZONE_H ? 0 : hud.svgY < ZONE_H * 2 ? 1 : 2
            const label    = zone === 0 ? hudChord.emotion : zone === 1 ? hudChord.state : hudChord.trait
            const labelY   = zone === 0 ? ZONE_H * 0.45   : zone === 1 ? ZONE_H * 1.45  : ZONE_H * 2.45
            const fill     = zone === 0 ? 'rgba(239,68,68,0.90)' : zone === 1 ? 'rgba(245,158,11,0.85)' : 'rgba(147,197,253,0.80)'
            const glow     = zone === 0 ? 'rgba(239,68,68,0.5)'  : zone === 1 ? 'rgba(245,158,11,0.4)'  : 'rgba(147,197,253,0.4)'
            return (
              <g style={{ pointerEvents: 'none' }}>
                <text x={hud.svgX} y={labelY} textAnchor="middle"
                  fill={fill} fontSize={9} fontFamily="monospace" fontWeight="bold"
                  style={{ filter: `drop-shadow(0 0 4px ${glow})` }}>
                  {label}
                </text>
              </g>
            )
          })()}

          {/* Auto progression markers — timeline strip at bottom + dot at peak */}
          {autoMarkers.length > 0 && (() => {
            const STRIP_H = 22
            const stripY = SVG_H - STRIP_H
            // Build segment boundaries: edges between markers + chart edges
            const boundaries = [
              0,
              ...autoMarkers.slice(0, -1).map((m, i) => (m.svgX + autoMarkers[i + 1].svgX) / 2),
              SVG_W,
            ]
            return (
              <g style={{ pointerEvents: 'none' }}>
                {/* Strip background */}
                <rect x={0} y={stripY} width={SVG_W} height={STRIP_H}
                  fill="rgba(0,0,0,0.45)" />
                {/* One colored segment per emotion */}
                {autoMarkers.map((m, i) => {
                  const c = m.color
                  const x0 = boundaries[i]
                  const x1 = boundaries[i + 1]
                  const w = x1 - x0
                  return (
                    <g key={`strip-${i}`}>
                      {/* Filled segment */}
                      <rect x={x0} y={stripY} width={w} height={STRIP_H}
                        fill={c + '28'} />
                      {/* Left border */}
                      <line x1={x0} y1={stripY} x2={x0} y2={SVG_H}
                        stroke={c + '66'} strokeWidth={i === 0 ? 0 : 1} />
                      {/* Emotion name */}
                      <text x={x0 + w / 2} y={stripY + 9} textAnchor="middle"
                        fill={c} fontSize={7} fontFamily="monospace" fontWeight="bold"
                        style={{ filter: `drop-shadow(0 0 4px ${c}99)` }}>{m.chord.emotion}</text>
                      {/* Intensity */}
                      <text x={x0 + w / 2} y={stripY + 18} textAnchor="middle"
                        fill={c + 'bb'} fontSize={6.5} fontFamily="monospace">{Math.round(m.intensity * 100)}%</text>
                    </g>
                  )
                })}
              </g>
            )
          })()}
          {autoMarkers.map((m, i) => {
            const my = SVG_H * (1 - m.intensity)
            const c = m.color
            const stripY = SVG_H - 22
            return (
              <g key={`auto-dot-${i}`} style={{ pointerEvents: 'none' }}>
                {/* Stake line from strip top to dot */}
                <line x1={m.svgX} y1={stripY} x2={m.svgX} y2={my + 6}
                  stroke={c + '55'} strokeWidth={1} strokeDasharray="3 3" />
                {/* Pulse ring */}
                <circle cx={m.svgX} cy={my} r={8} fill="none" stroke={c + '44'} strokeWidth={1}>
                  <animate attributeName="r" values="8;14;8" dur={`${1.5 + i * 0.18}s`} repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.5;0.08;0.5" dur={`${1.5 + i * 0.18}s`} repeatCount="indefinite" />
                </circle>
                {/* Dot at curve peak */}
                <circle cx={m.svgX} cy={my} r={5} fill={c} opacity={1}
                  style={{ filter: `drop-shadow(0 0 8px ${c}) drop-shadow(0 0 16px ${c}66)` }}>
                  <animate attributeName="opacity" values="0.85;1;0.85" dur="1.4s" repeatCount="indefinite" />
                </circle>
              </g>
            )
          })}

          {/* Saved markers — colored by emotion */}
          {markers.map((m, i) => {
            const mx = ((m.chordIndex + 0.5) / NUM_CHORDS) * SVG_W
            const my = SVG_H * (1 - m.intensity)
            const c = emotionColor(m.chord.emotion)
            return (
              <g key={i} style={{ pointerEvents: 'none' }}>
                <line x1={mx} y1={0} x2={mx} y2={SVG_H} stroke={c + '44'} strokeWidth={1} />
                <circle cx={mx} cy={my} r={9} fill="none" stroke={c + '66'} strokeWidth={1}>
                  <animate attributeName="r" values="9;13;9" dur="1.8s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.4;0.1;0.4" dur="1.8s" repeatCount="indefinite" />
                </circle>
                <circle cx={mx} cy={my} r={6} fill={c} opacity={1}
                  style={{ filter: `drop-shadow(0 0 8px ${c})` }} />
                <text x={mx} y={my - 16} textAnchor="middle"
                  fill={c} fontSize={7.5} fontFamily="monospace" fontWeight="bold"
                  style={{ filter: `drop-shadow(0 0 3px ${c}88)` }}>{m.chord.emotion}</text>
                <text x={mx} y={my - 7} textAnchor="middle"
                  fill={c + '99'} fontSize={6} fontFamily="monospace">{m.chord.state}</text>
                <text x={mx} y={my + 15} textAnchor="middle"
                  fill="rgba(147,197,253,0.70)" fontSize={6} fontFamily="monospace">{m.chord.trait}</text>
              </g>
            )
          })}

          {/* Pending chord — colored by emotion, with name prompt */}
          {pendingChord && (() => {
            const mx = ((pendingChord.chordIndex + 0.5) / NUM_CHORDS) * SVG_W
            const my = SVG_H * (1 - pendingChord.intensity)
            const c = emotionColor(pendingChord.chord.emotion)
            return (
              <g style={{ pointerEvents: 'none' }}>
                <circle cx={mx} cy={my} r={9} fill="none" stroke={c + '55'} strokeWidth={1.5} />
                <circle cx={mx} cy={my} r={6} fill={c} opacity={0.95}
                  style={{ filter: `drop-shadow(0 0 8px ${c})` }}>
                  <animate attributeName="opacity" values="0.85;1;0.85" dur="1.2s" repeatCount="indefinite" />
                </circle>
                <text x={mx} y={my - 14} textAnchor="middle"
                  fill={c} fontSize={7.5} fontFamily="monospace" fontWeight="bold">{pendingChord.chord.emotion}</text>
                <text x={mx} y={my - 6} textAnchor="middle"
                  fill={c + '99'} fontSize={6} fontFamily="monospace">{pendingChord.chord.state}</text>
                <text x={mx} y={my + 14} textAnchor="middle"
                  fill="rgba(147,197,253,0.65)" fontSize={6} fontFamily="monospace">{pendingChord.chord.trait}</text>
              </g>
            )
          })()}

          {/* Click flash — expanding ring + pulsing dot in emotion color */}
          {clickFlash && clickFlash.chord && (
            <g key={clickFlash.id} style={{ pointerEvents: 'none' }}>
              {(() => {
                const c = emotionColor(clickFlash.chord.emotion)
                return (
                  <>
                    <circle cx={clickFlash.svgX} cy={clickFlash.svgY} r={4} fill="none" stroke={c} strokeWidth={1.5} opacity={0.7}>
                      <animate attributeName="r" from="4" to="28" dur="0.9s" fill="freeze" />
                      <animate attributeName="opacity" from="0.7" to="0" dur="0.9s" fill="freeze" />
                    </circle>
                    <circle cx={clickFlash.svgX} cy={clickFlash.svgY} r={5} fill={c} opacity={1}
                      style={{ filter: `drop-shadow(0 0 8px ${c}) drop-shadow(0 0 16px ${c}88)` }}>
                      <animate attributeName="r" values="5;6.5;5" dur="1.1s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.9;1;0.9" dur="1.1s" repeatCount="indefinite" />
                    </circle>
                  </>
                )
              })()}
            </g>
          )}
        </svg>

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
        {autoMarkers.length > 0 ? (
          autoMarkers.map((m, i) => {
            const c = m.color
            return (
              <span key={`fa-${i}`}
                className="shrink-0 flex flex-col items-center justify-center leading-none rounded"
                style={{
                  color: c,
                  background: c + '22',
                  border: `1px solid ${c}55`,
                  boxShadow: `0 0 6px ${c}44`,
                  minWidth: 44,
                  padding: '2px 6px',
                }}>
                <span className="text-[7.5px] font-bold">{m.chord.emotion}</span>
                <span className="text-[6.5px] opacity-80">{Math.round(m.intensity * 100)}%</span>
              </span>
            )
          })
        ) : markers.length === 0 && !pendingChord ? (
          <span className="text-[8px] text-slate-600 shrink-0">Draw curve · click to mark chord · double-click to close</span>
        ) : (
          markers.map((m, i) => {
            const c = emotionColor(m.chord.emotion)
            return (
              <span key={i} className="text-[8px] font-semibold leading-none px-1.5 py-0.5 rounded shrink-0"
                style={{ color: c, background: c + '18', border: `1px solid ${c}44` }}>
                {m.chord.emotion} · {m.chord.state} · {Math.round(m.intensity * 100)}%
              </span>
            )
          })
        )}
        {pendingChord && (
          <>
            <input
              autoFocus
              type="text"
              placeholder="Name this chord…"
              value={chordName}
              onChange={e => setChordName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && chordName.trim()) {
                  onSaveChord?.(chordName.trim(), pendingChord.chord, pendingChord.intensity)
                  setMarkers(prev => [...prev, pendingChord])
                  setPendingChord(null)
                  setChordName('')
                }
                if (e.key === 'Escape') {
                  setPendingChord(null)
                  setChordName('')
                }
              }}
              className="flex-1 bg-transparent border-b border-violet-500/40 text-xs text-slate-200 placeholder-slate-600 outline-none px-1 py-0.5"
            />
            <button type="button" onClick={() => {
              if (chordName.trim()) {
                onSaveChord?.(chordName.trim(), pendingChord.chord, pendingChord.intensity)
                setMarkers(prev => [...prev, pendingChord])
              }
              setPendingChord(null)
              setChordName('')
            }} className="text-[9px] text-violet-400 hover:text-violet-200 px-2 shrink-0">Save</button>
          </>
        )}
        <button
          type="button"
          className="text-[8px] text-slate-500 hover:text-slate-300 px-2 py-0.5 rounded border border-slate-700 hover:border-slate-500 transition-colors ml-auto shrink-0"
          onClick={() => {
            const flat = Array.from({ length: 50 }, () => 0.25)
            setCurveState(flat)
            setMarkers([])
            setAutoMarkers([])
            setClickFlash(null)
            setPendingChord(null)
            onUpdateCurve(segmentIndex, flat)
          }}
        >Clear</button>
      </div>
    </div>
  )
}
