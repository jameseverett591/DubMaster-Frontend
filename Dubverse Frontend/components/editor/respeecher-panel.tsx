'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Mic2, Star, AlertTriangle, Loader2, Play, Pause, Lock, Unlock, RotateCcw, Dices, HelpCircle } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import type { RespeecherVoice } from '@/lib/api-client'
import type { Segment } from '@/lib/editor-types'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/** Hover explainer styled like the write-in chip — cyan on the dark panel blue.
 *  The shared TooltipContent hardcodes its arrow to fill-foreground, so the arrow
 *  is recoloured here with an arbitrary variant rather than by editing the shared
 *  component, which would restyle every tooltip in the app. */
function Hint({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="text-[9px] text-slate-400 hover:text-cyan-200 transition-colors cursor-help select-none">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent
        // Was "left", which opened straight across the voice list and covered it
        // while reading. The sampling column is the right half of a two-column
        // grid, so there is nothing to the left of it but content.
        side="top"
        align="end"
        sideOffset={6}
        collisionPadding={8}
        className="max-w-[230px] rounded-lg border border-cyan-400/50 bg-[#0d1525] px-2 py-1.5 text-[10px] leading-snug text-cyan-200 shadow-lg shadow-cyan-900/30 [&_svg]:fill-[#0d1525] [&_svg]:bg-[#0d1525]"
      >
        {text}
      </TooltipContent>
    </Tooltip>
  )
}

/** Slider-driven params. Ranges are enforced by the API, which 400s naming the
 *  offending field — these bounds mirror the documented ones exactly so an
 *  invalid request can't be built in the first place. `top_k` is excluded: it is
 *  an integer with a disjoint domain (-1 or > 0), so it gets a number input. */
const PARAM_SPECS: Array<{
  key: string; label: string; min: number; max: number; step: number; hint: string
}> = [
  { key: 'temperature', label: 'Temperature', min: 0, max: 2, step: 0.05,
    hint: 'Expressiveness. Low = steady and repeatable; high = more emotive but can wobble. The main dial worth moving.' },
  { key: 'top_p', label: 'Top P', min: 0.01, max: 1, step: 0.01,
    hint: 'Narrows each choice to the likeliest options. Lower = safer, more neutral delivery.' },
  { key: 'min_p', label: 'Min P', min: 0, max: 1, step: 0.01,
    hint: 'Rejects options far less likely than the best one. Higher = more conservative.' },
  { key: 'repetition_penalty', label: 'Repetition', min: 1, max: 2, step: 0.01,
    hint: 'Discourages repeating recent sounds. Raise if you hear a stutter or looped syllable.' },
  { key: 'presence_penalty', label: 'Presence', min: 0, max: 2, step: 0.05,
    hint: 'Discourages reusing anything already used. Rarely useful for speech.' },
  { key: 'frequency_penalty', label: 'Frequency', min: 0, max: 2, step: 0.05,
    hint: 'Like Presence, but scaled by how often. Rarely useful for speech.' },
]

const TOP_K_HINT = 'Hard cap on how many options are considered. −1 = no cap. Blunter than Top P; usually leave at −1.'

const FALLBACK_DEFAULTS: Record<string, number> = {
  temperature: 0.4, top_p: 0.8, min_p: 0, repetition_penalty: 1.25,
  presence_penalty: 0, frequency_penalty: 0, top_k: -1,
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? ''
}

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00'
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

/** Compact take player.
 *
 *  Native <audio controls> cannot be themed — the control strip is browser
 *  chrome, and the only lever is a filter hack that inverts the whole widget.
 *  Its default light bar reads as a bright slab against this panel, so the
 *  transport is rebuilt here: a hidden <audio> element driven by a styled
 *  button and a click-to-seek bar.
 *
 *  preload="metadata" so the duration is known before playback — the native
 *  players sat at 0:00 / 0:00 until pressed, which read as broken. */
