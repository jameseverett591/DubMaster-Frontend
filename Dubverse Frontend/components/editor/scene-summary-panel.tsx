'use client'

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { useEditorStore } from '@/lib/editor-store'
import { apiClient, type SceneSummary, type VideoNotes, type VideoNotesPreset } from '@/lib/api-client'
import { formatTime } from '@/lib/editor-types'
import { useT } from '@/lib/use-t'
import { ListVideo, RefreshCw } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// ---------------------------------------------------------------------------
// SceneSummaryPanel — Feature A of the Dubbing Studio Platform spec
// (plan-8012dcdb5d41cf3b.md). Plain-English scene context so a director who
// doesn't speak the source language can judge whether a translation serves
// the scene, without needing to know a word of it.
//
// Two artifacts, mirroring the videotranscriber.ai panel:
//   1. AI Notes  — a whole-video feed of timestamped beats; each [MM:SS] chip
//      seeks the playhead and selects the segment under it.
//   2. Chapters  — titled cards whose prose carries inline [MM:SS-MM:SS]
//      links back into the timeline.
// Selecting a segment additionally shows that segment's own Scene Summary
// (scene beat, this line's function, stakes) at the top of the panel.
// ---------------------------------------------------------------------------

const PRESETS: { id: VideoNotesPreset; label: string; hint: string }[] = [
  { id: 'smart',        label: "Director's Notes", hint: 'Who wants what, and what each line is doing' },
  { id: 'summary',      label: 'Summary',          hint: 'Structured overview, highlights, key beats' },
  { id: 'core_points',  label: 'Core Points',      hint: 'Main arguments, decisions, details' },
  { id: 'chapters',     label: 'Chapter Summary',  hint: 'Organized into titled chapters' },
  { id: 'study_notes',  label: 'Study Notes',      hint: 'Clear notes for learning and review' },
]

const TIMESTAMP_RE = /\[(\d{1,2}):(\d{2})(?:-(\d{1,2}):(\d{2}))?\]/g

/** Turn a chapter summary's inline [MM:SS] / [MM:SS-MM:SS] markers into
 *  clickable chips that seek the playhead. */
function LinkedSummary({ text, onSeek }: { text: string; onSeek: (t: number) => void }) {
  const parts: { key: number; node: React.ReactNode }[] = []
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  TIMESTAMP_RE.lastIndex = 0
  while ((m = TIMESTAMP_RE.exec(text)) !== null) {
    if (m.index > last) parts.push({ key: key++, node: text.slice(last, m.index) })
    const start = parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
    parts.push({
      key: key++,
      node: (
        <button
          type="button"
          onClick={() => onSeek(start)}
          className="text-amber-400 hover:text-amber-300 font-mono text-[10px] transition-colors"
        >
          [{m[0].slice(1, -1)}]
        </button>
      ),
    })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ key: key++, node: text.slice(last) })
  return <>{parts.map(p => <Fragment key={p.key}>{p.node}</Fragment>)}</>
}

