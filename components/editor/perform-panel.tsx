'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Mic2, Search, Loader2, Upload, AlertTriangle, Play, Pause, X } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import type { Segment } from '@/lib/editor-types'
import { cn } from '@/lib/utils'

interface ElevenVoice {
  id: string
  name: string
  gender: string | null
  accent: string | null
  description: string | null
  preview_url: string | null
}

const MODELS = [
  { id: 'eleven_english_sts_v2', label: 'English' },
  { id: 'eleven_multilingual_sts_v2', label: 'Multilingual' },
]

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? ''
}

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00'
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

/** Same compact transport as the Respeecher takes strip: native <audio controls>
 *  is browser chrome and cannot be themed, and its light bar reads as a bright
 *  slab against this panel. */
function ClipPlayer({ src, accent, label }: { src: string; accent: boolean; label: string }) {
  const ref = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [at, setAt] = useState(0)
  const [dur, setDur] = useState(0)

  // Only claim to be playing once play() actually resolves. Setting it
  // optimistically left the button stuck showing pause when the source 404'd.
  const toggle = () => {
    const a = ref.current
    if (!a) return
    if (a.paused) {
      a.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    } else {
      a.pause()
      setPlaying(false)
    }
  }

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = ref.current
    if (!a || !dur) return
    const r = e.currentTarget.getBoundingClientRect()
    a.currentTime = ((e.clientX - r.left) / r.width) * dur
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className={cn(
        'text-[9px] font-mono px-1 py-0.5 rounded shrink-0 w-12 text-center',
        accent ? 'bg-violet-500/25 text-violet-200' : 'bg-slate-800 text-slate-400'
      )}>
        {label}
      </span>
      <audio
        ref={ref}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
        onEnded={() => { setPlaying(false); setAt(0) }}
        onPause={() => setPlaying(false)}
        onError={() => setPlaying(false)}
        className="hidden"
      />
      <button
        type="button"
        onClick={toggle}
        className={cn(
          'shrink-0 h-5 w-5 rounded-full flex items-center justify-center transition-colors',
          accent ? 'bg-violet-500/30 text-violet-200 hover:bg-violet-500/50'
                 : 'bg-slate-700/60 text-slate-300 hover:bg-slate-600'
        )}
      >
        {playing ? <Pause className="h-2.5 w-2.5" /> : <Play className="h-2.5 w-2.5 ml-px" />}
      </button>
      <div onClick={seek} className="flex-1 min-w-0 h-1.5 rounded-full bg-slate-800 cursor-pointer overflow-hidden">
        <div
          className={cn('h-full rounded-full', accent ? 'bg-violet-400' : 'bg-slate-500')}
          style={{ width: `${dur > 0 ? (at / dur) * 100 : 0}%` }}
        />
      </div>
      <span className="shrink-0 text-[9px] font-mono text-slate-500 tabular-nums">
        {fmt(at)}/{fmt(dur)}
      </span>
    </div>
  )
}