function TakePlayer({ src, accent }: { src: string; accent: boolean }) {
  const ref = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [at, setAt] = useState(0)
  const [dur, setDur] = useState(0)

  const toggle = () => {
    const a = ref.current
    if (!a) return
    if (a.paused) { void a.play(); setPlaying(true) } else { a.pause(); setPlaying(false) }
  }

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = ref.current
    if (!a || !dur) return
    const r = e.currentTarget.getBoundingClientRect()
    a.currentTime = ((e.clientX - r.left) / r.width) * dur
  }

  const pct = dur > 0 ? (at / dur) * 100 : 0

  return (
    <div className="flex items-center gap-1.5 flex-1 min-w-0">
      <audio
        ref={ref}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
        onEnded={() => { setPlaying(false); setAt(0) }}
        className="hidden"
      />
      <button
        type="button"
        onClick={toggle}
        className={cn(
          'shrink-0 h-5 w-5 rounded-full flex items-center justify-center transition-colors',
          accent
            ? 'bg-teal-500/30 text-teal-200 hover:bg-teal-500/50'
            : 'bg-slate-700/60 text-slate-300 hover:bg-slate-600'
        )}
      >
        {playing ? <Pause className="h-2.5 w-2.5" /> : <Play className="h-2.5 w-2.5 ml-px" />}
      </button>
      <div
        onClick={seek}
        className="flex-1 min-w-0 h-1.5 rounded-full bg-slate-800 cursor-pointer overflow-hidden"
      >
        <div
          className={cn('h-full rounded-full', accent ? 'bg-teal-400' : 'bg-slate-500')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 text-[9px] font-mono text-slate-500 tabular-nums">
        {fmt(at)}/{fmt(dur)}
      </span>
    </div>
  )
}

