import { notFound } from "next/navigation"
import { JobEditor } from "@/components/job-editor"
import { DubNotReadyView } from "@/components/dub-not-ready-view"

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

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

  return (
    <JobEditor
      jobId={jobId}
      dubbedVideoUrl={status.dubbed_video_url}
      videoDuration={segmentsData.video_duration}
      segments={segmentsData.segments}
      segmentsLanguage={segmentsData.language}
      transcript={transcript}
    />
  )
}
