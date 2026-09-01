'use client'

import React, { useState } from 'react'
import { useT } from '@/lib/use-t'

interface Chord { emotion: string; state: string; trait: string }

const CHORDS: Chord[] = [
  { trait: 'Assertiveness',    state: 'Defiance',        emotion: 'Anger' },
  { trait: 'Confidence',       state: 'Empowerment',     emotion: 'Pride' },
  { trait: 'Resilience',       state: 'Serenity',        emotion: 'Trust' },
  { trait: 'Stubbornness',     state: 'Disdain',         emotion: 'Contempt' },
  { trait: 'Perfectionism',    state: 'Aversion',        emotion: 'Disgust' },
  { trait: 'Optimism',         state: 'Excitement',      emotion: 'Anticipation' },
  { trait: 'Sensitivity',      state: 'Dread',           emotion: 'Fear' },
  { trait: 'Warmth',           state: 'Elation',         emotion: 'Joy' },
  { trait: 'Empathy',          state: 'Resignation',     emotion: 'Sadness' },
  { trait: 'Warmth',           state: 'Longing',         emotion: 'Love' },
  { trait: 'Openness',         state: 'Alertness',       emotion: 'Surprise' },
  { trait: 'Conscientiousness',state: 'Vulnerability',   emotion: 'Shame' },
  { trait: 'Conscientiousness',state: 'Remorse',         emotion: 'Guilt' },
  { trait: 'Pessimism',        state: 'Resentment',      emotion: 'Envy' },
  { trait: 'Openness',         state: 'Wonder',          emotion: 'Awe' },
  { trait: 'Humility',         state: 'Appreciation',    emotion: 'Gratitude' },
  { trait: 'Optimism',         state: 'Yearning',        emotion: 'Hope' },
  { trait: 'Resilience',       state: 'Release',         emotion: 'Relief' },
  { trait: 'Apathy',           state: 'Indifference',    emotion: 'Boredom' },
  { trait: 'Impulsivity',      state: 'Tension',         emotion: 'Frustration' },
  { trait: 'Impulsivity',      state: 'Euphoria',        emotion: 'Excitement' },
  { trait: 'Sensitivity',      state: 'Overwhelm',       emotion: 'Anxiety' },
  { trait: 'Introversion',     state: 'Isolation',       emotion: 'Loneliness' },
  { trait: 'Sentimentality',   state: 'Longing',         emotion: 'Nostalgia' },
  { trait: 'Patience',         state: 'Flow',            emotion: 'Serenity' },
  { trait: 'Warmth',           state: 'Compassion',      emotion: 'Empathy' },
  { trait: 'Insecurity',       state: 'Suspicion',       emotion: 'Jealousy' },
  { trait: 'Openness',         state: 'Inquisitiveness', emotion: 'Curiosity' },
  { trait: 'Impulsivity',      state: 'Indecision',      emotion: 'Confusion' },
  { trait: 'Assertiveness',    state: 'Determination',   emotion: 'Confidence' },
  { trait: 'Conscientiousness',state: 'Acceptance',      emotion: 'Humility' },
  { trait: 'Sensitivity',      state: 'Pensiveness',     emotion: 'Regret' },
  { trait: 'Resilience',       state: 'Focus',           emotion: 'Determination' },
  { trait: 'Sensitivity',      state: 'Openness',        emotion: 'Vulnerability' },
  { trait: 'Empathy',          state: 'Tenderness',      emotion: 'Compassion' },
  { trait: 'Stubbornness',     state: 'Bitterness',      emotion: 'Resentment' },
  { trait: 'Optimism',         state: 'Elation',         emotion: 'Euphoria' },
  { trait: 'Sensitivity',      state: 'Pensiveness',     emotion: 'Melancholy' },
  { trait: 'Warmth',           state: 'Affection',       emotion: 'Tenderness' },
  { trait: 'Introversion',     state: 'Detachment',      emotion: 'Indifference' },
  { trait: 'Conscientiousness',state: 'Enthusiasm',      emotion: 'Zeal' },
  { trait: 'Sensitivity',      state: 'Unease',          emotion: 'Apprehension' },
  { trait: 'Patience',         state: 'Serenity',        emotion: 'Contentment' },
  { trait: 'Pessimism',        state: 'Resignation',     emotion: 'Despair' },
  { trait: 'Warmth',           state: 'Excitement',      emotion: 'Delight' },
  { trait: 'Empathy',          state: 'Mourning',        emotion: 'Grief' },
  { trait: 'Impulsivity',      state: 'Agitation',       emotion: 'Irritation' },
  { trait: 'Openness',         state: 'Amazement',       emotion: 'Wonder' },
  { trait: 'Resilience',       state: 'Serenity',        emotion: 'Acceptance' },
  { trait: 'Confidence',       state: 'Determination',   emotion: 'Courage' },
]

