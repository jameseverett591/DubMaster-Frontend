"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import Link from "next/link"
import {
  Download,
  Share2,
  CheckCircle2,
  RefreshCw,
  FileVideo,
  Languages,
  Mic2,
  Clock,
  AlertCircle,
  Pencil,
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
}: DubbedVideoResultProps) {
  const isComplete = !isDubbing && dubbingProgress >= 100

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
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <RefreshCw className="h-4 w-4 animate-spin text-primary" />
            Generating Dubbed Video
          </CardTitle>
          <CardDescription className="text-xs">{currentStage}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {dubbingError && (
            <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-2 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {dubbingError}
            </div>
          )}

          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Overall Progress</span>
              <span className="font-medium text-foreground">{Math.round(dubbingProgress)}%</span>
            </div>
            <Progress value={dubbingProgress} className="h-2.5" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-border bg-card p-2.5">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Mic2 className="h-3.5 w-3.5" />
                Voice Synthesis
              </div>
              <p className="mt-0.5 text-xs font-medium text-foreground">
                {dubbingProgress < 35 ? "Preparing..." : dubbingProgress < 70 ? "In Progress" : "Finalizing"}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-2.5">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Languages className="h-3.5 w-3.5" />
                Target Language
              </div>
              <p className="mt-0.5 text-xs font-medium text-foreground">{LANGUAGE_NAMES[targetLanguage]}</p>
            </div>
          </div>

          <div className="rounded-lg bg-muted/50 p-3">
            <h4 className="text-xs font-medium text-foreground">Processing Steps:</h4>
            <ul className="mt-1.5 space-y-1.5 text-xs">
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
                  <li key={label} className="flex items-center gap-1.5">
                    {done ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    ) : active ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin text-primary" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
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

  // ── Completed view (no video player — main player shows the dubbed video) ─
  return (
    <Card className="border-green-500/20 bg-green-500/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              Dubbing Complete!
            </CardTitle>
            <CardDescription className="text-xs">
              Dubbed into {LANGUAGE_NAMES[targetLanguage]}
            </CardDescription>
          </div>
          <Badge className="bg-green-500/10 text-green-500 border-green-500/20 text-xs">Ready</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Use the Original/Dubbed toggle on the video player to compare.
        </p>

        {/* Video Info */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-border bg-card p-2.5 text-center">
            <Clock className="mx-auto h-4 w-4 text-muted-foreground" />
            <p className="mt-0.5 text-xs text-muted-foreground">Duration</p>
            <p className="text-xs font-medium text-foreground">{originalVideo.duration}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-2.5 text-center">
            <Mic2 className="mx-auto h-4 w-4 text-muted-foreground" />
            <p className="mt-0.5 text-xs text-muted-foreground">Voices</p>
            <p className="text-xs font-medium text-foreground">{detectedVoices.length} speakers</p>
          </div>
        </div>

        {/* Voice Summary */}
        <div className="rounded-lg border border-border bg-card p-3">
          <h4 className="text-xs font-medium text-foreground">Voice Mapping</h4>
          <div className="mt-2 space-y-1.5">
            {detectedVoices.map((voice) => (
              <div key={voice.id} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{voice.characterName}</span>
                <Badge variant="outline" className="text-[10px] h-5">
                  {voice.selectedVoice?.replace("-", " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                </Badge>
              </div>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        {originalVideo.jobId && (
          <Button asChild className="w-full gap-1.5 h-8 text-xs">
            <Link href={`/editor/${originalVideo.jobId}`}>
              <Pencil className="h-3.5 w-3.5" />
              Open in Editor
            </Link>
          </Button>
        )}
        <div className="flex gap-2">
          <Button className="flex-1 gap-1.5 h-8 text-xs" onClick={handleDownload} disabled={!dubbedVideoUrl}>
            <Download className="h-3.5 w-3.5" />
            Download
          </Button>
          <Button variant="outline" className="gap-1.5 h-8 text-xs bg-transparent" onClick={handleShare}>
            <Share2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="outline" className="gap-1.5 h-8 text-xs bg-transparent" onClick={onRegenerate}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Export Formats */}
        <div className="rounded-lg bg-muted/50 p-3">
          <h4 className="text-xs font-medium text-foreground">Export Formats</h4>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button variant="outline" size="sm" className="gap-1 text-[10px] h-6 bg-transparent" onClick={handleDownload} disabled={!dubbedVideoUrl}>
              <FileVideo className="h-3 w-3" />
              MP4
            </Button>
            <Button variant="outline" size="sm" className="gap-1 text-[10px] h-6 bg-transparent" disabled>
              <FileVideo className="h-3 w-3" />
              WebM
            </Button>
            <Button variant="outline" size="sm" className="gap-1 text-[10px] h-6 bg-transparent" disabled>
              <FileVideo className="h-3 w-3" />
              MOV
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
