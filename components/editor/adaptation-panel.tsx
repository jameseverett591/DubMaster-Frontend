'use client'

import { useEditorStore } from '@/lib/editor-store'
import {
  VARIANT_LABELS,
  VARIANT_TYPE_FROM_API,
  fitRatioColor,
  fitRatioLabel,
  type AdaptationVariant,
  type AdaptedSegment,
  type VariantType,
} from '@/lib/adaptation-types'

// ---------------------------------------------------------------------------
// AdaptationPanel
// ---------------------------------------------------------------------------

export function AdaptationPanel() {
  const {
    selectedSegmentIndex,
    segments,
    adaptationVariants,
    isAdaptationLoading,
    setSelectedVariant,
    applyRecommendedToAll,
    targetLanguage,
    sourceLanguage,
    jobId,
    setAdaptationVariants,
    setAdaptationLoading,
  } = useEditorStore()

  const segment = selectedSegmentIndex !== null ? segments[selectedSegmentIndex] : null
  const adapted: AdaptedSegment | undefined = segment
    ? adaptationVariants[segment.id]
    : undefined

  // -------------------------------------------------------------------------
  // Fetch variants on demand when the panel is open but has none for this seg
  // -------------------------------------------------------------------------
  async function handleGenerate() {
    if (!segment || !jobId) return
    setAdaptationLoading(true)
    try {
      const body = {
        job_id: jobId,
        segments: [
          {
            segment_id: segment.id,
            source_text: segment.source_text,
            target_text: segment.target_text,
            source_language: sourceLanguage,
            target_language: targetLanguage,
            source_duration: segment.end_time - segment.start_time,
            speaker_id: segment.speaker_id,
            speaker_gender: segment.speaker_gender ?? 'male',
          },
        ],
      }
      const res = await fetch('/api/proxy/adapt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const raw = data.adapted_segments ?? []
      const mapped: AdaptedSegment[] = raw.map((a: Record<string, unknown>) => ({
        segmentId: String(a.segment_id),
        contextNotes: String(a.context_notes ?? ''),
        recommended: VARIANT_TYPE_FROM_API[String(a.recommended)] ?? 'performable',
        selectedVariant: VARIANT_TYPE_FROM_API[String(a.recommended)] ?? 'performable',
        variants: ((a.variants as Record<string, unknown>[]) ?? []).map((v) => ({
          type: VARIANT_TYPE_FROM_API[String(v.variant_type)] ?? 'performable',
          text: String(v.text ?? ''),
          rationale: String(v.rationale ?? ''),
          estimatedDurationRatio: Number(v.estimated_duration_ratio ?? 1),
          syllableCount: Number(v.syllable_count ?? 0),
        })),
      }))
      setAdaptationVariants(mapped)
    } catch (err) {
      console.error('[AdaptationPanel] generate failed:', err)
    } finally {
      setAdaptationLoading(false)
    }
  }

  // -------------------------------------------------------------------------
  // Render states
  // -------------------------------------------------------------------------

  if (!segment) {
    return (
      <EmptyState message="Select a segment to view adaptation variants." />
    )
  }

  if (isAdaptationLoading) {
    return <LoadingSkeleton />
  }

  if (!adapted) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <p className="text-sm text-slate-400">
          No variants generated yet for this segment.
        </p>
        <button
          onClick={handleGenerate}
          className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
        >
          Generate variants
        </button>
      </div>
    )
  }

  const variantOrder: VariantType[] = ['faithful', 'performable', 'syncFit']

  return (
    <div className="flex flex-col gap-3 p-3 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Adaptation Variants
        </span>
        <span className="text-xs text-slate-500">
          Seg {(selectedSegmentIndex ?? 0) + 1} · {segment.speaker_label ?? segment.speaker_id}
        </span>
      </div>

      {/* Context notes */}
      {adapted.contextNotes && (
        <p className="rounded bg-slate-800 px-2 py-1.5 text-xs text-slate-300 leading-relaxed">
          {adapted.contextNotes}
        </p>
      )}

      {/* Variant cards */}
      <div className="flex flex-col gap-2">
        {variantOrder.map((vtype) => {
          const variant = adapted.variants.find((v) => v.type === vtype)
          if (!variant) return null
          return (
            <VariantCard
              key={vtype}
              variant={variant}
              isSelected={adapted.selectedVariant === vtype}
              isRecommended={adapted.recommended === vtype}
              onSelect={() => setSelectedVariant(segment.id, vtype)}
            />
          )
        })}
      </div>

      {/* Batch footer */}
      <div className="mt-1 border-t border-slate-700 pt-3">
        <button
          onClick={applyRecommendedToAll}
          className="w-full rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 transition-colors"
        >
          Apply recommended to all unapproved segments
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// VariantCard
// ---------------------------------------------------------------------------

function VariantCard({
  variant,
  isSelected,
  isRecommended,
  onSelect,
}: {
  variant: AdaptationVariant
  isSelected: boolean
  isRecommended: boolean
  onSelect: () => void
}) {
  const meta = VARIANT_LABELS[variant.type]

  return (
    <button
      onClick={onSelect}
      className={[
        'w-full rounded-lg border p-3 text-left transition-all',
        isSelected
          ? 'border-blue-500 bg-blue-500/10 ring-1 ring-blue-500/40'
          : 'border-slate-700 bg-slate-800/60 hover:border-slate-500 hover:bg-slate-800',
      ].join(' ')}
    >
      {/* Label row */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`text-xs font-semibold ${meta.color}`}>{meta.label}</span>
        {isRecommended && (
          <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
            Recommended
          </span>
        )}
        {isSelected && (
          <span className="ml-auto rounded-full bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">
            Active
          </span>
        )}
      </div>

      {/* Line text */}
      <p className="text-sm text-slate-100 leading-snug mb-2">{variant.text}</p>

      {/* Rationale */}
      <p className="text-xs text-slate-500 leading-relaxed mb-2">{variant.rationale}</p>

      {/* Fit bar + syllable count */}
      <div className="flex items-center gap-2">
        <FitBar ratio={variant.estimatedDurationRatio} />
        <span className="text-[10px] text-slate-500 shrink-0">
          {variant.syllableCount} syl
        </span>
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// FitBar
// ---------------------------------------------------------------------------

function FitBar({ ratio }: { ratio: number }) {
  const pct = Math.min(100, Math.round(ratio * 100))
  const barColor = fitRatioColor(ratio)
  const label = fitRatioLabel(ratio)

  return (
    <div className="flex-1 flex items-center gap-1.5">
      <div className="relative flex-1 h-1.5 rounded-full bg-slate-700 overflow-hidden">
        <div
          className={`absolute left-0 top-0 h-full rounded-full ${barColor}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
        {/* Overflow indicator */}
        {pct > 100 && (
          <div className="absolute right-0 top-0 h-full w-1 rounded-full bg-red-500 animate-pulse" />
        )}
      </div>
      <span className="text-[10px] text-slate-500 shrink-0">{label}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Utility components
// ---------------------------------------------------------------------------

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-32 px-4">
      <p className="text-sm text-slate-500 text-center">{message}</p>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-3 animate-pulse">
      <div className="h-3 w-32 rounded bg-slate-700" />
      <div className="h-20 rounded-lg bg-slate-800" />
      <div className="h-20 rounded-lg bg-slate-800" />
      <div className="h-20 rounded-lg bg-slate-800" />
    </div>
  )
}
