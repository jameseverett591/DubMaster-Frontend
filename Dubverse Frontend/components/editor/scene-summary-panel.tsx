'use client'

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { useEditorStore } from '@/lib/editor-store'
import { apiClient, type SceneSummary, type VideoNotes, type VideoNotesPreset } from '@/lib/api-client'
import { formatTime } from '@/lib/editor-types'
import { useT } from '@/lib/use-t'
import { ListVideo, RefreshCw, Sparkles } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// ---------------------------------------------------------------------------
// SummaryPanel — whole-video summary rendered as a readable document,
// modeled on videotranscriber.ai's panel: a title, prose chapter sections
// whose [MM:SS] markers link into the timeline, and a key-moments table.
//
// Provider: VideoTranscriber.ai (their transcription + chapters pipeline —
// no Claude in that path). While their task runs the endpoint returns
// {status:"processing"} and we poll it. If VT is unavailable or fails, the
// backend falls back to the built-in summarizer over our own transcript.
// ---------------------------------------------------------------------------

const PRESETS: { id: VideoNotesPreset; label: string; hint: string }[] = [
  { id: 'smart',        label: "Director's Notes", hint: 'Who wants what, and what each line is doing' },
  { id: 'summary',      label: 'Summary',          hint: 'Structured overview, highlights, key beats' },
  { id: 'core_points',  label: 'Core Points',      hint: 'Main arguments, decisions, details' },
  { id: 'chapters',     label: 'Chapter Summary',  hint: 'Organized into titled chapters' },
  { id: 'study_notes',  label: 'Study Notes',      hint: 'Clear notes for learning and review' },
]

const TIMESTAMP_RE = /\[(\d{1,2}):(\d{2})(?:-(\d{1,2}):(\d{2}))?\]/g

const STAGE_LABELS: Record<string, string> = {
  submitted:   'Sending the film to Video Transcriber AI…',
  queued:      'Queued — waiting for their pipeline…',
  processing:  'Transcribing and building chapters…',
  pending:     'Transcribing and building chapters…',
  running:     'Transcribing and building chapters…',
  polling:     'Checking progress…',
}

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
          className="text-sky-400 hover:text-sky-300 font-mono text-[10px] transition-colors"
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

function ProviderChip({ provider }: { provider?: string }) {
  if (provider === 'videotranscriber') {
    return (
      <span className="inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
        <Sparkles className="h-2.5 w-2.5" /> Video Transcriber AI
      </span>
    )
  }
  if (provider === 'deepgram') {
    return (
      <span className="inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300">
        <Sparkles className="h-2.5 w-2.5" /> Deepgram
      </span>
    )
  }
  if (provider === 'claude') {
    return (
      <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/30 text-violet-300">
        DubMaster AI
      </span>
    )
  }
  return null
}

