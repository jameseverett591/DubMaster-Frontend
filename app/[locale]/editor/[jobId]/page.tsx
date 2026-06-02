'use client'

import { use, useState, useEffect, useRef, useCallback } from 'react'
import { DubVerseEditor } from '@/components/editor/dubverse-editor'
import { LoadingSpinner } from '@/components/loading-spinner'
import { ErrorBoundary } from '@/components/error-boundary'
import type { Segment, QCFinding } from '@/lib/editor-types'

import { apiClient } from '@/lib/api-client'
import { createClient } from '@/lib/supabase/client'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

// Stable identity for empty findings — avoids a new [] reference on every render
// which would otherwise re-trigger the editor's init effects (clobbering speaker
// voice assignments, traits, etc.) on every parent re-render (e.g. QC poll).
const NO_FINDINGS: QCFinding[] = []

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

  // QC state — populated concurrently while editor loads
  const [qcAnalysis, setQcAnalysis] = useState<any>(null)
  const [qcLoading, setQcLoading] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [qcUpdatedAt, setQcUpdatedAt] = useState<string | null>(null)
  const [reanalyzeNonce, setReanalyzeNonce] = useState(0)
  // A manual re-analyze in flight: stamp 'Updated' only for these, and accept a
  // result only once its generated_at differs from the one we started with
  // (the GET endpoint can serve the prior result mid-run).
  const reanalyzePendingRef = useRef(false)
  const reanalyzePrevGenRef = useRef<string | null>(null)

  useEffect(() => {
    localStorage.setItem('dubverse.lastEditorJobId', jobId)
  }, [jobId])

  // Set API client auth token from Supabase session
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.access_token) {
        apiClient.setToken(data.session.access_token)
      }
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        apiClient.setToken(session?.access_token ?? null)
      }
    )
    return () => subscription.unsubscribe()
  }, [])

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
        const persistedTraitsMapping: Record<string, string[]> | undefined = (status as any).traits_mapping ?? undefined

        // Cache-bust audio URLs at load time: filenames are stable across
        // regenerates ("segment_NNNN_regen.mp3"), so without a fresh query
        // param the browser would re-use stale cached mp3s from a previous
        // version of this segment's audio. A new timestamp per page load
        // guarantees fresh fetches every time the editor opens.
        const cacheBustTs = Date.now()

        const editorSegments: Segment[] = (segmentsData?.segments || []).map((seg: any, idx: number) => {
          const speakerId = `speaker-${String(seg.speaker ?? '').replace(/\D/g, '') || '1'}`
          const gender = speakerGenders[speakerId] as 'male' | 'female' | 'child' | undefined
          return {
            id: `segment-${idx}`,
            index: idx,
            status: seg.locked ? 'locked' : 'auto',
            start_time: seg.committed_start_time ?? seg.start ?? 0,
            end_time: seg.committed_end_time ?? seg.end ?? 0,
            source_text: sourceByIndex.get(seg.transcript_index ?? idx) ?? '',
            target_text: seg.text ?? '',
            active_text: seg.text ?? '',
            preview_text: null,
            isPreviewing: false,
            speaker_id: speakerId,
            speaker_label: seg.speaker ?? 'Speaker 1',
            speaker_gender: gender,
            audio_url: seg.path ? `${seg.path}?ts=${cacheBustTs}` : undefined,
            committed_audio_url: seg.committed_audio_url ? `${seg.committed_audio_url}?ts=${cacheBustTs}` : undefined,
            committed_adapted_text: seg.committed_adapted_text ?? undefined,
            committed_start_time: seg.committed_start_time ?? undefined,
            committed_end_time: seg.committed_end_time ?? undefined,
            committed_emotion: seg.emotion ?? undefined,
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
          traitsMapping: persistedTraitsMapping,
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
    let attempts = 0
    // Captured when the effect arms; handleReanalyze sets it before bumping the nonce.
    const prevGen = reanalyzePrevGenRef.current

    async function checkQC() {
      // Safety cap (~5 min at 5s) so a backend error can't poll forever.
      if (attempts >= 60) {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
        reanalyzePendingRef.current = false
        if (!cancelled) setQcLoading(false)
        return
      }
      attempts += 1
      try {
        const res = await fetch(`${API_BASE}/api/analysis/${jobId}/${lang}`)
        if (res.ok) {
          const data = await res.json()
          if (data.status === 'complete' && data.analysis) {
            // During a manual re-analyze, ignore the prior (stale) result the GET
            // endpoint may still serve until the new run finishes.
            if (reanalyzePendingRef.current && data.analysis.generated_at === prevGen) {
              if (!cancelled) setQcLoading(true)
              return
            }
            if (!cancelled) {
              setQcAnalysis(data.analysis)
              if (reanalyzePendingRef.current) {
                setQcUpdatedAt(new Date().toISOString())
                reanalyzePendingRef.current = false
              }
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
  }, [jobId, editorProps, reanalyzeNonce])

  // Manual re-analyze: re-run QC on the last rendered dubbed video, then re-arm
  // the poll effect above (which stops after the first result) to pick up the
  // fresh score.
  const handleReanalyze = useCallback(async () => {
    if (!editorProps || qcLoading) return
    const lang = editorProps.targetLangCode || 'en'
    setQcLoading(true)
    let res: Response | null = null
    try {
      res = await fetch(`${API_BASE}/api/analyze/${jobId}/${lang}`, { method: 'POST' })
    } catch {}
    if (!res || !res.ok) {
      // No dubbed video to analyze (404) or network error — abort cleanly.
      setQcLoading(false)
      return
    }
    reanalyzePrevGenRef.current = qcAnalysis?.generated_at ?? null
    reanalyzePendingRef.current = true
    setQcUpdatedAt(null)
    setReanalyzeNonce((n) => n + 1)
  }, [editorProps, jobId, qcLoading, qcAnalysis])

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
        qcFindings={NO_FINDINGS}
        qcAnalysis={qcAnalysis}
        qcLoading={qcLoading}
        qcUpdatedAt={qcUpdatedAt}
        canReanalyze={!!editorProps.dubbedVideoUrl}
        onReanalyze={handleReanalyze}
        pointsLeft={100}
        minutesAvailable={60}
        speakerGenders={editorProps.speakerGenders}
        voiceMapping={editorProps.voiceMapping}
        traitsMapping={editorProps.traitsMapping}
        onExport={() => {}}
        onShare={() => {}}
        onGenerateSpeech={() => {}}
        onTranslateAndDub={() => {}}
      />
    </ErrorBoundary>
  )
}
