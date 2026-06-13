export type PlanType = 'basic' | 'premium' | 'professional'

// Max recording seconds per plan — replaces the old recordButton feature flag.
// All plans can record; the cap enforced in VideoRecorder determines how long.
export const RECORDING_LIMITS: Record<PlanType, number> = {
  basic:        360,      // 6 min
  premium:      900,      // 15 min
  professional: Infinity, // unlimited (capped only by dubbing balance)
}
export const RECORDING_LIMIT_DEFAULT = 360 // fallback for null / unauthenticated

export type FeatureKey =
  | 'editor'
  | 'pipelineMonitor'
  | 'qcScoring'
  | 'askAI'
  | 'voiceLibrary'
  | 'emotionWriteIn'
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

export const FEATURE_MATRIX: Record<FeatureKey, PlanType[]> = {
  // Premium + Professional
  editor:               ['premium', 'professional'],
  pipelineMonitor:      ['premium', 'professional'],
  qcScoring:            ['premium', 'professional'],
  askAI:                ['premium', 'professional'],
  voiceLibrary:         ['premium', 'professional'],
  emotionWriteIn:       ['premium', 'professional'],
  // Professional only
  emotionalCurveEditor: ['professional'],
  lipSyncScoring:       ['professional'],
  heatmaps:             ['professional'],
  characterAnalyzer:    ['professional'],
  velmaPanel:           ['professional'],
  characterProfiles:    ['professional'],
  emotionalIntelligence:['professional'],
  studioCollaboration:  ['professional'],
  versioning:           ['professional'],
  performanceNotes:     ['professional'],
  voiceCloning:         ['professional'],
}

export function planHasFeature(plan: PlanType | null, feature: FeatureKey): boolean {
  if (!plan) return false
  return FEATURE_MATRIX[feature].includes(plan)
}
