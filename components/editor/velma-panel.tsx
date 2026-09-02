'use client'

import React, { useState, useCallback } from 'react'
import { Radio, Copy, Check, ShieldCheck, Music2, AlertTriangle, Tag, Mic2 } from 'lucide-react'
import type { Segment } from '@/lib/editor-types'
import type { Voice } from '@/lib/api-client'
import { useT } from '@/lib/use-t'

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

function getDominantChord(curve: number[]): Chord {
  const avg = curve.reduce((a, b) => a + b, 0) / curve.length
  return CHORDS[Math.min(49, Math.round(avg * 49))]
}

function deliveryQuality(score: number): { label: string; color: string; border: string; bg: string } {
  if (score < 0.2) return { label: 'Natural',         color: 'text-emerald-300', border: 'border-emerald-500/40', bg: 'bg-emerald-500/10' }
  if (score < 0.4) return { label: 'Good',            color: 'text-lime-300',    border: 'border-lime-500/40',    bg: 'bg-lime-500/10' }
  if (score < 0.6) return { label: 'Synthetic',       color: 'text-yellow-300',  border: 'border-yellow-500/40',  bg: 'bg-yellow-500/10' }
  return              { label: 'Highly Synthetic', color: 'text-red-300',     border: 'border-red-500/40',     bg: 'bg-red-500/10' }
}

function scoreRing(score: number): string {
  if (score >= 80) return 'border-emerald-500 text-emerald-300'
  if (score >= 60) return 'border-yellow-500 text-yellow-300'
  if (score >= 40) return 'border-orange-500 text-orange-300'
  return 'border-red-500 text-red-300'
}

function CopyChip({ tag }: { tag: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(tag).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [tag])
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex items-center gap-1 px-2 py-0.5 rounded-full font-mono text-[10px] transition-colors border"
      style={{
        background: copied ? 'rgba(139,92,246,0.20)' : 'rgba(139,92,246,0.08)',
        borderColor: copied ? 'rgba(139,92,246,0.55)' : 'rgba(139,92,246,0.22)',
        color: copied ? '#c4b5fd' : '#a78bfa',
      }}
    >
      {tag}
      {copied ? <Check className="h-2.5 w-2.5 text-violet-300" /> : <Copy className="h-2.5 w-2.5 opacity-50" />}
    </button>
  )
}

function SectionCard({ icon, title, trailing, children }: {
  icon: React.ReactNode
  title: string
  trailing?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-violet-400 shrink-0">{icon}</span>
        <span className="text-xs font-semibold text-white flex-1">{title}</span>
        {trailing}
      </div>
      {children}
    </div>
  )
}

function DataRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-neutral-800/60 last:border-0">
      <span className="text-[11px] text-slate-400">{label}</span>
      <div>{children}</div>
    </div>
  )
}

