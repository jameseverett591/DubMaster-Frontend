"use client"

import React from "react"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_GB } from "@/lib/plan-features"
import {
  Youtube,
  Clock,
  Languages,
  AlertCircle,
  Upload,
  FileText,
  Download,
  Link2,
  CheckCircle2,
  Info,
  Play,
  Edit3,
  Loader2,
  LogIn,
  LogOut,
  Import
} from "lucide-react"
import type { VideoSource } from "@/components/dashboard"
import { apiClient } from "@/lib/api-client"
import { useT } from '@/lib/use-t'

interface YouTubeIntegrationProps {
  onVideoSelect: (video: VideoSource) => void
}

type ChannelVideo = {
  id: string
  title: string
  thumbnail: string
  duration: string
  publishedAt: string
}

type TranscriptLine = {
  id: string
  start: number
  end: number
  text: string
  speaker?: string
}

const YT_SCOPE = "https://www.googleapis.com/auth/youtube.readonly"
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ""

declare global {
  interface Window {
    google?: any
  }
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, "0")}`
}

/** ISO 8601 (PT1H2M3S) → "1:02:03" / "2:03" */
function formatIsoDuration(iso: string): string {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!m) return ""
  const h = parseInt(m[1] || "0"), min = parseInt(m[2] || "0"), s = parseInt(m[3] || "0")
  const mm = String(min).padStart(2, "0"), ss = String(s).padStart(2, "0")
  return h > 0 ? `${h}:${mm}:${ss}` : `${min}:${ss}`
}

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 1000)
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")},${ms.toString().padStart(3, "0")}`
}

function formatVttTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 1000)
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`
}

/** Load the Google Identity Services script once. */
function loadGis(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve()
    const existing = document.querySelector('script[src*="accounts.google.com/gsi/client"]')
    if (existing) {
      existing.addEventListener("load", () => resolve())
      existing.addEventListener("error", () => reject(new Error("Failed to load Google sign-in")))
      return
    }
    const s = document.createElement("script")
    s.src = "https://accounts.google.com/gsi/client"
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error("Failed to load Google sign-in"))
    document.head.appendChild(s)
  })
}

export function YouTubeIntegration({ onVideoSelect }: YouTubeIntegrationProps) {
  const t = useT()
  const [youtubeUrl, setYoutubeUrl] = useState("")
  const [activeMode, setActiveMode] = useState("captions")

  // YouTube sign-in state
  const [ytToken, setYtToken] = useState<string | null>(null)
  const [ytChannel, setYtChannel] = useState<string | null>(null)
  const [channelVideos, setChannelVideos] = useState<ChannelVideo[]>([])
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [isLoadingVideos, setIsLoadingVideos] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  // Transcript extraction state
  const [extractedTranscript, setExtractedTranscript] = useState<TranscriptLine[] | null>(null)
  const [extractedLang, setExtractedLang] = useState<string | null>(null)
  const [extractedAuto, setExtractedAuto] = useState(false)
  const [extractedTitle, setExtractedTitle] = useState<string | null>(null)
  const [isExtracting, setIsExtracting] = useState(false)
  const [extractError, setExtractError] = useState<string | null>(null)
  const [captionSource, setCaptionSource] = useState<"youtube" | "upload" | null>(null)

  // Import state
  const [isImporting, setIsImporting] = useState(false)
  const [importingVideoId, setImportingVideoId] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)



  // Own video upload state
  const [ownVideoFile, setOwnVideoFile] = useState<File | null>(null)
  const [ownVideoError, setOwnVideoError] = useState<string | null>(null)

  // ── YouTube sign-in ──────────────────────────────────────────────────────

  const fetchChannelVideos = useCallback(async (token: string) => {
    setIsLoadingVideos(true)
    setAuthError(null)
    try {
      const headers = { Authorization: `Bearer ${token}` }
      const chRes = await fetch(
        "https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&mine=true",
        { headers })
      if (!chRes.ok) {
        if (chRes.status === 401) {
          setYtToken(null)
          throw new Error("YouTube session expired — sign in again")
        }
        throw new Error(`YouTube API error ${chRes.status}`)
      }
      const chData = await chRes.json()
      const channel = chData.items?.[0]
      if (!channel) throw new Error("This Google account has no YouTube channel")
      setYtChannel(channel.snippet?.title || "Your channel")
      const uploadsId = channel.contentDetails?.relatedPlaylists?.uploads
      if (!uploadsId) {
        setChannelVideos([])
        return
      }
      const plRes = await fetch(
        `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${uploadsId}&maxResults=50`,
        { headers })
      if (!plRes.ok) throw new Error(`YouTube API error ${plRes.status}`)
      const plData = await plRes.json()
      const videos: ChannelVideo[] = (plData.items || [])
        .map((item: any) => ({
          id: item.contentDetails?.videoId || item.snippet?.resourceId?.videoId,
          title: item.snippet?.title || "Untitled",
          thumbnail: item.snippet?.thumbnails?.medium?.url
            || item.snippet?.thumbnails?.default?.url || "",
          duration: formatIsoDuration(item.contentDetails?.duration || ""),
          publishedAt: item.snippet?.publishedAt || "",
        }))
        .filter((v: ChannelVideo) => v.id && v.title !== "Private video" && v.title !== "Deleted video")
      setChannelVideos(videos)
    } catch (e: any) {
      setAuthError(e.message || "Could not load your videos")
      setChannelVideos([])
    } finally {
      setIsLoadingVideos(false)
    }
  }, [])

  const handleYouTubeSignIn = async () => {
    if (!GOOGLE_CLIENT_ID) {
      setAuthError("YouTube sign-in isn't configured yet (missing NEXT_PUBLIC_GOOGLE_CLIENT_ID)")
      return
    }
    setIsSigningIn(true)
    setAuthError(null)
    try {
      await loadGis()
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: YT_SCOPE,
        callback: async (resp: any) => {
          setIsSigningIn(false)
          if (resp.error) {
            setAuthError(resp.error === "access_denied"
              ? "YouTube access was denied"
              : `Sign-in failed: ${resp.error}`)
            return
          }
          setYtToken(resp.access_token)
          fetchChannelVideos(resp.access_token)
        },
      })
      client.requestAccessToken({ prompt: "" })
    } catch (e: any) {
      setIsSigningIn(false)
      setAuthError(e.message || "Sign-in failed")
    }
  }

  const handleYouTubeSignOut = () => {
    if (ytToken && window.google?.accounts?.oauth2) {
      window.google.accounts.oauth2.revoke(ytToken, () => {})
    }
    setYtToken(null)
    setYtChannel(null)
    setChannelVideos([])
  }

  // ── Caption extraction ───────────────────────────────────────────────────

  const handleExtractTranscript = async (url: string) => {
    if (!url.trim()) return
    setIsExtracting(true)
    setExtractError(null)
    setExtractedTranscript(null)
    setExtractedTitle(null)
    try {
      // Info probe runs alongside — it's a slower yt-dlp call, so a failure
      // there shouldn't block the captions themselves.
      const [result, info] = await Promise.all([
        apiClient.getYouTubeCaptions(url),
        apiClient.getYouTubeInfo(url).catch(() => null),
      ])
      setExtractedTranscript(result.segments.map((s, i) => ({
        id: String(i + 1),
        start: s.start,
        end: s.end,
        text: s.text,
      })))
      setExtractedLang(result.language)
      setExtractedAuto(result.is_generated)
      setExtractedTitle(info?.title || null)
      setCaptionSource("youtube")
    } catch (e: any) {
      setExtractError(e.message || "Caption extraction failed")
    } finally {
      setIsExtracting(false)
    }
  }

  // ── Video import ─────────────────────────────────────────────────────────

  const handleImportVideo = async (url: string, title?: string,
                                   thumbnail?: string, duration?: string) => {
    if (!url.trim() || isImporting) return
    setIsImporting(true)
    setImportError(null)
    try {
      const res = await apiClient.importYouTube(url)
      const videoUrl = await apiClient.mediaUrl(`/api/media/${res.job_id}/video`)
      onVideoSelect({
        id: res.job_id,
        jobId: res.job_id,
        title: title || res.video_filename || "YouTube video",
        url: videoUrl,
        thumbnail: thumbnail || "",
        duration: duration || "Unknown",
        source: "youtube",
      })
    } catch (e: any) {
      setImportError(e.message || "Import failed")
    } finally {
      setIsImporting(false)
      setImportingVideoId(null)
    }
  }

  // ── Transcript download helpers ──────────────────────────────────────────

  const handleDownloadTranscript = (format: "srt" | "vtt" | "txt" | "json") => {
    if (!extractedTranscript) return

    let content = ""
    const filename = `transcript.${format}`

    if (format === "srt") {
      content = extractedTranscript.map((line, i) => {
        const startTime = formatSrtTime(line.start)
        const endTime = formatSrtTime(line.end)
        return `${i + 1}\n${startTime} --> ${endTime}\n${line.text}\n`
      }).join("\n")
    } else if (format === "vtt") {
      content = "WEBVTT\n\n" + extractedTranscript.map((line) => {
        const startTime = formatVttTime(line.start)
        const endTime = formatVttTime(line.end)
        return `${startTime} --> ${endTime}\n${line.text}\n`
      }).join("\n")
    } else if (format === "txt") {
      content = extractedTranscript.map(line => line.text).join("\n")
    } else if (format === "json") {
      content = JSON.stringify(extractedTranscript, null, 2)
    }

    const blob = new Blob([content], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  // Shared with the main uploader so the two can't drift; mirrors
  // MAX_UPLOAD_SIZE in the backend's app/config.py.

  const handleOwnVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > MAX_UPLOAD_BYTES) {
      setOwnVideoError(
        `That file is ${(file.size / 1024 ** 3).toFixed(1)}GB. The limit is ${MAX_UPLOAD_GB}GB — try a smaller export.`
      )
      setOwnVideoFile(null)
      e.target.value = ''   // let the same file be re-picked after re-encoding
      return
    }
    setOwnVideoError(null)
    setOwnVideoFile(file)
  }

  const handleStartDubbingWithOwnVideo = async () => {
    if (!ownVideoFile || !extractedTranscript || isImporting) return
    setIsImporting(true)
    setImportError(null)
    try {
      // Upload the file WITH the extracted captions — the backend stores them
      // as the job transcript and skips ASR entirely.
      const res = await apiClient.uploadVideo(
        ownVideoFile,
        undefined, undefined, undefined, undefined, undefined,
        extractedTranscript.map(l => ({
          text: l.text, start: l.start, end: l.end, speaker: l.speaker,
        })),
      )
      const videoUrl = await apiClient.mediaUrl(`/api/media/${res.job_id}/video`)
      onVideoSelect({
        id: res.job_id,
        jobId: res.job_id,
        title: ownVideoFile.name,
        url: videoUrl,
        thumbnail: "",
        duration: "Unknown",
        source: "upload",
      })
    } catch (e: any) {
      setImportError(e.message || "Upload failed")
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* Important Notice */}
      <Card className="backdrop-blur-md bg-blue-500/10 border-blue-500/30">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" />
            <div className="space-y-2">
              <p className="font-medium text-blue-400">{t('About YouTube Integration')}</p>
              <p className="text-sm text-blue-300/80">
                {t('Sign in with YouTube to browse your own channel, or paste a video URL directly. You can import any video you have the right to download:')}
              </p>
              <ul className="text-sm text-blue-300/80 list-disc list-inside space-y-1 ml-2">
                <li>{t('Videos you own and uploaded to your channel')}</li>
                <li>{t('Public domain videos — freely downloadable, no permission needed')}</li>
                <li>{t('Videos you have permission to download and dub')}</li>
              </ul>
              <p className="text-sm text-blue-300/80 mt-2">
                {t('You can also extract captions and transcripts with full timestamps, or pair YouTube captions with a video file you upload yourself.')}
              </p>
              <p className="text-sm text-blue-300/80 mt-2">
                <strong>{t('Note:')}</strong> {t("You're responsible for having the rights to any video you import. Private and age-restricted videos are not supported.")}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Tabs */}
      <Tabs value={activeMode} onValueChange={setActiveMode} className="w-full">
        <TabsList className="grid w-full grid-cols-3 bg-background/50 backdrop-blur-md">
          <TabsTrigger value="captions" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            {t('Extract Captions')}
          </TabsTrigger>
          <TabsTrigger value="own-video" className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            {t('Your Own Video')}
          </TabsTrigger>
          <TabsTrigger value="browse" className="flex items-center gap-2">
            <Youtube className="h-4 w-4" />
            {t('Browse Videos')}
          </TabsTrigger>
        </TabsList>

        {/* Extract Captions Tab */}
        <TabsContent value="captions" className="space-y-6 mt-6">
          <Card className="backdrop-blur-md bg-card/50 border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Youtube className="h-5 w-5 text-red-500" />
                {t('Extract YouTube Transcripts')}
              </CardTitle>
              <CardDescription>
                {t('Paste a YouTube URL to extract captions with timestamps for dubbing')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-3">
                <Input
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  className="flex-1"
                />
                <Button
                  onClick={() => handleExtractTranscript(youtubeUrl)}
                  disabled={isExtracting || !youtubeUrl.trim()}
                >
                  {isExtracting
                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    : <FileText className="mr-2 h-4 w-4" />}
                  {isExtracting ? t('Extracting...') : t('Extract Captions')}
                </Button>
              </div>

              {extractError && (
                <div className="flex items-start gap-2 text-sm text-red-500">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  {extractError}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Extracted Transcript Display */}
          {extractedTranscript && (
            <Card className="backdrop-blur-md bg-card/50 border-border/50">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                      {t('Transcript Extracted')}
                      {extractedAuto && (
                        <Badge variant="secondary" className="text-xs">
                          {t('auto-generated')}
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription>
                      {extractedTitle && <span className="block">{extractedTitle} — </span>}
                      {extractedTranscript.length} segments
                      {extractedLang && ` • ${extractedLang}`}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleDownloadTranscript("srt")}>
                      <Download className="mr-2 h-4 w-4" />
                      SRT
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleDownloadTranscript("vtt")}>
                      <Download className="mr-2 h-4 w-4" />
                      VTT
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleDownloadTranscript("json")}>
                      <Download className="mr-2 h-4 w-4" />
                      JSON
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[300px] rounded-lg border border-border/50 bg-background/30">
                  <div className="p-4 space-y-3">
                    {extractedTranscript.map((line) => (
                      <div
                        key={line.id}
                        className="flex gap-4 p-3 rounded-lg hover:bg-muted/30 transition-colors group"
                      >
                        <div className="flex flex-col items-center gap-1 text-xs text-muted-foreground min-w-[80px]">
                          <span className="font-mono bg-muted/50 px-2 py-1 rounded">
                            {formatTime(line.start)}
                          </span>
                          <span className="text-muted-foreground/50">to</span>
                          <span className="font-mono bg-muted/50 px-2 py-1 rounded">
                            {formatTime(line.end)}
                          </span>
                        </div>
                        <div className="flex-1">
                          {line.speaker && (
                            <span className="text-xs font-medium text-primary mb-1 block">
                              {line.speaker}
                            </span>
                          )}
                          <p className="text-foreground">{line.text}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Edit3 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>

                <div className="mt-4 flex gap-3">
                  <Button
                    className="flex-1"
                    disabled={isImporting}
                    onClick={() => handleImportVideo(
                      youtubeUrl,
                      extractedTitle || undefined)}
                  >
                    {isImporting
                      ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      : <Play className="mr-2 h-4 w-4" />}
                    {isImporting ? t('Importing...') : t('Import Video & Start Dubbing')}
                  </Button>
                </div>
                {importError && (
                  <div className="mt-2 flex items-start gap-2 text-sm text-red-500">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    {importError}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Your Own Video Tab */}
        <TabsContent value="own-video" className="space-y-6 mt-6">
          <Card className="backdrop-blur-md bg-card/50 border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5 text-primary" />
                {t('Dub Your Own YouTube Video')}
              </CardTitle>
              <CardDescription>
                {t('Upload a video you own and pair it with YouTube captions for perfect sync')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Step 1: Upload Video */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                    1
                  </div>
                  <h4 className="font-medium">{t('Upload Your Video File')}</h4>
                </div>
                <div className="ml-8">
                  <label
                    className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border/50 bg-background/30 p-6 transition-colors hover:border-primary/50 hover:bg-muted/20"
                  >
                    <Upload className="h-10 w-10 text-muted-foreground mb-3" />
                    <span className="text-sm font-medium text-foreground">
                      {ownVideoFile ? ownVideoFile.name : "Click to upload your video"}
                    </span>
                    <span className="text-xs text-muted-foreground mt-1">
                      {t('MP4, WebM, MOV up to 5GB')}
                    </span>
                    <input
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={handleOwnVideoUpload}
                    />
                  </label>
                  {ownVideoError && (
                    <div className="mt-2 flex items-start gap-2 text-sm text-red-500">
                      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                      {ownVideoError}
                    </div>
                  )}
                  {ownVideoFile && (
                    <div className="mt-2 flex items-center gap-2 text-sm text-green-500">
                      <CheckCircle2 className="h-4 w-4" />
                      Video ready: {ownVideoFile.name}
                    </div>
                  )}
                </div>
              </div>

              {/* Step 2: Get Captions */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                    2
                  </div>
                  <h4 className="font-medium">{t('Get Captions from YouTube')}</h4>
                </div>
                <div className="ml-8 space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {t('Paste the YouTube URL of this video to extract its captions:')}
                  </p>
                  <div className="flex gap-3">
                    <Input
                      placeholder="https://www.youtube.com/watch?v=..."
                      value={youtubeUrl}
                      onChange={(e) => setYoutubeUrl(e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      variant="outline"
                      disabled={isExtracting || !youtubeUrl.trim()}
                      onClick={() => handleExtractTranscript(youtubeUrl)}
                    >
                      {isExtracting
                        ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        : <Link2 className="mr-2 h-4 w-4" />}
                      {t('Extract')}
                    </Button>
                  </div>

                  {extractError && (
                    <div className="flex items-start gap-2 text-sm text-red-500">
                      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                      {extractError}
                    </div>
                  )}

                  {extractedTranscript && captionSource === "youtube" && (
                    <div className="flex items-center gap-2 text-sm text-green-500">
                      <CheckCircle2 className="h-4 w-4" />
                      {extractedTranscript.length} caption segments extracted
                    </div>
                  )}
                </div>
              </div>

              {/* Step 3: Start Dubbing */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                    ownVideoFile && extractedTranscript
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}>
                    3
                  </div>
                  <h4 className={`font-medium ${!ownVideoFile || !extractedTranscript ? "text-muted-foreground" : ""}`}>
                    {t('Start Dubbing')}
                  </h4>
                </div>
                <div className="ml-8 space-y-2">
                  <Button
                    className="w-full"
                    disabled={!ownVideoFile || !extractedTranscript || isImporting}
                    onClick={handleStartDubbingWithOwnVideo}
                  >
                    {isImporting
                      ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      : <Languages className="mr-2 h-4 w-4" />}
                    {isImporting ? t('Uploading...') : t('Start Dubbing Your Video')}
                  </Button>
                  {importError && (
                    <div className="flex items-start gap-2 text-sm text-red-500">
                      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                      {importError}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Browse Videos Tab — sign in to see your own channel uploads */}
        <TabsContent value="browse" className="space-y-6 mt-6">
          {!ytToken ? (
            <Card className="backdrop-blur-md bg-card/50 border-border/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Youtube className="h-5 w-5 text-red-500" />
                  {t('Your YouTube Videos')}
                </CardTitle>
                <CardDescription>
                  {t('Sign in with YouTube to browse and import videos from your own channel')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Button
                  onClick={handleYouTubeSignIn}
                  disabled={isSigningIn}
                  className="w-full sm:w-auto"
                >
                  {isSigningIn
                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    : <LogIn className="mr-2 h-4 w-4" />}
                  {isSigningIn ? t('Signing in...') : t('Sign in with YouTube')}
                </Button>
                {authError && (
                  <div className="flex items-start gap-2 text-sm text-red-500">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    {authError}
                  </div>
                )}
                {!GOOGLE_CLIENT_ID && (
                  <p className="text-xs text-muted-foreground">
                    {t('YouTube sign-in requires a Google OAuth client ID to be configured (NEXT_PUBLIC_GOOGLE_CLIENT_ID).')}
                  </p>
                )}

                {/* Direct URL import still works without sign-in */}
                <div className="pt-4 border-t border-border/50 space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {t('Or paste a URL — videos you own, have permission for, or that are public domain:')}
                  </p>
                  <div className="flex gap-3">
                    <Input
                      placeholder="https://www.youtube.com/watch?v=..."
                      value={youtubeUrl}
                      onChange={(e) => setYoutubeUrl(e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      variant="outline"
                      disabled={isImporting || !youtubeUrl.trim()}
                      onClick={() => handleImportVideo(youtubeUrl)}
                    >
                      {isImporting
                        ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        : <Import className="mr-2 h-4 w-4" />}
                      {t('Import')}
                    </Button>
                  </div>
                  {importError && (
                    <div className="flex items-start gap-2 text-sm text-red-500">
                      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                      {importError}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card className="backdrop-blur-md bg-card/50 border-border/50">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Youtube className="h-5 w-5 text-red-500" />
                        {ytChannel}
                      </CardTitle>
                      <CardDescription>
                        {channelVideos.length} {t('videos on your channel')}
                      </CardDescription>
                    </div>
                    <Button variant="outline" size="sm" onClick={handleYouTubeSignOut}>
                      <LogOut className="mr-2 h-4 w-4" />
                      {t('Sign out')}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {isLoadingVideos ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t('Loading your videos...')}
                    </div>
                  ) : channelVideos.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4">
                      {t('No public uploads found on this channel.')}
                    </p>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                      {channelVideos.map((video) => (
                        <Card
                          key={video.id}
                          className="overflow-hidden backdrop-blur-md bg-card/50 border-border/50"
                        >
                          <div className="relative aspect-video">
                            <img
                              src={video.thumbnail || "/placeholder.svg"}
                              alt={video.title}
                              className="h-full w-full object-cover"
                            />
                            {video.duration && (
                              <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded bg-black/80 px-2 py-1 text-xs text-white">
                                <Clock className="h-3 w-3" />
                                {video.duration}
                              </div>
                            )}
                          </div>
                          <CardContent className="p-4">
                            <h4 className="line-clamp-2 font-medium text-foreground">{video.title}</h4>
                            <Button
                              className="mt-3 w-full"
                              size="sm"
                              disabled={isImporting}
                              onClick={() => {
                                setImportingVideoId(video.id)
                                handleImportVideo(
                                  `https://www.youtube.com/watch?v=${video.id}`,
                                  video.title,
                                  video.thumbnail,
                                  video.duration)
                              }}
                            >
                              {importingVideoId === video.id && isImporting
                                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                : <Import className="mr-2 h-4 w-4" />}
                              {t('Import to Studio')}
                            </Button>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                  {authError && (
                    <div className="mt-3 flex items-start gap-2 text-sm text-red-500">
                      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                      {authError}
                    </div>
                  )}
                  {importError && (
                    <div className="mt-3 flex items-start gap-2 text-sm text-red-500">
                      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                      {importError}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Direct URL import */}
              <Card className="backdrop-blur-md bg-card/50 border-border/50">
                <CardHeader>
                  <CardTitle>{t('Import by URL')}</CardTitle>
                  <CardDescription>{t('Paste a video URL — your own, public domain, or one you have permission to use')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-3">
                    <Input
                      placeholder="https://www.youtube.com/watch?v=..."
                      value={youtubeUrl}
                      onChange={(e) => setYoutubeUrl(e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      variant="outline"
                      disabled={isImporting || !youtubeUrl.trim()}
                      onClick={() => handleImportVideo(youtubeUrl)}
                    >
                      {isImporting
                        ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        : <Import className="mr-2 h-4 w-4" />}
                      {t('Import')}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
