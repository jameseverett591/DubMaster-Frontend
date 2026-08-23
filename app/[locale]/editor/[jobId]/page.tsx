'use client'

import { use, useState, useEffect, useRef, useCallback } from 'react'
import { DubVerseEditor } from '@/components/editor/dubverse-editor'
import { LoadingSpinner } from '@/components/loading-spinner'
import { ErrorBoundary } from '@/components/error-boundary'
import type { Segment, QCFinding } from '@/lib/editor-types'
import { newSegmentId } from '@/lib/editor-types'

import { apiClient } from '@/lib/api-client'
import { createClient } from '@/lib/supabase/client'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

// Stable identity for empty findings — avoids a new [] reference on every render
// which would otherwise re-trigger the editor's init effects (clobbering speaker
// voice assignments, traits, etc.) on every parent re-render (e.g. QC poll).
const NO_FINDINGS: QCFinding[] = []

// Delegates to the client's version, which attaches the access token to media
// URLs. A local copy silently produced token-less /api/media/{job}/video URLs
// and the player just went black.
function toAbsoluteUrl(url: string): string {
  return apiClient.toAbsoluteUrl(url)
}

export default function EditorJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = use(params)
  const [editorProps, setEditorProps] = useState<any>(null)
  const [segments, setSegments] = useState<Segment[]>([])
  const [snapshotSegments, setSnapshotSegments] = useState<Segment[]>([])
  // Chunk-lens state and the deletion countdown both ride along on the segments
  // response. Without forwarding them the countdown card can never appear.
  const [chunkStatus, setChunkStatus] = useState<Record<string, string> | undefined>(undefined)
  const [retention, setRetention] = useState<any>(undefined)
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
      (event, session) => {
        // Only ever CLEAR on an explicit sign-out. Supabase fires events such as
        // INITIAL_SESSION and TOKEN_REFRESHED that can carry a null session while
        // the user is still signed in, and clearing on those disarmed the API
        // client: the UI kept showing the signed-in user (read from the earlier
        // getSession) while every authenticated request went out with no token
        // and came back 401.
        if (session?.access_token) {
          apiClient.setToken(session.access_token)
        } else if (event === 'SIGNED_OUT') {
          apiClient.setToken(null)
        }
      }
    )
    return () => subscription.unsubscribe()
  }, [])

  // Load job data
  useEffect(() => {
    async function safeJson(res: Response): Promise<any> {
      try {
        const text = await res.text()
        if (!text || text.trim() === '') return null
        return JSON.parse(text)
      } catch {
        return null
      }
    }

    async function loadJob() {
      try {
        const [statusRes, segmentsRes, transcriptRes, snapshotRes] = await Promise.allSettled([
          fetch(`${API_BASE}/api/status/${jobId}`, { headers: await apiClient.ensureAuthHeaders() }),
          fetch(`${API_BASE}/api/segments/${jobId}`, { headers: await apiClient.ensureAuthHeaders() }),
          fetch(`${API_BASE}/api/transcript/${jobId}`, { headers: await apiClient.ensureAuthHeaders() }),
          fetch(`${API_BASE}/api/segments/${jobId}/snapshot`, { headers: await apiClient.ensureAuthHeaders() }),
        ])

        const statusFetch = statusRes.status === 'fulfilled' ? statusRes.value : null
        if (!statusFetch || statusFetch.status === 404) throw new Error('Job not found')
        if (!statusFetch.ok) throw new Error('Failed to load job')
        const status = await statusFetch.json()

        const segFetch = segmentsRes.status === 'fulfilled' ? segmentsRes.value : null
        const segmentsData = segFetch?.ok ? await safeJson(segFetch) : null

        const txFetch = transcriptRes.status === 'fulfilled' ? transcriptRes.value : null
        const transcript = txFetch?.ok ? await safeJson(txFetch) : null

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

        // Map Velma emotion label to a normalised intensity [0,1] for the curve
        function velmaEmotionToIntensity(emotion: string | null | undefined): number {
          switch ((emotion ?? '').toLowerCase()) {
            case 'neutral':    return 0.25
            case 'calm':       return 0.20
            case 'happy': case 'joy': return 0.65
            case 'sad': case 'sadness': return 0.45
            case 'angry': case 'anger': return 0.85
            case 'fear': case 'fearful': return 0.75
            case 'disgusted': case 'disgust': return 0.70
            case 'surprised': case 'surprise': return 0.60
            default:           return 0.30
          }
        }

        const editorSegments: Segment[] = (segmentsData?.segments || []).map((seg: any, idx: number) => {
          const speakerId = `speaker-${String(seg.speaker ?? '').replace(/\D/g, '') || '1'}`
          const gender = speakerGenders[speakerId] as 'male' | 'female' | 'child' | undefined
          return {
            // Keep the persisted id — the backend round-trips it (sync response)
            // and sync correlates on it. Rebuilding it from idx meant identity
            // changed on every delete, which also churned the React key.
            id: seg.id ?? newSegmentId(),
            index: idx,
            transcript_index: seg.transcript_index ?? idx,
            status: seg.locked ? 'locked' : 'auto',
            // Carried so the editor can restore persisted pairs on load.
            paired_with_next: seg.paired_with_next ?? false,
            start_time: seg.committed_start_time ?? seg.start ?? 0,
            end_time: seg.committed_end_time ?? seg.end ?? 0,
            source_text: sourceByIndex.get(seg.transcript_index ?? idx) ?? '',
            target_text: seg.text ?? '',
            active_text: seg.text ?? '',
            preview_text: seg.committed_adapted_text ?? null,
            isPreviewing: false,
            speaker_id: speakerId,
            speaker_label: seg.speaker ?? 'Speaker 1',
            speaker_gender: gender,
            audio_url: seg.path ? `${seg.path}?ts=${cacheBustTs}` : undefined,
            committed_audio_url: seg.committed_audio_url ? `${seg.committed_audio_url}?ts=${cacheBustTs}` : undefined,
            committed_adapted_text: seg.committed_adapted_text ?? undefined,
            text_locked: seg.text_locked ?? false,
            committed_start_time: seg.committed_start_time ?? undefined,
            committed_end_time: seg.committed_end_time ?? undefined,
            // Casting and pacing. Absent here, the editor's restore had nothing
            // to read and every per-segment voice override vanished on reload.
            committed_voice_id: seg.committed_voice_id ?? undefined,
            committed_speed: seg.committed_speed ?? undefined,
            committed_emotion: seg.emotion ?? undefined,
            velma_emotion: seg.velma_emotion,
            velma_accent: seg.velma_accent,
            velma_deepfake_score: seg.velma_deepfake_score,
            velma_emotion_curve: seg.velma_emotion
              ? Array.from({ length: 20 }, () => velmaEmotionToIntensity(seg.velma_emotion))
              : undefined,
            flags: seg.flags ?? [],
            flag_status: seg.flag_status ?? 'unreviewed',
            correction_type: seg.correction_type ?? null,
            qc_findings: seg.qc_findings ?? [],
            // TTS engine + Respeecher take metadata. This mapper is a whitelist,
            // so anything not named here is dropped on load — these were, which
            // meant the engine chip never showed and a pinned seed silently
            // reverted to "auto" on every refresh, re-racing takes that were
            // already approved. The backend has persisted all of it since the
            // engine landed; only the load path was missing.
            engine: seg.engine ?? undefined,
            respeecher_takes: seg.respeecher_takes ?? undefined,
            respeecher_take_seeds: seg.respeecher_take_seeds ?? undefined,
            respeecher_fits: seg.respeecher_fits ?? undefined,
            respeecher_duration: seg.respeecher_duration ?? undefined,
            respeecher_seed: seg.respeecher_seed ?? null,
            respeecher_sampling_params: seg.respeecher_sampling_params ?? null,
            respeecher_seed_history: seg.respeecher_seed_history ?? undefined,
            // Performance fields — same whitelist that dropped the Respeecher
            // ones on load, so they go in up front rather than after the bug.
            perf_path: seg.perf_path ?? undefined,
            perf_model_id: seg.perf_model_id ?? undefined,
            perf_denoise: seg.perf_denoise ?? undefined,
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

        const snapshotFetch = snapshotRes.status === 'fulfilled' ? snapshotRes.value : null
        const snapshotData = snapshotFetch?.ok ? await safeJson(snapshotFetch) : null
        const mappedSnapshotSegments: Segment[] = (snapshotData?.segments ?? []).map((seg: any, idx: number) => ({
          id: seg.id ?? newSegmentId(),
          index: idx,
          status: 'auto' as const,
          start_time: seg.start ?? 0,
          end_time: seg.end ?? 0,
          source_text: '',
          target_text: seg.text ?? '',
          active_text: seg.text ?? '',
          preview_text: null,
          isPreviewing: false,
          speaker_id: `speaker-${String(seg.speaker ?? '').replace(/\D/g, '') || '1'}`,
          speaker_label: seg.speaker ?? 'Speaker 1',
          audio_url: seg.path ? `${seg.path}?ts=${cacheBustTs}` : undefined,
          committed_audio_url: undefined,
          qc_findings: [],
          emotionalCurve: {
            combined: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }],
            locked: false,
            analysis: { facial: [], vocal: [], scene: [] },
          },
        }))

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
        setChunkStatus(segmentsData?.chunk_status)
        setRetention(segmentsData?.retention)
        setSnapshotSegments(mappedSnapshotSegments)
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

    // Fast phase: every 5s for 5 min (60 attempts) — matches prior behavior.
    // Slow phase: back off to every 30s instead of giving up outright — full
    // analysis (Whisper retranscription + optional Azure/Gemini + emotion2vec)
    // can legitimately take longer than 5 minutes, especially now that it also
    // runs automatically pre-export. Giving up left a completed, correct
    // result sitting on disk invisible until a manual page reload. Final
    // outer cap (~2h5m total) is a genuine last-resort safety net, not a
    // realistic ceiling for any real analysis.
    const FAST_ATTEMPTS = 60
    const FAST_INTERVAL_MS = 5000
    const SLOW_INTERVAL_MS = 30000
    const SLOW_ATTEMPTS = 240

    function startPolling(intervalMs: number) {
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = setInterval(checkQC, intervalMs)
    }

    async function checkQC() {
      attempts += 1
      // Cross into the slow phase once the fast window elapses.
      if (attempts === FAST_ATTEMPTS + 1) {
        startPolling(SLOW_INTERVAL_MS)
      }
      // Final safety cap so a genuinely wedged job (bad data, backend down)
      // can't poll forever if the tab is left open.
      if (attempts >= FAST_ATTEMPTS + SLOW_ATTEMPTS) {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
        reanalyzePendingRef.current = false
        if (!cancelled) setQcLoading(false)
        return
      }
      try {
        const res = await fetch(`${API_BASE}/api/analysis/${jobId}/${lang}`, {
          headers: await apiClient.ensureAuthHeaders(),
        })
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
            await fetch(`${API_BASE}/api/analyze/${jobId}/${lang}`, {
              method: 'POST',
              headers: await apiClient.ensureAuthHeaders(),
            })
          } catch {}
          if (!cancelled) setQcLoading(true)
        }
      } catch {
        // Network error — keep polling silently
      }
    }

    checkQC()
    startPolling(FAST_INTERVAL_MS)

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
      res = await fetch(`${API_BASE}/api/analyze/${jobId}/${lang}`, {
        method: 'POST',
        headers: await apiClient.ensureAuthHeaders(),
      })
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
        snapshotSegments={snapshotSegments}
        chunkStatus={chunkStatus}
        retention={retention}
        qcScore={null}
        qcFindings={NO_FINDINGS}
        qcAnalysis={qcAnalysis}
        qcLoading={qcLoading}
        qcUpdatedAt={qcUpdatedAt}
        canReanalyze={!!editorProps.dubbedVideoUrl}
        onReanalyze={handleReanalyze}
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
