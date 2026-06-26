"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { useEditorStore } from "@/lib/editor-store"
import { useDropzone } from "react-dropzone"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Upload, FileVideo, X, CheckCircle2, AlertCircle, Languages, Users, Mic, Square } from "lucide-react"
import type { VideoSource } from "@/components/dashboard"
import { apiClient, isTerminalStatus, JobNotFoundError, type JobStatusValue } from "@/lib/api-client"
import PipelineMonitor from "@/components/pipeline-monitor"
import { BasicVideoPanel } from "@/components/basic-video-panel"
import { VideoRecorder } from "@/components/video-recorder"
import { usePlan } from "@/lib/use-plan"

const STORAGE_KEY = "dubverse_uploaded_files"
const SOURCE_LANG_STORAGE_KEY = "dubverse_source_language"

// Source languages the ASR pipeline supports. "auto" lets Whisper detect.
// "yue" (Cantonese) is critical — it's distinct from "zh" (Mandarin) and the
// backend uses it to disable Paraformer and run Whisper-only for accuracy.
const SOURCE_LANGUAGES: { code: string; name: string; flag: string }[] = [
  { code: "auto", name: "Auto-detect", flag: "🌐" },
  { code: "en", name: "English", flag: "🇺🇸" },
  { code: "yue", name: "Cantonese", flag: "🇭🇰" },
  { code: "zh", name: "Mandarin", flag: "🇨🇳" },
  { code: "ja", name: "Japanese", flag: "🇯🇵" },
  { code: "ko", name: "Korean", flag: "🇰🇷" },
  { code: "es", name: "Spanish", flag: "🇪🇸" },
  { code: "fr", name: "French", flag: "🇫🇷" },
  { code: "de", name: "German", flag: "🇩🇪" },
  { code: "it", name: "Italian", flag: "🇮🇹" },
  { code: "pt", name: "Portuguese", flag: "🇵🇹" },
  { code: "ar", name: "Arabic", flag: "🇸🇦" },
  { code: "hi", name: "Hindi", flag: "🇮🇳" },
  { code: "ru", name: "Russian", flag: "🇷🇺" },
  { code: "nl", name: "Dutch", flag: "🇳🇱" },
]

type PersistedFile = {
  id: string
  name: string
  duration: string
  jobId: string
  status: "ready" | "processing" | "error"
  statusLabel?: string
}

interface VideoUploadProps {
  onVideoSelect: (video: VideoSource) => void
  quotaExceeded?: boolean
  remainingMinutes?: number
  onBuyMore?: () => void
}

type UploadedFile = {
  file?: File
  id: string
  progress: number
  status: "uploading" | "processing" | "ready" | "error"
  statusLabel?: string
  thumbnail?: string
  duration?: string
  jobId?: string
  name?: string
}

