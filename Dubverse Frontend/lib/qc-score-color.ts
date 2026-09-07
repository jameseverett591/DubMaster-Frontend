// Single source of truth for QC score → color, so the main quality circle,
// component pills, segment ticker, and segment panel all agree on what
// "good" looks like instead of each carrying its own threshold set.
//   0-64  red
//   65-89 amber
//   90-100 green

export type QCColorTier = 'red' | 'amber' | 'green'

export function qcScoreTier(score: number | null | undefined): QCColorTier | null {
  if (score === null || score === undefined) return null
  if (score >= 90) return 'green'
  if (score >= 65) return 'amber'
  return 'red'
}

const TEXT: Record<QCColorTier, string> = {
  green: 'text-emerald-400',
  amber: 'text-amber-400',
  red: 'text-red-400',
}

const BADGE: Record<QCColorTier, string> = {
  green: 'border-emerald-500 text-emerald-400 bg-emerald-500/10',
  amber: 'border-amber-500 text-amber-400 bg-amber-500/10',
  red: 'border-red-500 text-red-400 bg-red-500/10',
}

const PILL: Record<QCColorTier, string> = {
  green: 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10',
  amber: 'border-amber-500/40 text-amber-300 bg-amber-500/10',
  red: 'border-red-500/40 text-red-300 bg-red-500/10',
}

export function qcScoreTextColor(score: number | null | undefined): string {
  const tier = qcScoreTier(score)
  return tier ? TEXT[tier] : 'text-slate-400'
}

/** Border/text/bg classes for a prominent badge (main grade circle, segment header chip). */
export function qcScoreBadgeColor(score: number | null | undefined): string {
  const tier = qcScoreTier(score)
  return tier ? BADGE[tier] : 'border-slate-500 text-slate-400 bg-slate-500/10'
}

/** Border/text/bg classes for a small inline pill (per-component score badges). */
export function qcScorePillColor(score: number | null | undefined): string {
  const tier = qcScoreTier(score)
  return tier ? PILL[tier] : 'border-slate-500/40 text-slate-300 bg-slate-500/10'
}
