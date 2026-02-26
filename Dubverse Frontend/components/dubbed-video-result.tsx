"use client"

import { useState, useRef, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Slider } from "@/components/ui/slider"
import {
  Download,
  Share2,
  Play,
  Pause,
  Volume2,
  VolumeX,
  CheckCircle2,
  RefreshCw,
  FileVideo,
  Languages,
  Mic2,
  Clock,
  AlertCircle,
} from "lucide-react"
import type { VideoSource, DetectedVoice } from "@/components/dashboard"

interface DubbedVideoResultProps {
  originalVideo: VideoSource
  targetLanguage: string
  detectedVoices: DetectedVoice[]
  dubbingProgress: number
  isDubbing: boolean
  dubbedVideoUrl?: string
  dubbingError?: string
  onRegenerate: () => void
  onClose: () => void
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
  ar: "Arabic",
  hi: "Hindi",
  ru: "Russian",
  nl: "Dutch",
}

export function DubbedVideoResult({
  originalVideo,
  targetLanguage,
  detectedVoices,
  dubbingProgress,
  isDubbing,
  dubbedVideoUrl,
  dubbingError,
  onRegenerate,
  onClose,
}: DubbedVideoResultProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [volume, setVolume] = useState(80)
  const [isMuted, setIsMuted] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  const isComplete = !isDubbing && dubbingProgress >= 100

  const videoSrc = showOriginal ? originalVideo.url : (dubbedVideoUrl ?? originalVideo.url)

  // Sync play/pause state with video element
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (isPlaying) {
      v.play().catch(() => setIsPlaying(false))
    } else {
      v.pause()
    }
  }, [isPlaying])

  // Sync volume and mute state
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.volume = volume / 100
    v.muted = isMuted
  }, [volume, isMuted])

  // Update timestamp as video plays
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onTime = () => setCurrentTime(v.currentTime)
    const onMeta = () => setDuration(v.duration)
    v.addEventListener("timeupdate", onTime)
    v.addEventListener("loadedmetadata", onMeta)
    return () => {
      v.removeEventListener("timeupdate", onTime)
      v.removeEventListener("loadedmetadata", onMeta)
    }
  }, [videoSrc])

  // Pause when switching between original/dubbed
  useEffect(() => {
    setIsPlaying(false)
  }, [showOriginal])

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, "0")}`
  }

  const handleDownload = () => {
    const url = dubbedVideoUrl ?? originalVideo.url
    const link = document.createElement("a")
    link.href = url
    link.download = `${originalVideo.title}_dubbed_${targetLanguage}.mp4`
    link.target = "_blank"
    link.rel = "noopener noreferrer"
    link.click()
  }

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${originalVideo.title} - Dubbed in ${LANGUAGE_NAMES[targetLanguage]}`,
          text: "Check out this dubbed video!",
          url: window.location.href,
        })
      } catch {
        // User cancelled share
      }
    }
  }

  // ── In-progress view ──────────────────────────────────────────────────────
  if (!isComplete) {
    const currentStage =
      dubbingProgress <= 12 ? "Extracting original audio..." :
      dubbingProgress <= 25 ? "Analyzing speech patterns..." :
      dubbingProgress <= 35 ? "Translating speaker tracks..." :
      dubbingProgress <= 55 ? "Generating AI voice-overs..." :
      dubbingProgress <= 70 ? "Voice synthesis in progress..." :
      dubbingProgress <= 88 ? "Syncing audio with video..." :
      dubbingProgress <= 95 ? "Rendering final output..." :
      "Finalizing..."

    return (
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 animate-spin text-primary" />
            Generating Dubbed Video
          </CardTitle>
          <CardDescription>{currentStage}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {dubbingError && (
            <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {dubbingError}
            </div>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Overall Progress</span>
              <span className="font-medium text-foreground">{Math.round(dubbingProgress)}%</span>
            </div>
            <Progress value={dubbingProgress} className="h-3" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Mic2 className="h-4 w-4" />
                Voice Synthesis
              </div>
              <p className="mt-1 font-medium text-foreground">
                {dubbingProgress < 35 ? "Preparing..." : dubbingProgress < 70 ? "In Progress" : "Finalizing"}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Languages className="h-4 w-4" />
                Target Language
              </div>
              <p className="mt-1 font-medium text-foreground">{LANGUAGE_NAMES[targetLanguage]}</p>
            </div>
          </div>

          <div className="rounded-lg bg-muted/50 p-4">
            <h4 className="text-sm font-medium text-foreground">Processing Steps:</h4>
            <ul className="mt-2 space-y-2 text-sm">
              {[
                { label: "Extracting original audio", threshold: 12 },
                { label: `Translating ${detectedVoices.length} speaker tracks`, threshold: 35 },
                { label: "Generating AI voice-overs", threshold: 70 },
                { label: "Syncing audio with video", threshold: 88 },
                { label: "Final rendering", threshold: 100 },
              ].map(({ label, threshold }, i, arr) => {
                const prevThreshold = arr[i - 1]?.threshold ?? 0
                const done = dubbingProgress > threshold
                const active = dubbingProgress > prevThreshold && dubbingProgress <= threshold
                return (
                  <li key={label} className="flex items-center gap-2">
                    {done ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : active ? (
                      <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className={done || active ? "text-foreground" : "text-muted-foreground"}>{label}</span>
                  </li>
                )
              })}
            </ul>
          </div>
        </CardContent>
      </Card>
    )
  }

  // ── Completed view ────────────────────────────────────────────────────────
  return (
    <Card className="border-green-500/20 bg-green-500/5">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              Dubbing Complete!
            </CardTitle>
            <CardDescription>Your video has been dubbed into {LANGUAGE_NAMES[targetLanguage]}</CardDescription>
          </div>
          <Badge className="bg-green-500/10 text-green-500 border-green-500/20">Ready to Download</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Video Preview */}
        <div className="relative overflow-hidden rounded-lg bg-black">
          <video
            ref={videoRef}
            src={videoSrc}
            poster={originalVideo.thumbnail}
            className="aspect-video w-full object-contain"
            onEnded={() => setIsPlaying(false)}
            onClick={() => setIsPlaying(!isPlaying)}
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <Button size="lg" className="h-16 w-16 rounded-full" onClick={() => setIsPlaying(!isPlaying)}>
              {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6 ml-1" />}
            </Button>
          </div>

          {/* Toggle Original/Dubbed */}
          <div className="absolute left-4 top-4 flex gap-2">
            <Button
              size="sm"
              variant={showOriginal ? "outline" : "default"}
              onClick={() => setShowOriginal(false)}
              className="text-xs"
            >
              Dubbed
            </Button>
            <Button
              size="sm"
              variant={showOriginal ? "default" : "outline"}
              onClick={() => setShowOriginal(true)}
              className="text-xs"
            >
              Original
            </Button>
          </div>

          {/* Timestamp */}
          <div className="absolute bottom-4 left-4 rounded-lg bg-black/70 px-3 py-1.5 font-mono text-sm text-white">
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>

          {/* Volume Control */}
          <div className="absolute bottom-4 right-4 flex items-center gap-2 rounded-lg bg-black/70 p-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-white hover:bg-white/20"
              onClick={() => setIsMuted(!isMuted)}
            >
              {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </Button>
            <div className="w-20">
              <Slider
                value={[isMuted ? 0 : volume]}
                max={100}
                step={1}
                onValueChange={([v]) => {
                  setVolume(v)
                  setIsMuted(v === 0)
                }}
                className="cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* Video Info */}
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg border border-border bg-card p-3 text-center">
            <Clock className="mx-auto h-5 w-5 text-muted-foreground" />
            <p className="mt-1 text-xs text-muted-foreground">Duration</p>
            <p className="font-medium text-foreground">{originalVideo.duration}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-3 text-center">
            <Mic2 className="mx-auto h-5 w-5 text-muted-foreground" />
            <p className="mt-1 text-xs text-muted-foreground">Voices</p>
            <p className="font-medium text-foreground">{detectedVoices.length} speakers</p>
          </div>
        </div>

        {/* Voice Summary */}
        <div className="rounded-lg border border-border bg-card p-4">
          <h4 className="font-medium text-foreground">Voice Mapping Summary</h4>
          <div className="mt-3 space-y-2">
            {detectedVoices.map((voice) => (
              <div key={voice.id} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{voice.characterName}</span>
                <Badge variant="outline" className="text-xs">
                  {voice.selectedVoice?.replace("-", " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                </Badge>
              </div>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <Button className="flex-1 gap-2" onClick={handleDownload} disabled={!dubbedVideoUrl}>
            <Download className="h-4 w-4" />
            Download Video
          </Button>
          <Button variant="outline" className="gap-2 bg-transparent" onClick={handleShare}>
            <Share2 className="h-4 w-4" />
            Share
          </Button>
          <Button variant="outline" className="gap-2 bg-transparent" onClick={onRegenerate}>
            <RefreshCw className="h-4 w-4" />
            Regenerate
          </Button>
        </div>

        {/* Format Options */}
        <div className="rounded-lg bg-muted/50 p-4">
          <h4 className="text-sm font-medium text-foreground">Export Formats</h4>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs bg-transparent" onClick={handleDownload} disabled={!dubbedVideoUrl}>
              <FileVideo className="h-3 w-3" />
              MP4 (H.264)
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5 text-xs bg-transparent" disabled>
              <FileVideo className="h-3 w-3" />
              WebM (VP9)
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5 text-xs bg-transparent" disabled>
              <FileVideo className="h-3 w-3" />
              MOV (ProRes)
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
