'use client'

import { useEffect, useState, useCallback } from 'react'
import { useEditorStore } from '@/lib/editor-store'
import { apiClient, API_BASE_URL, type Voice } from '@/lib/api-client'

const VOICES_BY_GENDER: Record<string, string[]> = {
  male:   ['male-1', 'male-2', 'male-3', 'male-4'],
  female: ['female-1', 'female-2', 'female-3', 'female-4'],
  child:  ['child-1', 'child-2', 'child-3'],
}

function buildDefaultVoiceMap(
  speakerGenders: Record<string, string>,
  uniqueSpeakers: string[],
): Record<string, string> {
  const usage: Record<string, number> = {}
  const map: Record<string, string> = {}
  for (let i = 0; i < uniqueSpeakers.length; i++) {
    const speaker = uniqueSpeakers[i]
    const gender = speakerGenders[speaker] ?? 'male'
    const pool = VOICES_BY_GENDER[gender] ?? VOICES_BY_GENDER.male
    const idx = usage[gender] ?? 0
    map[speaker] = pool[idx % pool.length]
    usage[gender] = idx + 1
  }
  return map
}

interface SpeakerCard {
  speaker_id: string
  display_name: string
  detected_gender: 'male' | 'female' | 'child' | 'unknown'
  sample_line: string
  current_voice_id: string
  is_auto: boolean
}

