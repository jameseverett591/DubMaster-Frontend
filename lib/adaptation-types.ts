export type VariantType = 'faithful' | 'performable' | 'syncFit'

// Maps frontend camelCase to backend snake_case for API calls
export const VARIANT_TYPE_TO_API: Record<VariantType, string> = {
  faithful:    'faithful',
  performable: 'performable',
  syncFit:     'sync_fit',
}

export const VARIANT_TYPE_FROM_API: Record<string, VariantType> = {
  faithful:    'faithful',
  performable: 'performable',
  sync_fit:    'syncFit',
}

export interface AdaptationVariant {
  type: VariantType
  text: string
  rationale: string
  estimatedDurationRatio: number  // 1.0 = fits slot, >1.0 = too long, <1.0 = short
  syllableCount: number
}

export interface AdaptedSegment {
  segmentId: string
  variants: AdaptationVariant[]   // always length 3
  recommended: VariantType
  selectedVariant: VariantType    // mutable — user's active choice, defaults to recommended
  contextNotes: string
}

export const VARIANT_LABELS: Record<VariantType, { label: string; description: string; color: string }> = {
  faithful: {
    label: 'Faithful',
    description: 'Closest meaning to original',
    color: 'text-blue-400',
  },
  performable: {
    label: 'Performable',
    description: 'Most natural actor delivery',
    color: 'text-emerald-400',
  },
  syncFit: {
    label: 'Sync Fit',
    description: 'Optimised for timing slot',
    color: 'text-amber-400',
  },
}

/** Returns a Tailwind color class based on duration fit ratio */
export function fitRatioColor(ratio: number): string {
  if (ratio <= 1.05) return 'bg-emerald-500'
  if (ratio <= 1.20) return 'bg-amber-500'
  return 'bg-red-500'
}

/** Returns a human-readable fit label */
export function fitRatioLabel(ratio: number): string {
  if (ratio <= 0.85) return 'Short'
  if (ratio <= 1.05) return 'Good fit'
  if (ratio <= 1.20) return 'Slightly long'
  return 'Too long'
}
