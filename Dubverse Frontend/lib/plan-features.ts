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
}

export function planHasFeature(plan: PlanType | null, feature: FeatureKey): boolean {
  if (!plan) return false
  return FEATURE_MATRIX[feature].includes(plan)
}