const EMOTION_COLOR: Record<string, string> = {
  Anger:'#ef4444', Contempt:'#ef4444', Disgust:'#ef4444', Frustration:'#ef4444',
  Resentment:'#ef4444', Irritation:'#ef4444', Jealousy:'#ef4444',
  Anticipation:'#f59e0b', Fear:'#f59e0b', Surprise:'#f59e0b', Excitement:'#f59e0b',
  Anxiety:'#f59e0b', Apprehension:'#f59e0b', Zeal:'#f59e0b', Boredom:'#f59e0b',
  Confusion:'#f59e0b', Hope:'#f59e0b', Envy:'#f59e0b',
  Joy:'#22c55e', Love:'#22c55e', Pride:'#22c55e', Trust:'#22c55e',
  Gratitude:'#22c55e', Euphoria:'#22c55e', Delight:'#22c55e', Contentment:'#22c55e',
  Serenity:'#22c55e', Awe:'#22c55e', Wonder:'#22c55e', Acceptance:'#22c55e',
  Courage:'#22c55e', Confidence:'#22c55e', Relief:'#22c55e', Empathy:'#22c55e',
  Compassion:'#22c55e', Tenderness:'#22c55e', Determination:'#22c55e', Humility:'#22c55e',
  Sadness:'#a78bfa', Shame:'#a78bfa', Guilt:'#a78bfa', Loneliness:'#a78bfa',
  Nostalgia:'#a78bfa', Regret:'#a78bfa', Melancholy:'#a78bfa', Vulnerability:'#a78bfa',
  Despair:'#a78bfa', Grief:'#a78bfa', Indifference:'#a78bfa',
}

interface StackItem {
  chord: Chord
  tier: 'emotion' | 'state' | 'trait'
  label: string
  color: string
}

interface Props {
  segment: { start_time: number; end_time: number; velma_emotion?: string }
  segmentIndex: number
  embedded?: boolean
  onClose: () => void
  onApply: (markers: Array<{ emotion: string; intensity: number; color: string }>) => void
}

interface BrowserBodyProps {
  segment: Props['segment']
  segmentIndex: number
  embedded: boolean
  selected: Chord | null
  stack: StackItem[]
  onClose: () => void
  onSelectChord: (chord: Chord) => void
  onAddToStack: (chord: Chord, tier: 'emotion' | 'state' | 'trait') => void
  onRemoveFromStack: (idx: number) => void
  onClearStack: () => void
  onApply: () => void
}

