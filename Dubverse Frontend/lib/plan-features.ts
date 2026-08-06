export type PlanType = 'basic' | 'premium' | 'professional'

// Max recording seconds per plan — replaces the old recordButton feature flag.
// All plans can record; the cap enforced in VideoRecorder determines how long.
export const RECORDING_LIMITS: Record<PlanType, number> = {
  basic:        360,      // 6 min
  premium:      900,      // 15 min
  professional: Infinity, // unlimited (capped only by dubbing balance)
}
export const RECORDING_LIMIT_DEFAULT = 360 // fallback for null / unauthenticated

/** Monthly dubbing allowance, in MINUTES, pooled across every video a user
 *  brings in that billing period. This is the quantity that is actually sold —
 *  the per-video cap below is only a safety rail on a single file.
 *
 *  Previously duplicated as a literal in three pages (dashboard, account,
 *  profile), all reading { basic: 45, premium: 90, professional: -1 } with
 *  nothing keeping them in step. */
export const PLAN_MINUTES: Record<PlanType, number> = {
  basic:         60,
  premium:      120,
  professional: 300,
}
export const PLAN_MINUTES_DEFAULT = 60

/** Max length of an UPLOADED video, in seconds. Distinct from RECORDING_LIMITS
 *  above, which caps the in-browser recorder — you can upload far longer than
 *  you can sit and record. */
/** A single file may not exceed the whole monthly pool — otherwise one upload
 *  swallows the billing period in one go. Kept in seconds; derived from
 *  PLAN_MINUTES so the two can't drift. */
export const UPLOAD_DURATION_LIMITS: Record<PlanType, number> = {
  basic:        PLAN_MINUTES.basic        * 60,  // 60 min
  premium:      PLAN_MINUTES.premium      * 60,  // 120 min
  professional: PLAN_MINUTES.professional * 60,  // 300 min
}
export const UPLOAD_DURATION_DEFAULT = PLAN_MINUTES_DEFAULT * 60

/** "1 hour" / "2 hours" / "Any length" — used for both the label and the
 *  rejection message so they can never drift apart. */
export function formatDurationLimit(seconds: number): string {
  if (!Number.isFinite(seconds)) return 'Any length'
  const h = seconds / 3600
  if (h >= 1) return `${h} hour${h === 1 ? '' : 's'}`
  return `${Math.round(seconds / 60)} min`
}

export type FeatureKey =
  | 'inlineEditor'
  | 'editor'
  | 'pipelineMonitor'
  | 'qcScoring'
  | 'askAI'
  | 'voiceLibrary'
  | 'emotionWriteIn'
  | 'reviewQueue'
  | 'emotionalCurveEditor'
  | 'lipSyncScoring'
  | 'heatmaps'
  | 'characterAnalyzer'
  | 'velmaPanel'
  | 'characterProfiles'
  | 'emotionalIntelligence'
  | 'studioCollaboration'
  | 'versioning'
  | 'performanceNotes'
  | 'voiceCloning'
  | 'customVoices'
  | 'voiceChanger'
  | 'respeecher'

export const FEATURE_MATRIX: Record<FeatureKey, PlanType[]> = {
  // All plans
  inlineEditor:         ['basic'],
  // Premium + Professional
  editor:               ['premium', 'professional'],
  pipelineMonitor:      ['premium', 'professional'],
  qcScoring:            ['premium', 'professional'],
  askAI:                ['premium', 'professional'],
  voiceLibrary:         ['premium', 'professional'],
  emotionWriteIn:       ['premium', 'professional'],
  reviewQueue:          ['professional'],
  // Professional only
  emotionalCurveEditor: ['professional'],
  lipSyncScoring:       ['professional'],
  heatmaps:             ['professional'],
  characterAnalyzer:    ['professional'],
  velmaPanel:           ['professional'],
  characterProfiles:    ['professional'],
  emotionalIntelligence:['professional'],
  studioCollaboration:  ['premium', 'professional'],
  versioning:           ['professional'],
  performanceNotes:     ['professional'],
  voiceCloning:         ['basic', 'professional'],
  customVoices:         ['professional'],
  // Same gate as customVoices: burns ElevenLabs credits per use.
  voiceChanger:         ['professional'],
  // Respeecher races three takes per generate, so every use is 3 billable
  // vendor requests. Professional only — the Seed Library goes with it, since
  // seeds only exist for Respeecher takes.
  respeecher:           ['professional'],
}

export function planHasFeature(plan: PlanType | null, feature: FeatureKey): boolean {
  if (!plan) return false
  return FEATURE_MATRIX[feature].includes(plan)
}
