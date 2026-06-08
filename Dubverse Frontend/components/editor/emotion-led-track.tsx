'use client'

import React, { useState, useCallback } from 'react'

const ROWS = 8

const EMOTION_PALETTE: Record<string, { lit: string; glow: string; text: string }> = {
  Neutral:     { lit: '#00CED1', glow: 'rgba(0,206,209,0.65)',   text: '#00CED1' },
  Calm:        { lit: '#3B82F6', glow: 'rgba(59,130,246,0.65)',  text: '#60A5FA' },
  Sad:         { lit: '#818CF8', glow: 'rgba(129,140,248,0.65)', text: '#A5B4FC' },
  Happy:       { lit: '#FCD34D', glow: 'rgba(252,211,77,0.65)',  text: '#FDE68A' },
  Excited:     { lit: '#F97316', glow: 'rgba(249,115,22,0.65)',  text: '#FB923C' },
  Inquisitive: { lit: '#34D399', glow: 'rgba(52,211,153,0.65)',  text: '#6EE7B7' },
  Angry:       { lit: '#EF4444', glow: 'rgba(239,68,68,0.70)',   text: '#F87171' },
  Fearful:     { lit: '#EC4899', glow: 'rgba(236,72,153,0.65)',  text: '#F472B6' },
}

const EMOTION_LIST = Object.keys(EMOTION_PALETTE)

function defaultGlowColor(intensity: number): string {
  if (intensity < 0.3) return 'rgba(0,206,209,0.65)'
  if (intensity < 0.6) return 'rgba(245,158,11,0.70)'
  if (intensity < 0.8) return 'rgba(239,68,68,0.75)'
  return 'rgba(153,27,27,0.85)'
}

function pulseDuration(intensity: number): string {
  if (intensity < 0.4) return '2s'
  if (intensity < 0.7) return '1.2s'
  return '0.7s'
}

function defaultLabel(intensity: number): string {
  if (intensity < 0.2) return 'Neutral'
  if (intensity < 0.4) return 'Calm'
  if (intensity < 0.6) return 'Assertive'
  if (intensity < 0.8) return 'Emotional'
  return 'Intense'
}

