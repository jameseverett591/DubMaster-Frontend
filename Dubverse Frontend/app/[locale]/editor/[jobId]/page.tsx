'use client'

import { use, useState, useEffect, useRef } from 'react'
import { DubVerseEditor } from '@/components/editor/dubverse-editor'
import { LoadingSpinner } from '@/components/loading-spinner'
import { ErrorBoundary } from '@/components/error-boundary'
import type { Segment } from '@/lib/editor-types'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

function toAbsoluteUrl(url: string): string {
  if (!url) return ''
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  return `${API_BASE}${url.startsWith('/') ? url : `/${url}`}`
}

export default function EditorJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = use(params)
  const [editorProps, setEditorProps] = useState<any>(null)
  const [segments, setSegments] = useState<Segment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [rptVideoUrl, setRptVideoUrl] = useState<string | null>(null)

  // QC state — populated concurrently while editor loads
  const [qcAnalysis, setQcAnalysis] = useState<any>(null)
  const [qcLoading, setQcLoading] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    localStorage.setItem('dubverse.lastEditorJobId', jobId)
  }, [jobId])

  // Load job data
  useEffect(() => {
    async function loadJob() {
      try {
        const [statusRes, segmentsRes, transcriptRes] = await Promise.allSettled([
          fetch(`${API_BASE}/api/status/${jobId}`),
          fetch(`${API_BASE}/api/segments/${jobId}`),
          fetch(`${API_BASE}/api/transcript/${jobId}`),
        ])

        const statusFetch = statusRes.status === 'fulfilled' ? statusRes.value : null
        if (!statusFetch || statusFetch.status === 404) throw new Error('Job not found')
        if (!statusFetch.ok) throw new Error('Failed to load job')
        const status = await statusFetch.json()

        const segFetch = segmentsRes.status === 'fulfilled' ? segmentsRes.value : null
        const segmentsData = segFetch?.ok ? await segFetch.json() : null

        const txFetch = transcriptRes.status === 'fulfilled' ? transcriptRes.value : null
        const transcript = txFetch?.ok ? await txFetch.json() : null

        const sourceByIndex = new Map<number, string>()
        if (transcript?.segments) {
          ;(transcript.segments as Array<{ text: string }>).forEach((seg, idx) => {
            sourceByIndex.set(idx, seg.text)
          })
        }

        const speakerGenders: Record<string, string> = status.speaker_genders ?? {}
        const persistedVoiceMapping: Record<string, string> | undefined = status.voice_mapping ?? undefined

        const editorSegments: Segment[] = (segmentsData?.segments || []).map((seg: any, idx: number) => {
          const speakerId = `speaker-${String(seg.speaker ?? '').replace(/\D/g, '') || '1'}`
          const gender = speakerGenders[speakerId] as 'male' | 'female' | 'child' | undefined
          return {
            id: `segment-${idx}`,
            index: idx,
            status: seg.locked ? 'locked' : 'auto',
            start_time: seg.start ?? 0,
            end_time: seg.end ?? 0,
            source_text: sourceByIndex.get(seg.transcript_index ?? idx) ?? '',
            target_text: seg.text ?? '',
            active_text: seg.text ?? '',
            preview_text: null,
            isPreviewing: false,
            speaker_id: speakerId,
            speaker_label: seg.speaker ?? 'Speaker 1',
            speaker_gender: gender,
            audio_url: seg.path,
            qc_findings: seg.qc_findings ?? [],
            emotionalCurve: {
              combined: [
                { x: 0, y: 0.5 },
                { x: 1, y: 0.5 }
              ],
              locked: false,
              analysis: {
                facial: [],
                vocal: [],
                scene: []
              }
            },
          }
        })

        const targetLang = (segmentsData?.language || 'en').toLowerCase()

        // Fire RPT init — creates working copy if it doesn't exist yet
        if (status.dubbed_video_url) {
          fetch(`${API_BASE}/api/dub/rpt-init/${jobId}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('sb-access-token') ?? ''}`,
            },
          })
            .then(r => r.ok ? r.json() : null)
            .then(data => {
              if (data?.rpt_video_url) {
                setRptVideoUrl(`${API_BASE}${data.rpt_video_url}`)
              }
            })
            .catch(() => {}) // silent — editor works without RPT copy
        }

        setEditorProps({
          title: status.video_filename || `Job ${jobId.slice(0, 8)}`,
          sourceLanguage: transcript?.language || 'Source',
          targetLanguage: segmentsData?.language || 'Target',
          targetLangCode: targetLang,
          videoUrl: toAbsoluteUrl(status.video_url || `/api/media/${jobId}/video`),
          dubbedVideoUrl: status.dubbed_video_url ? toAbsoluteUrl(status.dubbed_video_url) : null,
          videoDuration: segmentsData?.video_duration ?? status.video_duration ?? 0,
          speakerGenders,
          voiceMapping: persistedVoiceMapping,
        })
        setSegments(editorSegments)
      } catch (e: any) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    loadJob()
  }, [jobId])

  // QC fetch + poll — starts after job data is loaded and target language is known
  useEffect(() => {
    if (!editorProps) return

    const lang = editorProps.targetLangCode || 'en'
    let cancelled = false

    async function checkQC() {
      try {
        const res = await fetch(`${API_BASE}/api/analysis/${jobId}/${lang}`)
        if (res.ok) {
          const data = await res.json()
          if (data.status === 'complete' && data.analysis) {
            if (!cancelled) {
              setQcAnalysis(data.analysis)
              setQcLoading(false)
              if (pollRef.current) {
                clearInterval(pollRef.current)
                pollRef.current = null
              }
            }
          } else if (data.status === 'running') {
            if (!cancelled) setQcLoading(true)
          }
        } else if (res.status === 202) {
          if (!cancelled) setQcLoading(true)
        } else if (res.status === 404) {
          // Not yet triggered — kick it off
          try {
            await fetch(`${API_BASE}/api/analyze/${jobId}/${lang}`, { method: 'POST' })
          } catch {}
          if (!cancelled) setQcLoading(true)
        }
      } catch {
        // Network error — keep polling silently
      }
    }

    checkQC()
    pollRef.current = setInterval(checkQC, 5000)

    return () => {
      cancelled = true
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [jobId, editorProps])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-950">
        <LoadingSpinner />
      </div>
    )
  }

  if (error || !editorProps) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-950 text-white gap-4">
        <h2 className="text-xl font-semibold">Job Not Found</h2>
        <p className="text-slate-400">Could not load job {jobId}</p>
      </div>
    )
  }

  return (
    <ErrorBoundary>
      <DubVerseEditor
        jobId={jobId}
        title={editorProps.title}
        sourceLanguage={editorProps.sourceLanguage}
        targetLanguage={editorProps.targetLanguage}
        videoUrl={editorProps.videoUrl}
        dubbedVideoUrl={editorProps.dubbedVideoUrl}
        videoDuration={editorProps.videoDuration}
        segments={segments}
        qcScore={null}
        qcFindings={[]}
        qcAnalysis={qcAnalysis}
        qcLoading={qcLoading}
        pointsLeft={100}
        minutesAvailable={60}
        speakerGenders={editorProps.speakerGenders}
        voiceMapping={editorProps.voiceMapping}
        rptVideoUrl={rptVideoUrl}
        onExport={() => {}}
        onShare={() => {}}
        onGenerateSpeech={() => {}}
        onTranslateAndDub={() => {}}
      />
    </ErrorBoundary>
  )
}
