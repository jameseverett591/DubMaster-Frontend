'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Mic2, Trash2, Loader2, Upload, Wand2, Check, AlertTriangle } from 'lucide-react'
import { apiClient, type CustomVoice } from '@/lib/api-client'
import { useEditorStore } from '@/lib/editor-store'

interface TestClipsPanelProps {
  jobId?: string
  /** Index of the currently selected segment, for the per-segment apply. */
  selectedSegmentIndex: number | null
  /** Mirrors VoiceLibraryPanel: the editor pushes the voice to every segment
   *  belonging to this speaker on the backend. */
  onVoiceAssigned?: (speakerId: string, voiceId: string) => void
  /** Applies a voice to the selected segment only, leaving the speaker alone. */
  onApplyToSegment?: (segmentIndex: number, voiceId: string) => void
}

/**
 * Test Clips — the panel for voices cloned from an uploaded sample.
 *
 * These voices exist only as an id: the uploaded audio is streamed straight to
 * Fish Audio and never stored on our side, so there is no preview clip to play
 * and no local file to point at. That is why they cannot live in the catalog
 * grid, which is built around preview_url and paging, and why they get their
 * own panel: create, assign, delete.
 */
export function TestClipsPanel({
  jobId,
  selectedSegmentIndex,
  onVoiceAssigned,
  onApplyToSegment,
}: TestClipsPanelProps) {
  const { segments, speakerVoiceMap, updateSpeakerVoice, pulseSpeaker } = useEditorStore()

  const [voices, setVoices] = useState<CustomVoice[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Create
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [cloning, setCloning] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Per-row transient UI
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Record<string, string>>({})

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setVoices(await apiClient.getCustomVoices())
    } catch {
      setError('Could not load your cloned voices.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // Same 15 slots the voice library offers, so a voice can be pinned to a
  // numbered speaker before that character has any segments.
  const speakers = useMemo(() => {
    const seen = new Set<string>()
    const out: Array<{ speaker_id: string; display_name: string }> = []
    for (const seg of segments) {
      if (seen.has(seg.speaker_id)) continue
      seen.add(seg.speaker_id)
      const digits = seg.speaker_id.match(/\d+/)?.[0]
      out.push({
        speaker_id: seg.speaker_id,
        display_name: digits ? `Speaker ${digits}` : (seg.speaker_label ?? seg.speaker_id),
      })
    }
    for (let i = 1; out.length < 15; i++) {
      const id = `speaker-${i}`
      if (!seen.has(id)) { seen.add(id); out.push({ speaker_id: id, display_name: `Speaker ${i}` }) }
    }
    return out.sort((a, b) => {
      const na = parseInt(a.speaker_id.match(/\d+/)?.[0] ?? '999', 10)
      const nb = parseInt(b.speaker_id.match(/\d+/)?.[0] ?? '999', 10)
      return na - nb
    })
  }, [segments])

  const flash = useCallback((voiceId: string, msg: string) => {
    setFeedback(prev => ({ ...prev, [voiceId]: msg }))
    setTimeout(() => setFeedback(prev => { const n = { ...prev }; delete n[voiceId]; return n }), 2500)
  }, [])

  const handleCreate = useCallback(async () => {
    if (!file) return
    setCloning(true)
    setError(null)
    try {
      const created = await apiClient.cloneVoice(file, name.trim() || file.name.replace(/\.[^.]+$/, ''))
      setFile(null)
      setName('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      await refresh()
      flash(created.voice_id, 'Created')
    } catch (e: any) {
      setError(e?.message || 'Voice cloning failed.')
    } finally {
      setCloning(false)
    }
  }, [file, name, refresh, flash])

  // Mirrors handleAssign in the voice library: store, pulse, editor callback,
  // then persist the mapping so a reload keeps it.
  const handleAssign = useCallback(async (voiceId: string, speakerId: string) => {
    if (!speakerId) return
    setBusyId(voiceId)
    try {
      updateSpeakerVoice(speakerId, voiceId)
      pulseSpeaker(speakerId)
      onVoiceAssigned?.(speakerId, voiceId)
      if (jobId) {
        try { await apiClient.updateVoiceMapping(jobId, { ...speakerVoiceMap, [speakerId]: voiceId }) } catch {}
      }
      const sp = speakers.find(s => s.speaker_id === speakerId)
      flash(voiceId, `Assigned to ${sp?.display_name ?? speakerId}`)
    } finally {
      setBusyId(null)
    }
  }, [jobId, speakerVoiceMap, updateSpeakerVoice, pulseSpeaker, onVoiceAssigned, speakers, flash])

  const handleDelete = useCallback(async (v: CustomVoice) => {
    setBusyId(v.voice_id)
    try {
      await apiClient.deleteCustomVoice(v.voice_id, v.provider)
      setConfirmDelete(null)
      await refresh()
    } catch {
      setError('Could not delete that voice.')
    } finally {
      setBusyId(null)
    }
  }, [refresh])

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      {/* Create */}
      <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Mic2 className="h-4 w-4 text-[#A855F7]" />
          <h3 className="text-sm font-semibold text-slate-200">Create a voice from a clip</h3>
        </div>
        <p className="text-xs text-slate-500">
          10&ndash;30 seconds of clean, single-speaker speech (WAV or MP3) &mdash; no music
          or background noise. The clip is sent straight to the cloning service and is
          not stored here, so keep your own copy if you may want to re-clone it.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
  /** Re-apply a voice to every speaker already mapped to it.
   *
   *  One cloned voice commonly covers several numbered speakers (the same actor
   *  detected as two speakers, a character split across a scene). Assigning them
   *  one at a time means remembering which numbers share the voice and repeating
   *  the same click. Sequential, not parallel: each call regenerates a speaker's
   *  segments server-side, and firing several at once would have them racing to
   *  rewrite the same segments.json.
   *
   *  Chunk-scoped, because applyVoiceToSpeaker is — this covers the window under
   *  review, not the whole film. */
  const handleApplyToAll = useCallback(async (voiceId: string, speakerIds: string[]) => {
    if (speakerIds.length === 0) return
    setBusyId(voiceId)
    try {
      for (const sid of speakerIds) {
        updateSpeakerVoice(sid, voiceId)
        pulseSpeaker(sid)
        onVoiceAssigned?.(sid, voiceId)
        // eslint-disable-next-line no-await-in-loop
        await new Promise(r => setTimeout(r, 0))
      }
      if (jobId) {
        const next = { ...speakerVoiceMap }
        speakerIds.forEach(sid => { next[sid] = voiceId })
        try { await apiClient.updateVoiceMapping(jobId, next) } catch {}
      }
      flash(voiceId, `Applied to ${speakerIds.length} speaker${speakerIds.length === 1 ? '' : 's'} in this window`)
    } finally {
      setBusyId(null)
    }
  }, [jobId, speakerVoiceMap, updateSpeakerVoice, pulseSpeaker, onVoiceAssigned, flash])

          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <Button variant="outline" size="sm"
          onClick={() => fileInputRef.current?.click()}
          className="w-full h-9 text-xs border-slate-700 text-slate-300">
          <Upload className="h-3.5 w-3.5 mr-1.5" />
          {file ? file.name : 'Choose an audio clip'}
        </Button>
        <Input value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Name this voice (e.g. Middle-aged woman, heavy accent)"
          className="h-9 text-xs bg-slate-900 border-slate-700" />
        <Button size="sm" disabled={!file || cloning}
          onClick={handleCreate}
          className="w-full h-9 text-xs bg-amber-600 hover:bg-amber-700 text-white">
          {cloning
            ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Cloning&hellip;</>
            : <><Wand2 className="h-3.5 w-3.5 mr-1.5" />Create voice</>}
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-800/60 bg-red-950/40 p-2.5 text-xs text-red-300">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* List */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Your cloned voices {voices.length > 0 && `(${voices.length})`}
        </h3>

        {loading && voices.length === 0 && (
          <div className="flex items-center justify-center h-20 text-slate-500 text-xs">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />Loading&hellip;
          </div>
        )}

        {!loading && voices.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-700 p-4 text-center text-xs text-slate-500">
            No cloned voices yet &mdash; upload a clip above to create one.
          </div>
        )}

        {voices.map(v => {
          const assignedMatches = speakers.filter(s => speakerVoiceMap[s.speaker_id] === v.voice_id)
          const assignedSpeakers = assignedMatches.map(s => s.display_name)
          const assignedIds = assignedMatches.map(s => s.speaker_id)
          const busy = busyId === v.voice_id
          return (
            <div key={v.voice_id}
              className="rounded-lg border border-amber-500/20 bg-[#08131D]/90 p-3 space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-amber-300 truncate">{v.name}</div>
                  <div className="text-[10px] text-slate-500">
                    {v.provider === 'fish-audio' ? 'Fish Audio' : 'ElevenLabs'} &middot; cloned
                    {assignedSpeakers.length > 0 && ` · ${assignedSpeakers.join(', ')}`}
                  </div>
                </div>
                {confirmDelete === v.voice_id ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="sm" disabled={busy}
                      onClick={() => handleDelete(v)}
                      className="h-7 px-2 text-[10px] bg-red-700 hover:bg-red-800 text-white">
                      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Delete'}
                    </Button>
                    <Button size="sm" variant="ghost"
                      onClick={() => setConfirmDelete(null)}
                      className="h-7 px-2 text-[10px] text-slate-400">
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <button type="button"
                    title="Delete this voice — permanent"
                    aria-label={`Delete ${v.name}`}
                    onClick={() => setConfirmDelete(v.voice_id)}
                    className="shrink-0 text-slate-600 hover:text-red-400 transition-colors">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>

              {confirmDelete === v.voice_id && (
                <p className="text-[10px] text-red-300/80">
                  This removes the cloned model permanently. It cannot be recovered
                  without the original clip.
                </p>
              )}

              <div className="flex items-center gap-2">
                <select
                  aria-label={`Assign ${v.name} to a speaker`}
                  value=""
                  disabled={busy}
                  onChange={(e) => { const sid = e.target.value; e.target.value = ''; handleAssign(v.voice_id, sid) }}
                  className="flex-1 h-8 px-2 text-xs rounded bg-slate-900 border border-slate-700 text-slate-200">
                  <option value="">Assign to speaker&hellip;</option>
                  {speakers.map(s => (
                    <option key={s.speaker_id} value={s.speaker_id}>
                      {s.display_name}
                      {speakerVoiceMap[s.speaker_id] === v.voice_id ? ' ✓' : ''}
                    </option>
                  ))}
                </select>
                <Button size="sm" variant="outline"
                  disabled={selectedSegmentIndex === null || busy || !onApplyToSegment}
                  title={selectedSegmentIndex === null
                    ? 'Select a segment first'
                    : 'Use this voice for the selected segment only'}
                  onClick={() => {
                    if (selectedSegmentIndex === null) return
                    onApplyToSegment?.(selectedSegmentIndex, v.voice_id)
                    flash(v.voice_id, 'Applied to segment')
                  }}
                  className="h-8 text-xs border-slate-700 text-slate-300 shrink-0">
                  This segment
                </Button>
              </div>

              {feedback[v.voice_id] && (
                <div className="flex items-center gap-1 text-[10px] text-emerald-400">
                  <Check className="h-3 w-3" />{feedback[v.voice_id]}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
                  data-role="apply-segment"
              {assignedIds.length > 0 && (
                <Button size="sm" variant="outline"
                  disabled={busy}
                  title={`Re-render every segment belonging to ${assignedSpeakers.join(', ')} with this voice, within the window you are reviewing.`}
                  onClick={() => handleApplyToAll(v.voice_id, assignedIds)}
                  className="w-full h-8 text-xs border-emerald-700/60 text-emerald-300 hover:bg-emerald-500/10">
                  {busy
                    ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Applying…</>
                    : `Apply to all ${assignedIds.length} speaker${assignedIds.length === 1 ? '' : 's'}`}
                </Button>
              )}

