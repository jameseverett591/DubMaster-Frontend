'use client'

import React, { useState, useCallback } from 'react'
import { Radio, Eye, Copy, Check } from 'lucide-react'
import type { Segment } from '@/lib/editor-types'
import type { Voice } from '@/lib/api-client'

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

function deliveryQuality(score: number): { label: string; color: string } {
  if (score < 0.2) return { label: 'Natural',         color: 'text-green-400' }
  if (score < 0.4) return { label: 'Good',            color: 'text-emerald-400' }
  if (score < 0.6) return { label: 'Synthetic',       color: 'text-yellow-400' }
  return              { label: 'Highly Synthetic', color: 'text-red-400' }
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
      className="flex items-center gap-1 px-2 py-0.5 rounded font-mono text-xs transition-colors"
      style={{
        background: copied ? 'rgba(139,92,246,0.25)' : 'rgba(139,92,246,0.12)',
        border: `1px solid ${copied ? 'rgba(139,92,246,0.6)' : 'rgba(139,92,246,0.25)'}`,
        color: copied ? '#c4b5fd' : '#a78bfa',
      }}
    >
      {tag}
      {copied
        ? <Check className="h-3 w-3 text-violet-300" />
        : <Copy className="h-3 w-3 opacity-50" />}
    </button>
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
  if (!segment) {
    return (
      <div className="p-4 text-slate-400 text-sm">
        Select a segment to view Velma analysis.
      </div>
    )
  }

  const hasVelmaData = !!(segment.velma_emotion || segment.velma_accent || typeof segment.velma_deepfake_score === 'number')
  const performanceScore = computeVelmaPerformance(segment)
  const recommendations = getVelmaVoiceRecommendations(segment, voices)

  // Chord analysis — only show if curve exists and has been modified from flat 0.25
  const curve = segment.velma_emotion_curve
  const curveAvg = curve && curve.length > 0
    ? curve.reduce((a, b) => a + b, 0) / curve.length
    : null
  const curveModified = curveAvg !== null && Math.abs(curveAvg - 0.25) > 0.01
  const dominantChord = curveModified && curve ? getDominantChord(curve) : null

  // Suggested Fish Audio tags
  const suggestedTags: string[] = []
  if (segment.velma_emotion) suggestedTags.push(`[${segment.velma_emotion.toLowerCase()}]`)
  if (dominantChord && dominantChord.emotion.toLowerCase() !== segment.velma_emotion?.toLowerCase()) {
    suggestedTags.push(`[${dominantChord.emotion.toLowerCase()}]`)
  }
  if (dominantChord && suggestedTags.length < 3) {
    suggestedTags.push(`[${dominantChord.state.toLowerCase()}]`)
  }

  return (
    <div className="p-4 space-y-4 velma-theme">

      {/* Header */}
      <div className="flex items-center space-x-2 mb-2">
        <Radio className="h-4 w-4 text-violet-300" />
        <Eye className="h-4 w-4 text-violet-300" />
        <h2 className="text-violet-300 font-semibold text-sm">Velma Performance Analysis</h2>
      </div>

      {/* No data state */}
      {!hasVelmaData && (
        <div className="velma-card p-4 rounded border border-violet-500/20">
          <p className="text-xs text-violet-400 leading-relaxed">
            No Velma signals for this segment. Re-dub with Velma enabled to populate emotion, accent, and deepfake scores.
          </p>
        </div>
      )}

      {/* Performance Score */}
      {hasVelmaData && (
        <div className="velma-card p-4 rounded">
          <h3 className="text-sm font-semibold mb-2 text-violet-300">Velma Performance Score</h3>
          <div className="text-2xl font-bold text-violet-200">{performanceScore}/100</div>
        </div>
      )}

      {/* Chord Analysis */}
      {dominantChord && curveAvg !== null && (
        <div className="velma-card p-4 rounded">
          <h3 className="text-sm font-semibold mb-3 text-violet-300">Chord Analysis</h3>

          <div className="space-y-1.5 mb-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-red-400/70 font-semibold">Emotion</span>
              <span className="text-xs font-bold text-red-400">{dominantChord.emotion}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-amber-400/70 font-semibold">State</span>
              <span className="text-xs font-semibold text-amber-400/90">{dominantChord.state}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-blue-400/70 font-semibold">Trait</span>
              <span className="text-xs font-semibold text-blue-400/90">{dominantChord.trait}</span>
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-white/5">
              <span className="text-[10px] text-slate-500">Intensity</span>
              <span className="text-xs font-bold text-slate-300">{Math.round(curveAvg * 100)}%</span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500">Fish Audio tag</span>
            <CopyChip tag={`[${dominantChord.emotion.toLowerCase()}]`} />
          </div>
        </div>
      )}

      {/* Emotion Mismatch */}
      {segment.velma_emotion && segment.dubEmotion && segment.velma_emotion !== segment.dubEmotion && (
        <div className="velma-card p-4 rounded">
          <h3 className="text-sm font-semibold mb-2 text-violet-300">Emotion Mismatch</h3>
          <div className="text-xs text-violet-200">
            Original emotion is <span className="font-semibold">{segment.velma_emotion}</span>,{' '}
            but the dub expresses <span className="font-semibold">{segment.dubEmotion}</span>.
          </div>
        </div>
      )}

      {/* Accent Mismatch */}
      {segment.velma_accent && segment.voiceAccent && segment.velma_accent !== segment.voiceAccent && (
        <div className="velma-card p-4 rounded">
          <h3 className="text-sm font-semibold mb-2 text-violet-300">Accent Mismatch</h3>
          <div className="text-xs text-violet-200">
            Original accent is <span className="font-semibold">{segment.velma_accent}</span>,{' '}
            but the selected voice uses <span className="font-semibold">{segment.voiceAccent}</span>.
          </div>
        </div>
      )}

      {/* Original Performance */}
      {hasVelmaData && (
        <div className="velma-card p-4 rounded">
          <h3 className="text-sm font-semibold mb-2 text-violet-300">Original Performance (Velma)</h3>

          {segment.velma_emotion && (
            <div className="flex items-center justify-between mb-1">
              <span className="text-slate-400 text-xs">Emotion</span>
              <span className="px-2 py-0.5 text-xs rounded bg-slate-800 text-slate-200">
                {segment.velma_emotion}
              </span>
            </div>
          )}

          {segment.velma_accent && (
            <div className="flex items-center justify-between mb-1">
              <span className="text-slate-400 text-xs">Accent</span>
              <span className="px-2 py-0.5 text-xs rounded bg-slate-700 text-slate-300">
                {segment.velma_accent}
              </span>
            </div>
          )}

          {segment.speaker_gender && (
            <div className="flex items-center justify-between mb-1">
              <span className="text-slate-400 text-xs">Gender</span>
              <span className="px-2 py-0.5 text-xs rounded bg-slate-800 text-slate-200 capitalize">
                {segment.speaker_gender}
              </span>
            </div>
          )}

          {typeof segment.velma_deepfake_score === 'number' && (
            <>
              <div className="flex items-center justify-between mt-2">
                <span className="text-slate-400 text-xs">Deepfake Score</span>
                <span
                  className={`px-2 py-0.5 text-xs rounded ${
                    segment.velma_deepfake_score > 0.55
                      ? 'bg-red-700 text-red-100'
                      : segment.velma_deepfake_score > 0.35
                      ? 'bg-yellow-700 text-yellow-100'
                      : 'bg-green-700 text-green-100'
                  }`}
                >
                  {segment.velma_deepfake_score.toFixed(2)}
                </span>
              </div>

              <div className="flex items-center justify-between mt-1">
                <span className="text-slate-400 text-xs">Delivery</span>
                <span className={`text-xs font-semibold ${deliveryQuality(segment.velma_deepfake_score).color}`}>
                  {deliveryQuality(segment.velma_deepfake_score).label}
                </span>
              </div>
            </>
          )}

          {typeof segment.velma_deepfake_score === 'number' && segment.velma_deepfake_score > 0.55 && (
            <div className="mt-3 p-2 rounded bg-red-900 text-red-100 text-xs">
              This dub sounds synthetic. Consider regenerating the audio.
            </div>
          )}
        </div>
      )}

      {/* Suggested Fish Audio Tags */}
      {hasVelmaData && suggestedTags.length > 0 && (
        <div className="velma-card p-4 rounded">
          <h3 className="text-sm font-semibold mb-2 text-violet-300">Suggested Tags</h3>
          <p className="text-[10px] text-slate-500 mb-2">Click to copy Fish Audio bracket tag</p>
          <div className="flex flex-wrap gap-1.5">
            {suggestedTags.map((tag) => (
              <CopyChip key={tag} tag={tag} />
            ))}
          </div>
        </div>
      )}

      {/* QC Cross-Link */}
      <button
        type="button"
        onClick={() => setRightPanelTab('quality')}
        className="text-xs text-violet-300 underline hover:text-violet-200"
      >
        View full QC analysis →
      </button>

      {/* Voice Recommendations */}
      {recommendations.length > 0 && (
        <div className="velma-card p-4 rounded">
          <h3 className="text-sm font-semibold mb-2 text-violet-300">Recommended Voices</h3>
          <ul className="text-xs space-y-1">
            {recommendations.map((v) => (
              <li key={v.id} className="text-violet-200">
                • {v.name} — {v.reason}
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => setRightPanelTab('library')}
            className="mt-2 text-xs text-violet-300 underline hover:text-violet-200"
          >
            Open Voice Library →
          </button>
        </div>
      )}

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
