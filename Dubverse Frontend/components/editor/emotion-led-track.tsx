'use client'

import React, { useState } from 'react'

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
  progressionMarkers,
}: {
  curveData: number[] | undefined
  trackDuration: number
  emotionLabel?: string | null
  progressionMarkers?: Array<{ emotion: string; intensity: number; color: string }>
}) {
  const [hover, setHover] = useState<{
    x: number; y: number; t: number; intensity: number; col: number
  } | null>(null)

  const handleMouseMove: React.MouseEventHandler<HTMLDivElement> = (e) => {
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
        className="absolute inset-1 rounded-md border border-cyan-900/10"
        style={{
          background: 'linear-gradient(90deg, rgba(0,206,209,0.04) 0%, rgba(0,206,209,0.02) 100%)',
        }}
      />
    )
  }

  const avg = curveData.reduce((a, b) => a + b, 0) / curveData.length
  const boxGlow = defaultGlowColor(avg)
  const duration = pulseDuration(avg)

  // Peak column for emotion label overlay
  let peakCol = 0
  let peakVal = 0
  curveData.forEach((v, i) => { if (v > peakVal) { peakVal = v; peakCol = i } })
  const peakPct = ((peakCol + 0.5) / curveData.length) * 100

  return (
    <div
      className="absolute inset-1 rounded-md overflow-hidden"
      style={{
        background: 'rgba(0,12,18,0.72)',
        border: 'rgba(0,206,209,0.18)',
        boxShadow: `0 0 10px 1px ${boxGlow}, inset 0 0 6px rgba(0,206,209,0.04)`,
        animation: `emotion-pulse ${duration} ease-in-out infinite`,
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHover(null)}
    >
      {/* Decorative emotion palette header */}
      <div
        className="absolute top-0 left-0 right-0 flex items-center gap-0.5 px-1 pointer-events-none z-10"
        style={{
          height: 16,
          background: 'rgba(0,8,14,0.80)',
          borderBottom: '1px solid rgba(0,206,209,0.10)',
        }}
      >
        {EMOTION_LIST.map(emotion => {
          const p = EMOTION_PALETTE[emotion]
          return (
            <span
              key={emotion}
              className="text-[7px] px-1 leading-none font-semibold shrink-0 rounded"
              style={{ color: p.text }}
            >
              {emotion}
            </span>
          )
        })}
      </div>

      {/* LED columns */}
      <div
        className="absolute left-0 right-0 flex items-end"
        style={{ top: 16, bottom: 0, padding: '3px 2px 18px 2px' }}
      >
        {curveData.map((intensity, col) => {
          const litRows = Math.max(1, Math.round(intensity * ROWS))
          const litColor = '#00CED1'
          const cellGlow = defaultGlowColor(intensity)

          return (
            <div
              key={col}
              className="flex flex-col-reverse flex-1"
              style={{ gap: 2, padding: '0 1px' }}
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

      {/* Emotion label — floats above the peak LED column */}
      {progressionMarkers && progressionMarkers.length > 0 ? (
        progressionMarkers.map((m, i) => {
          // Distribute markers evenly if multiple
          const pct = progressionMarkers.length === 1
            ? peakPct
            : (i / (progressionMarkers.length - 1)) * 100
          return (
            <span
              key={i}
              className="absolute pointer-events-none select-none text-[7.5px] font-bold leading-none px-1.5 py-0.5 rounded"
              style={{
                left: `${Math.min(Math.max(pct, 5), 90)}%`,
                top: 20,
                transform: 'translateX(-50%)',
                color: m.color,
                background: m.color + '22',
                border: `1px solid ${m.color}55`,
                boxShadow: `0 0 5px ${m.color}44`,
                whiteSpace: 'nowrap',
                zIndex: 5,
              }}
            >
              {m.emotion} · {Math.round(m.intensity * 100)}%
            </span>
          )
        })
      ) : (
        <span
          className="absolute pointer-events-none select-none text-[8px] font-semibold leading-none px-1.5 py-0.5 rounded"
          style={{
            left: `${Math.min(Math.max(peakPct, 5), 90)}%`,
            top: 20,
            transform: 'translateX(-50%)',
            color: EMOTION_PALETTE.Neutral.text,
            background: 'rgba(0,0,0,0.72)',
            border: '1px solid rgba(0,206,209,0.25)',
            boxShadow: `0 0 6px ${defaultGlowColor(peakVal)}`,
            whiteSpace: 'nowrap',
            zIndex: 5,
          }}
        >
          {emotionLabel ?? defaultLabel(avg)} · {Math.round(avg * 100)}%
        </span>
      )}

      {/* Hover tooltip */}
      {hover && (
        <div
          className="absolute pointer-events-none z-20"
          style={{ left: Math.min(hover.x + 10, 160), top: Math.max(2, hover.y - 42) }}
        >
          <div
            className="rounded-md px-2 py-1 text-xs bg-slate-900/85 backdrop-blur-sm"
            style={{
              border: `1px solid ${'#00CED1'}30`,
              boxShadow: `0 0 8px ${defaultGlowColor(hover.intensity)}`,
              animation: `emotion-pulse ${pulseDuration(hover.intensity)} ease-in-out infinite`,
            }}
          >
            <span className="font-semibold block" style={{ color: '#00CED1' }}>
              {defaultLabel(hover.intensity)} — {Math.round(hover.intensity * 100)}%
            </span>
            <span className="text-slate-400 text-[10px]">{hover.t.toFixed(2)}s</span>
          </div>
        </div>
      )}
    </div>
  )
}