export default function RespeecherPanel({
  segment,
  jobId,
  isRegenerating,
  onGenerate,
  onUseFish,
}: {
  segment: Segment | null
  jobId: string
  isRegenerating: boolean
  /** seed === null means re-roll: race fresh takes and harvest a new seed. */
  onGenerate: (voiceId: string, samplingParams: Record<string, number>, seed: number | null) => void
  /** Re-render this segment on Fish, using the speaker's mapped Fish voice. */
  onUseFish: () => void
}) {
  const [voices, setVoices] = useState<RespeecherVoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [params, setParams] = useState<Record<string, number>>(FALLBACK_DEFAULTS)
  const [seed, setSeed] = useState<number | null>(null)
  const [locked, setLocked] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiClient.listRespeecherVoices()
      .then((v) => { if (!cancelled) { setVoices(v); setError(null) } })
      .catch((e) => { if (!cancelled) setError(e?.message ?? 'Could not load voices') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const defaultsFor = useCallback((voiceId: string | null): Record<string, number> => {
    const v = voices.find((x) => x.id === voiceId)
    return { ...FALLBACK_DEFAULTS, ...(v?.sampling_params ?? {}) }
  }, [voices])

  // Hydrate from whatever this segment last rendered with, so reopening the panel
  // shows the settings that produced the audio you're hearing rather than defaults.
  useEffect(() => {
    const stored = segment?.respeecher_sampling_params
    const storedSeed = segment?.respeecher_seed
    if (stored && Object.keys(stored).length) {
      const { seed: s, ...rest } = stored as Record<string, number>
      setParams((p) => ({ ...p, ...rest }))
    }
    if (typeof storedSeed === 'number') { setSeed(storedSeed); setLocked(true) }
    else { setLocked(false) }
  }, [segment?.id, segment?.respeecher_seed, segment?.respeecher_sampling_params])

  // Preselect the voice this segment last rendered with. Without it Generate sits
  // disabled on "Pick a voice to enable", and the only click that enables it also
  // runs pickVoice — which would overwrite the sampling params hydrated above with
  // the newly picked voice's defaults. The restored seed would then be replayed
  // under different params, which does NOT reproduce the take it was recorded for.
  // Note this sets `selected` only; params are deliberately left as hydrated.
  // Sourced from the seed history rather than the segment's voice_id: the editor's
  // Segment carries committed_voice_id (a Fish reference) and the loader never maps
  // the backend's voice_id at all, so history[0] — the most recent take — is the
  // only place the Respeecher voice actually reaches the client.
  useEffect(() => {
    if (!segment || !voices.length) return
    const candidate = segment.respeecher_seed_history?.[0]?.voice
    if (candidate && voices.some((x) => x.id === candidate)) setSelected(candidate)
  }, [segment?.id, segment?.respeecher_seed_history, voices])

  const grouped = useMemo(() => {
    const out: Record<string, RespeecherVoice[]> = {}
    for (const v of voices) (out[v.gender ?? 'other'] ??= []).push(v)
    for (const k of Object.keys(out)) {
      out[k].sort((a, b) => Number(b.is_best) - Number(a.is_best) || a.id.localeCompare(b.id))
    }
    return out
  }, [voices])

  if (!segment) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 text-xs px-4 text-center">
        Select a segment to generate it with Respeecher.
      </div>
    )
  }

  const lastEngine = segment.engine
  const takes = segment.respeecher_takes ?? []
  const fits = segment.respeecher_fits
  const topK = params.top_k ?? -1

  const pickVoice = (id: string) => {
    // Re-clicking the current voice is a no-op. It used to reset params, so the
    // click that enables Generate also discarded the tuning being enabled.
    if (id === selected) return
    setSelected(id)
    setParams(defaultsFor(id))   // each voice ships its own tuning
    // A seed reproduces its take only under the voice and params it was raced
    // on — the three are one unit. Carrying the pin across a voice change would
    // leave the panel promising a reproduction it cannot deliver, so drop it and
    // let the next generate race fresh seeds for this voice.
    setSeed(null)
    setLocked(false)
  }

  const resetAll = () => {
    setParams(defaultsFor(selected))
    setSeed(null)
    setLocked(false)
  }

  return (
    // Fills the pane and manages its own scrolling: the tuning column stays put
    // while the voice list scrolls, so the controls never slide out of reach.
    <div className="h-full flex flex-col p-3 gap-2.5 text-xs text-slate-300 min-h-0">
      {/* ── header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 text-slate-200 font-medium min-w-0">
          <Mic2 className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
          Respeecher
          {/* Always rendered, never gated on the segment's stored engine: that
              field only exists once a segment has been regenerated, so gating it
              hid the control on every segment that most needs it. */}
          <button
            onClick={onUseFish}
            disabled={isRegenerating}
            title="Re-render this segment on Fish Audio using the speaker's mapped voice"
            className="shrink-0 text-[9px] px-2 py-0.5 rounded-full border border-teal-400/60
                       bg-teal-500/25 text-white font-medium
                       hover:bg-teal-500/40 hover:border-teal-300
                       disabled:opacity-40 disabled:hover:bg-teal-500/25 transition-colors"
          >
            Fish Audio
          </button>
        </div>
        {lastEngine && (
          <span
            title="The engine that rendered this segment"
            className={cn(
              'text-[9px] px-1.5 py-0.5 rounded-full border font-mono shrink-0',
              lastEngine === 'respeecher'
                ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-200'
                : 'border-slate-700 bg-slate-800 text-slate-400'
            )}
          >
            {lastEngine}
          </span>
        )}
      </div>

      {lastEngine === 'fish-audio' && (
        <p className="text-[10px] text-amber-400/90 leading-snug flex gap-1.5 shrink-0">
          <AlertTriangle className="h-3 w-3 shrink-0 mt-px" />
          Last rendered on Fish. Child speakers always fall back — Respeecher has no child voice.
        </p>
      )}
      {fits === false && (
        <p className="text-[10px] text-red-400 leading-snug flex gap-1.5 shrink-0">
          <AlertTriangle className="h-3 w-3 shrink-0 mt-px" />
          Best take overruns the slot beyond clean time-stretch. Shorten the line.
        </p>
      )}

      {/* ── takes ──────────────────────────────────────────────── */}
      {takes.length > 0 && (
        <div className="space-y-1 shrink-0">
          <div className="text-[9px] text-slate-500 uppercase tracking-wide">
            Takes — first is live
          </div>
          {takes.map((p, i) => (
            <div key={p} className="flex items-center gap-1.5">
              <span className={cn(
                'text-[9px] font-mono px-1 py-0.5 rounded shrink-0',
                i === 0 ? 'bg-cyan-500/20 text-cyan-300' : 'bg-slate-800 text-slate-500'
              )}>
                {i === 0 ? 'live' : `alt${i}`}
              </span>
              <TakePlayer
                src={apiClient.getAudioFileUrl(jobId, basename(p))}
                accent={i === 0}
              />
            </div>
          ))}
        </div>
      )}

      {/* ── split: voices | tuning ─────────────────────────────── */}
      <div className="flex-1 min-h-0 grid grid-cols-2 gap-2.5 items-stretch">

        {/* left — voices (the only thing that scrolls) */}
        <div className="flex flex-col min-h-0 min-w-0 gap-1">
          <div className="text-[9px] text-slate-500 uppercase tracking-wide">Voice</div>
          {showHelp && (
            <p className="text-[9px] text-slate-400 leading-snug rounded-md border border-slate-800 bg-slate-900/60 p-1.5">
              <span className="text-amber-400">★</span> = Respeecher&apos;s recommended
              voices — start there. Cast on gender and accent. Names sharing a first
              word (Victoria / Vic) are <span className="text-slate-200">registers of one
              performer</span>, not different people. Audition with Re-roll rather than
              guessing.
            </p>
          )}
          {loading && (
            <div className="flex items-center gap-1.5 text-slate-500 text-[10px] py-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading…
            </div>
          )}
          {error && <p className="text-[10px] text-red-400 leading-snug">{error}</p>}
          {!loading && !error && voices.length === 0 && (
            <p className="text-[10px] text-slate-500">No voices. Check RESPEECHER_API_KEY.</p>
          )}
          <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-1">
            {Object.entries(grouped).map(([gender, list]) => (
              <div key={gender} className="space-y-0.5">
                <div className="text-[9px] text-slate-600 uppercase tracking-wider pt-1">{gender}</div>
                {list.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => pickVoice(v.id)}
                    title={`${v.full_name || v.id}${v.accent ? ` — ${v.accent}` : ''}`}
                    className={cn(
                      'w-full text-left rounded-md border px-1.5 py-1 transition-colors',
                      selected === v.id
                        ? 'border-cyan-500/60 bg-cyan-500/15 text-cyan-200'
                        : 'border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-600 hover:text-white'
                    )}
                  >
                    <span className="flex items-center gap-1 min-w-0">
                      {v.is_best && <Star className="h-2.5 w-2.5 text-amber-400 shrink-0" />}
                      <span className="truncate text-[10px]">{v.full_name || v.id}</span>
                    </span>
                    {v.accent && (
                      <span className="block text-[9px] text-slate-500 truncate">{v.accent}</span>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* right — sampling parameters, fixed; scrolls only if the pane is short */}
        <div className="flex flex-col min-h-0 min-w-0 gap-2 overflow-y-auto pr-0.5">
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-slate-500 uppercase tracking-wide">Sampling</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowHelp((h) => !h)}
                title="What do these do?"
                className={cn(
                  'text-[9px] flex items-center gap-0.5',
                  showHelp ? 'text-cyan-300' : 'text-slate-500 hover:text-slate-200'
                )}
              >
                <HelpCircle className="h-2.5 w-2.5" /> Help
              </button>
              <button
                type="button"
                onClick={resetAll}
                title="Restore this voice's defaults and clear the seed"
                className="text-[9px] text-slate-500 hover:text-slate-200 flex items-center gap-0.5"
              >
                <RotateCcw className="h-2.5 w-2.5" /> Reset
              </button>
            </div>
          </div>

          {showHelp && (
            <p className="text-[9px] text-slate-400 leading-snug rounded-md border border-slate-800 bg-slate-900/60 p-1.5">
              These shape how the model picks each sound. <span className="text-slate-200">Temperature</span> is
              the one worth moving. The three penalties suppress artifacts rather than shape
              performance — leave them at the voice&apos;s defaults unless you hear a specific
              defect. Hover any label for detail.
            </p>
          )}

          {PARAM_SPECS.map((sp) => {
            const val = params[sp.key] ?? FALLBACK_DEFAULTS[sp.key] ?? 0
            return (
              <div key={sp.key} className="space-y-0.5">
                <div className="flex items-center justify-between">
                  <Hint text={sp.hint}>{sp.label}</Hint>
                  <span className="text-[9px] font-mono text-slate-200">{val.toFixed(2)}</span>
                </div>
                {showHelp && (
                  <p className="text-[9px] text-cyan-200/70 leading-snug">{sp.hint}</p>
                )}
                <Slider
                  value={[val]}
                  min={sp.min}
                  max={sp.max}
                  step={sp.step}
                  onValueChange={([v]) => setParams((p) => ({ ...p, [sp.key]: v }))}
                />
              </div>
            )
          })}

          {/* seed block — pinned to the bottom of the tuning column */}
          <div className="pt-1.5 mt-1 border-t border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between gap-1">
              <Hint text={TOP_K_HINT}>Top K</Hint>
              <input
                type="number"
                value={topK}
                step={1}
                min={-1}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10)
                  // Domain is -1 or > 0; 0 is invalid and the API rejects it.
                  setParams((p) => ({ ...p, top_k: Number.isNaN(n) ? -1 : n === 0 ? -1 : n }))
                }}
                className="w-16 text-[10px] font-mono px-1 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-200 focus:outline-none focus:border-cyan-500/60"
              />
            </div>

            <div className="flex items-center justify-between gap-1">
              <Hint text="The number behind this exact performance. Lock it and every regeneration returns identical audio; re-roll to race three fresh reads and harvest a new one.">
                Seed
              </Hint>
              <input
                type="number"
                value={seed ?? ''}
                placeholder="auto"
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10)
                  setSeed(Number.isNaN(n) ? null : n)
                }}
                className="w-24 text-[10px] font-mono px-1 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500/60"
              />
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={seed === null}
                onClick={() => setLocked((l) => !l)}
                title={
                  locked
                    ? 'Locked — regenerating replays this exact take'
                    : 'Unlocked — regenerating races fresh takes and picks a new seed'
                }
                className={cn(
                  'flex-1 text-[9px] py-1 rounded-md border flex items-center justify-center gap-1 transition-colors',
                  seed === null
                    ? 'border-slate-800 bg-slate-900 text-slate-600 cursor-not-allowed'
                    : locked
                      ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                      : 'border-slate-700 bg-slate-800 text-slate-400 hover:text-white'
                )}
              >
                {locked ? <Lock className="h-2.5 w-2.5" /> : <Unlock className="h-2.5 w-2.5" />}
                {locked ? 'Locked' : 'Lock'}
              </button>
              <button
                type="button"
                onClick={() => { setSeed(null); setLocked(false) }}
                title="Discard the pinned seed and race fresh takes on the next generate"
                className="flex-1 text-[9px] py-1 rounded-md border border-slate-700 bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center gap-1"
              >
                <Dices className="h-2.5 w-2.5" /> Re-roll
              </button>
            </div>

            <button
              type="button"
              disabled={!selected || isRegenerating}
              onClick={() => selected && onGenerate(selected, { ...params }, locked ? seed : null)}
              className={cn(
                'w-full text-[10px] py-1.5 rounded-lg font-medium transition-colors flex items-center justify-center gap-1',
                !selected || isRegenerating
                  ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                  : 'bg-cyan-600 hover:bg-cyan-700 text-white'
              )}
            >
              {isRegenerating
                ? <><Loader2 className="h-3 w-3 animate-spin" /> Generating…</>
                : <><Play className="h-3 w-3" /> Generate</>}
            </button>
            {!selected && (
              <p className="text-[9px] text-slate-600 leading-snug text-center">
                Pick a voice to enable
              </p>
            )}
          </div>
        </div>
      </div>

      <p className="text-[9px] text-slate-600 leading-snug shrink-0">
        Punctuation drives timing — a comma buys a beat. Lock a seed to make a take
        reproducible; re-roll to race three fresh reads.
      </p>
    </div>
  )
}
