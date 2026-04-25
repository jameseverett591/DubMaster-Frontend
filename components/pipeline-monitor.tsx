"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Activity, Upload, AudioLines, Scissors, FileText, Users, Sparkles,
  Languages, Mic2, Clock, Gauge, CheckCircle2, XCircle,
  Loader2, SkipForward, ChevronDown, ChevronUp, Cpu, Timer, Zap,
  AlertTriangle, RefreshCw
} from "lucide-react"

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

interface PipelineStage {
  id: string
  name: string
  description: string
  status: "pending" | "active" | "completed" | "failed" | "skipped"
  started_at: number | null
  completed_at: number | null
  duration_ms: number | null
  output_summary: string | null
  error: string | null
}

interface PipelineData {
  job_id: string
  job_status: string
  job_progress: number
  current_stage: string | null
  pipeline: {
    type: string
    total_elapsed_ms: number
    stages: PipelineStage[]
    active_stage: string | null
    completed_stages: number
    failed_stages: number
    total_stages: number
  } | null
}

const STAGE_ICONS: Record<string, any> = {
  upload: Upload, chunk: Scissors, extract_audio: AudioLines, extract: AudioLines,
  separate: Scissors, transcribe: FileText, diarize: Users, classify: Sparkles,
  download: Upload, translate: Languages, synthesize: Mic2, align: Clock,
  mix: AudioLines, render: Gauge,
}

const STATUS_CONFIG: Record<string, { color: string; bg: string; ring: string; label: string; pulseClass: string }> = {
  pending:   { color: "text-muted-foreground", bg: "bg-muted/50",      ring: "ring-muted",         label: "Waiting",  pulseClass: "" },
  active:    { color: "text-primary",          bg: "bg-primary/10",    ring: "ring-primary",       label: "Running",  pulseClass: "animate-pulse" },
  completed: { color: "text-green-500",        bg: "bg-green-500/10",  ring: "ring-green-500/30",  label: "Done",     pulseClass: "" },
  failed:    { color: "text-red-500",          bg: "bg-red-500/10",    ring: "ring-red-500/30",    label: "Failed",   pulseClass: "" },
  skipped:   { color: "text-amber-500",        bg: "bg-amber-500/10",  ring: "ring-amber-500/30",  label: "Skipped",  pulseClass: "" },
}

