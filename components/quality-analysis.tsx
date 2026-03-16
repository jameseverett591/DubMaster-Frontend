"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  BarChart3,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  RefreshCw,
  Volume2,
  Clock,
  Zap,
  VolumeX,
  Activity,
  Eye,
  Heart,
  Mic,
  Languages,
  XCircle,
} from "lucide-react"
import {
  apiClient,
  type QualityAnalysis,
  type AnalysisStatus,
} from "@/lib/api-client"

interface QualityAnalysisProps {
  jobId: string
  language: string
  dubbingComplete: boolean
}

const GRADE_COLORS: Record<string, string> = {
  A: "text-green-500 border-green-500/30 bg-green-500/10",
  B: "text-blue-500 border-blue-500/30 bg-blue-500/10",
  C: "text-yellow-500 border-yellow-500/30 bg-yellow-500/10",
  D: "text-orange-500 border-orange-500/30 bg-orange-500/10",
  F: "text-red-500 border-red-500/30 bg-red-500/10",
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

export function QualityAnalysisPanel({ jobId, language, dubbingComplete }: QualityAnalysisProps) {
  const [status, setStatus] = useState<AnalysisStatus>("idle")
  const [analysis, setAnalysis] = useState<QualityAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const poll = useCallback(async () => {
    try {
      const resp = await apiClient.getAnalysis(jobId, language)
      if (resp.status === "complete" && resp.analysis) {
        setAnalysis(resp.analysis)
        setStatus("complete")
        stopPolling()
      }
      // If "running" or "started", keep polling
    } catch (e) {
      setError(e instanceof Error ? e.message : "Polling failed")
      setStatus("error")
      stopPolling()
    }
  }, [jobId, language, stopPolling])

  const handleAnalyze = async () => {
    setError(null)
    setStatus("running")
    try {
      await apiClient.triggerAnalysis(jobId, language)
      // Start polling at 3s intervals
      pollRef.current = setInterval(poll, 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to trigger analysis")
      setStatus("error")
    }
  }

  // Check for existing analysis on mount
  useEffect(() => {
    if (!dubbingComplete) return
    const check = async () => {
      try {
        const resp = await apiClient.getAnalysis(jobId, language)
        if (resp.status === "complete" && resp.analysis) {
          setAnalysis(resp.analysis)
          setStatus("complete")
        } else if (resp.status === "running") {
          setStatus("running")
          pollRef.current = setInterval(poll, 3000)
        }
      } catch {
        // No existing analysis — that's fine
      }
    }
    check()
    return stopPolling
  }, [jobId, language, dubbingComplete, poll, stopPolling])

  if (!dubbingComplete) {
    return (
      <div className="flex flex-col items-center justify-center p-6 text-center text-muted-foreground">
        <BarChart3 className="h-8 w-8 mb-2 opacity-40" />
        <p className="text-xs">Complete dubbing first to run quality analysis</p>
      </div>
    )
  }

  if (status === "idle") {
    return (
      <div className="flex flex-col items-center justify-center p-6 text-center gap-3">
        <BarChart3 className="h-8 w-8 text-muted-foreground opacity-60" />
        <div>
          <p className="text-xs font-medium text-foreground">Quality Analysis</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Evaluate timing, speed, loudness, and more
          </p>
        </div>
        <Button size="sm" className="h-7 text-xs gap-1.5" onClick={handleAnalyze}>
          <Activity className="h-3 w-3" />
          Analyze Dub Quality
        </Button>
      </div>
    )
  }

  if (status === "running") {
    return (
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-xs">
            <RefreshCw className="h-3.5 w-3.5 animate-spin text-primary" />
            Analyzing...
          </CardTitle>
          <CardDescription className="text-[10px]">
            Re-transcribing, measuring timing, loudness, speed...
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Progress value={undefined} className="h-1.5" />
        </CardContent>
      </Card>
    )
  }

  if (status === "error") {
    return (
      <div className="flex flex-col items-center justify-center p-6 text-center gap-2">
        <AlertCircle className="h-6 w-6 text-destructive" />
        <p className="text-xs text-destructive">{error}</p>
        <Button size="sm" variant="outline" className="h-7 text-xs bg-transparent" onClick={handleAnalyze}>
          Retry
        </Button>
      </div>
    )
  }

  if (!analysis) return null
  const { summary } = analysis

  return (
    <ScrollArea className="h-full">
      <div className="space-y-3 p-1">
        {/* Summary Card */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs">Quality Score</CardTitle>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                onClick={handleAnalyze}
                title="Re-analyze"
              >
                <RefreshCw className="h-3 w-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-center gap-3">
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-full border-2 text-lg font-bold ${GRADE_COLORS[summary.grade]}`}
              >
                {summary.grade}
              </div>
              <div className="flex-1">
                <div className="flex items-baseline gap-1">
                  <span className="text-xl font-bold text-foreground">{summary.score}</span>
                  <span className="text-[10px] text-muted-foreground">/100</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {Object.entries(summary.component_scores).map(([key, val]) => (
                    <Badge
                      key={key}
                      variant="outline"
                      className={`text-[9px] h-4 ${val >= 80 ? "border-green-500/30 text-green-600" : val >= 60 ? "border-yellow-500/30 text-yellow-600" : "border-red-500/30 text-red-600"}`}
                    >
                      {key}: {val}
                    </Badge>
                  ))}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {summary.services_available?.hume && (
                    <Badge className="text-[9px] h-4 bg-purple-500/10 text-purple-500 border-purple-500/20">
                      <Heart className="h-2.5 w-2.5 mr-0.5" />
                      Hume
                    </Badge>
                  )}
                  {summary.services_available?.azure_speech && (
                    <Badge className="text-[9px] h-4 bg-cyan-500/10 text-cyan-500 border-cyan-500/20">
                      <Mic className="h-2.5 w-2.5 mr-0.5" />
                      Azure Speech
                    </Badge>
                  )}
                  {summary.services_available?.azure_openai && (
                    <Badge className="text-[9px] h-4 bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
                      <Languages className="h-2.5 w-2.5 mr-0.5" />
                      Azure OpenAI
                    </Badge>
                  )}
                  {(summary.screenapp_available || summary.services_available?.screenapp) && (
                    <Badge className="text-[9px] h-4 bg-blue-500/10 text-blue-500 border-blue-500/20">
                      <Eye className="h-2.5 w-2.5 mr-0.5" />
                      ScreenApp
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Timing Issues */}
        {analysis.timing.status === "ok" && (
          <Card>
            <CardHeader className="pb-1.5">
              <CardTitle className="flex items-center gap-1.5 text-xs">
                <Clock className="h-3.5 w-3.5" />
                Timing
                {analysis.timing.issues_found ? (
                  <Badge variant="outline" className="ml-auto text-[9px] h-4 border-yellow-500/30 text-yellow-600">
                    {analysis.timing.issues_found} issues
                  </Badge>
                ) : (
                  <Badge variant="outline" className="ml-auto text-[9px] h-4 border-green-500/30 text-green-600">
                    OK
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            {analysis.timing.issues && analysis.timing.issues.length > 0 && (
              <CardContent className="pt-0">
                <div className="space-y-1">
                  {analysis.timing.issues.slice(0, 8).map((issue, i) => (
                    <div key={i} className="flex items-center justify-between text-[10px] py-0.5 border-b border-border/50 last:border-0">
                      <div className="flex items-center gap-1 flex-1 min-w-0">
                        {issue.severity === "high" ? (
                          <AlertCircle className="h-2.5 w-2.5 shrink-0 text-red-500" />
                        ) : issue.severity === "medium" ? (
                          <AlertTriangle className="h-2.5 w-2.5 shrink-0 text-yellow-500" />
                        ) : (
                          <CheckCircle2 className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                        )}
                        <span className="truncate text-muted-foreground">
                          #{issue.segment} {issue.text?.slice(0, 30)}
                        </span>
                      </div>
                      <span className="shrink-0 ml-1 font-mono">
                        {issue.type === "overlap"
                          ? `-${issue.overlap_seconds}s`
                          : `+${issue.offset?.toFixed(1)}s`}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            )}
          </Card>
        )}

        {/* Speed Anomalies */}
        {analysis.speed.status === "ok" && (
          <Card>
            <CardHeader className="pb-1.5">
              <CardTitle className="flex items-center gap-1.5 text-xs">
                <Zap className="h-3.5 w-3.5" />
                Speed
                {analysis.speed.anomalies_found ? (
                  <Badge variant="outline" className="ml-auto text-[9px] h-4 border-yellow-500/30 text-yellow-600">
                    {analysis.speed.anomalies_found} anomalies
                  </Badge>
                ) : (
                  <Badge variant="outline" className="ml-auto text-[9px] h-4 border-green-500/30 text-green-600">
                    OK
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="text-[10px]">
                Mean: {analysis.speed.mean_speed_ratio}x | StdDev: {analysis.speed.speed_std_dev}
              </CardDescription>
            </CardHeader>
            {analysis.speed.anomalies && analysis.speed.anomalies.length > 0 && (
              <CardContent className="pt-0">
                <div className="space-y-1">
                  {analysis.speed.anomalies.slice(0, 6).map((a, i) => (
                    <div key={i} className="flex items-center justify-between text-[10px] py-0.5 border-b border-border/50 last:border-0">
                      <div className="flex items-center gap-1 flex-1 min-w-0">
                        <Zap className={`h-2.5 w-2.5 shrink-0 ${a.severity === "high" ? "text-red-500" : "text-yellow-500"}`} />
                        <span className="truncate text-muted-foreground">
                          #{a.segment} {a.text?.slice(0, 25)}
                        </span>
                      </div>
                      <Badge variant="outline" className="text-[9px] h-4 shrink-0 ml-1">
                        {a.speed_ratio}x
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            )}
          </Card>
        )}

        {/* Silence Gaps */}
        {analysis.silences.status === "ok" && analysis.silences.unexpected_silences !== undefined && analysis.silences.unexpected_silences > 0 && (
          <Card>
            <CardHeader className="pb-1.5">
              <CardTitle className="flex items-center gap-1.5 text-xs">
                <VolumeX className="h-3.5 w-3.5" />
                Silence Gaps
                <Badge variant="outline" className="ml-auto text-[9px] h-4 border-red-500/30 text-red-600">
                  {analysis.silences.unexpected_silences} unexpected
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-1">
                {analysis.silences.silences
                  ?.filter((s) => s.expected_speech)
                  .slice(0, 5)
                  .map((s, i) => (
                    <div key={i} className="flex items-center justify-between text-[10px] py-0.5 border-b border-border/50 last:border-0">
                      <span className="text-muted-foreground">
                        {formatTime(s.start)} — {formatTime(s.end)}
                      </span>
                      <span className="font-mono text-red-500">{s.duration.toFixed(1)}s</span>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Loudness */}
        {analysis.loudness.status === "ok" && (
          <Card>
            <CardHeader className="pb-1.5">
              <CardTitle className="flex items-center gap-1.5 text-xs">
                <Volume2 className="h-3.5 w-3.5" />
                Loudness
                {analysis.loudness.within_spec ? (
                  <Badge variant="outline" className="ml-auto text-[9px] h-4 border-green-500/30 text-green-600">
                    Within spec
                  </Badge>
                ) : (
                  <Badge variant="outline" className="ml-auto text-[9px] h-4 border-red-500/30 text-red-600">
                    Out of spec
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-3 gap-1.5 text-center">
                <div className="rounded border border-border p-1.5">
                  <p className="text-[9px] text-muted-foreground">LUFS</p>
                  <p className="text-xs font-medium">{analysis.loudness.integrated_loudness_lufs}</p>
                </div>
                <div className="rounded border border-border p-1.5">
                  <p className="text-[9px] text-muted-foreground">Peak</p>
                  <p className="text-xs font-medium">{analysis.loudness.true_peak_dbfs} dB</p>
                </div>
                <div className="rounded border border-border p-1.5">
                  <p className="text-[9px] text-muted-foreground">Range</p>
                  <p className="text-xs font-medium">{analysis.loudness.loudness_range_lu} LU</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ScreenApp Insights */}
        {analysis.screenapp_dubbed?.status === "ok" && (
          <Card className="border-blue-500/20">
            <CardHeader className="pb-1.5">
              <CardTitle className="flex items-center gap-1.5 text-xs">
                <Eye className="h-3.5 w-3.5 text-blue-500" />
                ScreenApp Insights
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {analysis.screenapp_dubbed.summary && (
                <p className="text-[10px] text-muted-foreground mb-2">
                  {analysis.screenapp_dubbed.summary.slice(0, 200)}
                </p>
              )}
              {analysis.screenapp_dubbed.key_moments && analysis.screenapp_dubbed.key_moments.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-medium text-foreground">Key Moments</p>
                  {analysis.screenapp_dubbed.key_moments.slice(0, 5).map((m, i) => (
                    <div key={i} className="flex gap-1.5 text-[10px]">
                      <span className="shrink-0 font-mono text-muted-foreground">
                        {formatTime(m.time)}
                      </span>
                      <span className="text-foreground">{m.description}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {analysis.screenapp_dubbed?.status === "skipped" && (
          <Card className="border-border/50">
            <CardContent className="py-3">
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <Eye className="h-3 w-3 opacity-40" />
                <span>ScreenApp not configured. Set SCREENAPP_API_KEY for enhanced analysis.</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Emotion Analysis (Hume AI) */}
        {analysis.emotion?.status === "ok" && (
          <Card className="border-purple-500/20">
            <CardHeader className="pb-1.5">
              <CardTitle className="flex items-center gap-1.5 text-xs">
                <Heart className="h-3.5 w-3.5 text-purple-500" />
                Emotion Analysis
                <Badge
                  variant="outline"
                  className={`ml-auto text-[9px] h-4 ${
                    (analysis.emotion.emotion_variance ?? 0) >= 50
                      ? "border-green-500/30 text-green-600"
                      : (analysis.emotion.emotion_variance ?? 0) >= 25
                        ? "border-yellow-500/30 text-yellow-600"
                        : "border-red-500/30 text-red-600"
                  }`}
                >
                  {(analysis.emotion.emotion_variance ?? 0) >= 50
                    ? "Natural"
                    : (analysis.emotion.emotion_variance ?? 0) >= 25
                      ? "Moderate"
                      : "Robotic"}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-2 gap-1.5 text-center mb-2">
                <div className="rounded border border-border p-1.5">
                  <p className="text-[9px] text-muted-foreground">Variance</p>
                  <p className={`text-xs font-medium ${
                    (analysis.emotion.emotion_variance ?? 0) >= 50 ? "text-green-500"
                    : (analysis.emotion.emotion_variance ?? 0) >= 25 ? "text-yellow-500"
                    : "text-red-500"
                  }`}>
                    {analysis.emotion.emotion_variance}
                  </p>
                </div>
                <div className="rounded border border-border p-1.5">
                  <p className="text-[9px] text-muted-foreground">Intensity</p>
                  <p className="text-xs font-medium">{analysis.emotion.emotion_intensity}</p>
                </div>
              </div>
              {analysis.emotion.top_emotions && analysis.emotion.top_emotions.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {analysis.emotion.top_emotions.map((emo, i) => (
                    <Badge
                      key={i}
                      variant="outline"
                      className="text-[9px] h-4 border-purple-500/20 text-purple-600"
                    >
                      {emo.name}: {(emo.score * 100).toFixed(0)}%
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {analysis.emotion?.status === "skipped" && (
          <Card className="border-border/50">
            <CardContent className="py-3">
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <Heart className="h-3 w-3 opacity-40" />
                <span>Hume AI not configured. Set HUME_API_KEY for emotion analysis.</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Pronunciation Assessment (Azure Speech) */}
        {analysis.pronunciation?.status === "ok" && (
          <Card className="border-cyan-500/20">
            <CardHeader className="pb-1.5">
              <CardTitle className="flex items-center gap-1.5 text-xs">
                <Mic className="h-3.5 w-3.5 text-cyan-500" />
                Pronunciation
                <Badge
                  variant="outline"
                  className={`ml-auto text-[9px] h-4 ${
                    (analysis.pronunciation.fluency_score ?? 0) >= 80
                      ? "border-green-500/30 text-green-600"
                      : (analysis.pronunciation.fluency_score ?? 0) >= 60
                        ? "border-yellow-500/30 text-yellow-600"
                        : "border-red-500/30 text-red-600"
                  }`}
                >
                  {Math.round(
                    ((analysis.pronunciation.fluency_score ?? 0) +
                      (analysis.pronunciation.prosody_score ?? 0) +
                      (analysis.pronunciation.accuracy_score ?? 0) +
                      (analysis.pronunciation.completeness_score ?? 0)) / 4
                  )}/100
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-2 gap-1.5 text-center">
                {([
                  ["Fluency", analysis.pronunciation.fluency_score],
                  ["Prosody", analysis.pronunciation.prosody_score],
                  ["Accuracy", analysis.pronunciation.accuracy_score],
                  ["Completeness", analysis.pronunciation.completeness_score],
                ] as const).map(([label, val]) => (
                  <div key={label} className="rounded border border-border p-1.5">
                    <p className="text-[9px] text-muted-foreground">{label}</p>
                    <p className={`text-xs font-medium ${
                      (val ?? 0) >= 80 ? "text-green-500"
                      : (val ?? 0) >= 60 ? "text-yellow-500"
                      : "text-red-500"
                    }`}>
                      {val !== undefined ? Math.round(val) : "-"}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {analysis.pronunciation?.status === "skipped" && (
          <Card className="border-border/50">
            <CardContent className="py-3">
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <Mic className="h-3 w-3 opacity-40" />
                <span>Azure Speech not configured. Set AZURE_SPEECH_KEY for pronunciation assessment.</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Translation Quality (Azure OpenAI) */}
        {analysis.translation?.status === "ok" && (
          <Card className="border-emerald-500/20">
            <CardHeader className="pb-1.5">
              <CardTitle className="flex items-center gap-1.5 text-xs">
                <Languages className="h-3.5 w-3.5 text-emerald-500" />
                Translation Quality
                <Badge
                  variant="outline"
                  className={`ml-auto text-[9px] h-4 ${
                    (analysis.translation.translation_score ?? 0) >= 80
                      ? "border-green-500/30 text-green-600"
                      : (analysis.translation.translation_score ?? 0) >= 60
                        ? "border-yellow-500/30 text-yellow-600"
                        : "border-red-500/30 text-red-600"
                  }`}
                >
                  {analysis.translation.translation_score}/100
                </Badge>
              </CardTitle>
              {analysis.translation.summary && (
                <CardDescription className="text-[10px]">
                  {analysis.translation.summary}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="pt-0 space-y-2">
              <div className="grid grid-cols-2 gap-1.5 text-center">
                <div className="rounded border border-border p-1.5">
                  <p className="text-[9px] text-muted-foreground">Accuracy</p>
                  <p className={`text-xs font-medium ${
                    (analysis.translation.translation_score ?? 0) >= 80 ? "text-green-500"
                    : (analysis.translation.translation_score ?? 0) >= 60 ? "text-yellow-500"
                    : "text-red-500"
                  }`}>
                    {analysis.translation.translation_score}
                  </p>
                </div>
                <div className="rounded border border-border p-1.5">
                  <p className="text-[9px] text-muted-foreground">Coverage</p>
                  <p className={`text-xs font-medium ${
                    (analysis.translation.coverage_percent ?? 0) >= 90 ? "text-green-500"
                    : (analysis.translation.coverage_percent ?? 0) >= 70 ? "text-yellow-500"
                    : "text-red-500"
                  }`}>
                    {analysis.translation.coverage_percent}%
                  </p>
                </div>
              </div>

              {/* Translation errors */}
              {analysis.translation.errors && analysis.translation.errors.length > 0 && (
                <div>
                  <p className="text-[10px] font-medium text-foreground mb-1">Translation Issues</p>
                  <div className="space-y-1">
                    {analysis.translation.errors.slice(0, 6).map((err, i) => (
                      <div key={i} className="flex items-start gap-1 text-[10px] py-0.5 border-b border-border/50 last:border-0">
                        {err.severity === "critical" ? (
                          <XCircle className="h-2.5 w-2.5 shrink-0 mt-0.5 text-red-500" />
                        ) : err.severity === "major" ? (
                          <AlertCircle className="h-2.5 w-2.5 shrink-0 mt-0.5 text-orange-500" />
                        ) : (
                          <AlertTriangle className="h-2.5 w-2.5 shrink-0 mt-0.5 text-yellow-500" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-muted-foreground truncate">{err.issue}</p>
                          <p className="text-[9px] text-muted-foreground/60 truncate">
                            &ldquo;{err.original}&rdquo; &rarr; &ldquo;{err.translated}&rdquo;
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Missing dialogue */}
              {analysis.translation.missing_dialogue && analysis.translation.missing_dialogue.length > 0 && (
                <div>
                  <p className="text-[10px] font-medium text-foreground mb-1">Missing Dialogue</p>
                  <div className="space-y-1">
                    {analysis.translation.missing_dialogue.slice(0, 5).map((m, i) => (
                      <div key={i} className="flex items-center justify-between text-[10px] py-0.5 border-b border-border/50 last:border-0">
                        <span className="text-muted-foreground truncate flex-1">
                          {formatTime(m.start)}-{formatTime(m.end)}: {m.original_text?.slice(0, 30)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {analysis.translation?.status === "skipped" && (
          <Card className="border-border/50">
            <CardContent className="py-3">
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <Languages className="h-3 w-3 opacity-40" />
                <span>Azure OpenAI not configured. Set AZURE_OPENAI_KEY for translation evaluation.</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Re-transcribed Segments */}
        {analysis.retranscription.status === "ok" && analysis.retranscription.segments && (
          <Card>
            <CardHeader className="pb-1.5">
              <CardTitle className="text-xs">
                Re-transcription ({analysis.retranscription.segment_count} segments)
              </CardTitle>
              <CardDescription className="text-[10px]">
                What Whisper heard in the dubbed audio
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {analysis.retranscription.segments.slice(0, 15).map((seg, i) => (
                  <div key={i} className="flex gap-1.5 text-[10px] py-0.5 border-b border-border/50 last:border-0">
                    <span className="shrink-0 font-mono text-muted-foreground w-12">
                      {formatTime(seg.start)}
                    </span>
                    <span className="flex-1 text-foreground">{seg.text}</span>
                    <span className={`shrink-0 font-mono ${seg.confidence > 0.7 ? "text-green-500" : seg.confidence > 0.4 ? "text-yellow-500" : "text-red-500"}`}>
                      {Math.round(seg.confidence * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </ScrollArea>
  )
}
