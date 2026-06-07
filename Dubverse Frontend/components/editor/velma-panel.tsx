'use client'

import React from 'react'
import { Radio, Eye } from 'lucide-react'
import type { Segment } from '@/lib/editor-types'
import type { Voice } from '@/lib/api-client'

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

  const performanceScore = computeVelmaPerformance(segment)
  const recommendations = getVelmaVoiceRecommendations(segment, voices)

  return (
    <div className="p-4 space-y-4 velma-theme">

      {/* Header */}
      <div className="flex items-center space-x-2 mb-2">
        <Radio className="h-4 w-4 text-violet-300" />
        <Eye className="h-4 w-4 text-violet-300" />
        <h2 className="text-violet-300 font-semibold text-sm">Velma Performance Analysis</h2>
      </div>

      {/* Performance Score */}
      <div className="velma-card p-4 rounded">
        <h3 className="text-sm font-semibold mb-2 text-violet-300">Velma Performance Score</h3>
        <div className="text-2xl font-bold text-violet-200">{performanceScore}/100</div>
      </div>

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

      {/* Lip-sync Mismatch */}
      {typeof segment.lip_sync === 'number' && segment.lip_sync < 0.65 && (
        <div className="velma-card p-4 rounded">
          <h3 className="text-sm font-semibold mb-2 text-violet-300">Lip-sync Mismatch</h3>
          <div className="text-xs text-violet-200">
            Lip-sync score is <span className="font-semibold">{segment.lip_sync}</span>,{' '}
            indicating weak alignment between mouth movement and audio.
          </div>
        </div>
      )}

      {/* Original Performance */}
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

        {typeof segment.velma_deepfake_score === 'number' && (
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
        )}

        {typeof segment.velma_deepfake_score === 'number' && segment.velma_deepfake_score > 0.55 && (
          <div className="mt-3 p-2 rounded bg-red-900 text-red-100 text-xs">
            This dub sounds synthetic. Consider regenerating the audio.
          </div>
        )}
      </div>

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

  const df = typeof segment.velma_deepfake_score === 'number' ? segment.velma_deepfake_score : 0
  const dfScore = (1 - df) * 100

  return Math.round(dfScore)
}

function getVelmaVoiceRecommendations(
  segment: Segment,
  _voices: Voice[]
): { id: string; name: string; reason: string }[] {
  const recs: { id: string; name: string; reason: string }[] = []

  if (segment.velma_accent) {
    recs.push({
      id: 'accent-match',
      name: 'British Male Neutral',
      reason: 'Matches original accent',
    })
  }

  if (typeof segment.velma_deepfake_score === 'number' && segment.velma_deepfake_score > 0.55) {
    recs.push({
      id: 'df-fix',
      name: 'Expressive Male High-Quality',
      reason: 'Lower deepfake risk',
    })
  }

  return recs
}
