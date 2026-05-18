'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
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
    speakerPitchMap,
    updateSpeakerPitch,
    setSpeakerPitchMap,
    commitSegmentChanges,
  } = useEditorStore()

  const [voices, setVoices] = useState<Voice[]>([])
  const [voicesLoading, setVoicesLoading] = useState(false)
  const [voicesError, setVoicesError] = useState<string | null>(null)
  const [previewingId, setPreviewingId] = useState<string | null>(null)
  // Track which speakers have been manually overridden
  const [manualOverrides, setManualOverrides] = useState<Set<string>>(new Set())
  // Pending voice selections (not yet applied)
  const [pendingVoiceMap, setPendingVoiceMap] = useState<Record<string, string>>({})
  // Brief "Applied" confirmation per speaker
  const [justApplied, setJustApplied] = useState<Set<string>>(new Set())
  const [applyLoading, setApplyLoading] = useState<Set<string>>(new Set())

  // Derive unique speakers + their gender/sample from segments
  const speakerData = useMemo(() => {
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
  }, [segments])

  // Load voices once on mount
  useEffect(() => {
    setVoicesLoading(true)
    apiClient.getVoices()
      .then(({ voices }) => setVoices(voices))
      .catch(() => setVoicesError('Failed to load voices'))
      .finally(() => setVoicesLoading(false))
  }, [])

  // Sync pending map when speakerVoiceMap changes from outside
  useEffect(() => {
    setPendingVoiceMap(prev => {
      const next = { ...prev }
      for (const spk of speakerData) {
        const applied = speakerVoiceMap[spk.speaker_id]
        if (applied && next[spk.speaker_id] === undefined) {
          next[spk.speaker_id] = applied
        }
      }
      return next
    })
  }, [speakerVoiceMap, speakerData])

  const handleApplyVoice = useCallback(async (speakerId: string, voiceKey: string) => {
    setApplyLoading(prev => new Set([...prev, speakerId]))
    updateSpeakerVoice(speakerId, voiceKey)
    setManualOverrides(prev => new Set([...prev, speakerId]))
    if (jobId) {
      const next = { ...speakerVoiceMap, [speakerId]: voiceKey }
      try {
        await apiClient.updateVoiceMapping(jobId, next)
      } catch {
        // swallow — UI already updated optimistically
      }
    }
    // Commit voice change to RPT manifest for all segments
    // belonging to this speaker
    segments.forEach((seg, idx) => {
      if (seg.speaker_id === speakerId) {
        commitSegmentChanges(idx, {
          committed_voice_id: voiceKey,
          committed_pitch: speakerPitchMap[speakerId] ?? 0,
        })
      }
    })
    setApplyLoading(prev => {
      const n = new Set(prev)
      n.delete(speakerId)
      return n
    })
    setJustApplied(prev => new Set([...prev, speakerId]))
    setTimeout(() => {
      setJustApplied(prev => {
        const n = new Set(prev)
        n.delete(speakerId)
        return n
      })
    }, 2000)
  }, [jobId, speakerVoiceMap, updateSpeakerVoice])

  const handleResetToAuto = useCallback(async (speakerId: string, gender: string) => {
    setManualOverrides(prev => {
      const next = new Set(prev)
      next.delete(speakerId)
      return next
    })
    setPendingVoiceMap(prev => {
      const next = { ...prev }
      delete next[speakerId]
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
      const found = voices.find(v => v.voice_id === voiceId)
      const src = found?.preview_url || `${API_BASE_URL}/api/voice-preview/${voiceId}`
      const audio = new Audio(src)
      audio.onended = () => setPreviewingId(null)
      audio.onerror = () => setPreviewingId(null)
      await audio.play()
    } catch {
      setPreviewingId(null)
    }
  }, [])

  const handlePitchChange = useCallback((speakerId: string, nSteps: number) => {
    updateSpeakerPitch(speakerId, nSteps)
  }, [updateSpeakerPitch])

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

          // Group voices by gender/age — matching first, then others under a divider
          const childVoices = voices.filter(v => v.labels?.age === 'child')
          const femaleVoices = voices.filter(v => v.labels?.gender === 'female' && v.labels?.age !== 'child')
          const maleVoices = voices.filter(v => v.labels?.gender === 'male' && v.labels?.age !== 'child')

          let primaryVoices: Voice[] = []
          let otherVoices: Voice[] = []
          let fallbackNote: string | null = null

          if (spk.detected_gender === 'child') {
            primaryVoices = childVoices
            otherVoices = voices.filter(v => v.labels?.age !== 'child')
            if (childVoices.length === 0) {
              fallbackNote = 'No child voices available — select from other groups below'
            }
          } else if (spk.detected_gender === 'female') {
            primaryVoices = femaleVoices
            otherVoices = voices.filter(v => !(v.labels?.gender === 'female' && v.labels?.age !== 'child'))
            if (femaleVoices.length === 0) {
              fallbackNote = 'No female voices available — select from other groups below'
            }
          } else if (spk.detected_gender === 'male') {
            primaryVoices = maleVoices
            otherVoices = voices.filter(v => !(v.labels?.gender === 'male' && v.labels?.age !== 'child'))
            if (maleVoices.length === 0) {
              fallbackNote = 'No male voices available — select from other groups below'
            }
          } else {
            otherVoices = voices
          }

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

              {/* Fallback warning */}
              {fallbackNote && (
                <span className="text-[10px] text-amber-400/80">
                  ⚠ {fallbackNote}
                </span>
              )}

              {/* Sample line */}
              {spk.sample_line && (
                <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">
                  "{spk.sample_line}"
                </p>
              )}

              {/* Voice selector + preview + apply */}
              <div className="flex items-center gap-2">
                {voicesLoading ? (
                  <div className="flex-1 h-7 rounded bg-slate-700 animate-pulse" />
                ) : voices.length > 0 ? (
                  <select
                    value={pendingVoiceMap[spk.speaker_id] ?? currentVoice}
                    onChange={(e) => setPendingVoiceMap(prev => ({ ...prev, [spk.speaker_id]: e.target.value }))}
                    className="flex-1 rounded bg-slate-700 border border-slate-600 px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                  >
                    {primaryVoices.length > 0 && (
                      <optgroup label="Matching Voices">
                        {primaryVoices.map((v) => (
                          <option key={v.voice_id} value={v.voice_id}>
                            {v.name}
                            {v.labels?.gender ? ` (${v.labels.gender})` : ''}
                            {v.labels?.age && v.labels.age !== 'young' && v.labels.age !== 'middle aged' ? ` · ${v.labels.age}` : ''}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {otherVoices.length > 0 && (
                      <optgroup label={primaryVoices.length > 0 ? 'Other Voices' : 'All Voices'}>
                        {otherVoices.map((v) => (
                          <option key={v.voice_id} value={v.voice_id}>
                            {v.name}
                            {v.labels?.gender ? ` (${v.labels.gender})` : ''}
                            {v.labels?.age && v.labels.age !== 'young' && v.labels.age !== 'middle aged' ? ` · ${v.labels.age}` : ''}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                ) : (
                  <select
                    value={pendingVoiceMap[spk.speaker_id] ?? currentVoice}
                    onChange={(e) => setPendingVoiceMap(prev => ({ ...prev, [spk.speaker_id]: e.target.value }))}
                    className="flex-1 rounded bg-slate-700 border border-slate-600 px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                  >
                    {['male-1','male-2','male-3','male-4','female-1','female-2','female-3','female-4','child-1','child-2','child-3'].map(k => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                )}
                <button
                  onClick={() => handlePreview(pendingVoiceMap[spk.speaker_id] ?? currentVoice)}
                  disabled={previewingId === (pendingVoiceMap[spk.speaker_id] ?? currentVoice)}
                  className="shrink-0 rounded border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-50 transition-colors"
                  title="Preview voice"
                >
                  {previewingId === (pendingVoiceMap[spk.speaker_id] ?? currentVoice) ? '▶ …' : '▶'}
                </button>
                {/* Apply button */}
                {(() => {
                  const selectedVoice = pendingVoiceMap[spk.speaker_id] ?? currentVoice
                  const isChanged = selectedVoice !== currentVoice
                  const voiceMeta = voices.find(v => v.voice_id === selectedVoice)
                  const isGenderMatch = (() => {
                    if (!voiceMeta) return true
                    const g = spk.detected_gender
                    if (g === 'child') return voiceMeta.labels?.age === 'child'
                    if (g === 'female') return voiceMeta.labels?.gender === 'female' && voiceMeta.labels?.age !== 'child'
                    if (g === 'male') return voiceMeta.labels?.gender === 'male' && voiceMeta.labels?.age !== 'child'
                    return true
                  })()
                  const isLoading = applyLoading.has(spk.speaker_id)
                  const isJustApplied = justApplied.has(spk.speaker_id)

                  if (isJustApplied) {
                    return (
                      <span className="shrink-0 flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        Applied
                      </span>
                    )
                  }

                  return (
                    <button
                      onClick={() => handleApplyVoice(spk.speaker_id, selectedVoice)}
                      disabled={!isChanged || isLoading}
                      className={`shrink-0 rounded px-2 py-1 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                        isChanged
                          ? isGenderMatch
                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                            : 'bg-amber-600 hover:bg-amber-700 text-white'
                          : 'bg-slate-700 text-slate-400'
                      }`}
                      title={isChanged ? (isGenderMatch ? 'Apply this voice to all segments for this speaker' : 'Apply this voice (gender mismatch)') : 'Already applied'}
                    >
                      {isLoading ? '…' : 'Apply'}
                    </button>
                  )
                })()}
              </div>

              {/* Pitch shift slider */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-400">Pitch</span>
                  <span className="text-[10px] text-slate-300">
                    {(speakerPitchMap[spk.speaker_id] ?? 0) > 0 ? '+' : ''}
                    {speakerPitchMap[spk.speaker_id] ?? 0} semitones
                  </span>
                </div>
                <input
                  type="range"
                  min={-12}
                  max={12}
                  step={1}
                  value={speakerPitchMap[spk.speaker_id] ?? 0}
                  onChange={(e) => handlePitchChange(spk.speaker_id, parseInt(e.target.value, 10))}
                  className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
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
