'use client'

import { useState, useRef } from 'react'
import { Download, Loader2, X, Folder, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiClient } from '@/lib/api-client'

type Resolution = '720p' | '1080p' | '4k'
type Aspect     = 'widescreen' | 'fill'
type Format     = 'mp4' | 'mov' | 'avi' | 'mkv'

interface ExportModalProps {
  jobId: string
  onClose: () => void
}

const RESOLUTIONS: { value: Resolution; label: string; sub: string }[] = [
  { value: '720p',  label: '720p',  sub: '1280 × 720'  },
  { value: '1080p', label: '1080p', sub: '1920 × 1080' },
  { value: '4k',    label: '4K',    sub: '3840 × 2160' },
]

const ASPECTS: { value: Aspect; label: string; sub: string }[] = [
  { value: 'widescreen', label: 'Widescreen', sub: '16:9 — letterbox if needed' },
  { value: 'fill',       label: 'Fill Screen', sub: 'Crop to fill frame'        },
]

const FORMATS: { value: Format; label: string }[] = [
  { value: 'mp4', label: 'MP4' },
  { value: 'mov', label: 'MOV' },
  { value: 'avi', label: 'AVI' },
  { value: 'mkv', label: 'MKV' },
]

const EST_SIZES: Record<Resolution, Record<Format, string>> = {
  '720p':  { mp4: '~55 MB',  mov: '~60 MB',  avi: '~120 MB', mkv: '~55 MB'  },
  '1080p': { mp4: '~140 MB', mov: '~155 MB', avi: '~280 MB', mkv: '~140 MB' },
  '4k':    { mp4: '~480 MB', mov: '~530 MB', avi: '~1.1 GB', mkv: '~480 MB' },
}

const MIME: Record<Format, string> = {
  mp4: 'video/mp4', mov: 'video/quicktime',
  avi: 'video/x-msvideo', mkv: 'video/x-matroska',
}

const hasSavePicker = typeof window !== 'undefined' && 'showSaveFilePicker' in window