export function SpeakerVoicePanel() {
  const {
    jobId,
    segments,
    speakerVoiceMap,
    setSpeakerVoiceMap,
    updateSpeakerVoice,
  } = useEditorStore()

  const [voices, setVoices] = useState<Voice[]>([])
  const [voicesLoading, setVoicesLoading] = useState(false)
  const [voicesError, setVoicesError] = useState<string | null>(null)
  const [previewingId, setPreviewingId] = useState<string | null>(null)
  // Track which speakers have been manually overridden
  const [manualOverrides, setManualOverrides] = useState<Set<string>>(new Set())

  // Derive unique speakers + their gender/sample from segments
  const speakerData = (() => {
    const seen = new Set<string>()
    const speakers: Array<{
      speaker_id: string
      display_name: string
      detected_gender: 'male' | 'female' | 'child' | 'unknown'
      sample_line: string
    }> = []
    for (const seg of segments) {
      if (seen.has(seg.speaker_id)) continue
      seen.add(seg.speaker_id)
      const gender = (seg.speaker_gender as 'male' | 'female' | 'child') ?? 'unknown'
      speakers.push({
        speaker_id: seg.speaker_id,
        display_name: seg.speaker_label ?? seg.speaker_id,
        detected_gender: gender,
        sample_line: seg.source_text ?? seg.target_text ?? '',
      })
    }
    return speakers
  })()

  // Load voices once on mount
  useEffect(() => {
    setVoicesLoading(true)
    apiClient.getVoices()
      .then(({ voices }) => setVoices(voices))
      .catch(() => setVoicesError('Failed to load voices'))
      .finally(() => setVoicesLoading(false))
  }, [])

  const handleVoiceChange = useCallback(async (speakerId: string, voiceKey: string) => {
    setManualOverrides(prev => new Set([...prev, speakerId]))
    updateSpeakerVoice(speakerId, voiceKey)
    if (jobId) {
      const next = { ...speakerVoiceMap, [speakerId]: voiceKey }
      await apiClient.updateVoiceMapping(jobId, next)
    }
  }, [jobId, speakerVoiceMap, updateSpeakerVoice])

  const handleResetToAuto = useCallback(async (speakerId: string, gender: string) => {
    setManualOverrides(prev => {
      const next = new Set(prev)
      next.delete(speakerId)
      return next
    })
    const uniqueIds = speakerData.map(s => s.speaker_id)
    const genders = Object.fromEntries(speakerData.map(s => [s.speaker_id, s.detected_gender]))
    const defaults = buildDefaultVoiceMap(genders, uniqueIds)
    const autoVoice = defaults[speakerId] ?? 'male-1'
    updateSpeakerVoice(speakerId, autoVoice)
    if (jobId) {
      const next = { ...speakerVoiceMap, [speakerId]: autoVoice }
      await apiClient.updateVoiceMapping(jobId, next)
    }
  }, [jobId, speakerData, speakerVoiceMap, updateSpeakerVoice])

  const handlePreview = useCallback(async (voiceId: string) => {
    setPreviewingId(voiceId)
    try {
      const audio = new Audio(`${API_BASE_URL}/api/voice-preview/${voiceId}`)
      audio.onended = () => setPreviewingId(null)
      audio.onerror = () => setPreviewingId(null)
      await audio.play()
    } catch {
      setPreviewingId(null)
    }
  }, [])

  if (segments.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 px-4">
        <p className="text-sm text-slate-500 text-center">No segments loaded.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 p-3 overflow-y-auto">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Speaker Voices
        </span>
        <span className="text-xs text-slate-500">{speakerData.length} speaker{speakerData.length !== 1 ? 's' : ''}</span>
      </div>

      {voicesError && (
        <div className="rounded bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-400">
          {voicesError} —{' '}
          <button
            className="underline hover:text-red-300"
            onClick={() => {
              setVoicesError(null)
              setVoicesLoading(true)
              apiClient.getVoices()
                .then(({ voices }) => setVoices(voices))
                .catch(() => setVoicesError('Failed to load voices'))
                .finally(() => setVoicesLoading(false))
            }}
          >
            retry
          </button>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {speakerData.map((spk) => {
          const currentVoice = speakerVoiceMap[spk.speaker_id] ?? 'male-1'
          const isAuto = !manualOverrides.has(spk.speaker_id)
          const genderColor = {
            male: 'text-blue-400',
            female: 'text-pink-400',
            child: 'text-amber-400',
            unknown: 'text-slate-400',
          }[spk.detected_gender]
          const genderLabel = {
            male: '♂ Male',
            female: '♀ Female',
            child: '⚬ Child',
            unknown: '? Unknown',
          }[spk.detected_gender]

          // Sort voices: gender-matching first, then others
          const matchGender = spk.detected_gender === 'unknown' ? 'male' : spk.detected_gender
          const sortedVoices = [...voices].sort((a, b) => {
            const aMatch = (a.labels?.gender ?? '') === matchGender ? 0 : 1
            const bMatch = (b.labels?.gender ?? '') === matchGender ? 0 : 1
            return aMatch - bMatch
          })

          return (
            <div
              key={spk.speaker_id}
              className="rounded-lg border border-slate-700 bg-slate-800/60 p-3 flex flex-col gap-2"
            >
              {/* Header row */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-100">{spk.display_name}</span>
                {isAuto ? (
                  <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                    Auto
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                    Manual
                  </span>
                )}
              </div>

              {/* Gender */}
              <span className={`text-xs ${genderColor}`}>{genderLabel} · F0-detected</span>

              {/* Sample line */}
              {spk.sample_line && (
                <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">
                  "{spk.sample_line}"
                </p>
              )}

              {/* Voice selector + preview */}
              <div className="flex items-center gap-2">
                {voicesLoading ? (
                  <div className="flex-1 h-7 rounded bg-slate-700 animate-pulse" />
                ) : voices.length > 0 ? (
                  <select
                    value={currentVoice}
                    onChange={(e) => handleVoiceChange(spk.speaker_id, e.target.value)}
                    className="flex-1 rounded bg-slate-700 border border-slate-600 px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                  >
                    {sortedVoices.map((v) => (
                      <option key={v.voice_id} value={v.voice_id}>
                        {v.name}
                        {v.labels?.gender ? ` (${v.labels.gender})` : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <select
                    value={currentVoice}
                    onChange={(e) => handleVoiceChange(spk.speaker_id, e.target.value)}
                    className="flex-1 rounded bg-slate-700 border border-slate-600 px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                  >
                    {['male-1','male-2','male-3','male-4','female-1','female-2','female-3','female-4','child-1','child-2','child-3'].map(k => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                )}
                <button
                  onClick={() => handlePreview(currentVoice)}
                  disabled={previewingId === currentVoice}
                  className="shrink-0 rounded border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-50 transition-colors"
                  title="Preview voice"
                >
                  {previewingId === currentVoice ? '▶ …' : '▶'}
                </button>
              </div>

              {/* Reset to auto */}
              {!isAuto && (
                <button
                  onClick={() => handleResetToAuto(spk.speaker_id, spk.detected_gender)}
                  className="text-[10px] text-slate-500 hover:text-slate-300 text-left transition-colors"
                >
                  Reset to auto
                </button>
              )}
            </div>
          )
        })}
      </div>

      <p className="text-[10px] text-slate-600 text-center mt-1">
        Changes apply on next Generate Speech or Rebuild
      </p>
    </div>
  )
}