function mmss(t: number): string {
  const s = Math.max(0, Math.floor(t))
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`
}

export function SceneSummaryPanel() {
  const t = useT()
  const {
    selectedSegmentIndex, segments, jobId,
    selectSegment, setCurrentTime, setIsPlaying,
  } = useEditorStore()

  const segment = selectedSegmentIndex !== null ? segments[selectedSegmentIndex] : null

  // Whole-video notes
  const [preset, setPreset] = useState<VideoNotesPreset>('smart')
  const [notes, setNotes] = useState<VideoNotes | null>(null)
  const [notesLoading, setNotesLoading] = useState(false)
  const notesJobRef = useRef<string | null>(null)

  // Per-segment scene summary (the selected segment's own context card)
  const [summary, setSummary] = useState<SceneSummary | null>(null)
  const [segLoading, setSegLoading] = useState(false)

  /** Seek the playhead and select the segment covering that time. */
  const seekTo = useCallback((time: number) => {
    setCurrentTime(time)
    setIsPlaying(false)
    const idx = segments.findIndex(s => s.start_time <= time && time < s.end_time)
    if (idx >= 0) selectSegment(idx)
  }, [segments, selectSegment, setCurrentTime, setIsPlaying])

  async function loadNotes(p: VideoNotesPreset) {
    if (!jobId) return
    setNotesLoading(true)
    try {
      const result = await apiClient.getVideoNotes(jobId, p)
      setNotes(result)
    } catch (err) {
      console.error('[SceneSummaryPanel] video-notes fetch failed:', err)
      setNotes({ status: 'error', reason: 'request_failed' })
    } finally {
      setNotesLoading(false)
    }
  }

  async function loadSegmentSummary() {
    if (!segment || !jobId || segment.transcript_index === undefined) return
    setSegLoading(true)
    try {
      const result = await apiClient.getSceneSummary(jobId, segment.transcript_index)
      setSummary(result)
    } catch (err) {
      console.error('[SceneSummaryPanel] scene-summary fetch failed:', err)
      setSummary({ status: 'error', reason: 'request_failed' })
    } finally {
      setSegLoading(false)
    }
  }

  // Load the notes feed once per job; preset changes regenerate.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!jobId) return
    if (notesJobRef.current !== jobId) {
      notesJobRef.current = jobId
      setNotes(null)
    }
    loadNotes(preset)
  }, [jobId, preset])

  // Per-segment summary follows selection.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setSummary(null)
    if (segment) loadSegmentSummary()
  }, [segment?.id])

  return (
    <div className="flex flex-col min-h-0 h-full">
      {/* Header: title + preset library + regenerate */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-800 shrink-0">
        <ListVideo className="h-3.5 w-3.5 text-violet-400 shrink-0" />
        <span className="text-xs font-semibold text-violet-300 tracking-wide">{t('AI Notes')}</span>
        <div className="flex-1" />
        <Select value={preset} onValueChange={(v) => setPreset(v as VideoNotesPreset)}>
          <SelectTrigger className="h-7 w-36 bg-neutral-900 border-neutral-700 text-[11px] text-slate-300">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRESETS.map(p => (
              <SelectItem key={p.id} value={p.id} title={t(p.hint)}>
                {t(p.label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          type="button"
          onClick={() => loadNotes(preset)}
          disabled={notesLoading}
          title={t('Regenerate notes')}
          className="p-1.5 rounded-md border border-neutral-700 text-slate-400 hover:text-white hover:border-neutral-500 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${notesLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-3">

        {/* Selected segment — its own scene summary card */}
        {segment && (
          <div className="rounded-xl border border-blue-600/40 bg-neutral-900 p-3 shrink-0 shadow-[0_0_14px_rgba(65,105,225,0.35)]">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                {t('Selected line')} · {formatTime(segment.start_time)} · {segment.speaker_label ?? segment.speaker_id}
              </span>
            </div>
            {segLoading && <p className="text-[11px] text-slate-500">{t('Reading the scene…')}</p>}
            {!segLoading && summary?.status === 'ok' && (
              <>
                {summary.scene_beat && (
                  <p className="text-base text-slate-300 leading-relaxed">{summary.scene_beat}</p>
                )}
                {summary.line_function && (
                  <p className="text-xs mt-1.5">
                    <span className="text-slate-500">{t('Function:')} </span>
                    <span className="text-amber-300 font-medium">{summary.line_function}</span>
                  </p>
                )}
                {summary.stakes_tags && summary.stakes_tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {summary.stakes_tags.map(tag => (
                      <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full border border-slate-600 text-slate-400">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}
            {!segLoading && (!summary || summary.status !== 'ok') && (
              <p className="text-[11px] text-slate-500">{t('Scene summary unavailable for this segment.')}</p>
            )}
          </div>
        )}

        {/* Notes feed */}
        {notesLoading && !notes && (
          <div className="flex flex-col gap-3 animate-pulse">
            <div className="h-3 w-40 rounded bg-slate-800" />
            <div className="h-16 rounded-lg bg-slate-800" />
            <div className="h-16 rounded-lg bg-slate-800" />
          </div>
        )}

        {notes && notes.status !== 'ok' && (
          <div className="rounded-xl border border-blue-600/40 bg-neutral-900 p-3 shadow-[0_0_14px_rgba(65,105,225,0.35)]">
            <p className="text-sm text-slate-400 leading-relaxed">
              {notes.reason === 'no_api_key'
                ? t('AI Notes are not configured for this environment.')
                : t('AI Notes are unavailable for this job.')}
            </p>
          </div>
        )}

        {notes?.status === 'ok' && (
          <>
            {notes.video_title && (
              <p className="text-sm font-semibold text-white leading-snug">{notes.video_title}</p>
            )}

            {/* Timestamped beats — the videotranscriber-style feed */}
            <div className="flex flex-col">
              {(notes.notes ?? []).map((n, i) => (
                <div key={i} className="flex gap-2 py-1.5 border-b border-neutral-800/50 last:border-0">
                  <button
                    type="button"
                    onClick={() => seekTo(n.start)}
                    className="shrink-0 h-fit text-[10px] font-mono px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/25 transition-colors"
                  >
                    {mmss(n.start)}
                  </button>
                  <p className="text-sm text-slate-300 leading-relaxed">{n.text}</p>
                </div>
              ))}
            </div>

            {/* Chapter cards */}
            {(notes.chapters ?? []).length > 0 && (
              <div className="flex flex-col gap-2 mt-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {t('Chapter Summary')}
                </span>
                {(notes.chapters ?? []).map((c, i) => (
                  <div key={i} className="rounded-xl border border-blue-600/40 bg-neutral-900 p-3 shadow-[0_0_14px_rgba(65,105,225,0.35)]">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold text-white flex-1">{c.title}</span>
                      {c.start !== null && (
                        <button
                          type="button"
                          onClick={() => seekTo(c.start!)}
                          className="text-[10px] font-mono text-amber-400 hover:text-amber-300 transition-colors"
                        >
                          {mmss(c.start)}{c.end !== null ? `–${mmss(c.end)}` : ''}
                        </button>
                      )}
                    </div>
                    <p className="text-sm text-slate-300 leading-relaxed">
                      <LinkedSummary text={c.summary} onSeek={seekTo} />
                    </p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {!jobId && (
          <div className="flex-1 flex items-center justify-center text-slate-500 text-xs p-6 text-center">
            {t('Load a job to generate AI Notes.')}
          </div>
        )}
      </div>
    </div>
  )
}
