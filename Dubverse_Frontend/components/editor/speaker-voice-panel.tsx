'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { AlertTriangle, Check, ChevronDown, RefreshCw, Loader2 } from 'lucide-react'
import { useEditorStore } from '@/lib/editor-store'
import { apiClient } from '@/lib/api-client'
import { useT } from '@/lib/use-t'

// Curated starter set of character-trait words. Per-speaker custom additions
// (via the Customize input) extend the list at the speaker level only.
const TRAIT_PRESETS = [
  'calm', 'weary', 'paternal', 'confident', 'authoritative',
  'warm', 'intense', 'controlled', 'measured', 'dignified',
  'gruff', 'gentle', 'sharp', 'smooth', 'nervous',
  'playful', 'deliberate', 'energetic', 'reserved', 'commanding',
]

export function SpeakerVoicePanel() {
  const t = useT()
  const {
    jobId,
    segments,
    speakerVoiceMap,
    speakerTraitsMap,
    setSpeakerTraits,
    speakerCustomTraits,
    addCustomTrait,
    speakerPitchMap,
    updateSpeakerPitch,
    updateSegment,
    setImportedSegments,
  } = useEditorStore()

  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const [pendingTraits, setPendingTraits] = useState<Record<string, string[]>>({})
  const [customInput, setCustomInput] = useState<Record<string, string>>({})
  const [justApplied, setJustApplied] = useState<Set<string>>(new Set())

  // Per-speaker bulk-regenerate state machine: idle → confirming → running → done.
  // Keyed by speaker_id so two speakers can run independently if needed.
  type RegenStatus = 'idle' | 'confirming' | 'running' | 'done'
  const [regenStatus, setRegenStatus] = useState<Record<string, RegenStatus>>({})
  const [regenProgress, setRegenProgress] = useState<Record<string, { current: number; total: number }>>({})
  const [regenErrors, setRegenErrors] = useState<Record<string, number>>({})

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

  // Sync local pending with applied when applied changes from outside
  useEffect(() => {
    setPendingTraits(prev => {
      const next = { ...prev }
      for (const spk of speakerData) {
        const applied = speakerTraitsMap[spk.speaker_id]
        if (applied && next[spk.speaker_id] === undefined) {
          next[spk.speaker_id] = [...applied]
        }
      }
      return next
    })
  }, [speakerTraitsMap, speakerData])

  const togglePendingTrait = useCallback((speakerId: string, trait: string) => {
    setPendingTraits(prev => {
      const current = prev[speakerId] ?? []
      const next = current.includes(trait)
        ? current.filter(t => t !== trait)
        : [...current, trait]
      return { ...prev, [speakerId]: next }
    })
  }, [])

  const handleApplyTraits = useCallback(async (speakerId: string) => {
    const traits = pendingTraits[speakerId] ?? []
    setSpeakerTraits(speakerId, traits)
    setJustApplied(prev => new Set([...prev, speakerId]))
    setTimeout(() => {
      setJustApplied(prev => { const n = new Set(prev); n.delete(speakerId); return n })
    }, 2000)
    // Persist server-side. Build the full map (this speaker's new value
    // merged with everyone else's existing values) so the PATCH replaces
    // the whole mapping cleanly.
    if (jobId) {
      const fullMap: Record<string, string[]> = { ...speakerTraitsMap, [speakerId]: traits }
      try {
        await apiClient.updateTraitsMapping(jobId, fullMap)
      } catch {
        // UI already updated optimistically; swallow.
      }
    }
  }, [pendingTraits, setSpeakerTraits, jobId, speakerTraitsMap])

  const handlePitchChange = useCallback((speakerId: string, n: number) => {
    updateSpeakerPitch(speakerId, n)
  }, [updateSpeakerPitch])

  // Loop through every segment for this speaker, sequentially regenerate each
  // with the speaker's CURRENT voice/traits/pitch and the segment's existing
  // text/emotion/speed. Touches only this speaker's segments — others are left
  // entirely alone (filter on speaker_id, not index).
  const handleRegenerateAllForSpeaker = useCallback(async (speakerId: string) => {
    if (!jobId) return

    // Snapshot the speaker's segments + speaker-level settings at click time so
    // an Apply on traits/pitch mid-run doesn't surprise the in-flight loop.
    const targets = segments
      .map((seg, idx) => ({ seg, idx }))
      .filter(({ seg }) => seg.speaker_id === speakerId)

    if (targets.length === 0) {
      setRegenStatus(prev => { const n = { ...prev }; delete n[speakerId]; return n })
      return
    }

    const voiceKey = speakerVoiceMap[speakerId]
    const traits = speakerTraitsMap[speakerId] ?? []
    const pitch = speakerPitchMap[speakerId] ?? 0

    setRegenStatus(prev => ({ ...prev, [speakerId]: 'running' }))
    setRegenProgress(prev => ({ ...prev, [speakerId]: { current: 0, total: targets.length } }))
    setRegenErrors(prev => { const n = { ...prev }; delete n[speakerId]; return n })

    let failures = 0
    for (let i = 0; i < targets.length; i++) {
      const { seg, idx } = targets[i]
      const text = seg.committed_adapted_text ?? seg.active_text ?? seg.target_text
      try {
        // regenerate_segment (dubbing_service) matches on transcript_index, NOT
        // array position — the two diverge after any split, so passing the raw
        // array index regenerates a DIFFERENT segment. Matches the pattern the
        // editor's own regen call sites already use.
        const response = await apiClient.regenerateSegment(jobId, seg.transcript_index ?? idx, {
          text,
          speed: seg.committed_speed ?? 1.0,
          emotion: seg.committed_emotion ?? undefined,
          traits: traits.length > 0 ? traits : undefined,
          voice_key: voiceKey,
          pitch,
        })
        // Mirror the new audio + voice into both store buckets so the editor
        // reflects the change without needing a job reload.
        const filename = response.segment.path?.split('/').pop() ?? ''
        // Cache-bust: filename stays the same across regenerates ("segment_NNNN_regen.mp3"),
        // so without a query param the browser keeps serving the old mp3 from cache.
        //
        // Must go through getAudioFileUrl's own cacheBust param, not string
        // concatenation — the URL already carries ?access_token=<jwt>, and a
        // second literal "?ts=..." leaves two "?" in one URL. The server then
        // parses ONE query string, so access_token becomes "<jwt>?ts=175...",
        // which fails to decode, 401s, and the stitcher silently drops the
        // segment (see 33a6aaa9 — this file wasn't covered by that fix).
        const newAudioUrl = filename ? apiClient.getAudioFileUrl(jobId, filename, true) : undefined
        const update = {
          audio_url: newAudioUrl,
          committed_audio_url: newAudioUrl,
          committed_voice_id: response.segment.voice_id ?? voiceKey,
          status: 'edited' as const,
        }
        updateSegment(idx, update)
        setImportedSegments(prev => {
          if (!prev) return prev
          return prev.map((s, i) => i === idx ? { ...s, ...update } : s)
        })
      } catch (e) {
        console.error(`[Regenerate-all] seg ${idx} failed:`, e)
        failures += 1
      }
      setRegenProgress(prev => ({ ...prev, [speakerId]: { current: i + 1, total: targets.length } }))
    }

    if (failures > 0) {
      setRegenErrors(prev => ({ ...prev, [speakerId]: failures }))
    }
    setRegenStatus(prev => ({ ...prev, [speakerId]: 'done' }))
    // Auto-clear the done state after 4s so the button reverts to idle.
    setTimeout(() => {
      setRegenStatus(prev => { const n = { ...prev }; delete n[speakerId]; return n })
      setRegenProgress(prev => { const n = { ...prev }; delete n[speakerId]; return n })
      setRegenErrors(prev => { const n = { ...prev }; delete n[speakerId]; return n })
    }, 4000)
  }, [jobId, segments, speakerVoiceMap, speakerTraitsMap, speakerPitchMap, updateSegment, setImportedSegments])

  if (segments.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 px-4">
        <p className="text-sm text-slate-500 text-center">{t('No segments loaded.')}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 p-3 overflow-y-auto">
      {/* WARNING BANNER */}
      <div className="rounded-lg bg-amber-500/15 border border-amber-500/40 px-3 py-2.5 flex gap-2.5">
        <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
        <p className="text-[11px] text-amber-200/90 leading-relaxed">
          <span className="font-semibold text-amber-300">
            ⚠ Once a speaker&apos;s character traits are established, this builds the basic character&apos;s personality.
          </span>{' '}
          This cannot be changed — to change it means creating a new and/or different character.
          You can do this by using the Clear button to wipe the segment clean and start building
          the character over. This will affect all segments across the board.{' '}
          <span className="font-semibold text-amber-300">{t('Please build characters decisively and carefully.')}</span>{' '}
          Make all character changes early on in production so you are happy with the character.
          This way you don&apos;t lose hours and days of work unnecessarily.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          {t('Characters')}
        </span>
        <span className="text-xs text-slate-500">
          {speakerData.length} speaker{speakerData.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {speakerData.map((spk) => {
          const applied = speakerTraitsMap[spk.speaker_id] ?? []
          const pending = pendingTraits[spk.speaker_id] ?? []
          const custom = speakerCustomTraits[spk.speaker_id] ?? []
          const isChanged =
            JSON.stringify([...pending].sort()) !== JSON.stringify([...applied].sort())
          const isJustApplied = justApplied.has(spk.speaker_id)

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

          return (
            <div
              key={spk.speaker_id}
              className="rounded-lg border border-slate-700 bg-slate-800/60 p-3 flex flex-col gap-2"
            >
              {/* Header */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-100">{spk.display_name}</span>
                {applied.length > 0 && (
                  <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-400">
                    {applied.length} {applied.length === 1 ? 'trait' : 'traits'} applied
                  </span>
                )}
              </div>

              {/* Gender */}
              <span className={`text-xs ${genderColor}`}>{genderLabel} · F0-detected</span>

              {/* Sample line */}
              {spk.sample_line && (
                <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">
                  &quot;{spk.sample_line}&quot;
                </p>
              )}

              {/* Trait dropdown trigger (midnight blue) */}
              <button
                type="button"
                onClick={() =>
                  setOpenDropdown(prev => (prev === spk.speaker_id ? null : spk.speaker_id))
                }
                className="flex items-center justify-between rounded text-white text-xs px-3 py-2 border border-blue-900/70 hover:bg-[#1f1f8a] transition-colors"
                style={{ backgroundColor: '#191970' }}
              >
                <span>
                  {pending.length > 0
                    ? `${pending.length} selected — ${pending.slice(0, 2).join(', ')}${pending.length > 2 ? '…' : ''}`
                    : 'Select character traits…'}
                </span>
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${openDropdown === spk.speaker_id ? 'rotate-180' : ''}`}
                />
              </button>

              {/* Dropdown panel */}
              {openDropdown === spk.speaker_id && (
                <div
                  className="rounded p-2 border border-blue-900/70 flex flex-col gap-0.5 max-h-72 overflow-y-auto"
                  style={{ backgroundColor: '#191970' }}
                >
                  {[...TRAIT_PRESETS, ...custom].map((trait) => {
                    const isSelected = pending.includes(trait)
                    return (
                      <button
                        key={trait}
                        type="button"
                        onClick={() => togglePendingTrait(spk.speaker_id, trait)}
                        className="flex items-center gap-2 text-white text-xs px-2 py-1.5 hover:bg-blue-900 rounded transition-colors text-left"
                      >
                        {isSelected ? (
                          <Check className="h-3.5 w-3.5 text-green-400 shrink-0" />
                        ) : (
                          <span className="w-3.5 shrink-0" />
                        )}
                        <span>{trait}</span>
                      </button>
                    )
                  })}

                  {/* Customize write-in */}
                  <div className="flex gap-1 mt-1 pt-1.5 border-t border-blue-900/70">
                    <input
                      type="text"
                      value={customInput[spk.speaker_id] ?? ''}
                      onChange={(e) =>
                        setCustomInput(prev => ({ ...prev, [spk.speaker_id]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const t = (customInput[spk.speaker_id] ?? '').trim().toLowerCase()
                          if (t) {
                            addCustomTrait(spk.speaker_id, t)
                            togglePendingTrait(spk.speaker_id, t)
                            setCustomInput(prev => ({ ...prev, [spk.speaker_id]: '' }))
                          }
                        }
                      }}
                      placeholder="+ Customize: type a trait, Enter to add"
                      className="flex-1 text-white text-xs px-2 py-1.5 rounded border border-blue-900/70 placeholder-blue-300/70 focus:outline-none focus:border-blue-400"
                      style={{ backgroundColor: '#0a0a4a' }}
                    />
                  </div>
                </div>
              )}

              {/* Apply button */}
              <div className="flex justify-end">
                {isJustApplied ? (
                  <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
                    <Check className="h-3 w-3" /> {t('Applied')}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleApplyTraits(spk.speaker_id)}
                    disabled={!isChanged}
                    className={`rounded px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      isChanged ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-slate-700 text-slate-400'
                    }`}
                    title={isChanged ? 'Lock these traits for this character' : 'No changes to apply'}
                  >
                    {t('Apply')}
                  </button>
                )}
              </div>

              {/* Pitch slider */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-400">{t('Pitch')}</span>
                  <span className="text-[10px] text-slate-300">
                    {(speakerPitchMap[spk.speaker_id] ?? 0) > 0 ? '+' : ''}
                    {speakerPitchMap[spk.speaker_id] ?? 0} semitones
                  </span>
                </div>
                <input
                  type="range"
                  aria-label={`Pitch shift for ${spk.display_name} in semitones`}
                  title={t('Pitch shift')}
                  min={-12}
                  max={12}
                  step={1}
                  value={speakerPitchMap[spk.speaker_id] ?? 0}
                  onChange={(e) => handlePitchChange(spk.speaker_id, parseInt(e.target.value, 10))}
                  className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
              </div>

              {/* Regenerate all segments for this speaker — 4-state UX */}
              {(() => {
                const speakerSegmentCount = segments.filter(s => s.speaker_id === spk.speaker_id).length
                const status = regenStatus[spk.speaker_id] ?? 'idle'
                const progress = regenProgress[spk.speaker_id]
                const errors = regenErrors[spk.speaker_id] ?? 0

                if (status === 'idle') {
                  return (
                    <button
                      type="button"
                      onClick={() => setRegenStatus(prev => ({ ...prev, [spk.speaker_id]: 'confirming' }))}
                      disabled={!jobId || speakerSegmentCount === 0}
                      className="w-full text-[11px] rounded-md py-1.5 bg-slate-700/80 hover:bg-slate-600 text-slate-200 border border-slate-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                      title={`Regenerate all ${speakerSegmentCount} segments using ${spk.display_name}'s current voice + traits`}
                    >
                      <RefreshCw className="h-3 w-3" />
                      Regenerate all {speakerSegmentCount} segments
                    </button>
                  )
                }

                if (status === 'confirming') {
                  return (
                    <div className="rounded-md bg-amber-500/10 border border-amber-500/40 p-2 flex flex-col gap-2">
                      <p className="text-[10px] text-amber-200 leading-snug">
                        {t('This will regenerate')} <span className="font-semibold">{speakerSegmentCount}</span> segments using
                        <span className="font-semibold"> {spk.display_name}</span>&apos;s current voice. Continue?
                      </p>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleRegenerateAllForSpeaker(spk.speaker_id)}
                          className="flex-1 text-[10px] rounded py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-medium transition-colors"
                        >
                          {t('Yes, regenerate')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setRegenStatus(prev => { const n = { ...prev }; delete n[spk.speaker_id]; return n })}
                          className="flex-1 text-[10px] rounded py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
                        >
                          {t('Cancel')}
                        </button>
                      </div>
                    </div>
                  )
                }

                if (status === 'running' && progress) {
                  return (
                    <div className="rounded-md bg-slate-800 border border-slate-700 p-2 flex flex-col gap-1.5">
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-300">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Regenerating {progress.current} of {progress.total}…
                      </div>
                      <div className="h-1 bg-slate-700 rounded overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 transition-all duration-300"
                          style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
                        />
                      </div>
                    </div>
                  )
                }

                if (status === 'done') {
                  const ok = (progress?.total ?? 0) - errors
                  return (
                    <div className={`rounded-md p-2 flex items-center gap-1.5 animate-pulse ${
                      errors > 0
                        ? 'bg-amber-500/20 border border-amber-500/40'
                        : 'bg-emerald-500/20 border border-emerald-500/40'
                    }`}>
                      <Check className={`h-3 w-3 ${errors > 0 ? 'text-amber-400' : 'text-emerald-400'}`} />
                      <span className={`text-[10px] font-medium ${errors > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>
                        {errors > 0
                          ? `Regenerated ${ok} of ${progress?.total ?? 0} — ${errors} failed`
                          : `Regenerated ${progress?.total ?? 0} segments`}
                      </span>
                    </div>
                  )
                }
                return null
              })()}
            </div>
          )
        })}
      </div>

      <p className="text-[10px] text-slate-600 text-center mt-1">
        {t('Traits attach to a segment on first keystroke in the text box.')}
      </p>
    </div>
  )
}
