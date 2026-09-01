'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import type { Segment } from '@/lib/editor-types'
import { useT } from '@/lib/use-t'

interface CharacterProfilePopoverProps {
  segmentIndex: number
  /** The segment's stable id. Staged state is keyed by identity, not by row
   *  position, so that a delete above this segment can't shift its settings
   *  onto a neighbour. segmentIndex remains only for onClearSegment. */
  segmentKey: string
  x: number
  y: number
  onClose: () => void
  onClearSegment: (segmentIndex: number) => void
  segment: Segment
  speakerVoiceMap: Record<string, string>
  speakerPitchMap: Record<string, number>
  stagedEmotions: Record<string, string>
  stagedSpeeds: Record<string, number>
  stagedVoices: Record<string, string>
}

const POPOVER_WIDTH = 300
const POPOVER_MAX_HEIGHT = 420

export function CharacterProfilePopover({
  segmentIndex,
  segmentKey,
  x, y,
  onClose,
  onClearSegment,
  segment,
  speakerVoiceMap,
  speakerPitchMap,
  stagedEmotions,
  stagedSpeeds,
  stagedVoices,
}: CharacterProfilePopoverProps) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const [voiceName, setVoiceName] = useState<string | null>(null)
  const [voiceLoading, setVoiceLoading] = useState(false)
  const [confirmingClear, setConfirmingClear] = useState(false)

  // Resolve the voice that this segment effectively uses, plus override status
  const overrideVoiceId = stagedVoices[segmentKey] ?? segment.committed_voice_id
  const speakerDefault = speakerVoiceMap[segment.speaker_id]
  const effectiveVoiceId = overrideVoiceId ?? speakerDefault
  const isOverride = !!(overrideVoiceId && overrideVoiceId !== speakerDefault)

  // Fetch voice name (Fish API by-id lookup)
  useEffect(() => {
    if (!effectiveVoiceId) { setVoiceName(null); return }
    setVoiceLoading(true)
    setVoiceName(null)
    let cancelled = false
    apiClient.getVoiceById(effectiveVoiceId)
      .then(v => { if (!cancelled) setVoiceName(v.name) })
      .catch(() => { if (!cancelled) setVoiceName(null) })
      .finally(() => { if (!cancelled) setVoiceLoading(false) })
    return () => { cancelled = true }
  }, [effectiveVoiceId])

  // Click-outside dismiss (deferred so the right-click that opened us doesn't immediately close)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 0)
    return () => { clearTimeout(t); document.removeEventListener('mousedown', handler) }
  }, [onClose])

  // Esc dismiss
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  // Clamp to viewport
  const winW = typeof window !== 'undefined' ? window.innerWidth : 1920
  const winH = typeof window !== 'undefined' ? window.innerHeight : 1080
  const safeX = Math.max(10, Math.min(x, winW - POPOVER_WIDTH - 10))
  const safeY = Math.max(10, Math.min(y, winH - POPOVER_MAX_HEIGHT - 10))

  const traits = segment.attached_traits ?? []
  const emotion = stagedEmotions[segmentKey] ?? segment.committed_emotion
  const speed = stagedSpeeds[segmentKey] ?? segment.committed_speed ?? 1.0
  const pitch = speakerPitchMap[segment.speaker_id] ?? 0

  return (
    <div
      ref={ref}
      className="fixed z-[60] w-[300px] bg-slate-900/95 backdrop-blur-md border border-slate-700 rounded-lg shadow-2xl text-xs"
      style={{ left: safeX, top: safeY }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800">
        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
          {t('Character Profile')}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('Close')}
          className="text-slate-500 hover:text-slate-200 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="px-3 py-2.5 flex flex-col gap-2">
        {/* Speaker */}
        <div className="flex items-baseline gap-2">
          <span className="text-slate-500 w-16 shrink-0">{t('Speaker')}</span>
          <span className="text-slate-100 font-medium">{segment.speaker_label ?? segment.speaker_id}</span>
        </div>

        {/* Voice */}
        <div className="flex items-baseline gap-2">
          <span className="text-slate-500 w-16 shrink-0 pt-0.5">{t('Voice')}</span>
          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              {voiceLoading ? (
                <span className="text-slate-400 italic">Loading…</span>
              ) : voiceName ? (
                <span className="text-emerald-300 font-medium">{voiceName}</span>
              ) : effectiveVoiceId ? (
                <span className="text-slate-300 font-mono text-[10px]">
                  {effectiveVoiceId.length > 16 ? effectiveVoiceId.slice(0, 8) + '…' + effectiveVoiceId.slice(-4) : effectiveVoiceId}
                </span>
              ) : (
                <span className="text-amber-400 italic">none</span>
              )}
              {isOverride && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  {t('Override')}
                </span>
              )}
            </div>
            {effectiveVoiceId && voiceName && (
              <span className="text-slate-600 font-mono text-[9px] truncate" title={effectiveVoiceId}>
                {effectiveVoiceId}
              </span>
            )}
          </div>
        </div>

        {/* Traits */}
        <div className="flex items-baseline gap-2">
          <span className="text-slate-500 w-16 shrink-0 pt-0.5">{t('Traits')}</span>
          <div className="flex-1 flex flex-wrap gap-1">
            {traits.length > 0 ? traits.map(t => (
              <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/40 font-mono">
                [{t}]
              </span>
            )) : (
              <span className="text-slate-600 italic">none</span>
            )}
          </div>
        </div>

        {/* Emotion (preset tags + write-in customs share the same field) */}
        <div className="flex items-baseline gap-2">
          <span className="text-slate-500 w-16 shrink-0">{t('Emotion')}</span>
          {emotion ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/40 font-mono">
              [{emotion}]
            </span>
          ) : (
            <span className="text-slate-600 italic">none</span>
          )}
        </div>

        {/* Speed */}
        <div className="flex items-baseline gap-2">
          <span className="text-slate-500 w-16 shrink-0">{t('Speed')}</span>
          <span className={`font-mono ${speed === 1.0 ? 'text-slate-400' : 'text-orange-300'}`}>
            {speed.toFixed(2)}×
          </span>
        </div>

        {/* Pitch */}
        <div className="flex items-baseline gap-2">
          <span className="text-slate-500 w-16 shrink-0">{t('Pitch')}</span>
          <span className={`font-mono ${pitch === 0 ? 'text-slate-400' : 'text-cyan-300'}`}>
            {pitch > 0 ? '+' : ''}{pitch} semitones
          </span>
        </div>

        <div className="pt-2 mt-1 border-t border-slate-800">
          {!confirmingClear ? (
            <button
              type="button"
              onClick={() => setConfirmingClear(true)}
              className="w-full text-xs px-2 py-1.5 rounded bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 hover:text-red-300 transition-colors"
            >
              {t('Clear Segment')}
            </button>
          ) : (
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] text-slate-300">{t('Wipe all overrides on THIS segment?')}</span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => { onClearSegment(segmentIndex); onClose() }}
                  className="flex-1 text-xs px-2 py-1.5 rounded bg-green-500/20 text-green-300 border border-green-500/40 hover:bg-green-500/30 transition-colors"
                >
                  {t('Yes')}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingClear(false)}
                  className="flex-1 text-xs px-2 py-1.5 rounded bg-slate-700/60 text-slate-300 border border-slate-600 hover:bg-slate-700 transition-colors"
                >
                  {t('Cancel')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