export function ExportModal({ jobId, onClose }: ExportModalProps) {
  const [resolution, setResolution] = useState<Resolution>('1080p')
  const [aspect,     setAspect]     = useState<Aspect>('widescreen')
  const [format,     setFormat]     = useState<Format>('mp4')
  const [destLabel,  setDestLabel]  = useState<string>('')
  const [fileHandle, setFileHandle] = useState<any>(null)
  const [exporting,  setExporting]  = useState(false)
  const [done,       setDone]       = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const pathInputRef = useRef<HTMLInputElement>(null)

  const suggestedName = `dubmaster_${resolution}_${aspect}.${format}`

  const handleBrowse = async () => {
    if (!hasSavePicker) return
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName,
        types: [{ description: `${format.toUpperCase()} Video`, accept: { [MIME[format]]: [`.${format}`] } }],
      })
      setFileHandle(handle)
      setDestLabel(handle.name)
    } catch (e: any) {
      if (e?.name !== 'AbortError') setError('Could not open folder picker.')
    }
  }

  const handleExport = async () => {
    setExporting(true)
    setError(null)
    try {
      const result = await apiClient.exportVideo(jobId, resolution, aspect, format)
      const downloadUrl = apiClient.getExportDownloadUrl(jobId, result.filename)

      if (fileHandle) {
        const response = await fetch(downloadUrl)
        const blob = await response.blob()
        const writable = await fileHandle.createWritable()
        await writable.write(blob)
        await writable.close()
        setDone(true)
        setTimeout(onClose, 1400)
        return
      }

      if (hasSavePicker) {
        try {
          const handle = await (window as any).showSaveFilePicker({
            suggestedName: result.filename,
            types: [{ description: `${format.toUpperCase()} Video`, accept: { [MIME[format]]: [`.${format}`] } }],
          })
          const response = await fetch(downloadUrl)
          const blob = await response.blob()
          const writable = await handle.createWritable()
          await writable.write(blob)
          await writable.close()
          setDone(true)
          setTimeout(onClose, 1400)
          return
        } catch (e: any) {
          if (e?.name === 'AbortError') { onClose(); return }
        }
      }

      const a = document.createElement('a')
      a.href = downloadUrl
      a.download = result.filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setDone(true)
      setTimeout(onClose, 1400)
    } catch (e: any) {
      setError(e.message || 'Export failed — please try again')
    } finally {
      setExporting(false)
    }
  }

  const hintText = fileHandle
    ? null
    : hasSavePicker
      ? 'Click Browse to choose where to save — works in Chrome & Edge on Windows and Mac.'
      : 'Safari & Firefox: file saves to your Downloads folder. You can rename it above.'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm">
      <div className="w-[420px] rounded-xl border border-white/10 bg-[#161619] shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.07]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-[#F5A623] to-[#C97A0E]">
              <Download className="h-3.5 w-3.5 text-white" strokeWidth={2.5} />
            </div>
            <div>
              <div className="text-[13.5px] font-semibold text-white leading-tight">Export Video</div>
              <div className="text-[11px] text-neutral-500 leading-tight mt-0.5 font-mono">
                {jobId.slice(0, 8)}… · {format.toUpperCase()}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={exporting}
            className="w-6 h-6 rounded-md flex items-center justify-center text-neutral-500 hover:text-white hover:bg-white/8 transition-colors disabled:opacity-40"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 flex flex-col gap-4">

          {/* Resolution */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500 mb-2">Resolution</p>
            <div className="flex gap-1.5">
              {RESOLUTIONS.map(r => (
                <button
                  type="button"
                  key={r.value}
                  onClick={() => setResolution(r.value)}
                  className={cn(
                    'flex-1 rounded-lg border py-2 text-center transition-colors',
                    resolution === r.value
                      ? 'border-amber-500/50 bg-amber-500/[0.08] text-amber-400'
                      : 'border-white/[0.07] bg-[#1E1E24] text-neutral-400 hover:border-white/[0.13] hover:text-white'
                  )}
                >
                  <div className="text-[12.5px] font-semibold">{r.label}</div>
                  <div className="text-[10px] opacity-60 mt-0.5">{r.sub}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Aspect */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500 mb-2">Aspect Ratio</p>
            <div className="flex gap-1.5">
              {ASPECTS.map(a => (
                <button
                  type="button"
                  key={a.value}
                  onClick={() => setAspect(a.value)}
                  className={cn(
                    'flex-1 rounded-lg border px-3 py-2 text-left transition-colors',
                    aspect === a.value
                      ? 'border-amber-500/50 bg-amber-500/[0.08] text-amber-400'
                      : 'border-white/[0.07] bg-[#1E1E24] text-neutral-400 hover:border-white/[0.13] hover:text-white'
                  )}
                >
                  <div className="text-[12px] font-semibold">{a.label}</div>
                  <div className="text-[10px] opacity-60 mt-0.5">{a.sub}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Format */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500 mb-2">Format</p>
            <div className="flex gap-1.5">
              {FORMATS.map(f => (
                <button
                  type="button"
                  key={f.value}
                  onClick={() => setFormat(f.value)}
                  className={cn(
                    'flex-1 rounded-lg border py-2 text-[12px] font-semibold transition-colors',
                    format === f.value
                      ? 'border-amber-500/50 bg-amber-500/[0.08] text-amber-400'
                      : 'border-white/[0.07] bg-[#1E1E24] text-neutral-400 hover:border-white/[0.13] hover:text-white'
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Destination */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500 mb-2">Destination</p>
            <div className="flex gap-1.5">
              <div className="flex-1 relative">
                <Folder className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-500 pointer-events-none" />
                <input
                  ref={pathInputRef}
                  type="text"
                  value={destLabel}
                  onChange={e => { setDestLabel(e.target.value); setFileHandle(null) }}
                  placeholder={suggestedName}
                  spellCheck={false}
                  className={cn(
                    'w-full pl-8 pr-3 py-2 rounded-lg border bg-[#1E1E24] text-[11.5px] font-mono text-white placeholder:text-neutral-600 outline-none transition-colors',
                    destLabel ? 'border-amber-500/40' : 'border-white/[0.07]'
                  )}
                />
              </div>
              {hasSavePicker && (
                <button
                  type="button"
                  onClick={handleBrowse}
                  className="px-3 rounded-lg border border-white/[0.07] bg-[#1E1E24] text-[12px] font-medium text-neutral-400 hover:text-white hover:border-white/[0.13] transition-colors flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Folder className="h-3 w-3" />
                  Browse
                </button>
              )}
            </div>
            {hintText && (
              <p className="text-[10.5px] text-neutral-600 mt-1.5">{hintText}</p>
            )}
            {fileHandle && (
              <p className="text-[10.5px] text-amber-500/70 mt-1.5 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Saving to {fileHandle.name}
              </p>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-500/[0.08] border border-red-500/20 text-[11.5px] text-red-400">
              {error}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="h-px bg-white/[0.07]" />

        {/* Footer */}
        <div className="px-5 py-3.5 flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={exporting}
            className="px-4 py-2 rounded-lg border border-white/[0.07] text-[13px] text-neutral-400 hover:text-white hover:border-white/[0.13] transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || done}
            className={cn(
              'flex-1 py-2 rounded-lg text-[13px] font-bold text-black flex items-center justify-center gap-2 transition-all disabled:opacity-60',
              done ? 'bg-green-500' : 'bg-[#F5A623] hover:bg-amber-400'
            )}
          >
            {done ? (
              <><CheckCircle2 className="h-4 w-4" /> Done</>
            ) : exporting ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Encoding…</>
            ) : (
              <><Download className="h-4 w-4" /> Export Now</>
            )}
          </button>
          <div className="text-right flex-shrink-0">
            <div className="text-[11px] font-semibold text-white">{EST_SIZES[resolution][format]}</div>
            <div className="text-[10px] text-neutral-600">estimated</div>
          </div>
        </div>

      </div>
    </div>
  )
}
