'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Header } from '@/components/header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Film, Download, Loader2, AlertCircle } from 'lucide-react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

type ShareInfo = {
  title: string
  source_language?: string
  target_language?: string
  video_url: string
  download_url?: string
  expires_in?: number
}

export default function SharePage() {
  const params = useParams()
  const token = String(params?.token || '')
  const [info, setInfo] = useState<ShareInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    fetch(`${API_BASE}/api/share/${token}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('This share link is invalid or has expired')
        return res.json()
      })
      .then((data) => { if (!cancelled) { setInfo(data); setLoading(false) } })
      .catch((e) => { if (!cancelled) { setError(e.message || 'Share link unavailable'); setLoading(false) } })
    return () => { cancelled = true }
  }, [token])

  const videoSrc = info ? `${API_BASE}${info.video_url}` : ''
  const downloadSrc = info ? `${API_BASE}${info.download_url || info.video_url + '&dl=1'}` : ''

  return (
    <div className="min-h-screen bg-neutral-950 text-slate-100">
      <Header />
      <main className="mx-auto max-w-4xl px-4 py-10">
        <div className="mb-6 flex items-center gap-3">
          <Film className="h-6 w-6 text-amber-400" />
          <div>
            <h1 className="text-xl font-semibold">{info?.title || 'Shared dub'}</h1>
            <p className="text-xs text-slate-400">
              {info?.source_language && info?.target_language
                ? `${info.source_language} → ${info.target_language} · dubbed with DubMaster`
                : 'Shared with you via DubMaster'}
            </p>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-32 text-slate-400">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading shared video…
          </div>
        )}

        {error && !loading && (
          <Card className="border-neutral-800 bg-neutral-900">
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <AlertCircle className="h-8 w-8 text-amber-400" />
              <p className="text-sm text-slate-300">{error}</p>
              <p className="text-xs text-slate-500">Ask the sender to create a new share link.</p>
            </CardContent>
          </Card>
        )}

        {info && !loading && (
          <>
            <div className="overflow-hidden rounded-xl border border-neutral-800 bg-black">
              <video src={videoSrc} controls playsInline className="aspect-video w-full" />
            </div>
            <div className="mt-4 flex items-center justify-between">
              <p className="text-xs text-slate-500">This link expires — download a copy if you need it.</p>
              <a href={downloadSrc}>
                <Button size="sm" className="bg-amber-500 text-black hover:bg-amber-600">
                  <Download className="mr-1.5 h-4 w-4" /> Download MP4
                </Button>
              </a>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
