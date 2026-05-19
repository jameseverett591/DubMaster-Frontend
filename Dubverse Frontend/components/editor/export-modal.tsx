'use client'

import { useState } from 'react'
import { Download, X, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiClient } from '@/lib/api-client'

type Resolution = '720p' | '1080p' | '4k'
type Aspect = 'widescreen' | 'fill'
type Format = 'mp4' | 'mov' | 'avi' | 'mkv'

interface ExportModalProps {
  jobId: string
  onClose: () => void
}

const RESOLUTIONS: { value: Resolution; label: string; sub: string }[] = [
  { value: '720p',  label: '720p',  sub: '1280 × 720' },
  { value: '1080p', label: '1080p', sub: '1920 × 1080' },
  { value: '4k',    label: '4K',    sub: '3840 × 2160' },
]

const ASPECTS: { value: Aspect; label: string; sub: string }[] = [
  { value: 'widescreen', label: 'Widescreen', sub: '16:9 — letterbox if needed' },
  { value: 'fill',       label: 'Fill Screen', sub: 'Crop to fill frame' },
]

const FORMATS: { value: Format; label: string }[] = [
  { value: 'mp4', label: 'MP4' },
  { value: 'mov', label: 'MOV' },
  { value: 'avi', label: 'AVI' },
  { value: 'mkv', label: 'MKV' },
]

export function ExportModal({ jobId, onClose }: ExportModalProps) {
  const [resolution, setResolution] = useState<Resolution>('1080p')
  const [aspect, setAspect] = useState<Aspect>('widescreen')
  const [format, setFormat] = useState<Format>('mp4')
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleExport = async () => {
    setExporting(true)
    setError(null)
    try {
      const result = await apiClient.exportVideo(jobId, resolution, aspect, format)
      const downloadUrl = apiClient.getExportDownloadUrl(jobId, result.filename)

      // Try File System Access API for native OS save dialog
      if ('showSaveFilePicker' in window) {
        try {
          const ext = result.filename.split('.').pop() ?? format
          const mimeTypes: Record<string, string> = {
            mp4: 'video/mp4', mov: 'video/quicktime',
            avi: 'video/x-msvideo', mkv: 'video/x-matroska',
          }
          const fileHandle = await (window as any).showSaveFilePicker({
            suggestedName: result.filename,
            types: [{
              description: `${ext.toUpperCase()} Video`,
              accept: { [mimeTypes[ext] ?? 'video/mp4']: [`.${ext}`] },
            }],
          })
          const response = await fetch(downloadUrl)
          const blob = await response.blob()
          const writable = await fileHandle.createWritable()
          await writable.write(blob)
          await writable.close()
          onClose()
          return
        } catch (err: any) {
          // User cancelled picker or API unavailable — fall through to download
          if (err?.name === 'AbortError') { onClose(); return }
        }
      }

      // Fallback: browser download
      const a = document.createElement('a')
      a.href = downloadUrl
      a.download = result.filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      onClose()
    } catch (e: any) {
      setError(e.message || 'Export failed — please try again')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-neutral-900 border border-neutral-700 rounded-xl w-full max-w-md p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Download className="h-5 w-5 text-amber-400" />
            <h2 className="text-base font-semibold text-white">Export Video</h2>
          </div>
          <button
            onClick={onClose}
            disabled={exporting}
            className="text-neutral-400 hover:text-white transition-colors disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Resolution */}
        <div className="mb-5">
          <p className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-2">Resolution</p>
          <div className="grid grid-cols-3 gap-2">
            {RESOLUTIONS.map(r => (
              <button
                key={r.value}
                onClick={() => setResolution(r.value)}
                className={cn(
                  'flex flex-col items-center py-2.5 rounded-lg border text-sm transition-colors',
                  resolution === r.value
                    ? 'border-amber-500 bg-amber-500/10 text-amber-300'
                    : 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-white'
                )}
              >
                <span className="font-semibold">{r.label}</span>
                <span className="text-[10px] mt-0.5 opacity-70">{r.sub}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Aspect Ratio */}
        <div className="mb-5">
          <p className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-2">Aspect Ratio</p>
          <div className="grid grid-cols-2 gap-2">
            {ASPECTS.map(a => (
              <button
                key={a.value}
                onClick={() => setAspect(a.value)}
                className={cn(
                  'flex flex-col items-start px-3 py-2.5 rounded-lg border text-sm transition-colors',
                  aspect === a.value
                    ? 'border-amber-500 bg-amber-500/10 text-amber-300'
                    : 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-white'
                )}
              >
                <span className="font-semibold">{a.label}</span>
                <span className="text-[10px] mt-0.5 opacity-70">{a.sub}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Format */}
        <div className="mb-6">
          <p className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-2">Format</p>
          <div className="grid grid-cols-4 gap-2">
            {FORMATS.map(f => (
              <button
                key={f.value}
                onClick={() => setFormat(f.value)}
                className={cn(
                  'py-2 rounded-lg border text-sm font-semibold transition-colors',
                  format === f.value
                    ? 'border-amber-500 bg-amber-500/10 text-amber-300'
                    : 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-white'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={exporting}
            className="flex-1 py-2 rounded-lg border border-neutral-700 text-sm text-neutral-400 hover:text-white hover:border-neutral-500 transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex-1 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {exporting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Encoding…
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                Export Now
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
