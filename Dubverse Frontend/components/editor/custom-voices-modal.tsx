'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Mic2, Trash2, Loader2, Upload, Check, Wand2 } from 'lucide-react'
import { apiClient, type CustomVoice } from '@/lib/api-client'

interface CustomVoicesModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Called after the list changes so the Voice Library can refresh.
  onChanged?: () => void
}

export function CustomVoicesModal({ open, onOpenChange, onChanged }: CustomVoicesModalProps) {
  const [voices, setVoices] = useState<CustomVoice[]>([])
  const [loading, setLoading] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [cloning, setCloning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setVoices(await apiClient.getCustomVoices())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) refresh()
  }, [open, refresh])

  const handleClone = useCallback(async () => {
    if (!file || cloning) return
    setCloning(true)
    setError(null)
    try {
      await apiClient.cloneVoice(file, name.trim() || file.name.replace(/\.[^.]+$/, ''))
      setFile(null)
      setName('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      await refresh()
      onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Voice cloning failed')
    } finally {
      setCloning(false)
    }
  }, [file, name, cloning, refresh, onChanged])

  const handleDelete = useCallback(async (v: CustomVoice) => {
    await apiClient.deleteCustomVoice(v.voice_id, v.provider)
    await refresh()
    onChanged?.()
  }, [refresh, onChanged])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-[#0B1220] border-slate-700 text-slate-200">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-400">
            <Mic2 className="h-5 w-5" /> Custom Voices
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Add your own voice — just upload a short clip. DubMaster clones it for you
            and adds it to the Voice Library so you can assign it to any speaker.
          </DialogDescription>
        </DialogHeader>

        {/* Add-your-voice (clone) */}
        <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-3 space-y-2.5">
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null) }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 rounded-md border border-dashed border-slate-600 bg-slate-800/50 hover:border-amber-500/60 hover:text-amber-300 text-slate-300 text-sm py-4 transition-colors"
          >
            <Upload className="h-4 w-4" />
            {file ? file.name : 'Choose an audio clip of the voice'}
          </button>
          <p className="text-[11px] text-slate-500">
            Best results: 10–30 seconds of clean, single-speaker speech (WAV or MP3), no music or background noise.
          </p>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name this voice (e.g. My Narrator)"
            className="h-9 text-sm bg-slate-800 border-slate-700"
          />
          {error && <p className="text-[11px] text-red-400">{error}</p>}
          <Button
            onClick={handleClone}
            disabled={!file || cloning}
            className="w-full h-9 text-sm bg-amber-600 hover:bg-amber-700 text-white"
          >
            {cloning
              ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Cloning your voice…</>
              : <><Wand2 className="h-4 w-4 mr-1.5" /> Create voice</>}
          </Button>
        </div>

        {/* Your voices */}
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-6 text-slate-500 text-sm">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
            </div>
          ) : voices.length === 0 ? (
            <p className="text-center text-xs text-slate-500 py-6">
              No custom voices yet. Upload a clip above to create one.
            </p>
          ) : (
            voices.map(v => (
              <div
                key={`${v.provider}:${v.voice_id}`}
                className="flex items-center gap-2 rounded border border-slate-700 bg-slate-900/40 px-3 py-2"
              >
                <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-slate-200 truncate">{v.name}</div>
                  <div className="text-[10px] text-slate-500 truncate">
                    {(v as { cloned?: boolean }).cloned ? 'Your cloned voice' : v.provider === 'fish-audio' ? 'Fish Audio' : 'ElevenLabs'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(v)}
                  className="text-slate-500 hover:text-red-400 transition-colors shrink-0"
                  aria-label="Remove voice"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