export function SceneSummaryPanel() {
  const t = useT()
  const {
    selectedSegmentIndex, segments, jobId, title,
    selectSegment, setCurrentTime, setIsPlaying,
  } = useEditorStore()

  const segment = selectedSegmentIndex !== null ? segments[selectedSegmentIndex] : null

  const [preset, setPreset] = useState<VideoNotesPreset>('summary')
  const [notes, setNotes] = useState<VideoNotes | null>(null)
  const [notesLoading, setNotesLoading] = useState(false)
  const notesJobRef = useRef<string | null>(null)
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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
      if (result.status === 'processing') {
        const wait = Math.min(Math.max(result.retry_after ?? 4, 2), 15) * 1000
        pollTimer.current = setTimeout(() => loadNotes(p), wait)
        return
      }
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

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!jobId) return
    if (notesJobRef.current !== jobId) {
      notesJobRef.current = jobId
      setNotes(null)
    }
    if (pollTimer.current) clearTimeout(pollTimer.current)
    loadNotes(preset)
    return () => { if (pollTimer.current) clearTimeout(pollTimer.current) }
  }, [jobId, preset])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setSummary(null)
    if (segment) loadSegmentSummary()
  }, [segment?.id])

  const processing = notes?.status === 'processing'
  const ok = notes?.status === 'ok'
  const chapters = notes?.chapters ?? []

  return (
    <div className="flex flex-col min-h-0 h-full bg-neutral-950">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-800 shrink-0">
        <ListVideo className="h-3.5 w-3.5 text-sky-400 shrink-0" />
        <span className="text-xs font-semibold text-white tracking-wide">{t('Summary')}</span>
        <ProviderChip provider={notes?.provider} />
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
          disabled={notesLoading || processing}
          title={t('Regenerate')}
          className="p-1.5 rounded-md border border-neutral-700 text-slate-400 hover:text-white hover:border-neutral-500 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${notesLoading || processing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-5 py-5 flex flex-col gap-5">

          {/* Vendor task in flight */}
          {processing && (
            <div className="rounded-xl border border-sky-500/25 bg-sky-500/5 p-4">
              <div className="flex items-center gap-2.5">
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-60" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-sky-400" />
                </span>
                <p className="text-xs font-medium text-sky-200">
                  {t(STAGE_LABELS[notes?.stage ?? ''] ?? 'Video Transcriber AI is working…')}
                </p>
              </div>
              <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">
                {t('Feature-length films take a few minutes — this fills in automatically when their pipeline finishes.')}
              </p>
              <div className="mt-3 h-1 rounded-full bg-neutral-800 overflow-hidden">
                <div className="h-full w-1/3 rounded-full bg-sky-400/60 animate-pulse" />
              </div>
            </div>
          )}

          {/* First-load skeleton */}
          {notesLoading && !notes && !processing && (
            <div className="flex flex-col gap-3 animate-pulse">
              <div className="h-4 w-56 rounded bg-slate-800" />
              <div className="h-20 rounded-lg bg-slate-800" />
              <div className="h-20 rounded-lg bg-slate-800" />
            </div>
          )}

          {/* Error / unavailable */}
          {notes && (notes.status === 'error' || notes.status === 'skipped') && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-6 text-center">
              <ListVideo className="h-5 w-5 text-slate-600 mx-auto mb-2" />
              <p className="text-sm text-slate-400 leading-relaxed">
                {notes.reason === 'insufficient_quota'
                  ? t('Video Transcriber AI quota is exhausted — top up API quota on their dashboard to resume.')
                  : notes.reason === 'exceeds_max_minutes'
                  ? t('This film exceeds the current Video Transcriber AI length cap.')
                  : notes.reason === 'no_api_key'
                  ? t('AI summaries are not configured for this environment.')
                  : t('Summary unavailable for this job.')}
              </p>
              <button
                type="button"
                onClick={() => loadNotes(preset)}
                className="mt-3 text-[11px] font-medium px-3 py-1.5 rounded-md border border-neutral-600 text-slate-300 hover:border-neutral-400 hover:text-white transition-colors"
              >
                {t('Try again')}
              </button>
            </div>
          )}

          {ok && (
            <>
              {/* Document title */}
              <div>
                <h2 className="text-2xl font-bold text-white leading-snug">
                  {notes.video_title || title || t('Video Summary')}
                </h2>
                <div className="flex items-center gap-3 mt-1.5 text-[10px] text-slate-500">
                  <ProviderChip provider={notes.provider} />
                  {chapters.length > 0 && <span>{chapters.length} {t('sections')}</span>}
                </div>
              </div>

              {/* Prose sections — first three boxed in soft blue, the rest plain */}
              <div className="rounded-xl border border-sky-400/30 bg-sky-500/10 p-4 flex flex-col gap-5">
                {chapters.slice(0, 3).map((c, i) => (
                  <section key={i}>
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <h3
                        className="text-sm font-semibold text-sky-300 leading-snug"
                        style={{ WebkitTextStroke: '0.6px rgba(0,0,0,0.9)' }}
                      >
                        {c.title}
                      </h3>
                      {c.start !== null && (
                        <button
                          type="button"
                          onClick={() => seekTo(c.start!)}
                          className="text-[10px] font-mono text-sky-400/80 hover:text-sky-300 transition-colors"
                        >
                          [{mmss(c.start)}{c.end !== null ? `–${mmss(c.end)}` : ''}]
                        </button>
                      )}
                    </div>
                    <p className="text-[13px] text-slate-300 leading-[1.75] mt-1.5">
                      <LinkedSummary text={c.summary} onSeek={seekTo} />
                    </p>
                  </section>
                ))}
              </div>
              {chapters.length > 3 && (
                <div className="flex flex-col gap-5">
                  {chapters.slice(3).map((c, i) => (
                    <section key={i + 3}>
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <h3
                          className="text-sm font-semibold text-sky-300 leading-snug"
                          style={{ WebkitTextStroke: '0.6px rgba(0,0,0,0.9)' }}
                        >
                          {c.title}
                        </h3>
                        {c.start !== null && (
                          <button
                            type="button"
                            onClick={() => seekTo(c.start!)}
                            className="text-[10px] font-mono text-sky-400/80 hover:text-sky-300 transition-colors"
                          >
                            [{mmss(c.start)}{c.end !== null ? `–${mmss(c.end)}` : ''}]
                          </button>
                        )}
                      </div>
                      <p className="text-[13px] text-slate-300 leading-[1.75] mt-1.5">
                        <LinkedSummary text={c.summary} onSeek={seekTo} />
                      </p>
                    </section>
                  ))}
                </div>
              )}

              {/* Key moments table — brass plate with rivets */}
              {chapters.length > 0 && (
                <section>
                  <h3 className="text-sm font-semibold text-sky-300 mb-2">{t('Key Moments')}</h3>
                  <div className="relative rounded-lg border-2 border-[#8a6d3b] bg-gradient-to-b from-[#4a3a1c] via-[#352a12] to-[#2a2110] overflow-hidden shadow-[inset_0_1px_0_rgba(255,220,150,0.25),0_2px_8px_rgba(0,0,0,0.5)]">
                    {/* corner rivets */}
                    {['top-1.5 left-1.5', 'top-1.5 right-1.5', 'bottom-1.5 left-1.5', 'bottom-1.5 right-1.5'].map(pos => (
                      <span
                        key={pos}
                        className={`absolute ${pos} h-1.5 w-1.5 rounded-full bg-gradient-to-br from-[#f0d890] via-[#a8894a] to-[#5c4a22] shadow-[inset_0_-1px_1px_rgba(0,0,0,0.6)]`}
                      />
                    ))}
                    <div className="grid grid-cols-[72px_1fr] bg-gradient-to-r from-[#6b5423]/60 via-[#8a6d3b]/40 to-[#6b5423]/60 px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-[#e8cf8f]">
                      <span>{t('Timestamp')}</span>
                      <span>{t('Key Point')}</span>
                    </div>
                    {chapters.map((c, i) => (
                      <div
                        key={i}
                        className="grid grid-cols-[72px_1fr] px-4 py-2 border-t border-[#8a6d3b]/40 items-start gap-2 bg-gradient-to-r from-transparent via-[#f0d890]/[0.04] to-transparent"
                      >
                        <button
                          type="button"
                          onClick={() => c.start !== null && seekTo(c.start)}
                          className="text-[10px] font-mono text-[#f0d890] hover:text-[#ffe9b0] transition-colors text-left"
                        >
                          [{c.start !== null ? mmss(c.start) : '—'}]
                        </button>
                        <span className="text-[12px] text-amber-100/90 leading-relaxed">{c.title}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Fallback beats feed when the provider returned notes but no chapters */}
              {chapters.length === 0 && (notes.notes ?? []).length > 0 && (
                <div className="flex flex-col">
                  {(notes.notes ?? []).map((n, i) => (
                    <div key={i} className="flex gap-2.5 py-2 border-b border-neutral-800/50 last:border-0">
                      <button
                        type="button"
                        onClick={() => seekTo(n.start)}
                        className="shrink-0 h-fit text-[10px] font-mono text-sky-400 hover:text-sky-300 transition-colors"
                      >
                        [{mmss(n.start)}]
                      </button>
                      <p className="text-[13px] text-slate-300 leading-relaxed">{n.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Selected line context — metallic burgundy plate */}
          {segment && (
            <div className="relative rounded-xl border-2 border-[#6e2438] bg-gradient-to-b from-[#4a1a29] via-[#3a1420] to-[#2a0f18] p-4 overflow-hidden shadow-[inset_0_1px_0_rgba(255,180,200,0.2),0_2px_8px_rgba(0,0,0,0.5)]">
              {/* corner rivets */}
              {['top-1.5 left-1.5', 'top-1.5 right-1.5', 'bottom-1.5 left-1.5', 'bottom-1.5 right-1.5'].map(pos => (
                <span
                  key={pos}
                  className={`absolute ${pos} h-1.5 w-1.5 rounded-full bg-gradient-to-br from-[#f0b8c8] via-[#a04860] to-[#4a1626] shadow-[inset_0_-1px_1px_rgba(0,0,0,0.6)]`}
                />
              ))}
              <div className="text-[10px] font-semibold uppercase tracking-widest text-[#e8a0b4] mb-1.5">
                {t('Selected line')} · {formatTime(segment.start_time)} · {segment.speaker_label ?? segment.speaker_id}
              </div>
              {segLoading && <p className="text-[11px] text-rose-200/60">{t('Reading the scene…')}</p>}
              {!segLoading && summary?.status === 'ok' && (
                <>
                  {summary.scene_beat && (
                    <p className="text-[13px] text-rose-50/90 leading-relaxed">{summary.scene_beat}</p>
                  )}
                  {summary.line_function && (
                    <p className="text-xs mt-1.5">
                      <span className="text-rose-200/50">{t('Function:')} </span>
                      <span className="text-[#f0b8c8] font-medium">{summary.line_function}</span>
                    </p>
                  )}
                  {summary.stakes_tags && summary.stakes_tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {summary.stakes_tags.map(tag => (
                        <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-[#5c2030] border border-[#8a3a50] text-rose-200">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </>
              )}
              {!segLoading && (!summary || summary.status !== 'ok') && (
                <p className="text-[11px] text-rose-200/60">{t('Scene summary unavailable for this segment.')}</p>
              )}
            </div>
          )}

          {!jobId && (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-xs p-6 text-center">
              {t('Load a job to generate a summary.')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
