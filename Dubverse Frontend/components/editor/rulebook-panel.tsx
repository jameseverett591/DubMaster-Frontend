'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useEditorStore } from '@/lib/editor-store'
import {
  apiClient,
  type Rule,
  type RuleClass,
  type EffectiveRules,
} from '@/lib/api-client'
import { useT } from '@/lib/use-t'
import {
  BookOpen, Globe, Plus, RefreshCw, Trash2, ArrowUpCircle,
  ToggleLeft, ToggleRight, Pencil, Check, X,
} from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// ---------------------------------------------------------------------------
// RulebookPanel — Feature B of the Dubbing Studio Platform spec
// (plan-8012dcdb5d41cf3b.md §5.5). The director's accumulated decisions:
// every correction becomes a typed, scoped rule that steers translation,
// register, and delivery on THIS job — and, once promoted, on every future
// job. Job scope is the staging area; global is the institutional memory.
// ---------------------------------------------------------------------------

const CLASS_META: Record<RuleClass, { label: string; hint: string }> = {
  name_mapping:    { label: 'Name mapping',    hint: 'Force an English rendering of a source name/term' },
  glossary:        { label: 'Glossary term',   hint: 'Canonical English term for a source phrase' },
  persona:         { label: 'Speaker persona', hint: 'Pin a character profile to a speaker' },
  stance:          { label: 'Register / stance', hint: 'Scene-style directive (e.g. dismissal language in confrontations)' },
  translation_fix: { label: 'Translation fix', hint: 'Force an exact target line for a recurring source line' },
  delivery:        { label: 'Voice / delivery', hint: 'Emotion / speed / pitch defaults for a speaker' },
}

const CLASS_ORDER: RuleClass[] = [
  'translation_fix', 'name_mapping', 'glossary', 'persona', 'stance', 'delivery',
]

