import { notFound } from "next/navigation"
import { DubVerseEditor } from "@/components/editor/dubverse-editor"
import { DubNotReadyView } from "@/components/dub-not-ready-view"
import type { Segment, QCFinding } from "@/lib/editor-types"

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

function toAbsoluteUrl(url: string, base: string): string {
  if (!url) return url
  if (url.startsWith("http://") || url.startsWith("https://")) return url
  if (url.startsWith("//")) return `https:${url}`
  if (url.startsWith("/")) return `${base}${url}`
  return `${base}/${url}`
}

function speakerIdFor(speaker: string): string {
  const n = speaker.match(/\d+/)
  return n ? `speaker-${parseInt(n[0], 10) + 1}` : "speaker-1"
}

type PageProps = { params: Promise<{ jobId: string; locale: string }> }

export default async function EditorJobPage({ params }: PageProps) {
  const { jobId } = await params

  const [statusRes, segmentsRes, transcriptRes] = await Promise.allSettled([
    fetch(`${API_BASE}/api/status/${jobId}`, { cache: "no-store" }),
    fetch(`${API_BASE}/api/segments/${jobId}`, { cache: "no-store" }),
    fetch(`${API_BASE}/api/transcript/${jobId}`, { cache: "no-store" }),
  ])

  // Job not found → 404 page
  const statusFetch = statusRes.status === "fulfilled" ? statusRes.value : null
  if (!statusFetch || statusFetch.status === 404) notFound()

  // Segments missing → dub not complete yet
  const segFetch = segmentsRes.status === "fulfilled" ? segmentsRes.value : null
  if (!segFetch || !segFetch.ok) {
    return <DubNotReadyView jobId={jobId} />
  }

  const status = await statusFetch.json()
  const segmentsData = await segFetch.json()
  const transcript =
    transcriptRes.status === "fulfilled" && transcriptRes.value.ok
      ? await transcriptRes.value.json()
      : null

  // Dub not yet produced
  if (!status.dubbed_video_url) {
    return <DubNotReadyView jobId={jobId} />
  }

  // Build source text lookup from transcript
  const sourceByIndex = new Map<number, string>()
  if (transcript?.segments?.length) {
    (transcript.segments as Array<{ text: string }>).forEach((seg, idx) => {
      sourceByIndex.set(idx, seg.text)
    })
  }

  // Map API segments to editor Segment type
  const editorSegments: Segment[] = segmentsData.segments.map((seg: any, idx: number) => {
    const sourceText = sourceByIndex.get(seg.transcript_index) ?? ""
    return {
      id: `segment-${idx}`,
      index: idx,
      status: seg.locked ? "locked" : "auto",
      start_time: seg.start,
      end_time: seg.end,
      source_text: sourceText,
      target_text: seg.text,
      speaker_id: speakerIdFor(seg.speaker),
      speaker_label: seg.speaker,
      audio_url: seg.path,
      qc_findings: (seg.qc_findings as QCFinding[]) ?? [],
    }
  })

  return (
    <DubVerseEditor
      jobId={jobId}
      title={status.video_filename || "DubMaster Project"}
      sourceLanguage={transcript?.language || "Source"}
      targetLanguage={segmentsData.language || "Target"}
      videoUrl={toAbsoluteUrl(segmentsData.video_path || "", API_BASE)}
      dubbedVideoUrl={status.dubbed_video_url ? toAbsoluteUrl(status.dubbed_video_url, API_BASE) : null}
      videoDuration={segmentsData.video_duration}
      segments={editorSegments}
      onExport={() => {}}
      onGenerateSpeech={() => {}}
    />
  )
}