export function EmotionLedTrack({
  curveData,
  trackDuration,
  emotionLabel,
}: {
  curveData: number[] | undefined
  trackDuration: number
  emotionLabel?: string | null
}) {
  const [colEmotions, setColEmotions] = useState<Record<number, string>>({})
  const [selectedCols, setSelectedCols] = useState<Set<number>>(new Set())
  const [editingMode, setEditingMode] = useState(false)
  const [hover, setHover] = useState<{
    x: number; y: number; t: number; intensity: number; col: number
  } | null>(null)

  const exitEditing = useCallback(() => {
    setEditingMode(false)
    setSelectedCols(new Set())
    setHover(null)
  }, [])

  const handleColClick = useCallback((col: number, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!editingMode) setEditingMode(true)
    setSelectedCols(prev => {
      const next = new Set(prev)
      if (next.has(col)) next.delete(col)
      else next.add(col)
      return next
    })
  }, [editingMode])

  const assignEmotion = useCallback((emotion: string) => {
    setColEmotions(prev => {
      const next = { ...prev }
      selectedCols.forEach(col => { next[col] = emotion })
      return next
    })
  }, [selectedCols])

  const handleMouseMove: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (editingMode) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const t = (x / rect.width) * trackDuration
    const col = Math.max(0, Math.min((curveData?.length ?? 1) - 1, Math.floor(((curveData?.length ?? 1) * x) / rect.width)))
    setHover({ x, y, t, intensity: curveData?.[col] ?? 0, col })
  }

  if (!curveData || curveData.length === 0) {
    return (
      <div
        className="absolute inset-1 rounded-md flex items-center justify-center border border-cyan-900/20"
        style={{ background: 'rgba(0,10,15,0.55)' }}
      >
        <span className="text-[10px] text-cyan-600/40 select-none">re-dub to populate</span>
      </div>
    )
  }

  const avg = curveData.reduce((a, b) => a + b, 0) / curveData.length
  const boxGlow = defaultGlowColor(avg)
  const duration = pulseDuration(avg)

  // Build emotion summary from tagged columns
  const grouped: Record<string, number[]> = {}
  Object.entries(colEmotions).forEach(([colStr, emotion]) => {
    const col = parseInt(colStr)
    if (!grouped[emotion]) grouped[emotion] = []
    grouped[emotion].push(curveData[col] ?? avg)
  })
  const emotionSummary = Object.entries(grouped).map(([emotion, intensities]) => ({
    emotion,
    avgIntensity: intensities.reduce((a, b) => a + b, 0) / intensities.length,
  }))
  const showDefaultBadge = emotionSummary.length === 0

  return (
    <div
      className="absolute inset-1 rounded-md overflow-hidden"
      style={{
        background: 'rgba(0,12,18,0.72)',
        border: `1px solid ${editingMode ? 'rgba(0,206,209,0.35)' : 'rgba(0,206,209,0.18)'}`,
        boxShadow: `0 0 10px 1px ${boxGlow}, inset 0 0 6px rgba(0,206,209,0.04)`,
        animation: `emotion-pulse ${duration} ease-in-out infinite`,
      }}
      onDoubleClick={exitEditing}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHover(null)}
    >
      {/* Picker bar — editing mode only */}
      {editingMode && (
        <div
          className="absolute top-0 left-0 right-0 flex items-center gap-0.5 px-1 z-10"
          style={{
            height: 30,
            background: 'rgba(0,8,14,0.92)',
            borderBottom: '1px solid rgba(0,206,209,0.15)',
          }}
        >
          {EMOTION_LIST.map(emotion => {
            const p = EMOTION_PALETTE[emotion]
            const isActive = Array.from(selectedCols).some(col => colEmotions[col] === emotion)
            return (
              <button
                key={emotion}
                type="button"
                className="text-[7.5px] px-1 py-0.5 rounded leading-none font-semibold shrink-0 transition-all"
                style={{
                  color: p.text,
                  background: isActive ? `${p.lit}22` : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${isActive ? p.lit + '55' : 'rgba(255,255,255,0.06)'}`,
                  boxShadow: isActive ? `0 0 4px ${p.glow}` : 'none',
                }}
                onClick={(e) => { e.stopPropagation(); assignEmotion(emotion) }}
              >
                {emotion}
              </button>
            )
          })}
          <button
            type="button"
            className="ml-auto text-[9px] text-slate-500 hover:text-slate-300 px-1 leading-none shrink-0"
            onClick={(e) => { e.stopPropagation(); exitEditing() }}
          >
            ×
          </button>
        </div>
      )}

      {/* LED columns */}
      <div
        className="absolute left-0 right-0 flex items-end"
        style={{
          top: editingMode ? 30 : 0,
          bottom: 0,
          padding: '3px 2px 18px 2px',
        }}
      >
        {curveData.map((intensity, col) => {
          const litRows = Math.max(1, Math.round(intensity * ROWS))
          const assigned = colEmotions[col]
          const palette = assigned ? EMOTION_PALETTE[assigned] : null
          const litColor = palette ? palette.lit : '#00CED1'
          const cellGlow = palette ? palette.glow : defaultGlowColor(intensity)
          const isSelected = selectedCols.has(col)

          return (
            <div
              key={col}
              className="flex flex-col-reverse flex-1 cursor-pointer"
              style={{
                gap: 2,
                padding: '0 1px',
                outline: isSelected ? `1px solid ${litColor}80` : 'none',
                outlineOffset: -1,
                borderRadius: 2,
              }}
              onClick={(e) => handleColClick(col, e)}
            >
              {Array.from({ length: ROWS }).map((_, row) => {
                const isLit = row < litRows
                return (
                  <div
                    key={row}
                    style={{
                      flex: 1,
                      minHeight: 3,
                      borderRadius: 3,
                      backgroundColor: isLit ? litColor : 'rgba(0,206,209,0.07)',
                      opacity: isLit ? 0.45 + intensity * 0.55 : 1,
                      boxShadow: isLit ? `0 0 3px ${cellGlow}` : 'none',
                    }}
                  />
                )
              })}
            </div>
          )
        })}
      </div>

      {/* Emotion badges */}
      <div className="absolute bottom-1 left-1.5 right-1.5 flex flex-wrap gap-x-1.5 gap-y-0.5 pointer-events-none">
        {showDefaultBadge && (
          <span
            className="text-[8px] font-semibold leading-none px-1 py-0.5 rounded select-none"
            style={{ color: EMOTION_PALETTE.Neutral.text, background: 'rgba(0,0,0,0.55)' }}
          >
            {emotionLabel ?? defaultLabel(avg)} · {Math.round(avg * 100)}%
          </span>
        )}
        {emotionSummary.map(({ emotion, avgIntensity }) => {
          const p = EMOTION_PALETTE[emotion] ?? EMOTION_PALETTE.Neutral
          return (
            <span
              key={emotion}
              className="text-[8px] font-semibold leading-none px-1 py-0.5 rounded select-none"
              style={{ color: p.text, background: 'rgba(0,0,0,0.55)' }}
            >
              {emotion} · {Math.round(avgIntensity * 100)}%
            </span>
          )
        })}
      </div>

      {/* Hover tooltip — view mode only */}
      {hover && !editingMode && (
        <div
          className="absolute pointer-events-none z-20"
          style={{ left: Math.min(hover.x + 10, 160), top: Math.max(2, hover.y - 42) }}
        >
          <div
            className="rounded-md px-2 py-1 text-xs bg-slate-900/85 backdrop-blur-sm"
            style={{
              border: `1px solid ${(colEmotions[hover.col] ? EMOTION_PALETTE[colEmotions[hover.col]]?.lit : '#00CED1') + '30'}`,
              boxShadow: `0 0 8px ${defaultGlowColor(hover.intensity)}`,
              animation: `emotion-pulse ${pulseDuration(hover.intensity)} ease-in-out infinite`,
            }}
          >
            <span
              className="font-semibold block"
              style={{
                color: colEmotions[hover.col]
                  ? (EMOTION_PALETTE[colEmotions[hover.col]]?.text ?? '#00CED1')
                  : '#00CED1',
              }}
            >
              {colEmotions[hover.col] ?? defaultLabel(hover.intensity)} — {Math.round(hover.intensity * 100)}%
            </span>
            <span className="text-slate-400 text-[10px]">{hover.t.toFixed(2)}s</span>
          </div>
        </div>
      )}
    </div>
  )
}
