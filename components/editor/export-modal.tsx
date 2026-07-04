'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Download, Loader2, X, Folder, CheckCircle2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiClient } from '@/lib/api-client'

type Resolution = '720p' | '1080p' | '4k'
type Aspect     = 'widescreen' | 'fill'
type Format     = 'mp4' | 'mov' | 'avi' | 'mkv'
type Stage      = 'config' | 'exporting' | 'done' | 'error'

interface ExportModalProps {
  jobId: string
  title?: string
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

const STATUS_LABEL: Record<string, string> = {
  preparing: 'Preparing…',
  exporting: 'Exporting…',
  done:      'Finalizing…',
}

export function ExportModal({ jobId, title, onClose }: ExportModalProps) {
  const [resolution, setResolution] = useState<Resolution>('1080p')
  const [aspect,     setAspect]     = useState<Aspect>('widescreen')
  const [format,     setFormat]     = useState<Format>('mp4')
  const [destLabel,  setDestLabel]  = useState('')
  const [fileHandle, setFileHandle] = useState<any>(null)
  const [stage,      setStage]      = useState<Stage>('config')
  const [pct,        setPct]        = useState(0)
  const [statusMsg,  setStatusMsg]  = useState('Preparing…')
  const [exportId,   setExportId]   = useState<string | null>(null)
  const [dlFilename, setDlFilename] = useState('')
  const [dlUrl,      setDlUrl]      = useState('')
  const [error,      setError]      = useState<string | null>(null)
  const pollRef   = useRef<ReturnType<typeof setInterval> | null>(null)
  const barRef    = useRef<HTMLDivElement>(null)

  // Drive progress bar width via DOM ref — avoids JSX inline style lint warning
  useEffect(() => {
    barRef.current?.style.setProperty('--progress', `${pct}%`)
  }, [pct])

  const suggestedName = `dubmaster_${resolution}_${aspect}.${format}`

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  useEffect(() => () => stopPolling(), [stopPolling])

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

  const triggerDownload = useCallback(async (filename: string, downloadUrl: string, handle: any) => {
    const fullUrl = apiClient.getExportDownloadUrl(jobId, filename)
    if (handle) {
      try {
        const blob = await (await fetch(fullUrl)).blob()
        const writable = await handle.createWritable()
        await writable.write(blob)
        await writable.close()
        return
      } catch { /* fall through */ }
    }
    if (hasSavePicker) {
      try {
        const h = await (window as any).showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: 'Video', accept: { [MIME[format]]: [`.${format}`] } }],
        })
        const blob = await (await fetch(fullUrl)).blob()
        const w = await h.createWritable()
        await w.write(blob); await w.close()
        return
      } catch (e: any) { if (e?.name === 'AbortError') return }
    }
    const a = document.createElement('a')
    a.href = fullUrl; a.download = filename
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }, [jobId, format, fileHandle])

  const handleExport = async () => {
    setStage('exporting')
    setError(null)
    setPct(0)
    setStatusMsg('Preparing…')
    try {
      const result = await apiClient.exportVideo(jobId, resolution, aspect, format)
      setExportId(result.export_id)
      setDlFilename(result.filename)

      pollRef.current = setInterval(async () => {
        try {
          const prog = await apiClient.getExportProgress(result.export_id)
          setPct(prog.pct)
          setStatusMsg(STATUS_LABEL[prog.status] ?? prog.status)
          setDlUrl(prog.download_url)

          if (prog.status === 'done') {
            stopPolling()
            setStatusMsg('Done ✓')
            setPct(100)
            setStage('done')
            await triggerDownload(prog.filename, prog.download_url, fileHandle)
          } else if (prog.status === 'error') {
            stopPolling()
            setError(prog.error ?? 'Export failed')
            setStage('error')
          } else if (prog.status === 'cancelled') {
            stopPolling()
            onClose()
          }
        } catch { /* network blip, keep polling */ }
      }, 600)
    } catch (e: any) {
      setError(e.message || 'Export failed — please try again')
      setStage('error')
    }
  }

  const handleCancel = async () => {
    stopPolling()
    if (exportId) await apiClient.cancelExport(exportId).catch(() => {})
    onClose()
  }

  const hintText = fileHandle ? null
    : hasSavePicker
      ? 'Click Browse to choose where to save — Chrome & Edge on Windows and Mac.'
      : 'Safari & Firefox: file saves to your Downloads folder.'

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
              <div className="text-[11px] text-neutral-500 leading-tight mt-0.5 font-mono truncate max-w-[200px]">
                {title ?? jobId.slice(0, 8) + '…'} · {format.toUpperCase()}
              </div>
            </div>
          </div>
          <button type="button" onClick={stage === 'exporting' ? handleCancel : onClose}
            aria-label="Close export dialog"
            className="w-6 h-6 rounded-md flex items-center justify-center text-neutral-500 hover:text-white hover:bg-white/8 transition-colors">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* ── CONFIG PANEL ── */}
        {stage === 'config' && (
          <div className="px-5 py-4 flex flex-col gap-4">
            {/* Resolution */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500 mb-2">Resolution</p>
              <div className="flex gap-1.5">
                {RESOLUTIONS.map(r => (
                  <button type="button" key={r.value} onClick={() => setResolution(r.value)}
                    className={cn('flex-1 rounded-lg border py-2 text-center transition-colors',
                      resolution === r.value
                        ? 'border-amber-500/50 bg-amber-500/[0.08] text-amber-400'
                        : 'border-white/[0.07] bg-[#1E1E24] text-neutral-400 hover:border-white/[0.13] hover:text-white')}>
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
                  <button type="button" key={a.value} onClick={() => setAspect(a.value)}
                    className={cn('flex-1 rounded-lg border px-3 py-2 text-left transition-colors',
                      aspect === a.value
                        ? 'border-amber-500/50 bg-amber-500/[0.08] text-amber-400'
                        : 'border-white/[0.07] bg-[#1E1E24] text-neutral-400 hover:border-white/[0.13] hover:text-white')}>
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
                  <button type="button" key={f.value} onClick={() => setFormat(f.value)}
                    className={cn('flex-1 rounded-lg border py-2 text-[12px] font-semibold transition-colors',
                      format === f.value
                        ? 'border-amber-500/50 bg-amber-500/[0.08] text-amber-400'
                        : 'border-white/[0.07] bg-[#1E1E24] text-neutral-400 hover:border-white/[0.13] hover:text-white')}>
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
                  <input type="text" value={destLabel}
                    onChange={e => { setDestLabel(e.target.value); setFileHandle(null) }}
                    placeholder={suggestedName} spellCheck={false}
                    className={cn(
                      'w-full pl-8 pr-3 py-2 rounded-lg border bg-[#1E1E24] text-[11.5px] font-mono text-white placeholder:text-neutral-600 outline-none transition-colors',
                      destLabel ? 'border-amber-500/40' : 'border-white/[0.07]'
                    )} />
                </div>
                {hasSavePicker && (
                  <button type="button" onClick={handleBrowse}
                    className="px-3 rounded-lg border border-white/[0.07] bg-[#1E1E24] text-[12px] font-medium text-neutral-400 hover:text-white hover:border-white/[0.13] transition-colors flex items-center gap-1.5 whitespace-nowrap">
                    <Folder className="h-3 w-3" /> Browse
                  </button>
                )}
              </div>
              {hintText && <p className="text-[10.5px] text-neutral-600 mt-1.5">{hintText}</p>}
              {fileHandle && (
                <p className="text-[10.5px] text-amber-500/70 mt-1.5 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Saving to {fileHandle.name}
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── PROGRESS CARD ── */}
        {(stage === 'exporting' || stage === 'done') && (
          <div className="px-5 py-6 flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5',
                stage === 'done' ? 'bg-green-500/15' : 'bg-amber-500/10')}>
                {stage === 'done'
                  ? <CheckCircle2 className="h-5 w-5 text-green-400" />
                  : <Loader2 className="h-5 w-5 text-amber-400 animate-spin" />
                }
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-white truncate">
                  {title ?? jobId.slice(0, 12) + '…'}
                </div>
                <div className="text-[11px] text-neutral-500 font-mono truncate mt-0.5">
                  {destLabel || suggestedName}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-[13px] font-bold text-white">{pct}%</div>
                <div className="text-[10px] text-neutral-500 mt-0.5">{statusMsg}</div>
              </div>
            </div>

            {/* Progress bar — width driven via ref.style.setProperty to avoid JSX inline style lint */}
            <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                ref={barRef}
                className={cn(
                  'h-full rounded-full transition-all duration-500 [width:var(--progress,0%)]',
                  stage === 'done' ? 'bg-green-500' : 'bg-amber-500'
                )}
              />
            </div>

            <div className="flex gap-2 text-[10.5px] text-neutral-600">
              <span className="flex-1">{EST_SIZES[resolution][format]} · {resolution} {format.toUpperCase()}</span>
              {stage === 'done' && <span className="text-green-400 font-medium">Download started</span>}
            </div>
          </div>
        )}

        {/* ── ERROR CARD ── */}
        {stage === 'error' && (
          <div className="px-5 py-6 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-red-500/10">
                <AlertCircle className="h-5 w-5 text-red-400" />
              </div>
              <div>
                <div className="text-[13px] font-semibold text-white">Export failed</div>
                <div className="text-[11px] text-neutral-500 mt-0.5">{error}</div>
              </div>
            </div>
          </div>
        )}

        <div className="h-px bg-white/[0.07]" />

        {/* Footer */}
        <div className="px-5 py-3.5 flex items-center gap-2">
          {stage === 'config' && (
            <>
              <button type="button" onClick={onClose}
                className="px-4 py-2 rounded-lg border border-white/[0.07] text-[13px] text-neutral-400 hover:text-white hover:border-white/[0.13] transition-colors">
                Cancel
              </button>
              <button type="button" onClick={handleExport}
                className="flex-1 py-2 rounded-lg bg-[#F5A623] hover:bg-amber-400 text-[13px] font-bold text-black flex items-center justify-center gap-2 transition-colors">
                <Download className="h-4 w-4" /> Export Now
              </button>
              <div className="text-right flex-shrink-0">
                <div className="text-[11px] font-semibold text-white">{EST_SIZES[resolution][format]}</div>
                <div className="text-[10px] text-neutral-600">estimated</div>
              </div>
            </>
          )}
          {stage === 'exporting' && (
            <button type="button" onClick={handleCancel}
              className="flex-1 py-2 rounded-lg border border-white/[0.07] text-[13px] text-neutral-400 hover:text-red-400 hover:border-red-500/30 transition-colors">
              Cancel Export
            </button>
          )}
          {stage === 'done' && (
            <button type="button" onClick={onClose}
              className="flex-1 py-2 rounded-lg bg-green-500 hover:bg-green-400 text-[13px] font-bold text-black flex items-center justify-center gap-2 transition-colors">
              <CheckCircle2 className="h-4 w-4" /> Done
            </button>
          )}
          {stage === 'error' && (
            <>
              <button type="button" onClick={onClose}
                className="px-4 py-2 rounded-lg border border-white/[0.07] text-[13px] text-neutral-400 hover:text-white transition-colors">
                Close
              </button>
              <button type="button" onClick={() => { setStage('config'); setError(null) }}
                className="flex-1 py-2 rounded-lg bg-[#F5A623] text-[13px] font-bold text-black transition-colors">
                Try Again
              </button>
            </>
          )}
        </div>

      </div>
    </div>
  )
}
