"use client"

import { useState, useCallback, useEffect } from "react"
import { useDropzone } from "react-dropzone"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Upload, FileVideo, X, CheckCircle2, AlertCircle } from "lucide-react"
import type { VideoSource } from "@/components/dashboard"
import { apiClient, isTerminalStatus, JobNotFoundError, type JobStatusValue } from "@/lib/api-client"

const STORAGE_KEY = "dubverse_uploaded_files"

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
  const t = useTranslations('upload')
  const ts = useTranslations('studio')

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
      // Re-verify each non-ready job against the backend
      restored.forEach((f) => {
        if (f.jobId && f.status !== "ready") {
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

    newFiles.forEach((uploadedFile) => {
      startUpload(uploadedFile.id, uploadedFile.file)
    })
  }, [])

  const formatDuration = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
    }
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  const startUpload = async (tempId: string, file: File) => {
    try {
      const response = await apiClient.uploadVideo(file, (progress) => {
        setUploadedFiles((prev) =>
          prev.map((f) => (f.id === tempId ? { ...f, progress } : f))
        )
      })

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
    } catch (err) {
      setUploadedFiles((prev) =>
        prev.map((f) =>
          f.id === tempId ? { ...f, status: "error", statusLabel: err instanceof Error ? err.message : t('uploadFailed') } : f
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
    const MAX_RETRIES = 360  // ~30 min at 5s intervals
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

  return (
    <div className="space-y-6">
      {/* Main Upload Area - Compact */}
      <div>
        <div className="text-center mb-4">
          <h2 className="text-2xl font-bold text-white mb-1">{ts('uploadTitle')}</h2>
          <p className="text-[#94A3B8] text-sm">
            {ts('uploadSubtitle')}
          </p>
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

                <div className="relative flex items-center gap-4 rounded-2xl border border-[#A855F7]/30 bg-[#0F172A]/60 backdrop-blur-xl p-5 group-hover:border-[#A855F7]/60 transition-all duration-300">
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

                    {uploadedFile.status === "processing" && (
                      <div className="mt-3 flex items-center gap-2 text-sm">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#FDB022] border-t-transparent" />
                        <span className="text-[#FDB022]">{uploadedFile.statusLabel ?? t('processing')}</span>
                      </div>
                    )}

                    {uploadedFile.status === "ready" && (
                      <div className="mt-3 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm">
                          <CheckCircle2 className="h-4 w-4 text-[#22D3EE]" />
                          <span className="text-[#22D3EE] font-semibold">{t('readyForDubbing')}</span>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => handleStartDubbing(uploadedFile)}
                          className="bg-gradient-to-r from-[#A855F7] to-[#22D3EE] hover:opacity-90 shadow-[0_0_20px_rgba(168,85,247,0.4)]"
                        >
                          {t('startDubbing')} →
                        </Button>
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
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