export default function VelmaPanel({
  segment,
  voices,
  setRightPanelTab,
}: {
  segment: Segment | null
  voices: Voice[]
  setRightPanelTab: (tab: string) => void
}) {
  const t = useT()
  if (!segment) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 text-xs px-4 text-center">
        {t('Select a segment to view Velma analysis.')}
      </div>
    )
  }

  const hasVelmaData = !!(segment.velma_emotion || segment.velma_accent || typeof segment.velma_deepfake_score === 'number')
  const performanceScore = computeVelmaPerformance(segment)
  const recommendations = getVelmaVoiceRecommendations(segment, voices)

  const curve = segment.velma_emotion_curve
  const curveAvg = curve && curve.length > 0 ? curve.reduce((a, b) => a + b, 0) / curve.length : null
  const curveModified = curveAvg !== null && Math.abs(curveAvg - 0.25) > 0.01
  const dominantChord = curveModified && curve ? getDominantChord(curve) : null

  const suggestedTags: string[] = []
  if (segment.velma_emotion) suggestedTags.push(`[${segment.velma_emotion.toLowerCase()}]`)
  if (dominantChord && dominantChord.emotion.toLowerCase() !== segment.velma_emotion?.toLowerCase()) {
    suggestedTags.push(`[${dominantChord.emotion.toLowerCase()}]`)
  }
  if (dominantChord && suggestedTags.length < 3) {
    suggestedTags.push(`[${dominantChord.state.toLowerCase()}]`)
  }

  return (
    <div className="flex flex-col gap-2.5 p-3 overflow-y-auto h-full bg-neutral-950 text-white">

      {/* Header */}
      <div className="flex items-center gap-2 pb-1 border-b border-neutral-800">
        <Radio className="h-3.5 w-3.5 text-violet-400" />
        <span className="text-xs font-semibold text-violet-300 tracking-wide">{t('Velma Analysis')}</span>
      </div>

      {/* No data */}
      {!hasVelmaData && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
          <p className="text-[11px] text-slate-400 leading-relaxed">
            {t('No Velma signals for this segment. Re-dub with Velma enabled to populate emotion, accent, and deepfake scores.')}
          </p>
        </div>
      )}

      {/* Authenticity Score — with deepfake score */}
      {hasVelmaData && typeof segment.velma_deepfake_score === 'number' && (() => {
        const dq = deliveryQuality(segment.velma_deepfake_score)
        return (
          <SectionCard
            icon={<ShieldCheck className="h-3.5 w-3.5" />}
            title={t('Authenticity Score')}
            trailing={
              <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${dq.color} ${dq.border} ${dq.bg}`}>
                {dq.label}
              </span>
            }
          >
            <div className="flex items-center gap-4">
              <div className={`w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold border-2 shrink-0 ${scoreRing(performanceScore)}`}>
                {performanceScore}
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-slate-500">/100</span>
                <span className="text-[10px] text-slate-400 leading-tight">
                  Based on deepfake detection score ({segment.velma_deepfake_score.toFixed(2)})
                </span>
                {segment.velma_deepfake_score > 0.55 && (
                  <span className="text-[10px] text-red-400 mt-0.5">{t('Sounds synthetic — consider regenerating')}</span>
                )}
              </div>
            </div>
          </SectionCard>
        )
      })()}

      {/* Authenticity Score — no deepfake score fallback */}
      {hasVelmaData && typeof segment.velma_deepfake_score !== 'number' && (
        <SectionCard icon={<ShieldCheck className="h-3.5 w-3.5" />} title={t('Authenticity Score')}>
          <span className="text-[11px] text-slate-500">{t('Deepfake score unavailable for this segment.')}</span>
        </SectionCard>
      )}

      {/* Original Performance */}
      {hasVelmaData && (
        <SectionCard icon={<Radio className="h-3.5 w-3.5" />} title={t('Original Performance')}>
          {segment.velma_emotion && (
            <DataRow label="Emotion">
              <span className="text-[10px] px-2 py-0.5 rounded-full border border-violet-500/30 bg-violet-500/10 text-violet-200 font-medium">
                {segment.velma_emotion}
              </span>
            </DataRow>
          )}
          {segment.velma_accent && (
            <DataRow label="Accent">
              <span className="text-[10px] px-2 py-0.5 rounded-full border border-slate-600/40 bg-slate-800/50 text-slate-300 font-medium">
                {segment.velma_accent}
              </span>
            </DataRow>
          )}
          {segment.speaker_gender && (
            <DataRow label="Gender">
              <span className="text-[10px] px-2 py-0.5 rounded-full border border-slate-600/40 bg-slate-800/50 text-slate-300 font-medium capitalize">
                {segment.speaker_gender}
              </span>
            </DataRow>
          )}
        </SectionCard>
      )}

      {/* Chord Analysis */}
      {dominantChord && curveAvg !== null && (
        <SectionCard
          icon={<Music2 className="h-3.5 w-3.5" />}
          title={t('Chord Analysis')}
          trailing={
            <span className="text-[10px] text-slate-500 font-mono">{Math.round(curveAvg * 100)}% intensity</span>
          }
        >
          <DataRow label="Emotion">
            <span className="text-[10px] font-bold text-red-400">{dominantChord.emotion}</span>
          </DataRow>
          <DataRow label="State">
            <span className="text-[10px] font-semibold text-amber-400">{dominantChord.state}</span>
          </DataRow>
          <DataRow label="Trait">
            <span className="text-[10px] font-semibold text-sky-400">{dominantChord.trait}</span>
          </DataRow>
          <div className="flex items-center justify-between pt-2 mt-0.5">
            <span className="text-[10px] text-slate-500">{t('Fish Audio tag')}</span>
            <CopyChip tag={`[${dominantChord.emotion.toLowerCase()}]`} />
          </div>
        </SectionCard>
      )}

      {/* Emotion Mismatch */}
      {segment.velma_emotion && segment.dubEmotion && segment.velma_emotion !== segment.dubEmotion && (
        <SectionCard
          icon={<AlertTriangle className="h-3.5 w-3.5 text-yellow-400" />}
          title={t('Emotion Mismatch')}
        >
          <p className="text-[11px] text-slate-300 leading-relaxed">
            Original: <span className="font-semibold text-white">{segment.velma_emotion}</span>
            {' · '}
            Dub: <span className="font-semibold text-yellow-300">{segment.dubEmotion}</span>
          </p>
        </SectionCard>
      )}

      {/* Accent Mismatch */}
      {segment.velma_accent && segment.voiceAccent && segment.velma_accent !== segment.voiceAccent && (
        <SectionCard
          icon={<AlertTriangle className="h-3.5 w-3.5 text-yellow-400" />}
          title={t('Accent Mismatch')}
        >
          <p className="text-[11px] text-slate-300 leading-relaxed">
            Original: <span className="font-semibold text-white">{segment.velma_accent}</span>
            {' · '}
            Voice: <span className="font-semibold text-yellow-300">{segment.voiceAccent}</span>
          </p>
        </SectionCard>
      )}

      {/* Suggested Fish Audio Tags */}
      {hasVelmaData && suggestedTags.length > 0 && (
        <SectionCard icon={<Tag className="h-3.5 w-3.5" />} title={t('Suggested Tags')}>
          <p className="text-[10px] text-slate-500 mb-2">{t('Click to copy Fish Audio bracket tag')}</p>
          <div className="flex flex-wrap gap-1.5">
            {suggestedTags.map((tag) => (
              <CopyChip key={tag} tag={tag} />
            ))}
          </div>
        </SectionCard>
      )}

      {/* Voice Recommendations */}
      {recommendations.length > 0 && (
        <SectionCard icon={<Mic2 className="h-3.5 w-3.5" />} title={t('Recommended Voices')}>
          <ul className="space-y-1 mb-2">
            {recommendations.map((v) => (
              <li key={v.id} className="text-[11px] text-slate-300">
                <span className="text-white font-medium">{v.name}</span>
                <span className="text-slate-500"> — {v.reason}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setRightPanelTab('library')}
            className="text-[10px] text-violet-400 hover:text-violet-200 transition-colors"
          >
            Open Voice Library →
          </button>
        </SectionCard>
      )}

      {/* QC Cross-Link */}
      <button
        type="button"
        onClick={() => setRightPanelTab('quality')}
        className="text-[10px] text-slate-500 hover:text-violet-300 transition-colors text-left"
      >
        View full QC analysis →
      </button>

    </div>
  )
}

function computeVelmaPerformance(segment: Segment): number {
  const hasData =
    segment.velma_emotion ||
    segment.velma_accent ||
    typeof segment.velma_deepfake_score === 'number'

  if (!hasData) return 0

  if (typeof segment.velma_deepfake_score === 'number') {
    return Math.round((1 - segment.velma_deepfake_score) * 100)
  }

  return 70
}

function getVelmaVoiceRecommendations(
  segment: Segment,
  voices: Voice[]
): { id: string; name: string; reason: string }[] {
  const recs: { id: string; name: string; reason: string }[] = []

  if (segment.velma_accent && voices.length > 0) {
    const accentLower = segment.velma_accent.toLowerCase()
    const match = voices.find(
      (v) => v.accent && v.accent.toLowerCase().includes(accentLower)
    )
    if (match) {
      recs.push({
        id: match.id,
        name: match.name,
        reason: `Matches original ${segment.velma_accent} accent`,
      })
    }
  }

  if (typeof segment.velma_deepfake_score === 'number' && segment.velma_deepfake_score > 0.55) {
    const current = segment.speaker_id
    const alt = voices.find((v) => v.id !== current)
    if (alt) {
      recs.push({
        id: alt.id,
        name: alt.name,
        reason: 'Lower deepfake risk — current voice sounds synthetic',
      })
    }
  }

  return recs
}
