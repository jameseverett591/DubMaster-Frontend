// Mock QC report based on QC Score.txt — used until /api/qc/{jobId} backend lands.
// Drop-in shape matching QCReport in editor-types.ts.

import type { QCReport, QCFinding } from './editor-types'

export function buildMockQCReport(jobId: string): QCReport {
  const findings: QCFinding[] = [
    // Silence gap → timing finding
    {
      id: 'qc-silence-1',
      segment_index: 14,
      type: 'timing',
      severity: 'error',
      message: 'Unexpected 1.9s silence gap',
      suggestion: 'Tighten segment timing or add filler audio',
      timestamp_start: 53,
      timestamp_end: 54.9,
    },
    {
      id: 'qc-silence-2',
      segment_index: 22,
      type: 'timing',
      severity: 'warning',
      message: 'Long silence detected',
      timestamp_start: 66,
      timestamp_end: 73,
    },
    {
      id: 'qc-silence-3',
      segment_index: 30,
      type: 'timing',
      severity: 'warning',
      message: 'Pacing gap',
      timestamp_start: 89,
      timestamp_end: 95,
    },
    // Lip-sync issues (low score = 26)
    {
      id: 'qc-lipsync-1',
      segment_index: 5,
      type: 'sync',
      severity: 'error',
      message: 'Dubbed audio drifts from source mouth movement',
      suggestion: 'Adjust segment timing or speed',
      timestamp_start: 19,
      timestamp_end: 22,
    },
    {
      id: 'qc-lipsync-2',
      segment_index: 12,
      type: 'sync',
      severity: 'error',
      message: 'Lip-sync offset > 250ms',
      timestamp_start: 38,
      timestamp_end: 40,
    },
    // Low confidence retranscription → pronunciation
    {
      id: 'qc-pronun-1',
      segment_index: 11,
      type: 'pronunciation',
      severity: 'warning',
      message: 'Retranscription confidence 76%',
      timestamp_start: 35,
      timestamp_end: 37,
    },
  ]

  return {
    job_id: jobId,
    generated_at: new Date().toISOString(),
    grade: 'F',
    overall: 49,
    components: {
      timing: 100,
      speed: 100,
      loudness: 100,
      silences: 80,
      emotion_variance: 36,
      emotion_intensity: 40,
      lip_sync: 26,
      emotion_preservation: 72,
    },
    emotion_provider: 'hume',
    timing: { status: 'ok' },
    speed: { status: 'ok', mean: 1.0, std_dev: 0 },
    silence_gaps: {
      unexpected_count: 1,
      gaps: [
        { start: 64, end: 66, duration: 1.9 },
      ],
    },
    loudness: {
      within_spec: true,
      lufs: -14.19,
      peak_db: -1.27,
      range_lu: 8.3,
    },
    emotion: {
      label: 'Moderate',
      variance: 36,
      intensity: 40,
      top: [
        { name: 'Determination', pct: 27 },
        { name: 'Anger', pct: 18 },
        { name: 'Concentration', pct: 13 },
        { name: 'Interest', pct: 12 },
        { name: 'Excitement', pct: 11 },
      ],
    },
    retranscription: {
      segment_count: 35,
      items: [
        { start: 0, text: 'Why all the secrecy?', confidence: 0.82 },
        { start: 6, text: "I really don't know how to run a business together.", confidence: 0.82 },
        { start: 11, text: 'Take it back and open a factory.', confidence: 0.82 },
        { start: 13, text: "Pay me back once you've made money.", confidence: 0.82 },
        { start: 16, text: "I won't be paying you back anytime soon.", confidence: 0.82 },
        { start: 19, text: 'Take your time.', confidence: 0.82 },
        { start: 22, text: 'Do me one more favor.', confidence: 0.82 },
        { start: 23, text: 'Take my son as your student.', confidence: 0.82 },
        { start: 26, text: 'There are so many master on martial arts street.', confidence: 0.82 },
        { start: 28, text: 'Just find them to teach you.', confidence: 0.76 },
        { start: 30, text: "The master outside aren't as good as you, more or less.", confidence: 0.76 },
        { start: 35, text: 'Bro man, mochi lamb.', confidence: 0.76 },
        { start: 37, text: 'Bro chewing.', confidence: 0.76 },
        { start: 38, text: "Bro man, I've learned some new moves.", confidence: 0.76 },
        { start: 40, text: 'Help me test if they work.', confidence: 0.76 },
      ],
    },
    findings,
  }
}
