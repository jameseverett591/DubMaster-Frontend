"use client"

import { useRef, useEffect, useCallback } from "react"
import type { InlineSegment, InlineSpeaker } from "./types"

interface WaveformTimelineProps {
  segments: InlineSegment[]
  speakers: InlineSpeaker[]
  duration: number
  currentTime: number
  selectedSegmentId: string | null
  onTimeClick: (time: number) => void
  onSegmentClick: (segmentId: string) => void
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function formatTime(s: number) {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, "0")}`
}

export function WaveformTimeline({
  segments,
  speakers,
  duration,
  currentTime,
  selectedSegmentId,
  onTimeClick,
  onSegmentClick,
}: WaveformTimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const speakerColor = useCallback(
    (speakerId: string): string =>
      speakers.find((s) => s.id === speakerId)?.color ?? "#6B7280",
    [speakers]
  )

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = container.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`
    ctx.scale(dpr, dpr)

    const { width, height } = rect
    const safeDuration = Math.max(duration, 0.1)

    // Background
    ctx.fillStyle = "#111827"
    ctx.fillRect(0, 0, width, height)

    // Speaker-colored blocks (flat, full-height like Bolt reference)
    for (const seg of segments) {
      const sx = (seg.start / safeDuration) * width
      const ex = (seg.end / safeDuration) * width
      const color = speakerColor(seg.speaker_id)
      const isSelected = seg.id === selectedSegmentId
      const alpha = isSelected ? 0.9 : 0.7

      ctx.fillStyle = hexToRgba(color, alpha)
      ctx.fillRect(sx, 0, ex - sx, height - 18)

      // 1px gap between blocks
      ctx.fillStyle = "#111827"
      ctx.fillRect(ex - 1, 0, 2, height - 18)
    }

    // Selected segment border
    for (const seg of segments) {
      if (seg.id !== selectedSegmentId) continue
      const sx = (seg.start / safeDuration) * width
      const ex = (seg.end / safeDuration) * width
      ctx.strokeStyle = "#ffffff"
      ctx.lineWidth = 2
      ctx.strokeRect(sx, 1, ex - sx, height - 20)
    }

    // Low-confidence overlay
    for (const seg of segments) {
      if (seg.confidence >= 0.6 && seg.confidence_tier !== "low") continue
      const sx = (seg.start / safeDuration) * width
      const ex = (seg.end / safeDuration) * width
      ctx.fillStyle = "rgba(239,68,68,0.15)"
      ctx.fillRect(sx, 4, ex - sx, height - 22)
    }

    // Playhead
    const px = (currentTime / safeDuration) * width
    ctx.strokeStyle = "#EF4444"
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(px, 0)
    ctx.lineTo(px, height - 14)
    ctx.stroke()

    // Playhead triangle
    ctx.fillStyle = "#EF4444"
    ctx.beginPath()
    ctx.moveTo(px - 6, 0)
    ctx.lineTo(px + 6, 0)
    ctx.lineTo(px, 6)
    ctx.closePath()
    ctx.fill()
  }, [segments, speakers, duration, currentTime, selectedSegmentId, speakerColor])

  useEffect(() => {
    draw()
    const handler = () => draw()
    window.addEventListener("resize", handler)
    return () => window.removeEventListener("resize", handler)
  }, [draw])

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const x = e.clientX - rect.left
    const clickTime = (x / rect.width) * Math.max(duration, 0.1)
    onTimeClick(clickTime)
    const clicked = segments.find((s) => clickTime >= s.start && clickTime < s.end)
    if (clicked) onSegmentClick(clicked.id)
  }

  const visibleSpeakers = speakers.filter((sp) =>
    segments.some((seg) => seg.speaker_id === sp.id)
  )

  return (
    <div className="bg-gray-900 border-b border-gray-800 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800/60">
        <span className="text-xs font-medium text-gray-400">Timeline</span>
        <div className="flex items-center gap-4 text-xs font-mono">
          <span className="text-[#64748B]">
            <span className="text-[#94A3B8] font-sans mr-1">Current:</span>
            {formatTime(currentTime)}
          </span>
          <span className="text-[#64748B]">
            <span className="text-[#94A3B8] font-sans mr-1">Duration:</span>
            {formatTime(duration)}
          </span>
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative cursor-crosshair"
        style={{ height: "120px" }}
        onClick={handleClick}
      >
        <canvas ref={canvasRef} className="absolute inset-0" />
      </div>

      <div className="px-4 py-2 border-t border-gray-800/60 flex flex-wrap items-center gap-4">
        {visibleSpeakers.map((sp) => (
          <div key={sp.id} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: sp.color }} />
            <span className="text-xs text-[#94A3B8]">{sp.name}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5 ml-auto">
          <div className="w-2.5 h-2.5 rounded-sm bg-red-500/30 border border-red-500/60" />
          <span className="text-xs text-gray-500">Low confidence</span>
        </div>
      </div>
    </div>
  )
}
