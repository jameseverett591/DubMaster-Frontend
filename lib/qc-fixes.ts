import type { QCFinding, QCFindingType, Segment } from './editor-types'

export interface QCFixResult {
  patch: Partial<Segment>
  /** Short label for the Apply button */
  label: string
  /** Longer description shown next to the button */
  description: string
  /** True when the fix changes audio-generating params — caller should prompt regeneration */
  requiresRegeneration: boolean
}

export interface QCFixOpts {
  /** Pre-resolved retranscription text for this segment (from QCReport.retranscription.items).
   *  Required for pronunciation fixes; without it applyQCFix returns null. */
  retranscriptionText?: string
}

/**
 * Given a QC finding and the segment it targets, returns a Partial<Segment>
 * patch to apply via updateSegment(), or null when no safe auto-fix exists.
 *
 * Callers are responsible for calling updateSegment(finding.segment_index, result.patch).
 * When result.requiresRegeneration is true, surface a "Regenerate to hear changes" nudge.
 */
export function applyQCFix(
  finding: QCFinding,
  segment: Segment,
  opts: QCFixOpts = {},
): QCFixResult | null {
  switch (finding.type) {
    case 'pronunciation':
      return fixPronunciation(finding, segment, opts)
    case 'timing':
      return fixTiming(finding, segment)
    case 'sync':
      return fixSync(finding, segment)
    case 'translation':
      return fixTranslation(finding, segment)
    case 'delivery':
      return fixDelivery(finding, segment)
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Per-type fix implementations
// ---------------------------------------------------------------------------

function fixPronunciation(
  _finding: QCFinding,
  _segment: Segment,
  opts: QCFixOpts,
): QCFixResult | null {
  const text = opts.retranscriptionText?.trim()
  if (!text) return null   // no blind auto-fix without the actual retranscription text

  return {
    patch: {
      target_text: text,
      active_text: text,
      variant_text: text,
      preview_text: null,
      isPreviewing: false,
      isUserEdited: true,
      status: 'edited',
    },
    label: 'Use retranscription',
    description: 'Replaces the dubbed text with what Whisper heard — review before regenerating.',
    requiresRegeneration: true,
  }
}

function fixTiming(
  _finding: QCFinding,
  segment: Segment,
): QCFixResult {
  // Best-effort heuristic: bump speed 10%, cap at 1.5×. Not guaranteed to solve
  // every timing gap — caller should surface "best guess" copy alongside this fix.
  const current = segment.committed_speed ?? 1.0
  const nudged = Math.min(+(current * 1.1).toFixed(2), 1.5)

  return {
    patch: {
      committed_speed: nudged,
      rpt_dirty: true,
    },
    label: 'Speed up (best guess)',
    description: `Increases speed to ${nudged}× to compress timing gap. Regenerate to hear changes.`,
    requiresRegeneration: true,
  }
}

function fixSync(
  _finding: QCFinding,
  segment: Segment,
): QCFixResult {
  // Lip-sync drift: same speed-nudge heuristic as timing. Precision fix requires
  // a full re-render with tighter segment bounds, which is outside client scope.
  const current = segment.committed_speed ?? 1.0
  const nudged = Math.min(+(current * 1.1).toFixed(2), 1.5)

  return {
    patch: {
      committed_speed: nudged,
      rpt_dirty: true,
    },
    label: 'Speed up (best guess)',
    description: `Increases speed to ${nudged}× to tighten lip-sync. Regenerate to hear changes.`,
    requiresRegeneration: true,
  }
}

function fixTranslation(
  finding: QCFinding,
  _segment: Segment,
): QCFixResult | null {
  const suggestion = finding.suggestion?.trim()
  if (!suggestion) return null

  return {
    patch: {
      target_text: suggestion,
      active_text: suggestion,
      variant_text: suggestion,
      preview_text: null,
      isPreviewing: false,
      isUserEdited: true,
      status: 'edited',
    },
    label: 'Apply suggestion',
    description: 'Replaces the translation with the QC-suggested text.',
    requiresRegeneration: true,
  }
}

function fixDelivery(
  finding: QCFinding,
  _segment: Segment,
): QCFixResult | null {
  const emotion = finding.details?.suggested_emotion as string | undefined
  if (!emotion?.trim()) return null

  return {
    patch: {
      dubEmotion: emotion,
      committed_emotion: emotion,
      rpt_dirty: true,
    },
    label: 'Apply emotion',
    description: `Sets delivery emotion to "${emotion}". Regenerate to hear changes.`,
    requiresRegeneration: true,
  }
}

// ---------------------------------------------------------------------------
// Utility: check whether a finding has an auto-applicable fix before calling
// applyQCFix (useful for rendering the button in a disabled/hidden state).
// ---------------------------------------------------------------------------

export function findingIsAutoFixable(
  finding: QCFinding,
  opts: QCFixOpts = {},
): boolean {
  switch (finding.type as QCFindingType) {
    case 'pronunciation':
      return !!opts.retranscriptionText?.trim()
    case 'timing':
    case 'sync':
      return true   // speed nudge always available
    case 'translation':
      return !!finding.suggestion?.trim()
    case 'delivery':
      return !!(finding.details?.suggested_emotion as string | undefined)?.trim()
    default:
      return false
  }
}