function RuleRow({
  rule,
  jobId,
  onChanged,
}: {
  rule: Rule
  jobId: string
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(rule.target)
  const [busy, setBusy] = useState(false)

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try { await fn(); onChanged() } finally { setBusy(false) }
  }

  const speaker = rule.conditions?.speaker

  return (
    <div className="px-3 py-2 border-b border-slate-800/60 last:border-b-0">
      <div className="flex items-start gap-2">
        {/* Enabled toggle — a disabled rule exists but never fires */}
        <button
          type="button"
          disabled={busy}
          onClick={() => act(() => apiClient.updateRule(jobId, rule.id, { enabled: !rule.enabled }))}
          className="mt-0.5 shrink-0 text-slate-500 hover:text-white transition-colors disabled:opacity-40"
          title={rule.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
        >
          {rule.enabled
            ? <ToggleRight className="w-4 h-4 text-emerald-400" />
            : <ToggleLeft className="w-4 h-4" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-[9px] px-1.5 py-px rounded-full font-mono uppercase tracking-wide ${
              rule.scope === 'global'
                ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                : 'bg-slate-700/50 text-slate-400 border border-slate-600/40'
            }`}>
              {rule.scope === 'global' ? 'global' : 'this job'}
            </span>
            {rule.inferred && (
              <span className="text-[9px] px-1.5 py-px rounded-full bg-sky-500/15 text-sky-400 border border-sky-500/30 font-mono">
                suggested
              </span>
            )}
            {speaker && (
              <span className="text-[9px] px-1.5 py-px rounded-full bg-slate-800 text-slate-400 font-mono">
                {speaker}
              </span>
            )}
          </div>

          {rule.source_pattern && (
            <div className="mt-1 text-[11px] text-slate-400 font-mono truncate" title={rule.source_pattern}>
              {rule.source_pattern}
            </div>
          )}

          {editing ? (
            <div className="mt-1 flex items-center gap-1">
              <input
                value={draft}
                onChange={e => setDraft(e.target.value)}
                className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-white outline-none focus:border-slate-500"
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter') act(async () => { await apiClient.updateRule(jobId, rule.id, { target: draft }); setEditing(false) })
                  if (e.key === 'Escape') { setDraft(rule.target); setEditing(false) }
                }}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => act(async () => { await apiClient.updateRule(jobId, rule.id, { target: draft }); setEditing(false) })}
                className="p-1 text-emerald-400 hover:text-emerald-300"
              ><Check className="w-3.5 h-3.5" /></button>
              <button
                type="button"
                onClick={() => { setDraft(rule.target); setEditing(false) }}
                className="p-1 text-slate-500 hover:text-slate-300"
              ><X className="w-3.5 h-3.5" /></button>
            </div>
          ) : (
            <div
              className="mt-0.5 text-[12px] text-white cursor-pointer hover:text-slate-200 truncate"
              title={rule.target}
              onClick={() => { setDraft(rule.target); setEditing(true) }}
            >
              {rule.target || <span className="text-slate-500 italic">(no target — click to set)</span>}
            </div>
          )}

          {rule.notes && (
            <div className="mt-0.5 text-[10px] text-slate-500 italic truncate">{rule.notes}</div>
          )}
        </div>

        <div className="flex flex-col gap-1 shrink-0">
          {rule.scope === 'job' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => act(() => apiClient.promoteRule(jobId, rule.id))}
              className="p-1 text-slate-500 hover:text-amber-400 transition-colors disabled:opacity-40"
              title="Promote to global — apply this decision on every future job"
            >
              <ArrowUpCircle className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => act(() => apiClient.deleteRule(jobId, rule.id, rule.scope))}
            className="p-1 text-slate-500 hover:text-red-400 transition-colors disabled:opacity-40"
            title="Delete rule"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

export function RulebookPanel() {
  const t = useT()
  const { jobId, selectedSegmentIndex, segments } = useEditorStore()

  const [rules, setRules] = useState<Rule[]>([])
  const [effective, setEffective] = useState<EffectiveRules | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [classFilter, setClassFilter] = useState<'all' | RuleClass>('all')
  const [adding, setAdding] = useState(false)

  const refresh = useCallback(async () => {
    if (!jobId) return
    setLoading(true)
    setError(null)
    try {
      const data = await apiClient.getRulebook(jobId)
      setRules(data.rules ?? [])
      setEffective(data.effective ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load rulebook')
    } finally {
      setLoading(false)
    }
  }, [jobId])

  useEffect(() => { refresh() }, [refresh])

  // "Rules applied to this segment" — count rules whose pattern appears in the
  // selected segment's source, or whose speaker condition matches it.
  const segment = selectedSegmentIndex !== null ? segments[selectedSegmentIndex] : null
  const appliedHere = useMemo(() => {
    if (!segment) return []
    const src = (segment.source_text || '').trim()
    const spk = segment.speaker_label || segment.speaker_id || ''
    return rules.filter(r => {
      if (!r.enabled) return false
      const p = (r.source_pattern || '').trim()
      const condSpk = r.conditions?.speaker
      return (p && src.includes(p)) || (condSpk && condSpk === spk)
    })
  }, [rules, segment])

  const grouped = useMemo(() => {
    const out = new Map<RuleClass, Rule[]>()
    for (const r of rules) {
      if (classFilter !== 'all' && r.class !== classFilter) continue
      const list = out.get(r.class) ?? []
      list.push(r)
      out.set(r.class, list)
    }
    return out
  }, [rules, classFilter])

  const globalCount = rules.filter(r => r.scope === 'global').length

  return (
    <div className="flex flex-col h-full bg-neutral-950 text-slate-200">
      {/* Header */}
      <div className="px-3 py-2 border-b border-slate-800 flex items-center gap-2">
        <BookOpen className="w-4 h-4 text-amber-400" />
        <span className="text-xs font-semibold">Rulebook</span>
        <span className="text-[10px] text-slate-500">
          {rules.length} rule{rules.length === 1 ? '' : 's'}
          {globalCount > 0 && ` · ${globalCount} global`}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="p-1 text-slate-500 hover:text-white transition-colors disabled:opacity-40"
          title="Reload rules"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <button
          type="button"
          onClick={() => setAdding(v => !v)}
          className="p-1 text-slate-500 hover:text-white transition-colors"
          title="Add a rule"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Rules applied to the selected segment */}
      {segment && appliedHere.length > 0 && (
        <div className="px-3 py-1.5 border-b border-slate-800 bg-emerald-500/5">
          <span className="text-[10px] font-mono text-emerald-400">
            Rules applied ({appliedHere.length}) — segment {selectedSegmentIndex}
          </span>
          <div className="mt-1 flex flex-wrap gap-1">
            {appliedHere.map(r => (
              <span key={r.id} className="text-[9px] px-1.5 py-px rounded bg-slate-800 text-slate-300 font-mono">
                {CLASS_META[r.class]?.label ?? r.class}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Add-rule form */}
      {adding && jobId && (
        <AddRuleForm
          jobId={jobId}
          onDone={() => { setAdding(false); refresh() }}
          onCancel={() => setAdding(false)}
        />
      )}

      {/* Filter */}
      <div className="px-3 py-1.5 border-b border-slate-800 flex items-center gap-2">
        <Select value={classFilter} onValueChange={v => setClassFilter(v as typeof classFilter)}>
          <SelectTrigger className="h-6 w-40 text-[10px] bg-slate-800/60 border-slate-700">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All rule classes</SelectItem>
            {CLASS_ORDER.map(c => (
              <SelectItem key={c} value={c}>{CLASS_META[c].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Rule list, grouped by class */}
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="px-3 py-2 text-[11px] text-red-400">{error}</div>
        )}
        {!loading && !error && rules.length === 0 && (
          <div className="px-4 py-8 text-center">
            <BookOpen className="w-8 h-8 text-slate-700 mx-auto mb-2" />
            <p className="text-[11px] text-slate-500 leading-relaxed">
              No rules yet. Right-click a transcript line →
              <span className="text-slate-300"> Add to Rulebook</span> to capture
              a decision, or add one above.
            </p>
            <p className="mt-2 text-[10px] text-slate-600 leading-relaxed">
              Rules steer translation, register, and delivery on this job —
              and once promoted to global, on every future job.
            </p>
          </div>
        )}
        {CLASS_ORDER.map(cls => {
          const list = grouped.get(cls)
          if (!list?.length) return null
          return (
            <div key={cls}>
              <div className="px-3 py-1 bg-slate-900/60 border-b border-slate-800 sticky top-0">
                <span className="text-[9px] font-mono uppercase tracking-widest text-slate-500">
                  {CLASS_META[cls].label} ({list.length})
                </span>
              </div>
              {list.map(r => (
                <RuleRow key={r.id} rule={r} jobId={jobId!} onChanged={refresh} />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AddRuleForm — explicit capture. Also used by RuleCaptureDialog when the
// director right-clicks a transcript line (the primary capture path).
// ---------------------------------------------------------------------------

export function AddRuleForm({
  jobId,
  initialClass = 'translation_fix',
  initialSource = '',
  initialTarget = '',
  initialSpeaker = '',
  onDone,
  onCancel,
}: {
  jobId: string
  initialClass?: RuleClass
  initialSource?: string
  initialTarget?: string
  initialSpeaker?: string
  onDone: () => void
  onCancel: () => void
}) {
  const [cls, setCls] = useState<RuleClass>(initialClass)
  const [source, setSource] = useState(initialSource)
  const [target, setTarget] = useState(initialTarget)
  const [speaker, setSpeaker] = useState(initialSpeaker)
  const [notes, setNotes] = useState('')
  const [global, setGlobal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Persona/delivery rules key off the speaker, not a source phrase.
  const speakerKeyed = cls === 'persona' || cls === 'delivery'

  const save = async () => {
    if (!target.trim() && cls !== 'delivery') { setErr('Target is required'); return }
    if (!speakerKeyed && !source.trim()) { setErr('Source pattern is required'); return }
    if (speakerKeyed && !speaker.trim()) { setErr('Speaker is required'); return }
    setBusy(true)
    setErr(null)
    try {
      await apiClient.addRule(jobId, {
        class: cls,
        source_pattern: source.trim(),
        target: target.trim(),
        notes: notes.trim(),
        scope: global ? 'global' : 'job',
        conditions: speaker.trim() ? { speaker: speaker.trim() } : {},
      })
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save rule')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="px-3 py-2 border-b border-slate-800 bg-slate-900/40 space-y-1.5">
      <div className="flex items-center gap-2">
        <Select value={cls} onValueChange={v => setCls(v as RuleClass)}>
          <SelectTrigger className="h-6 w-40 text-[10px] bg-slate-800/60 border-slate-700">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CLASS_ORDER.map(c => (
              <SelectItem key={c} value={c}>{CLASS_META[c].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-[9px] text-slate-500 leading-tight flex-1">{CLASS_META[cls].hint}</span>
      </div>

      {speakerKeyed ? (
        <input
          value={speaker}
          onChange={e => setSpeaker(e.target.value)}
          placeholder="Speaker (e.g. speaker-2)"
          className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[11px] text-white outline-none focus:border-slate-500"
        />
      ) : (
        <input
          value={source}
          onChange={e => setSource(e.target.value)}
          placeholder={cls === 'stance' ? 'Scene description (optional)' : 'Source text / name / term'}
          className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[11px] text-white outline-none focus:border-slate-500"
        />
      )}

      <input
        value={target}
        onChange={e => setTarget(e.target.value)}
        placeholder={
          cls === 'stance' ? 'Directive (e.g. "use dismissal language, never invitation")'
            : cls === 'delivery' ? 'Defaults (e.g. emotion=calm, speed=0.95)'
            : 'Target / forced rendering'
        }
        className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[11px] text-white outline-none focus:border-slate-500"
      />

      <input
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="Notes (why this rule exists)"
        className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[11px] text-white outline-none focus:border-slate-500"
      />

      <div className="flex items-center gap-2 pt-0.5">
        <button
          type="button"
          onClick={() => setGlobal(v => !v)}
          className={`flex items-center gap-1 text-[10px] transition-colors ${global ? 'text-amber-400' : 'text-slate-500 hover:text-slate-300'}`}
          title="Global rules apply on every future job"
        >
          <Globe className="w-3 h-3" />
          {global ? 'Apply globally' : 'This job only'}
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          className="px-2 py-0.5 text-[10px] text-slate-400 hover:text-white"
        >Cancel</button>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="px-2.5 py-0.5 text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded hover:bg-amber-500/30 disabled:opacity-40"
        >{busy ? 'Saving…' : 'Save rule'}</button>
      </div>
      {err && <div className="text-[10px] text-red-400">{err}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// RuleCaptureDialog — the primary capture path: right-click a transcript
// line → "Add to Rulebook". The segment's source/target text pre-fill the
// form; the director picks the rule class and confirms.
// ---------------------------------------------------------------------------

export function RuleCaptureDialog({
  segmentIndex,
  onClose,
}: {
  segmentIndex: number
  onClose: () => void
}) {
  const { jobId, segments } = useEditorStore()
  const segment = segments[segmentIndex]
  if (!segment || !jobId) return null

  const speaker = segment.speaker_label || segment.speaker_id || ''

  return (
    <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div
        className="w-[440px] max-w-[90vw] bg-neutral-900 border border-slate-700 rounded-lg shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-semibold text-white">Add to Rulebook</span>
          <span className="text-[10px] text-slate-500">segment {segmentIndex}</span>
        </div>

        <div className="px-4 py-2 border-b border-slate-800/60 space-y-1">
          <div className="text-[10px] font-mono text-slate-500 truncate" title={segment.source_text}>
            <span className="text-slate-600">src:</span> {segment.source_text}
          </div>
          <div className="text-[10px] text-slate-400 truncate" title={segment.target_text || segment.active_text}>
            <span className="text-slate-600">tgt:</span> {segment.target_text || segment.active_text}
          </div>
        </div>

        <AddRuleForm
          jobId={jobId}
          initialClass="translation_fix"
          initialSource={segment.source_text || ''}
          initialTarget={segment.target_text || segment.active_text || ''}
          initialSpeaker={speaker}
          onDone={onClose}
          onCancel={onClose}
        />
      </div>
    </div>
  )
}
