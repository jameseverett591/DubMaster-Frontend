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
import { useEffect, useState } from "react"
import type { VideoSource, DetectedVoice } from "@/components/dashboard"
import { apiClient } from "@/lib/api-client"
import { usePlan } from "@/lib/use-plan"
import { useT } from '@/lib/use-t'

// Paywall basis for sharing/downloading a finished dub: active subscription
// unlocks outright; otherwise the job's render must already be billed (or the
// caller is a bypassed test account). Mirrors the editor gate and the
// backend's /download attachment 402.
function useShareUnlocked(jobId?: string): boolean {
  const { isPro } = usePlan()
  const [jobPaid, setJobPaid] = useState(false)
  useEffect(() => {
    if (!jobId) return
    apiClient.getQuotaEstimate(jobId)
      .then(q => setJobPaid(!!q && (q.bypassed === true || q.already_billed === true)))
      .catch(() => {})
  }, [jobId])
  return isPro || jobPaid
}

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
  const t = useT()
  const isComplete = !isDubbing && dubbingProgress >= 100
  const [linkCopied, setLinkCopied] = useState(false)
  const [isSharing, setIsSharing] = useState(false)
  const shareUnlocked = useShareUnlocked(originalVideo.jobId)
  const lockedTitle = t('Available after payment')

  const handleDownload = () => {
    let url = dubbedVideoUrl ?? originalVideo.url
    // Cross-origin (UI :3001 → API :8000) ignores the `download` attribute and
    // plays the file inline; the API's attachment=1 switch answers
    // Content-Disposition: attachment, which is what actually saves the file.
    if (url.includes("/api/download/")) {
      url += `${url.includes("?") ? "&" : "?"}attachment=1`
    }
    const link = document.createElement("a")
    link.href = url
    link.download = `${originalVideo.title}_dubbed_${targetLanguage}.mp4`
    link.target = "_blank"
    link.rel = "noopener noreferrer"
    link.click()
  }

  // Fetch-into-memory cap: above this we share the authenticated link
  // instead of materialising the file.
  const SHARE_FILE_MAX_BYTES = 250 * 1024 * 1024

  const handleShare = async () => {
    const fileName = `${originalVideo.title}_dubbed_${targetLanguage}.mp4`

    // Prefer Web Share Level 2: hand the OS the actual video FILE so share
    // targets (Save, Mail, Nearby Share, installed apps) receive the video
    // itself. The old code shared window.location.href — a link back into
    // DubMaster — so the video never left the app.
    if (dubbedVideoUrl && navigator.canShare) {
      setIsSharing(true)
      try {
        const resp = await fetch(dubbedVideoUrl)
        if (resp.ok) {
          const blob = await resp.blob()
          if (blob.size <= SHARE_FILE_MAX_BYTES) {
            const file = new File([blob], fileName, { type: blob.type || "video/mp4" })
            if (navigator.canShare({ files: [file] })) {
              await navigator.share({ files: [file], title: fileName })
              return
            }
          }
        }
      } catch {
        // File fetch/share failed or was cancelled — fall through to link share.
      } finally {
        setIsSharing(false)
      }
    }

    // Fallback: share the direct video URL (never the DubMaster page URL).
    const shareUrl = dubbedVideoUrl ?? window.location.href
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${originalVideo.title} - Dubbed in ${LANGUAGE_NAMES[targetLanguage]}`,
          text: "Check out this dubbed video!",
          url: shareUrl,
        })
      } catch {
        // User cancelled share
      }
      return
    }
    try {
      await navigator.clipboard.writeText(shareUrl)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2000)
    } catch {
      // Clipboard unavailable
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
            {t('Generating Dubbed Video')}
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
              <span className="text-muted-foreground">{t('Overall Progress')}</span>
              <span className="font-medium text-foreground">{Math.round(dubbingProgress)}%</span>
            </div>
            <Progress value={dubbingProgress} className="h-2.5" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-border bg-card p-2.5">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Mic2 className="h-3.5 w-3.5" />
                {t('Voice Synthesis')}
              </div>
              <p className="mt-0.5 text-xs font-medium text-foreground">
                {dubbingProgress < 35 ? "Preparing..." : dubbingProgress < 70 ? t('In Progress') : t('Finalizing')}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-2.5">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Languages className="h-3.5 w-3.5" />
                {t('Target Language')}
              </div>
              <p className="mt-0.5 text-xs font-medium text-foreground">{LANGUAGE_NAMES[targetLanguage]}</p>
            </div>
          </div>

          <div className="rounded-lg bg-muted/50 p-3">
            <h4 className="text-xs font-medium text-foreground">{t('Processing Steps:')}</h4>
            <ul className="mt-1.5 space-y-1.5 text-xs">
              {[
                { label: "Extracting original audio", threshold: 12 },
                { label: "Translating {count} speaker tracks", vars: { count: detectedVoices.length }, threshold: 35 },
                { label: "Generating AI voice-overs", threshold: 70 },
                { label: "Syncing audio with video", threshold: 88 },
                { label: "Final rendering", threshold: 100 },
              ].map(({ label, threshold, vars }, i, arr) => {
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
                    <span className={done || active ? "text-foreground" : "text-muted-foreground"}>{t(label, vars)}</span>
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
              {t('Dubbing Complete!')}
            </CardTitle>
            <CardDescription className="text-xs">
              Dubbed into {LANGUAGE_NAMES[targetLanguage]}
            </CardDescription>
          </div>
          <Badge className="bg-green-500/10 text-green-500 border-green-500/20 text-xs">{t('Ready')}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          {t('Use the Original/Dubbed toggle on the video player to compare.')}
        </p>

        {/* Video Info */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-border bg-card p-2.5 text-center">
            <Clock className="mx-auto h-4 w-4 text-muted-foreground" />
            <p className="mt-0.5 text-xs text-muted-foreground">{t('Duration')}</p>
            <p className="text-xs font-medium text-foreground">{originalVideo.duration}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-2.5 text-center">
            <Mic2 className="mx-auto h-4 w-4 text-muted-foreground" />
            <p className="mt-0.5 text-xs text-muted-foreground">{t('Voices')}</p>
            <p className="text-xs font-medium text-foreground">{detectedVoices.length} speakers</p>
          </div>
        </div>

        {/* Voice Summary */}
        <div className="rounded-lg border border-border bg-card p-3">
          <h4 className="text-xs font-medium text-foreground">{t('Voice Mapping')}</h4>
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
              {t('Open in Editor')}
            </Link>
          </Button>
        )}
        <div className="flex gap-2">
          <Button className="flex-1 gap-1.5 h-8 text-xs" onClick={handleDownload} disabled={!dubbedVideoUrl || !shareUnlocked} title={shareUnlocked ? undefined : lockedTitle}>
            <Download className="h-3.5 w-3.5" />
            {t('Download')}
          </Button>
          <Button variant="outline" className="gap-1.5 h-8 text-xs bg-transparent" onClick={handleShare} disabled={isSharing || !shareUnlocked} title={shareUnlocked ? (linkCopied ? t('Link copied!') : t('Share')) : lockedTitle}>
            {isSharing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : linkCopied ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> : <Share2 className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="outline" className="gap-1.5 h-8 text-xs bg-transparent" onClick={onRegenerate}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Export Formats */}
        <div className="rounded-lg bg-muted/50 p-3">
          <h4 className="text-xs font-medium text-foreground">{t('Export Formats')}</h4>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button variant="outline" size="sm" className="gap-1 text-[10px] h-6 bg-transparent" onClick={handleDownload} disabled={!dubbedVideoUrl || !shareUnlocked} title={shareUnlocked ? undefined : lockedTitle}>
              <FileVideo className="h-3 w-3" />
              MP4
            </Button>
            <Button variant="outline" size="sm" className="gap-1 text-[10px] h-6 bg-transparent" disabled>
              <FileVideo className="h-3 w-3" />
              {t('WebM')}
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
