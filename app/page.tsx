'use client'

import { DubVerseEditor } from '@/components/editor/dubverse-editor'
import type { Segment, QCScore, QCFinding } from '@/lib/editor-types'

// Demo data - Ip Man scene
const DEMO_SEGMENTS: Segment[] = [
  {
    id: 'seg-1',
    index: 0,
    status: 'auto',
    start_time: 0.5,
    end_time: 2.8,
    source_text: '咏春，叶问。',
    target_text: 'Wing Chun, Ip Man.',
    speaker_id: '1',
    speaker_label: 'Speaker 1',
    qc_findings: [],
  },
  {
    id: 'seg-2',
    index: 1,
    status: 'auto',
    start_time: 3.2,
    end_time: 5.5,
    source_text: '我真想看看。',
    target_text: 'I really want to see it.',
    speaker_id: '2',
    speaker_label: 'Speaker 2',
    qc_findings: [],
  },
  {
    id: 'seg-3',
    index: 2,
    status: 'auto',
    start_time: 6.0,
    end_time: 10.2,
    source_text: '你一个大男人是怎么打出一套女人拳的？',
    target_text: 'How does a grown man like you fight like a woman?',
    speaker_id: '2',
    speaker_label: 'Speaker 2',
    qc_findings: [],
  },
  {
    id: 'seg-4',
    index: 3,
    status: 'edited',
    start_time: 10.8,
    end_time: 16.5,
    source_text: '好嘅功夫系唔会分男女老幼，睇人嘅嘅。',
    target_text: "Good martial arts don't distinguish between gender or age; it's all about the person.",
    speaker_id: '1',
    speaker_label: 'Speaker 1',
    qc_findings: [],
  },
  {
    id: 'seg-5',
    index: 4,
    status: 'auto',
    start_time: 17.0,
    end_time: 20.8,
    source_text: '至于打成点，你一阵咪会知啦。',
    target_text: "As for how it turns out, you'll find out soon enough.",
    speaker_id: '1',
    speaker_label: 'Speaker 1',
    qc_findings: [],
  },
  {
    id: 'seg-6',
    index: 5,
    status: 'locked',
    start_time: 21.2,
    end_time: 22.5,
    source_text: '请。',
    target_text: 'Please.',
    speaker_id: '2',
    speaker_label: 'Speaker 2',
    locked_at: '2024-01-15T10:30:00Z',
    qc_findings: [],
  },
  {
    id: 'seg-7',
    index: 6,
    status: 'auto',
    start_time: 23.0,
    end_time: 24.2,
    source_text: '嗯。',
    target_text: 'Hmm.',
    speaker_id: '3',
    speaker_label: 'Speaker 3',
    qc_findings: [],
  },
  {
    id: 'seg-8',
    index: 7,
    status: 'auto',
    start_time: 24.8,
    end_time: 26.5,
    source_text: '啊啊啊！',
    target_text: 'Ahh!',
    speaker_id: '3',
    speaker_label: 'Speaker 3',
    qc_findings: [],
  },
]

const DEMO_QC_FINDINGS: QCFinding[] = [
  {
    id: 'qc-1',
    segment_index: 2,
    type: 'timing',
    severity: 'warning',
    message: 'Audio is 250ms longer than the original segment.',
    suggestion: 'Consider shortening by 10% to maintain sync.',
    timestamp_start: 6.0,
    timestamp_end: 10.2,
  },
  {
    id: 'qc-2',
    segment_index: 3,
    type: 'translation',
    severity: 'info',
    message: 'Translation could be more natural.',
    suggestion: "Good martial arts don't discriminate by gender or age; it's all about the person.",
    timestamp_start: 10.8,
    timestamp_end: 16.5,
  },
  {
    id: 'qc-3',
    segment_index: 4,
    type: 'sync',
    severity: 'error',
    message: 'Lip sync mismatch detected. Audio starts 180ms before mouth movement.',
    suggestion: 'Delay audio by 180ms.',
    timestamp_start: 17.0,
    timestamp_end: 20.8,
  },
  {
    id: 'qc-4',
    segment_index: 6,
    type: 'delivery',
    severity: 'warning',
    message: 'Emotion mismatch: detected as neutral, expected contemplative.',
    suggestion: 'Regenerate with "thoughtful" emotion setting.',
    timestamp_start: 23.0,
    timestamp_end: 24.2,
  },
  {
    id: 'qc-5',
    segment_index: 7,
    type: 'pronunciation',
    severity: 'info',
    message: 'Exclamation sounds slightly artificial.',
    suggestion: 'Increase stability for more natural delivery.',
    timestamp_start: 24.8,
    timestamp_end: 26.5,
  },
]

const DEMO_QC_SCORE: QCScore = {
  overall: 78,
  grade: 'B',
  components: {
    timing: 72,
    translation: 85,
    delivery: 75,
    sync: 68,
    pronunciation: 88,
  },
  total_findings: 5,
  errors: 1,
  warnings: 2,
  info: 2,
}

// Map QC findings to segments
const segmentsWithFindings = DEMO_SEGMENTS.map(seg => ({
  ...seg,
  qc_findings: DEMO_QC_FINDINGS.filter(f => f.segment_index === seg.index),
}))

export default function EditorDemoPage() {
  return (
    <DubVerseEditor
      jobId="demo-ip-man-2010"
      title="Ip Man (2010) - Ip Man vs. Master Shin Scene"
      sourceLanguage="zh-CN"
      targetLanguage="en-US"
      videoUrl="https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
      dubbedVideoUrl="https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
      videoDuration={262.3}
      segments={segmentsWithFindings}
      qcScore={DEMO_QC_SCORE}
      qcFindings={DEMO_QC_FINDINGS}
      onExport={() => console.log('Export clicked')}
      onGenerateSpeech={() => console.log('Generate Speech clicked')}
    />
  )
}
