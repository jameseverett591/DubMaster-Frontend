'use client'

import { use, useState, useEffect } from 'react'
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

  useEffect(() => {
    localStorage.setItem('dubverse.lastEditorJobId', jobId)
  }, [jobId])

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

        // Build source text lookup from transcript
        const sourceByIndex = new Map<number, string>()
        if (transcript?.segments) {
          ;(transcript.segments as Array<{ text: string }>).forEach((seg, idx) => {
            sourceByIndex.set(idx, seg.text)
          })
        }

        // Map API segments → editor Segment type
        const editorSegments: Segment[] = (segmentsData?.segments || []).map((seg: any, idx: number) => ({
          id: `segment-${idx}`,
          index: idx,
          status: seg.locked ? 'locked' : 'auto',
          start_time: seg.start ?? 0,
          end_time: seg.end ?? 0,
          source_text: sourceByIndex.get(seg.transcript_index ?? idx) ?? '',
          target_text: seg.text ?? '',
          speaker_id: `speaker-${String(seg.speaker ?? '').replace(/\D/g, '') || '1'}`,
          speaker_label: seg.speaker ?? 'Speaker 1',
          audio_url: seg.path,
          qc_findings: seg.qc_findings ?? [],
        }))

        setEditorProps({
          title: status.video_filename || `Job ${jobId.slice(0, 8)}`,
          sourceLanguage: transcript?.language || 'Source',
          targetLanguage: segmentsData?.language || 'Target',
          // video_url from /api/status is "/api/media/{id}/video" — convert to absolute
          videoUrl: toAbsoluteUrl(status.video_url || `/api/media/${jobId}/video`),
          // dubbed_video_url is "/api/download/{id}/en" — filesystem-based, no job-in-memory needed
          dubbedVideoUrl: status.dubbed_video_url ? toAbsoluteUrl(status.dubbed_video_url) : null,
          videoDuration: segmentsData?.video_duration ?? status.video_duration ?? 0,
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
        pointsLeft={100}
        minutesAvailable={60}
        onExport={() => {}}
        onShare={() => {}}
        onGenerateSpeech={() => {}}
        onTranslateAndDub={() => {}}
      />
    </ErrorBoundary>
  )
}