function BrowserBody({
  segment, segmentIndex, embedded, selected, stack,
  onClose, onSelectChord, onAddToStack, onRemoveFromStack, onClearStack, onApply,
}: BrowserBodyProps) {
  const t = useT()
  return (
    <div
      className={embedded ? 'flex flex-col w-full h-full' : 'flex flex-col rounded-xl overflow-hidden shadow-2xl'}
      style={embedded
        ? { background: '#0d1117' }
        : { width: 720, maxHeight: '80vh', background: '#0d1117', border: '1px solid rgba(255,255,255,0.08)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">{t('Advanced')}</span>
          <span className="text-slate-700 text-xs">·</span>
          <span className="text-xs text-slate-400">Segment {segmentIndex + 1}</span>
          {segment.velma_emotion && (
            <>
              <span className="text-slate-700 text-xs">·</span>
              <span className="text-xs" style={{ color: EMOTION_COLOR[segment.velma_emotion] ?? '#60a5fa' }}>
                Velma: {segment.velma_emotion}
              </span>
            </>
          )}
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-200 text-sm px-1">✕</button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Left — chord browser */}
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {/* Three-tier column headers */}
          <div className="grid grid-cols-3 border-b border-white/6">
            {(['emotion', 'state', 'trait'] as const).map(tier => (
              <div
                key={tier}
                className="px-3 py-2 text-[9px] uppercase tracking-widest font-semibold border-r border-white/6 last:border-r-0"
                style={{ color: tier === 'emotion' ? '#f87171' : tier === 'state' ? '#fbbf24' : '#818cf8' }}
              >
                {tier === 'emotion' ? 'Emotion' : tier === 'state' ? t('Mindstate') : t('Character Trait')}
              </div>
            ))}
          </div>

          {/* Chord rows */}
          <div className="flex-1 overflow-y-auto">
            {CHORDS.map((chord, i) => {
              const isSelected = selected?.emotion === chord.emotion
              const color = EMOTION_COLOR[chord.emotion] ?? '#60a5fa'
              return (
                <div
                  key={i}
                  className="grid grid-cols-3 border-b border-white/4 cursor-pointer group transition-colors"
                  style={{ background: isSelected ? `${color}14` : undefined }}
                  onClick={() => onSelectChord(chord)}
                >
                  {(['emotion', 'state', 'trait'] as const).map(tier => {
                    const label = tier === 'emotion' ? chord.emotion : tier === 'state' ? chord.state : chord.trait
                    const inStack = stack.some(s => s.label === label && s.tier === tier)
                    return (
                      <div
                        key={tier}
                        className="flex items-center justify-between px-3 py-2 border-r border-white/4 last:border-r-0"
                        onClick={(e) => {
                          e.stopPropagation()
                          onSelectChord(chord)
                          onAddToStack(chord, tier)
                        }}
                      >
                        <span
                          className="text-xs transition-colors"
                          style={{ color: isSelected ? (tier === 'emotion' ? color : tier === 'state' ? '#fbbf24' : '#818cf8') : '#94a3b8' }}
                        >
                          {label}
                        </span>
                        {inStack ? (
                          <span className="text-[8px] ml-1 opacity-60" style={{ color }}>✓</span>
                        ) : (
                          <span className="text-[10px] ml-1 opacity-0 group-hover:opacity-40 text-slate-400">+</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>

        {/* Right — stack */}
        <div className="w-52 flex flex-col border-l border-white/8 shrink-0">
          <div className="px-3 py-2 text-[9px] uppercase tracking-widest font-semibold text-slate-500 border-b border-white/6">
            Stack ({stack.length})
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-1.5">
            {stack.length === 0 && (
              <p className="text-slate-600 text-[10px] text-center mt-4 leading-relaxed">
                {t('Click any cell')}<br />to add it to<br />your stack
              </p>
            )}
            {stack.map((item, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded px-2 py-1.5 gap-2"
                style={{ background: `${item.color}18`, border: `1px solid ${item.color}30` }}
              >
                <div className="flex flex-col min-w-0">
                  <span className="text-[9px] text-slate-500 uppercase tracking-wider">{item.tier}</span>
                  <span className="text-xs truncate font-medium" style={{ color: item.color }}>{item.label}</span>
                </div>
                <button
                  onClick={() => onRemoveFromStack(i)}
                  className="text-slate-600 hover:text-slate-300 text-xs shrink-0 leading-none"
                >✕</button>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="px-2 py-2 flex flex-col gap-1.5 border-t border-white/6">
            <button
              onClick={onApply}
              disabled={stack.length === 0}
              className="w-full py-1.5 rounded text-[10px] font-bold tracking-wide transition-all"
              style={{
                background: stack.length > 0 ? 'rgba(167,139,250,0.15)' : 'rgba(100,100,100,0.08)',
                color: stack.length > 0 ? '#a78bfa' : '#475569',
                border: `1px solid ${stack.length > 0 ? 'rgba(167,139,250,0.35)' : 'rgba(100,100,100,0.2)'}`,
                cursor: stack.length > 0 ? 'pointer' : 'not-allowed',
              }}
            >
              {t('Apply to Segment')}
            </button>
            <button
              onClick={onClearStack}
              disabled={stack.length === 0}
              className="w-full py-1 rounded text-[9px] text-slate-600 hover:text-slate-400 transition-colors"
            >
              {t('Clear stack')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function AdvancedChordBrowser({ segment, segmentIndex, embedded, onClose, onApply }: Props) {
  const t = useT()
  const [selected, setSelected] = useState<Chord | null>(null)
  const [stack, setStack] = useState<StackItem[]>([])

  const addToStack = (chord: Chord, tier: 'emotion' | 'state' | 'trait') => {
    const label = tier === 'emotion' ? chord.emotion : tier === 'state' ? chord.state : chord.trait
    const color = EMOTION_COLOR[chord.emotion] ?? '#60a5fa'
    if (stack.some(s => s.label === label && s.tier === tier)) return
    setStack(prev => [...prev, { chord, tier, label, color }])
  }

  const handleApply = () => {
    if (stack.length === 0) return
    const markers = stack.map((item, i) => ({
      emotion: item.chord.emotion,
      intensity: Math.max(0.3, 1 - i * 0.12),
      color: item.color,
    }))
    onApply(markers)
  }

  if (embedded) {
    return (
      <BrowserBody
        segment={segment}
        segmentIndex={segmentIndex}
        embedded={true}
        selected={selected}
        stack={stack}
        onClose={onClose}
        onSelectChord={(chord) => setSelected(prev => prev?.emotion === chord.emotion ? null : chord)}
        onAddToStack={addToStack}
        onRemoveFromStack={(idx) => setStack(prev => prev.filter((_, i) => i !== idx))}
        onClearStack={() => setStack([])}
        onApply={handleApply}
      />
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <BrowserBody
        segment={segment}
        segmentIndex={segmentIndex}
        embedded={false}
        selected={selected}
        stack={stack}
        onClose={onClose}
        onSelectChord={(chord) => setSelected(prev => prev?.emotion === chord.emotion ? null : chord)}
        onAddToStack={addToStack}
        onRemoveFromStack={(idx) => setStack(prev => prev.filter((_, i) => i !== idx))}
        onClearStack={() => setStack([])}
        onApply={handleApply}
      />
    </div>
  )
}
