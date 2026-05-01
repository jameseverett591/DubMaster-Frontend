"use client"

import { Suspense } from "react"
import { DubVerseEditor } from "@/components/editor/dubverse-editor"
import { LoadingSpinner } from "@/components/loading-spinner"
import { ErrorBoundary } from "@/components/error-boundary"
import type { Segment } from "@/lib/editor-types"

const MOCK_SEGMENTS: Segment[] = [
  {
    id: "segment-0",
    index: 0,
    status: "auto",
    start_time: 0.5,
    end_time: 2.3,
    source_text: "咏春，叶问。",
    target_text: "Wing Chun, Ip Man.",
    speaker_id: "speaker-1",
    speaker_label: "Speaker 1",
    qc_findings: [],
  },
  {
    id: "segment-1",
    index: 1,
    status: "auto",
    start_time: 2.5,
    end_time: 4.8,
    source_text: "我真想看看。",
    target_text: "I really want to see it.",
    speaker_id: "speaker-2",
    speaker_label: "Speaker 2",
    qc_findings: [],
  },
  {
    id: "segment-2",
    index: 2,
    status: "auto",
    start_time: 5.0,
    end_time: 8.2,
    source_text: "你一个大男人是怎么打出一套女人拳的?",
    target_text: "How does a grown man like you fight like a woman?",
    speaker_id: "speaker-2",
    speaker_label: "Speaker 2",
    qc_findings: [],
  },
]

export default function EditorPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <ErrorBoundary>
        <DubVerseEditor
          jobId="demo"
          title="Ip Man (2010) - Ip Man vs. Master Shin Scene"
          sourceLanguage="Cantonese (China)"
          targetLanguage="English"
          videoUrl="https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
          dubbedVideoUrl={null}
          videoDuration={262.4}
          segments={MOCK_SEGMENTS}
          qcScore={null}
          qcFindings={[]}
          pointsLeft={100}
          minutesAvailable={60}
          onExport={() => {}}
          onShare={() => {}}
          onGenerateSpeech={() => {}}
          onTranslateAndDub={() => {}}
        />
      </ErrorBoundary>
    </Suspense>
  )
}