export default function PerformPanel({
  segment,
  jobId,
  isRegenerating,
  onPerformed,
}: {
  segment: Segment | null
  jobId: string
  isRegenerating: boolean
  /** Called with the backend's updated segment so the editor can merge it. */
  onPerformed: (updated: Record<string, unknown>) => void
}) {
  const [voices, setVoices] = useState<ElevenVoice[]>([])
  const [loading, setLoading] = useState(true)
  const [enabled, setEnabled] = useState(true)
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [denoise, setDenoise] = useState(true)   // phone/laptop recordings are the norm here
  const [modelId, setModelId] = useState(MODELS[0].id)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  // One shared element for voice auditions — clicking a second voice replaces
  // the first rather than layering two previews over each other.
  const previewRef = useRef<HTMLAudioElement | null>(null)
  const [previewing, setPreviewing] = useState<string | null>(null)
  // Converted audition result — object URL, revoked when replaced.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewVoice, setPreviewVoice] = useState<string | null>(null)

  const togglePreview = useCallback((v: ElevenVoice) => {
    const a = previewRef.current
    if (!a || !v.preview_url) return
    if (previewing === v.id) {
      a.pause()
      setPreviewing(null)
      return
    }
    a.src = v.preview_url
    a.play().then(() => setPreviewing(v.id)).catch(() => setPreviewing(null))
  }, [previewing])

  useEffect(() => {
    let cancelled = false
    apiClient.listElevenLabsVoices()
      .then((d) => { if (!cancelled) { setVoices(d.voices); setEnabled(d.enabled) } })
      .catch(() => { if (!cancelled) setEnabled(false) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Object URLs must be revoked or every re-pick leaks one.
  useEffect(() => {
    if (!file) { setFileUrl(null); return }
    const url = URL.createObjectURL(file)
    setFileUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase()
    if (!n) return voices
    return voices.filter((v) =>
      v.name.toLowerCase().includes(n) ||
      (v.accent ?? '').toLowerCase().includes(n) ||
      (v.description ?? '').toLowerCase().includes(n)
    )
  }, [voices, q])

  const takeFile = useCallback((f: File | null | undefined) => {
    if (!f) return
    setError(null)
    setFile(f)
    // A preview belongs to the clip it was made from — drop it when the clip
    // changes rather than leaving a stale audition playing under a new recording.
    setPreviewUrl((old) => { if (old) URL.revokeObjectURL(old); return null })
    setPreviewVoice(null)
  }, [])

  // Audition: converts and plays back WITHOUT touching the segment, so you can
  // hear a voice on your own read before committing the segment's audio to it.
  const preview = async () => {
    if (!file || !selected) return
    setBusy(true)
    setError(null)
    try {
      const blob = await apiClient.previewSts(file, selected, {
        modelId, removeBackgroundNoise: denoise,
      })
      setPreviewUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(blob) })
      setPreviewVoice(selected)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed')
    } finally {
      setBusy(false)
    }
  }

  const convert = async () => {
    if (!segment || !file || !selected) return
    setBusy(true)
    setError(null)
    try {
      const res = await apiClient.performSegment(
        jobId,
        segment.transcript_index ?? segment.index ?? 0,
        file,
        selected,
        { modelId, removeBackgroundNoise: denoise },
      )
      onPerformed(res.segment)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Conversion failed')
    } finally {
      setBusy(false)
    }
  }

  if (!segment) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 text-xs px-4 text-center">
        Select a segment to drive it with a recording.
      </div>
    )
  }

  const isPerformed = segment.engine === 'elevenlabs-sts'
  const working = busy || isRegenerating

  return (
    <div className="h-full flex flex-col p-3 gap-2.5 text-xs text-slate-300 min-h-0">
      <audio
        ref={previewRef}
        onEnded={() => setPreviewing(null)}
        onPause={() => setPreviewing(null)}
        onError={() => setPreviewing(null)}
        className="hidden"
      />
      {/* ── header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5 text-slate-200 font-medium">
          <Mic2 className="h-3.5 w-3.5 text-violet-400" />
          Perform
        </div>
        {segment.engine && (
          <span className={cn(
            'text-[9px] px-1.5 py-0.5 rounded-full border font-mono shrink-0',
            isPerformed
              ? 'border-violet-400/50 bg-violet-500/15 text-violet-200'
              : 'border-slate-700 bg-slate-800 text-slate-400'
          )}>
            {segment.engine}
          </span>
        )}
      </div>

      {/* The state that must not be missable: text no longer drives the audio. */}
      {isPerformed && (
        <div className="shrink-0 rounded-md border border-violet-500/40 bg-violet-500/10 px-2 py-1.5">
          <p className="text-[10px] text-violet-200 leading-snug">
            Driven by a recording
            {segment.perf_path && (
              <span className="font-mono text-violet-300/80"> ({basename(segment.perf_path)})</span>
            )}
            . The text still sets the subtitle and timing, but changing it will
            not change this audio — replace the recording, or switch engines.
          </p>
        </div>
      )}

      {!enabled && (
        <p className="text-[10px] text-red-400 leading-snug flex gap-1.5 shrink-0">
          <AlertTriangle className="h-3 w-3 shrink-0 mt-px" />
          ElevenLabs is not configured — set ELEVENLABS_API_KEY.
        </p>
      )}

      {/* ── source performance ─────────────────────────────────── */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          takeFile(e.dataTransfer.files?.[0])
        }}
        className={cn(
          'shrink-0 rounded-md border border-dashed px-3 py-3 text-center transition-colors',
          dragging ? 'border-violet-400 bg-violet-500/10' : 'border-slate-700 bg-slate-900/50'
        )}
      >
        {file ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[10px] text-slate-300 truncate flex-1 min-w-0" title={file.name}>
                {file.name}
              </span>
              <button
                type="button"
                onClick={() => setFile(null)}
                title="Remove this recording"
                className="shrink-0 h-4 w-4 rounded flex items-center justify-center text-slate-500 hover:text-red-300"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
            {fileUrl && <ClipPlayer src={fileUrl} accent={false} label="source" />}
          </div>
        ) : (
          <label className="cursor-pointer block">
            <Upload className="h-4 w-4 mx-auto text-slate-500 mb-1" />
            <span className="text-[10px] text-slate-400">
              Drop a recording here, or <span className="text-violet-300 underline">choose a file</span>
            </span>
            <input
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => takeFile(e.target.files?.[0])}
            />
          </label>
        )}
      </div>

      {/* Current audio, so you can compare against what you're replacing.
          Built via getAudioFileUrl: segment.audio_url is a RELATIVE path
          (data/dubbed/...), which an <audio> tag resolves against the page
          origin and 404s on. */}
      {segment.audio_url && (
        <div className="shrink-0">
          <ClipPlayer
            src={apiClient.getAudioFileUrl(jobId, basename(segment.audio_url.split('?')[0]))}
            accent
            label="current"
          />
        </div>
      )}

      {/* The audition: what the segment WOULD sound like, before committing. */}
      {previewUrl && (
        <div className="shrink-0 space-y-0.5">
          <ClipPlayer src={previewUrl} accent label="preview" />
          <p className="text-[9px] text-violet-300/70 pl-[3.4rem]">
            Not applied yet — {voices.find((v) => v.id === previewVoice)?.name ?? previewVoice}
          </p>
        </div>
      )}

      {/* ── split: voices | controls ───────────────────────────── */}
      <div className="flex-1 min-h-0 grid grid-cols-2 gap-2.5 items-stretch">
        <div className="flex flex-col min-h-0 min-w-0 gap-1">
          <div className="relative shrink-0">
            <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-600" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter voices…"
              className="w-full rounded-md border border-slate-800 bg-slate-900/60 pl-6 pr-2 py-1
                         text-[10px] text-slate-200 placeholder:text-slate-600
                         focus:outline-none focus:border-violet-500/60"
            />
          </div>
          {loading && (
            <div className="flex items-center gap-1.5 text-slate-500 text-[10px] py-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading…
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-0.5">
            {shown.map((v) => (
              <div
                key={v.id}
                className={cn(
                  'w-full rounded-md border px-1.5 py-1 transition-colors flex items-center gap-1.5',
                  selected === v.id
                    ? 'border-violet-500/60 bg-violet-500/15 text-violet-100'
                    : 'border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-600 hover:text-white'
                )}
              >
                {/* Audition. Separate from selection so hearing a voice doesn't
                    change which one you're about to convert with. */}
                <button
                  type="button"
                  disabled={!v.preview_url}
                  onClick={(e) => { e.stopPropagation(); togglePreview(v) }}
                  title={v.preview_url ? `Hear ${v.name}` : 'No preview available'}
                  className={cn(
                    'shrink-0 h-4 w-4 rounded-full flex items-center justify-center transition-colors',
                    previewing === v.id
                      ? 'bg-violet-500/40 text-violet-100'
                      : 'bg-slate-700/60 text-slate-300 hover:bg-slate-600 disabled:opacity-30'
                  )}
                >
                  {previewing === v.id
                    ? <Pause className="h-2 w-2" />
                    : <Play className="h-2 w-2 ml-px" />}
                </button>
                <button
                  type="button"
                  onClick={() => setSelected(v.id)}
                  title={`${v.name}${v.accent ? ` — ${v.accent}` : ''}`}
                  className="flex-1 min-w-0 text-left"
                >
                  <span className="block truncate text-[10px]">{v.name}</span>
                  {(v.accent || v.gender) && (
                    <span className="block text-[9px] text-slate-500 truncate">
                      {[v.gender, v.accent].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </button>
              </div>
            ))}
          </div>
          <p className="text-[9px] text-slate-600 leading-snug shrink-0">
            Stock voices only — cloning your own voice needs a paid ElevenLabs plan.
          </p>
        </div>

        <div className="flex flex-col min-h-0 min-w-0 gap-2 overflow-y-auto pr-0.5">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={denoise}
              onChange={(e) => setDenoise(e.target.checked)}
              className="accent-violet-500"
            />
            <span className="text-[10px] text-slate-300">Remove background noise</span>
          </label>
          <p className="text-[9px] text-slate-500 leading-snug -mt-1">
            On by default: phone and laptop recordings carry room tone that would
            otherwise bleed into the converted voice.
          </p>

          <div className="space-y-1">
            <span className="text-[9px] text-slate-500 uppercase tracking-wide">Model</span>
            <div className="flex rounded-md border border-slate-800 overflow-hidden">
              {MODELS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setModelId(m.id)}
                  className={cn(
                    'flex-1 text-[9px] py-1 transition-colors',
                    modelId === m.id
                      ? 'bg-violet-500/25 text-white'
                      : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-[10px] text-red-400 leading-snug">{error}</p>}

          <button
            type="button"
            disabled={!file || !selected || working || !enabled}
            onClick={preview}
            title="Convert and listen without changing the segment"
            className="mt-auto w-full rounded-md border border-violet-400/60 bg-violet-500/10
                       hover:bg-violet-500/20 disabled:opacity-40 disabled:hover:bg-violet-500/10
                       text-violet-100 text-[11px] py-1.5 font-medium transition-colors
                       flex items-center justify-center gap-1.5"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            Preview
          </button>
          <button
            type="button"
            disabled={!file || !selected || working || !enabled}
            onClick={convert}
            className="w-full rounded-md bg-violet-600 hover:bg-violet-500
                       disabled:opacity-40 disabled:hover:bg-violet-600
                       text-white text-[11px] py-1.5 font-medium transition-colors
                       flex items-center justify-center gap-1.5"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mic2 className="h-3 w-3" />}
            {busy ? 'Converting…' : 'Apply to segment'}
          </button>
          {(!file || !selected) && (
            <p className="text-[9px] text-slate-600 text-center -mt-1">
              {!file ? 'Add a recording' : 'Pick a target voice'} to enable
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