function formatMs(ms: number | null): string {
  if (ms === null || ms === undefined) return "\u2014"
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function StageNode({ stage, isLast, isExpanded, onToggle }: {
  stage: PipelineStage; isLast: boolean; isExpanded: boolean; onToggle: () => void
}) {
  const config = STATUS_CONFIG[stage.status] || STATUS_CONFIG.pending
  const Icon = STAGE_ICONS[stage.id] || Activity

  return (
    <div data-testid={`pipeline-stage-${stage.id}`} className="relative">
      {!isLast && (
        <div className="absolute left-[19px] top-[40px] bottom-0 w-0.5 z-0">
          <div className={`h-full transition-all duration-500 ${
            stage.status === "completed" ? "bg-green-500/40" :
            stage.status === "active" ? "bg-primary/30 animate-pulse" : "bg-border/40"
          }`} />
        </div>
      )}
      <div
        className={`relative z-10 flex items-start gap-3 cursor-pointer group rounded-xl p-3 transition-all duration-200 hover:bg-muted/30 ${
          stage.status === "active" ? "bg-primary/5 ring-1 ring-primary/20" : ""
        }`}
        onClick={onToggle}
      >
        <div className={`relative flex-shrink-0 flex h-10 w-10 items-center justify-center rounded-full ring-2 transition-all duration-300 ${config.bg} ${config.ring} ${config.pulseClass}`}>
          {stage.status === "active" ? <Loader2 className={`h-5 w-5 ${config.color} animate-spin`} /> :
           stage.status === "completed" ? <CheckCircle2 className={`h-5 w-5 ${config.color}`} /> :
           stage.status === "failed" ? <XCircle className={`h-5 w-5 ${config.color}`} /> :
           stage.status === "skipped" ? <SkipForward className={`h-5 w-5 ${config.color}`} /> :
           <Icon className={`h-5 w-5 ${config.color}`} />}
          {stage.status === "active" && <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h4 className={`font-medium text-sm ${stage.status === "active" ? "text-foreground" : stage.status === "pending" ? "text-muted-foreground" : "text-foreground"}`}>
                {stage.name}
              </h4>
              <Badge variant="outline" className={`text-[10px] py-0 px-1.5 ${config.color} border-current/20`}>
                {config.label}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              {stage.duration_ms != null && (
                <span className="text-xs text-muted-foreground font-mono flex items-center gap-1">
                  <Timer className="h-3 w-3" />{formatMs(stage.duration_ms)}
                </span>
              )}
              {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> :
                <ChevronDown className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />}
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{stage.description}</p>
        </div>
      </div>
      {isExpanded && (
        <div className="ml-[52px] mt-1 mb-3 rounded-lg border border-border/50 bg-card/50 p-3 space-y-2">
          {stage.output_summary && (
            <div className="flex items-start gap-2">
              <Zap className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
              <p className="text-xs text-foreground">{stage.output_summary}</p>
            </div>
          )}
          {stage.error && (
            <div className="flex items-start gap-2 rounded-md bg-red-500/10 p-2">
              <AlertTriangle className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />
              <p className="text-xs text-red-400 font-mono">{stage.error}</p>
            </div>
          )}
          {stage.started_at && (
            <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
              <span>Started: {new Date(stage.started_at * 1000).toLocaleTimeString()}</span>
              {stage.completed_at && <span>Ended: {new Date(stage.completed_at * 1000).toLocaleTimeString()}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function PipelineMonitor({ jobId }: { jobId: string }) {
  const [pipelineData, setPipelineData] = useState<PipelineData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedStage, setExpandedStage] = useState<string | null>(null)
  const [autoExpand, setAutoExpand] = useState(true)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchPipeline = useCallback(async () => {
    if (!jobId) return
    try {
      const res = await fetch(`${BACKEND_URL}/api/pipeline/${jobId}`)
      if (!res.ok) { if (res.status === 404) return; throw new Error(res.statusText) }
      const data: PipelineData = await res.json()
      setPipelineData(data)
      setLoading(false); setError(null)
      if (autoExpand && data.pipeline?.active_stage) setExpandedStage(data.pipeline.active_stage)
      if (data.job_status === "completed" || data.job_status === "failed") {
        if (intervalRef.current) clearInterval(intervalRef.current)
      }
    } catch (err: any) { setError(err.message); setLoading(false) }
  }, [jobId, autoExpand])

  useEffect(() => {
    if (!jobId) return
    fetchPipeline()
    intervalRef.current = setInterval(fetchPipeline, 1500)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [jobId, fetchPipeline])

  const handleToggleStage = (stageId: string) => {
    setAutoExpand(false)
    setExpandedStage(prev => prev === stageId ? null : stageId)
  }

  if (loading && !pipelineData) {
    return (
      <Card className="border-primary/20">
        <CardContent className="flex items-center justify-center py-12">
          <div className="text-center">
            <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Connecting to pipeline...</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error && !pipelineData) {
    return (
      <Card className="border-red-500/20">
        <CardContent className="flex items-center justify-center py-12">
          <div className="text-center">
            <XCircle className="h-8 w-8 text-red-500 mx-auto mb-3" />
            <p className="text-sm text-red-400">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={fetchPipeline}>
              <RefreshCw className="h-4 w-4 mr-2" />Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  const pipeline = pipelineData?.pipeline
  const stages = pipeline?.stages || []
  const completedCount = pipeline?.completed_stages || 0
  const totalCount = pipeline?.total_stages || 0
  const isComplete = pipelineData?.job_status === "completed"
  const isFailed = pipelineData?.job_status === "failed"

  return (
    <Card data-testid="pipeline-monitor" className={`transition-all ${isComplete ? "border-green-500/30" : isFailed ? "border-red-500/30" : "border-primary/20"}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
              isComplete ? "bg-green-500/10" : isFailed ? "bg-red-500/10" : "bg-primary/10"
            }`}>
              {isComplete ? <CheckCircle2 className="h-5 w-5 text-green-500" /> :
               isFailed ? <XCircle className="h-5 w-5 text-red-500" /> :
               <Activity className="h-5 w-5 text-primary animate-pulse" />}
            </div>
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                Pipeline Monitor
                {!isComplete && !isFailed && (
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
                  </span>
                )}
              </CardTitle>
              <CardDescription>
                {isComplete ? "All stages completed successfully" :
                 isFailed ? "Pipeline encountered an error" :
                 pipelineData?.current_stage || "Processing..."}
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {pipeline?.total_elapsed_ms && (
              <Badge variant="outline" className="gap-1 font-mono text-xs">
                <Cpu className="h-3 w-3" />{formatMs(pipeline.total_elapsed_ms)}
              </Badge>
            )}
            <Badge variant={isComplete ? "default" : "outline"} className={
              isComplete ? "bg-green-500/10 text-green-500" : isFailed ? "bg-red-500/10 text-red-500" : ""
            }>
              {completedCount}/{totalCount} stages
            </Badge>
          </div>
        </div>
        <div className="mt-3">
          <Progress value={pipelineData?.job_progress || 0} className="h-2" />
          <div className="flex justify-between mt-1">
            <span className="text-xs text-muted-foreground">{pipelineData?.job_progress || 0}%</span>
            <span className="text-xs text-muted-foreground capitalize">{pipeline?.type || "analysis"} pipeline</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <ScrollArea className="max-h-[500px]">
          <div className="space-y-0">
            {stages.map((stage, index) => (
              <StageNode
                key={stage.id}
                stage={stage}
                isLast={index === stages.length - 1}
                isExpanded={expandedStage === stage.id}
                onToggle={() => handleToggleStage(stage.id)}
              />
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
