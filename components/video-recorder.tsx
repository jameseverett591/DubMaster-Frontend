"use client"

import { useRef, useState, useCallback, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Video, X, Circle, Square, AlertCircle, Loader2 } from "lucide-react"

// Ordered preference: VP9 webm → VP8 webm → plain webm → MP4 (Safari 14.1+)
const MIME_CANDIDATES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4",
]

function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null
}

function extForMime(mime: string): string {
  return mime.startsWith("video/mp4") ? "mp4" : "webm"
}

function fmt(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

type Phase = "idle" | "requesting" | "previewing" | "recording" | "done"

interface VideoRecorderProps {
  onFileCaptured: (file: File) => void
  /** Hard cap from the user's plan (seconds). Defaults to no cap. */
  maxSeconds?: number
  /** Remaining dubbing quota in seconds — caps further if smaller than maxSeconds. */
  remainingSeconds?: number
  /** Override the trigger button's className (defaults to text-link style for upload page). */
  triggerClassName?: string
  /** Override the trigger button's label text. */
  triggerLabel?: string
}

export function VideoRecorder({ onFileCaptured, maxSeconds, remainingSeconds, triggerClassName, triggerLabel }: VideoRecorderProps) {
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>("idle")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const mimeType = pickMimeType()

  // Effective cap: whichever is tighter — plan limit or remaining quota.
  // Both can be undefined (no limit); otherwise clamp to the smaller value.
  const effectiveCap = Math.min(
    maxSeconds !== undefined ? maxSeconds : Infinity,
    remainingSeconds !== undefined ? remainingSeconds : Infinity,
  )
  const capIsFinite = Number.isFinite(effectiveCap)
  const timeLeft = capIsFinite ? Math.max(0, effectiveCap - elapsed) : null

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    chunksRef.current = []
  }, [])

  const handleClose = useCallback(() => {
    // Nullify callbacks before stopping so onstop doesn't fire on user-cancel
    if (recorderRef.current) {
      recorderRef.current.onstop = null
      recorderRef.current.ondataavailable = null
      if (recorderRef.current.state !== "inactive") recorderRef.current.stop()
    }
    cleanup()
    setOpen(false)
    setPhase("idle")
    setErrorMsg(null)
    setElapsed(0)
  }, [cleanup])

  const handleOpen = useCallback(async () => {
    if (!mimeType) {
      setErrorMsg("Your browser doesn't support video recording. Try Chrome or Firefox.")
      setOpen(true)
      return
    }
    setOpen(true)
    setPhase("requesting")
    setErrorMsg(null)

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      streamRef.current = stream
      setPhase("previewing") // useEffect attaches stream once <video> mounts
    } catch (err: any) {
      const denied = err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError"
      setErrorMsg(
        denied
          ? "Camera access denied. Allow camera permissions in your browser and try again."
          : "Could not access your camera. Make sure it isn't in use by another app."
      )
      setPhase("idle")
    }
  }, [mimeType])

  // Attach the stream to the <video> element after it mounts (phase change → re-render → effect)
  useEffect(() => {
    if (phase === "previewing" && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current
    }
  }, [phase])

  // Cleanup on unmount
  useEffect(() => cleanup, [cleanup])

  const handleStop = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    recorderRef.current?.stop()
    setPhase("done")
  }, [])

  // Auto-stop when elapsed reaches the effective cap
  useEffect(() => {
    if (phase === "recording" && capIsFinite && elapsed >= effectiveCap) {
      handleStop()
    }
  }, [elapsed, phase, capIsFinite, effectiveCap, handleStop])

  const handleStart = useCallback(() => {
    if (!streamRef.current || !mimeType) return
    // Guard: if quota / plan cap leaves 0 seconds, block rather than start-then-instantly-stop
    if (capIsFinite && effectiveCap <= 0) {
      setErrorMsg("No recording time remaining. Upgrade your plan or buy bonus minutes.")
      return
    }
    chunksRef.current = []
    const recorder = new MediaRecorder(streamRef.current, { mimeType })
    recorderRef.current = recorder
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType })
      const ext = extForMime(mimeType)
      const file = new File([blob], `recording-${Date.now()}.${ext}`, { type: mimeType })
      onFileCaptured(file)
      handleClose()
    }
    recorder.start(100) // collect chunks every 100 ms
    setPhase("recording")
    setElapsed(0)
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000)
  }, [mimeType, onFileCaptured, handleClose, capIsFinite, effectiveCap])

  return (
    <>
      {/* Trigger */}
      <button
        type="button"
        onClick={handleOpen}
        className={triggerClassName ?? "flex items-center gap-2 text-sm text-[#64748B] hover:text-[#C084FC] transition-colors"}
      >
        <Video className="h-4 w-4" />
        {triggerLabel ?? "or record from your webcam"}
      </button>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="relative w-full max-w-lg mx-4 rounded-2xl bg-[#0F172A] border border-[#A855F7]/30 shadow-[0_0_60px_rgba(168,85,247,0.2)] overflow-hidden">

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#1E293B]">
              <div className="flex items-center gap-2">
                <Video className="h-4 w-4 text-[#A855F7]" />
                <span className="text-sm font-semibold text-white">Record Video</span>
                {phase === "recording" && (
                  <span className="flex items-center gap-1.5 ml-2">
                    <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-xs font-mono text-red-400">{fmt(elapsed)}</span>
                    {timeLeft !== null && (
                      <span className={`text-xs font-mono ${timeLeft <= 30 ? "text-red-300" : "text-[#475569]"}`}>
                        / {fmt(timeLeft)} left
                      </span>
                    )}
                  </span>
                )}
              </div>
              <button
                type="button"
                aria-label="Close recorder"
                onClick={handleClose}
                className="text-[#64748B] hover:text-white transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4">

              {/* Error state — inline, self-contained */}
              {errorMsg && (
                <div className="flex items-start gap-3 rounded-lg bg-red-500/10 border border-red-500/25 p-3">
                  <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                  <p className="text-sm text-red-300">{errorMsg}</p>
                </div>
              )}

              {/* Requesting permissions */}
              {phase === "requesting" && (
                <div className="flex flex-col items-center gap-3 py-12">
                  <Loader2 className="h-8 w-8 text-[#A855F7] animate-spin" />
                  <p className="text-sm text-[#94A3B8]">Requesting camera access…</p>
                </div>
              )}

              {/* Camera preview — mirrored for natural webcam feel */}
              {(phase === "previewing" || phase === "recording") && (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full rounded-xl bg-black aspect-video object-cover"
                  style={{ transform: "scaleX(-1)" }}
                />
              )}

              {/* Controls */}
              <div className="flex flex-col items-center gap-2">
                {phase === "previewing" && (
                  <>
                    {capIsFinite && (
                      <p className="text-xs text-[#475569]">
                        Max recording: {fmt(effectiveCap)}
                        {remainingSeconds !== undefined && remainingSeconds < (maxSeconds ?? Infinity) && (
                          <span className="text-[#F59E0B]"> (limited by remaining quota)</span>
                        )}
                      </p>
                    )}
                    <Button
                      onClick={handleStart}
                      className="bg-red-600 hover:bg-red-700 text-white gap-2"
                    >
                      <Circle className="h-3.5 w-3.5 fill-current" />
                      Start Recording
                    </Button>
                  </>
                )}

                {phase === "recording" && (
                  <Button
                    onClick={handleStop}
                    className="bg-red-600 hover:bg-red-700 text-white gap-2"
                  >
                    <Square className="h-3.5 w-3.5 fill-current" />
                    Stop & Upload
                  </Button>
                )}

                {phase === "done" && (
                  <div className="flex items-center gap-2 text-sm text-[#94A3B8]">
                    <Loader2 className="h-4 w-4 animate-spin text-[#A855F7]" />
                    Processing recording…
                  </div>
                )}
              </div>

            </div>
          </div>
        </div>
      )}
    </>
  )
}
