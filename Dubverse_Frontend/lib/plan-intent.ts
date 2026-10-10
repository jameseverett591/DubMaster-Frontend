'use client'

/**
 * PLAN INTENT — what the user picked BEFORE signing in.
 *
 * Plan CTAs exist on signed-out surfaces (landing, pricing). Clicking one
 * stashes the choice here; the sign-in flow redirects to /subscribe, which
 * resolves the intent: 'pro'/'wallet' go straight to Stripe checkout, 'free'
 * routes to the studio (or, for an account that still has an active
 * subscription, offers the Switch-to-Free downgrade on the subscribe page).
 *
 * sessionStorage, not localStorage: the intent is one journey, not a
 * preference — it should not outlive the tab.
 */

export type PlanIntentKey = 'free' | 'pro' | 'wallet'

const KEY = 'pendingPlan'

export function setPlanIntent(planKey: PlanIntentKey, isYearly = false) {
  if (typeof window === 'undefined') return
  // sessionStorage throws in some private-mode / storage-disabled contexts —
  // the intent is a convenience, not worth killing the CTA click over.
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ planKey, isYearly }))
  } catch {}
}

export function clearPlanIntent() {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(KEY)
  } catch {}
}

export function takePlanIntent(): { planKey: PlanIntentKey; isYearly: boolean } | null {
  if (typeof window === 'undefined') return null
  const raw = sessionStorage.getItem(KEY)
  if (!raw) return null
  sessionStorage.removeItem(KEY)
  try {
    const parsed = JSON.parse(raw)
    if (parsed?.planKey === 'free' || parsed?.planKey === 'pro' || parsed?.planKey === 'wallet') {
      return { planKey: parsed.planKey, isYearly: !!parsed.isYearly }
    }
  } catch {
    // Corrupt value — treated as no intent.
  }
  return null
}
