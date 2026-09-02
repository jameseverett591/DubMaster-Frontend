'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { apiClient, type CharacterProfile } from '@/lib/api-client'
import { useT } from '@/lib/use-t'

interface Props {
  jobId: string
}

const EMPTY_PROFILE = (): CharacterProfile => ({ name: '', traits: [], speech_style: '' })

export function CharacterProfilesPanel({ jobId }: Props) {
  const t = useT()
  const [profiles, setProfiles] = useState<CharacterProfile[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [draft, setDraft] = useState<CharacterProfile>(EMPTY_PROFILE())
  const [traitsInput, setTraitsInput] = useState('')

  useEffect(() => {
    apiClient.getCharacterProfiles(jobId).then(setProfiles).catch(() => {})
  }, [jobId])

  const openEdit = (index: number) => {
    const p = profiles[index]
    setDraft({ ...p })
    setTraitsInput(p.traits.join(', '))
    setEditingIndex(index)
  }

  const openNew = () => {
    setDraft(EMPTY_PROFILE())
    setTraitsInput('')
    setEditingIndex(profiles.length)
  }

  const commitDraft = () => {
    if (!draft.name.trim()) return
    const finalProfile: CharacterProfile = {
      ...draft,
      traits: traitsInput.split(',').map(t => t.trim()).filter(Boolean),
    }
    const next = [...profiles]
    if (editingIndex !== null && editingIndex < profiles.length) {
      next[editingIndex] = finalProfile
    } else {
      next.push(finalProfile)
    }
    setProfiles(next)
    setEditingIndex(null)
  }

  const remove = (index: number) => {
    setProfiles(prev => prev.filter((_, i) => i !== index))
    if (editingIndex === index) setEditingIndex(null)
  }

  const save = useCallback(async () => {
    setSaving(true)
    try {
      await apiClient.saveCharacterProfiles(jobId, profiles)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      // ignore
    } finally {
      setSaving(false)
    }
  }, [jobId, profiles])

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: '#0d1117' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/8 shrink-0">
        <div>
          <span className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">{t('Character Profiles')}</span>
          <p className="text-[9px] text-slate-600 mt-0.5">{t('Define voices to keep characters consistent across translation')}</p>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="text-[9px] font-bold px-3 py-1 rounded transition-all"
          style={{
            background: saved ? 'rgba(34,197,94,0.15)' : 'rgba(167,139,250,0.15)',
            color: saved ? '#86efac' : '#a78bfa',
            border: `1px solid ${saved ? 'rgba(34,197,94,0.35)' : 'rgba(167,139,250,0.35)'}`,
          }}
        >
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
        </button>
      </div>

      {/* Profile list */}
      <div className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-2">
        {profiles.map((p, i) => (
          <div
            key={i}
            className="rounded-lg px-3 py-2.5 flex items-start justify-between gap-2"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
          >
            <div className="min-w-0 flex-1">
              <span className="text-xs font-semibold text-slate-200">{p.name}</span>
              {p.traits.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {p.traits.map(t => (
                    <span key={t} className="text-[8px] px-1.5 py-0.5 rounded-full text-slate-400"
                      style={{ background: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.2)' }}>
                      {t}
                    </span>
                  ))}
                </div>
              )}
              {p.speech_style && (
                <p className="text-[9px] text-slate-500 mt-1 leading-relaxed italic">{p.speech_style}</p>
              )}
            </div>
            <div className="flex gap-1 shrink-0">
              <button onClick={() => openEdit(i)} className="text-[9px] text-slate-500 hover:text-slate-300 px-1.5 py-0.5 rounded transition-colors"
                style={{ border: '1px solid rgba(255,255,255,0.08)' }}>{t('Edit')}</button>
              <button onClick={() => remove(i)} className="text-[9px] text-red-600 hover:text-red-400 px-1.5 py-0.5 rounded transition-colors"
                style={{ border: '1px solid rgba(239,68,68,0.2)' }}>✕</button>
            </div>
          </div>
        ))}

        {profiles.length === 0 && editingIndex === null && (
          <p className="text-[10px] text-slate-600 text-center mt-6 leading-relaxed">
            {t('No characters yet.')}<br />{t('Add one to give the AI a consistent voice to write for.')}
          </p>
        )}
      </div>

      {/* Inline editor */}
      {editingIndex !== null && (
        <div className="px-3 py-3 border-t border-white/8 flex flex-col gap-2 shrink-0"
          style={{ background: 'rgba(167,139,250,0.05)' }}>
          <span className="text-[9px] text-slate-500 uppercase tracking-widest">
            {editingIndex < profiles.length ? t('Edit Character') : t('New Character')}
          </span>
          <input
            className="w-full bg-transparent text-xs text-slate-200 px-2 py-1.5 rounded outline-none"
            style={{ border: '1px solid rgba(255,255,255,0.12)' }}
            placeholder={t('Character name')}
            value={draft.name}
            onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
          />
          <input
            className="w-full bg-transparent text-xs text-slate-400 px-2 py-1.5 rounded outline-none"
            style={{ border: '1px solid rgba(255,255,255,0.12)' }}
            placeholder="Traits (comma-separated): calm, authoritative, humble"
            value={traitsInput}
            onChange={e => setTraitsInput(e.target.value)}
          />
          <textarea
            className="w-full bg-transparent text-xs text-slate-400 px-2 py-1.5 rounded outline-none resize-none"
            style={{ border: '1px solid rgba(255,255,255,0.12)' }}
            placeholder="Speech style: Speaks with quiet authority. Uses short sentences."
            rows={2}
            value={draft.speech_style}
            onChange={e => setDraft(d => ({ ...d, speech_style: e.target.value }))}
          />
          <div className="flex gap-2">
            <button
              onClick={commitDraft}
              disabled={!draft.name.trim()}
              className="flex-1 py-1.5 rounded text-[10px] font-bold transition-all"
              style={{
                background: draft.name.trim() ? 'rgba(167,139,250,0.15)' : 'rgba(100,100,100,0.08)',
                color: draft.name.trim() ? '#a78bfa' : '#475569',
                border: `1px solid ${draft.name.trim() ? 'rgba(167,139,250,0.35)' : 'rgba(100,100,100,0.2)'}`,
              }}
            >
              {editingIndex < profiles.length ? t('Update') : t('Add Character')}
            </button>
            <button
              onClick={() => setEditingIndex(null)}
              className="px-3 py-1.5 rounded text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
              style={{ border: '1px solid rgba(255,255,255,0.08)' }}
            >
              {t('Cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Add button */}
      {editingIndex === null && (
        <div className="px-3 py-2 border-t border-white/8 shrink-0">
          <button
            onClick={openNew}
            className="w-full py-1.5 rounded text-[10px] font-semibold text-slate-400 hover:text-slate-200 transition-colors"
            style={{ border: '1px solid rgba(255,255,255,0.08)' }}
          >
            + Add Character
          </button>
        </div>
      )}
    </div>
  )
}