export function VideoUpload({
  onVideoSelect,
  quotaExceeded = false,
  remainingMinutes = 0,
  onBuyMore
}: VideoUploadProps) {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
  const [sourceLanguage, setSourceLanguage] = useState<string>("auto")
  const [numSpeakers, setNumSpeakers] = useState<string>("auto")
  const numSpeakersRef = useRef<string>("auto")
  // Ref mirror so the dropzone callback (created once) always sees the
  // current selection without forcing the dropzone to be re-created.
  const sourceLanguageRef = useRef<string>("auto")
  const t = useTranslations('upload')
  const ts = useTranslations('studio')
  const { hasFeature, recordingLimit } = usePlan()
  const resetEditor = useEditorStore((s) => s.resetEditor)

  // ── Inline recording ───────────────────────────────────────────────────
  const [recordingState, setRecordingState] = useState<'idle' | 'active' | 'done'>('idle')
  const [recordedUrl, setRecordedUrl]       = useState<string | null>(null)
  const [recordedFile, setRecordedFile]     = useState<File | null>(null)
  const [recordingElapsed, setRecordingElapsed] = useState(0)

  const cameraVideoRef    = useRef<HTMLVideoElement>(null)
  const cameraStreamRef   = useRef<MediaStream | null>(null)
  const mediaRecorderRef  = useRef<MediaRecorder | null>(null)
  const recordingChunksRef = useRef<Blob[]>([])
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const remainingSeconds = (remainingMinutes ?? 0) * 60
  const effectiveCap = Math.min(
    recordingLimit !== undefined ? recordingLimit : Infinity,
    remainingSeconds > 0 ? remainingSeconds : Infinity,
  )
  const capIsFinite = Number.isFinite(effectiveCap)
  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  const stopCameraStream = useCallback(() => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(t => t.stop())
      cameraStreamRef.current = null
    }
  }, [])

  const handleStopRecording = useCallback(() => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
    mediaRecorderRef.current?.stop()
  }, [])

  const handleStartRecording = useCallback(async () => {
    if (capIsFinite && effectiveCap <= 0) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      cameraStreamRef.current = stream
      recordingChunksRef.current = []
      const MIME_CANDIDATES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
      const mimeType = MIME_CANDIDATES.find(t => MediaRecorder.isTypeSupported(t)) ?? ''
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      mediaRecorderRef.current = recorder
      recorder.ondataavailable = (e) => { if (e.data.size > 0) recordingChunksRef.current.push(e.data) }
      recorder.onstop = () => {
        const blob = new Blob(recordingChunksRef.current, { type: mimeType || 'video/webm' })
        const ext  = mimeType.includes('mp4') ? 'mp4' : 'webm'
        const file = new File([blob], `recording-${Date.now()}.${ext}`, { type: mimeType || 'video/webm' })
        setRecordedFile(file)
        setRecordedUrl(URL.createObjectURL(blob))
        setRecordingState('done')
        stopCameraStream()
      }
      recorder.start(100)
      setRecordingState('active')
      setRecordingElapsed(0)
      recordingTimerRef.current = setInterval(() => setRecordingElapsed(s => s + 1), 1000)
    } catch (err) {
      console.error('[Record] camera access failed', err)
    }
  }, [capIsFinite, effectiveCap, stopCameraStream])

  // Attach stream to <video> element once 'active' state renders it
  useEffect(() => {
    if (recordingState === 'active' && cameraVideoRef.current && cameraStreamRef.current) {
      cameraVideoRef.current.srcObject = cameraStreamRef.current
    }
  }, [recordingState])

  // Auto-stop when elapsed hits plan cap
  useEffect(() => {
    if (recordingState === 'active' && capIsFinite && recordingElapsed >= effectiveCap) {
      handleStopRecording()
    }
  }, [recordingElapsed, recordingState, capIsFinite, effectiveCap, handleStopRecording])

  // Turn off camera light on unmount / navigation away
  useEffect(() => () => stopCameraStream(), [stopCameraStream])

  // Revoke blob URL when replaced or on unmount
  useEffect(() => () => { if (recordedUrl) URL.revokeObjectURL(recordedUrl) }, [recordedUrl])

  // Restore previously chosen source language so users uploading multiple
  // Cantonese videos in a row don't have to re-select it each time.
  useEffect(() => {
    const saved = localStorage.getItem(SOURCE_LANG_STORAGE_KEY)
    if (saved && SOURCE_LANGUAGES.some((l) => l.code === saved)) {
      setSourceLanguage(saved)
      sourceLanguageRef.current = saved
    }
  }, [])

  useEffect(() => {
    sourceLanguageRef.current = sourceLanguage
    localStorage.setItem(SOURCE_LANG_STORAGE_KEY, sourceLanguage)
  }, [sourceLanguage])

  useEffect(() => {
    numSpeakersRef.current = numSpeakers
  }, [numSpeakers])

  // Restore persisted jobs on mount and verify their status
  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    try {
      const persisted: PersistedFile[] = JSON.parse(raw)
      if (!persisted.length) return
      const restored: UploadedFile[] = persisted.map((p) => ({
        id: p.id,
        name: p.name,
        progress: 100,
        status: p.status,
        statusLabel: p.statusLabel,
        duration: p.duration,
        jobId: p.jobId,
      }))
      setUploadedFiles(restored)
      // Re-verify all jobs against the backend — catches stale IDs for ready
      // files too so deleted jobs are cleaned up automatically on page load.
      restored.forEach((f) => {
        if (f.jobId) {
          pollJobStatus(f.id, f.jobId)
        }
      })
    } catch {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [])

  const persistFiles = (files: UploadedFile[]) => {
    const toSave: PersistedFile[] = files
      .filter((f) => f.jobId)
      .map((f) => ({
        id: f.id,
        name: f.name ?? f.file?.name ?? "",
        duration: f.duration ?? "0:00",
        jobId: f.jobId!,
        status: f.status === "uploading" ? "processing" : f.status as PersistedFile["status"],
        statusLabel: f.statusLabel,
      }))
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
  }

  const onDrop = useCallback((acceptedFiles: File[]) => {
    // Block upload if quota exceeded
    if (quotaExceeded) {
      return
    }
    const newFiles = acceptedFiles.map((file) => ({
      file,
      id: Math.random().toString(36).substring(7),
      progress: 0,
      status: "uploading" as const,
    }))

    setUploadedFiles((prev) => [...prev, ...newFiles])

    // Snapshot language + speaker count for this batch so UI changes mid-upload
    // don't affect in-flight requests.
    const langForBatch = sourceLanguageRef.current
    const speakersForBatch = numSpeakersRef.current
    newFiles.forEach((uploadedFile) => {
      startUpload(uploadedFile.id, uploadedFile.file, langForBatch, speakersForBatch)
    })
  }, [])

  const handleUseRecording = useCallback(() => {
    if (recordedFile) onDrop([recordedFile])
    setRecordingState('idle')
    setRecordedUrl(null)
    setRecordedFile(null)
  }, [recordedFile, onDrop])

  const formatDuration = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
    }
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  const startUpload = async (tempId: string, file: File, langOverride?: string, speakersOverride?: string) => {
    try {
      const lang = langOverride ?? sourceLanguageRef.current
      const spkRaw = speakersOverride ?? numSpeakersRef.current
      const numSpk = spkRaw && spkRaw !== 'auto' ? parseInt(spkRaw, 10) : undefined
      const response = await apiClient.uploadVideo(
        file,
        (progress) => {
          setUploadedFiles((prev) =>
            prev.map((f) => (f.id === tempId ? { ...f, progress } : f))
          )
        },
        lang,
        numSpk,
      )

      // Upload received by backend — now it's processing
      setUploadedFiles((prev) => {
        const next = prev.map((f) =>
          f.id === tempId
            ? { ...f, progress: 100, status: "processing" as const, jobId: response.job_id, name: f.file?.name, statusLabel: t('analysingVideo') }
            : f
        )
        persistFiles(next)
        return next
      })

      pollJobStatus(tempId, response.job_id)
      localStorage.setItem('dubverse.lastEditorJobId', response.job_id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('uploadFailed')
      if (msg === "Upload cancelled") {
        try {
          const jobs = await apiClient.listJobs()
          const now = Date.now()
          const recentMatch = jobs
            .filter((j) => j.video_filename === file.name)
            .filter((j) => {
              const ts = Date.parse(j.created_at.endsWith('Z') ? j.created_at : j.created_at + 'Z')
              return Number.isFinite(ts) && now - ts <= 5 * 60 * 1000
            })
            .sort((a, b) => Date.parse(b.created_at.endsWith('Z') ? b.created_at : b.created_at + 'Z') - Date.parse(a.created_at.endsWith('Z') ? a.created_at : a.created_at + 'Z'))[0]

          if (recentMatch?.job_id) {
            setUploadedFiles((prev) => {
              const next = prev.map((f) =>
                f.id === tempId
                  ? {
                      ...f,
                      progress: 100,
                      status: "processing" as const,
                      jobId: recentMatch.job_id,
                      name: file.name,
                      statusLabel: t('analysingVideo'),
                    }
                  : f
              )
              persistFiles(next)
              return next
            })
            pollJobStatus(tempId, recentMatch.job_id)
            return
          }
        } catch {}
      }

      setUploadedFiles((prev) =>
        prev.map((f) =>
          f.id === tempId ? { ...f, status: "error", statusLabel: msg } : f
        )
      )
    }
  }

  const pollJobStatus = (tempId: string, jobId: string) => {
    const PROCESSING_LABELS: Partial<Record<JobStatusValue, string>> = {
      uploading: t('uploading'),
      processing: t('processing'),
      chunking: t('chunking'),
      extracting_audio: t('extractingAudio'),
      diarizing: t('identifyingSpeakers'),
      transcribing: t('transcribing'),
    }

    let retries = 0
    const MAX_RETRIES = 1440  // ~2 hours at 5s intervals (matches backend RUNPOD_QUEUE_TIMEOUT_SEC=7200)
    let interval = 5000

    const poll = async () => {
      if (retries >= MAX_RETRIES) {
        setUploadedFiles((prev) =>
          prev.map((f) =>
            f.id === tempId
              ? { ...f, status: "error" as const, statusLabel: "Processing timed out. Please try again." }
              : f
          )
        )
        return
      }
      retries++

      try {
        const status = await apiClient.getJobStatus(jobId)
        interval = 5000

        const label = PROCESSING_LABELS[status.status] ?? t('processing')

        if (status.status === "failed") {
          setUploadedFiles((prev) =>
            prev.map((f) =>
              f.id === tempId
                ? { ...f, status: "error", statusLabel: status.error_message || t('processingFailed') }
                : f
            )
          )
          return
        }

        if (status.status === "completed") {
          setUploadedFiles((prev) => {
            const next = prev.map((f) =>
              f.id === tempId
                ? {
                    ...f,
                    status: "ready" as const,
                    jobId,
                    duration: status.video_duration ? formatDuration(Math.floor(status.video_duration)) : "0:00",
                    statusLabel: undefined,
                  }
                : f
            )
            persistFiles(next)
            return next
          })
          return
        }

        if (!isTerminalStatus(status.status)) {
          setUploadedFiles((prev) =>
            prev.map((f) => (f.id === tempId ? { ...f, statusLabel: label } : f))
          )
          setTimeout(poll, interval)
        }
      } catch (err) {
        if (err instanceof JobNotFoundError) {
          setUploadedFiles((prev) => {
            const next = prev.filter((f) => f.id !== tempId)
            persistFiles(next)
            return next
          })
          return
        }
        interval = Math.min(interval * 1.5, 15000)
        setTimeout(poll, interval)
      }
    }

    setTimeout(poll, 3000)
  }

  const removeFile = (fileId: string) => {
    setUploadedFiles((prev) => {
      const next = prev.filter((f) => f.id !== fileId)
      persistFiles(next)
      return next
    })
  }

  const handleStartDubbing = (uploadedFile: UploadedFile) => {
    const fileName = uploadedFile.name ?? uploadedFile.file?.name ?? "video"
    onVideoSelect({
      id: uploadedFile.jobId ?? uploadedFile.id,
      jobId: uploadedFile.jobId,
      title: fileName.replace(/\.[^/.]+$/, ""),
      url: uploadedFile.file ? URL.createObjectURL(uploadedFile.file) : "",
      thumbnail: uploadedFile.thumbnail || "",
      duration: uploadedFile.duration || "0:00",
      source: "upload",
    })
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "video/*": [".mp4", ".mov", ".avi", ".mkv", ".webm"],
    },
    maxSize: 10 * 1024 * 1024 * 1024, // 10GB max
    disabled: quotaExceeded,
  })

  // Premium+: show PipelineMonitor while actively processing
  const activeProcessingFile = uploadedFiles.find((f) => f.status === "processing" && f.jobId)
  // Basic: show BasicVideoPanel for the most recently uploaded file that has a jobId.
  // Using .findLast so a fresh upload always takes over from stale restored files.
  const basicPanelFile = !hasFeature('pipelineMonitor')
    ? (uploadedFiles.findLast((f) => f.jobId) ?? null)
    : null

  const showRightPanel = recordingState !== 'idle' || (hasFeature('pipelineMonitor') ? !!activeProcessingFile : !!basicPanelFile)
  const [isReviewingTranscript, setIsReviewingTranscript] = useState(false)

  return (
    <div className="space-y-6">
      {/* Top section: Upload Area + right panel side by side (single column when reviewing) */}
      <div className={`grid gap-6 transition-all duration-500 ${showRightPanel && !isReviewingTranscript ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"}`}>
      {/* Main Upload Area - Compact */}
      <div>
        <div className="text-center mb-4">
          <h2 className="text-2xl font-bold text-white mb-1">{ts('uploadTitle')}</h2>
          <p className="text-[#94A3B8] text-sm">
            {ts('uploadSubtitle')}
          </p>
        </div>

        {/* Source language + speaker count — must be set BEFORE upload because
            transcription and diarization run immediately on the backend. */}
        <div className="mb-4 flex flex-wrap items-center justify-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm text-[#94A3B8] font-medium whitespace-nowrap">
              Source language:
            </label>
            <Select value={sourceLanguage} onValueChange={setSourceLanguage}>
              <SelectTrigger className="w-[180px] h-9 text-sm bg-[#0F172A]/60 border-[#A855F7]/30">
                <Languages className="mr-2 h-3.5 w-3.5 text-[#A855F7]" />
                <SelectValue placeholder="Auto-detect" />
              </SelectTrigger>
              <SelectContent>
                {SOURCE_LANGUAGES.map((lang) => (
                  <SelectItem key={lang.code} value={lang.code}>
                    <span className="mr-2">{lang.flag}</span>
                    {lang.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm text-[#94A3B8] font-medium whitespace-nowrap">
              Speakers:
            </label>
            <Select value={numSpeakers} onValueChange={setNumSpeakers}>
              <SelectTrigger className="w-[140px] h-9 text-sm bg-[#0F172A]/60 border-[#A855F7]/30">
                <Users className="mr-2 h-3.5 w-3.5 text-[#A855F7]" />
                <SelectValue placeholder="Auto-detect" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto-detect</SelectItem>
                <SelectItem value="1">1 speaker</SelectItem>
                <SelectItem value="2">2 speakers</SelectItem>
                <SelectItem value="3">3 speakers</SelectItem>
                <SelectItem value="4">4 speakers</SelectItem>
                <SelectItem value="5">5 speakers</SelectItem>
                <SelectItem value="6">6 speakers</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <button
            type="button"
            onClick={handleStartRecording}
            disabled={recordingState !== 'idle' || (capIsFinite && effectiveCap <= 0)}
            title={capIsFinite ? `Max ${fmtTime(effectiveCap)}` : 'Record video'}
            className="flex items-center gap-2 h-9 px-3 rounded-md border border-red-500/50 bg-red-600/10 text-sm text-red-400 hover:border-red-500 hover:bg-red-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Mic className="h-3.5 w-3.5" />
            Record
          </button>
        </div>

        <div
          {...getRootProps()}
          className={`relative flex flex-col items-center justify-center rounded-xl border-3 border-dashed p-10 transition-all duration-300 ${
            quotaExceeded
              ? "border-red-500/40 bg-red-500/5 cursor-not-allowed opacity-60"
              : isDragActive
              ? "border-[#22D3EE] bg-[#22D3EE]/10 shadow-[0_0_40px_rgba(34,211,238,0.4)] cursor-pointer"
              : "border-[#A855F7]/40 hover:border-[#A855F7] hover:bg-[#A855F7]/5 hover:shadow-[0_0_30px_rgba(168,85,247,0.3)] cursor-pointer"
          }`}
        >
          <input {...getInputProps()} disabled={quotaExceeded} />

          {/* Quota Exceeded Overlay */}
          {quotaExceeded && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#020817]/80 backdrop-blur-sm rounded-xl z-10">
              <div className="text-center px-6">
                <div className="mb-4">
                  <AlertCircle className="h-12 w-12 text-red-400 mx-auto" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">{t('quotaExceeded')}</h3>
                <p className="text-[#94A3B8] text-sm mb-4">
                  {t('quotaExceededMessage')}
                </p>
                <div className="flex gap-3 justify-center">
                  {onBuyMore && (
                    <Button
                      onClick={(e) => {
                        e.stopPropagation()
                        onBuyMore()
                      }}
                      className="bg-gradient-to-r from-[#A855F7] to-[#22D3EE] text-white"
                    >
                      {t('buyBonusMinutes')}
                    </Button>
                  )}
                  <Button
                    onClick={(e) => {
                      e.stopPropagation()
                      window.location.href = "/subscribe?upgrade=true"
                    }}
                    variant="outline"
                    className="border-[#A855F7]/30 text-[#C084FC] hover:bg-[#A855F7]/10"
                  >
                    {t('upgradePlan')}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Center icon with glow - Smaller */}
          <div className="relative mb-4">
            <div className="absolute inset-0 bg-gradient-to-r from-[#A855F7] to-[#22D3EE] rounded-full blur-xl opacity-40" />
            <div className="relative rounded-full bg-gradient-to-br from-[#A855F7] to-[#22D3EE] p-4 shadow-[0_0_20px_rgba(168,85,247,0.6)]">
              <Upload className="h-8 w-8 text-white" />
            </div>
          </div>

          <div className="text-center">
            <p className="text-xl font-bold text-white mb-1">
              {isDragActive ? t('dropHere') : ts('dragAndDrop')}
            </p>
            <p className="text-[#94A3B8] text-sm mb-4">
              or <span className="text-[#22D3EE] font-semibold">{ts('clickToBrowse')}</span> {ts('fromYourComputer')}
            </p>

            <div className="flex flex-wrap justify-center gap-2">
              <span className="px-3 py-1.5 rounded-full bg-[#A855F7]/20 border border-[#A855F7]/40 text-[#C084FC] text-xs font-medium">
                ✨ {ts('maxDuration')}
              </span>
              <span className="px-3 py-1.5 rounded-full bg-[#22D3EE]/20 border border-[#22D3EE]/40 text-[#22D3EE] text-xs font-medium">
                🚀 {ts('maxSize')}
              </span>
              <span className="px-3 py-1.5 rounded-full bg-[#FDB022]/20 border border-[#FDB022]/40 text-[#FDB022] text-xs font-medium">
                🎬 {ts('4kSupported')}
              </span>
            </div>
          </div>
        </div>

      </div>

      {/* Right panel — recording states take priority over pipeline panels */}
      {showRightPanel && (
        <div className="min-w-0 overflow-hidden self-start">

          {recordingState === 'active' && (
            <div className="rounded-2xl border border-[#A855F7]/30 bg-[#0F172A]/80 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#1E293B]">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-sm font-semibold text-white">Recording in Progress</span>
                </div>
                <span className="font-mono text-xs text-red-400">
                  {fmtTime(recordingElapsed)}
                  {capIsFinite && <span className="text-slate-500"> / {fmtTime(effectiveCap)}</span>}
                </span>
              </div>
              <video
                ref={cameraVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full aspect-video object-cover bg-black"
                style={{ transform: 'scaleX(-1)' }}
              />
              <div className="p-4 flex justify-center">
                <button
                  type="button"
                  onClick={handleStopRecording}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                  Stop & Save
                </button>
              </div>
            </div>
          )}

          {recordingState === 'done' && recordedUrl && (
            <div className="rounded-2xl border border-[#A855F7]/30 bg-[#0F172A]/80 overflow-hidden">
              <div className="px-4 py-3 border-b border-[#1E293B]">
                <span className="text-sm font-semibold text-white">DubMaster Video Player</span>
              </div>
              <video
                src={recordedUrl}
                controls
                className="w-full aspect-video object-cover bg-black"
              />
              <div className="p-4 flex flex-wrap gap-3 justify-center">
                <button
                  type="button"
                  onClick={handleUseRecording}
                  className="px-4 py-2 rounded-lg bg-gradient-to-r from-[#A855F7] to-[#22D3EE] text-white text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  Use This Video
                </button>
                <a
                  href={recordedUrl}
                  download="dubmaster-recording.webm"
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#1E293B] border border-slate-700 text-slate-300 text-sm hover:bg-slate-800 transition-colors"
                >
                  Download
                </a>
                <button
                  type="button"
                  onClick={() => { setRecordingState('idle'); setRecordedUrl(null); setRecordedFile(null) }}
                  className="px-3 py-2 rounded-lg bg-[#1E293B] border border-slate-700 text-slate-400 text-sm hover:text-white transition-colors"
                >
                  Discard
                </button>
              </div>
            </div>
          )}

          {recordingState === 'idle' && (
            hasFeature('pipelineMonitor')
              ? <PipelineMonitor jobId={activeProcessingFile!.jobId!} />
              : <BasicVideoPanel jobId={basicPanelFile!.jobId!} onStale={() => removeFile(basicPanelFile!.id)} onReviewingChange={setIsReviewingTranscript} />
          )}

        </div>
      )}
      </div>

      {uploadedFiles.length > 0 && (
        <div className="mt-12">
          <div className="mb-6">
            <h3 className="text-2xl font-bold text-white mb-2">{ts('yourVideos')}</h3>
            <p className="text-[#94A3B8]">{ts('readyToTransform')}</p>
          </div>

          <div className="space-y-4">
            {uploadedFiles.map((uploadedFile) => (
              <div
                key={uploadedFile.id}
                className="relative group"
              >
                {/* Outer glow on hover */}
                <div className="absolute -inset-0.5 bg-gradient-to-r from-[#A855F7] to-[#22D3EE] rounded-2xl opacity-0 group-hover:opacity-30 blur-xl transition-opacity duration-300" />

                <div className="relative rounded-2xl border border-[#A855F7]/30 bg-[#0F172A]/60 backdrop-blur-xl p-5 group-hover:border-[#A855F7]/60 transition-all duration-300">
                  <div className="flex items-center gap-4">
                    <div className="flex h-20 w-32 items-center justify-center rounded-xl bg-gradient-to-br from-[#A855F7]/20 to-[#22D3EE]/20 border border-[#A855F7]/30 overflow-hidden">
                      {uploadedFile.status === "ready" && uploadedFile.thumbnail ? (
                        <img
                          src={uploadedFile.thumbnail || "/placeholder.svg"}
                          alt={uploadedFile.name ?? uploadedFile.file?.name ?? "video"}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <FileVideo className="h-10 w-10 text-[#A855F7]" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-4">
                        <p className="font-semibold text-white truncate">{uploadedFile.name ?? uploadedFile.file?.name ?? "video"}</p>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeFile(uploadedFile.id)}
                          className="text-[#64748B] hover:text-[#A855F7] hover:bg-[#A855F7]/10 shrink-0"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="mt-1 flex items-center gap-2 text-sm text-[#94A3B8]">
                        {uploadedFile.file && <span>{(uploadedFile.file.size / (1024 * 1024)).toFixed(1)} MB</span>}
                        {uploadedFile.duration && (
                          <>
                            <span>•</span>
                            <span>{uploadedFile.duration}</span>
                          </>
                        )}
                      </div>

                    {uploadedFile.status === "uploading" && (
                      <div className="mt-3">
                        <div className="relative h-2 bg-[#1E293B] rounded-full overflow-hidden">
                          <div
                            className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#A855F7] to-[#22D3EE] rounded-full shadow-[0_0_10px_rgba(168,85,247,0.6)]"
                            style={{ width: `${uploadedFile.progress}%` }}
                          />
                        </div>
                        <p className="mt-2 text-xs text-[#94A3B8]">
                          {t('uploading')} <span className="text-[#22D3EE] font-semibold">{Math.round(uploadedFile.progress)}%</span>
                        </p>
                      </div>
                    )}

                    {uploadedFile.status === "ready" && (
                      <div className="mt-3 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm">
                          <CheckCircle2 className="h-4 w-4 text-[#22D3EE]" />
                          <span className="text-[#22D3EE] font-semibold">{t('readyForDubbing')}</span>
                        </div>
                        {/* Basic users dub from the right panel — no navigation needed */}
                        {hasFeature('pipelineMonitor') && (
                          <Button
                            size="sm"
                            onClick={() => handleStartDubbing(uploadedFile)}
                            className="bg-gradient-to-r from-[#A855F7] to-[#22D3EE] hover:opacity-90 shadow-[0_0_20px_rgba(168,85,247,0.4)]"
                          >
                            {t('startDubbing')} →
                          </Button>
                        )}
                      </div>
                    )}

                    {uploadedFile.status === "processing" && (
                      <div className="mt-3 flex items-center gap-2 text-sm">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#FDB022] border-t-transparent" />
                        <span className="text-[#FDB022]">{uploadedFile.statusLabel ?? t('processing')}</span>
                      </div>
                    )}

                    {uploadedFile.status === "error" && (
                      <div className="mt-3 flex items-center gap-2 text-sm text-red-400">
                        <AlertCircle className="h-4 w-4" />
                        {uploadedFile.statusLabel ?? t('uploadFailedRetry')}
                      </div>
                    )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex justify-end">
            <Button
              variant="outline"
              size="sm"
              className="text-red-400 border-red-400/30 hover:bg-red-400/10 hover:text-red-300"
              onClick={async () => {
                setUploadedFiles([])
                localStorage.removeItem(STORAGE_KEY)
                resetEditor()
                try {
                  await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/jobs/clear-all?force=true`, { method: "DELETE" })
                } catch (e) {
                  console.error("Failed to clear jobs on backend:", e)
                }
              }}
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Clear All
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
