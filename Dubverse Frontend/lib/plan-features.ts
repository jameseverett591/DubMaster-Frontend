export type PlanType = 'basic' | 'premium' | 'professional'

export type FeatureKey =
  | 'editor'
  | 'pipelineMonitor'
  | 'qcScoring'
  | 'askAI'
  | 'voiceLibrary'
  | 'emotionWriteIn'
  | 'recordButton'
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
  recordButton:         ['premium', 'professional'],
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
