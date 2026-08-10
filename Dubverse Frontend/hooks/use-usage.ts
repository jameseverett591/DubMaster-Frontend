'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { usePlan } from '@/lib/use-plan'
import { PLAN_MINUTES } from '@/lib/plan-features'

export interface UsageInfo {
  /** Minutes consumed this month, from the usage table. */
  minutesUsed: number
  /** Purchased top-up minutes, from bonus_minutes. */
  bonusBalance: number
  /** Plan allowance for the month. 0 means no plan resolved yet. */
  planLimit: number
  /** Plan allowance minus usage, plus bonus. Never negative. */
  minutesRemaining: number
  loading: boolean
}

/** Real monthly usage, read from the same two tables the dashboard uses.
 *
 *  Extracted into a hook because the editor header previously displayed
 *  hardcoded values (pointsLeft={100} minutesAvailable={60}) that were shown
 *  identically to every customer and contradicted the dashboard on the same
 *  screen. Two components computing balance from two sources is how that
 *  happens, so both now read from here.
 */
export function useUsage(): UsageInfo {
  const { plan, loading: planLoading } = usePlan()
  const [minutesUsed, setMinutesUsed] = useState(0)
  const [bonusBalance, setBonusBalance] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()

    const load = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) { if (!cancelled) setLoading(false); return }
        const uid = session.user.id

        // Keyed to the current month exactly as the backend writes it
        // (usage_service._current_month → "YYYY-MM-01", UTC). Taking the most
        // recent row instead would carry LAST month's total into a fresh
        // billing period, so a heavy user would open the new month already
        // showing "0 min left" until their first job wrote a row.
        const now = new Date()
        const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`

        const { data: usageData } = await supabase
          .from('usage')
          .select('minutes_used')
          .eq('user_id', uid)
          .eq('month', monthKey)
          .maybeSingle()

        // maybeSingle here too: a user who has never bought top-ups has no row,
        // and single() would treat that as an error.
        const { data: bonusData } = await supabase
          .from('bonus_minutes')
          .select('balance')
          .eq('user_id', uid)
          .maybeSingle()

        if (cancelled) return
        setMinutesUsed(usageData?.minutes_used || 0)
        setBonusBalance(bonusData?.balance || 0)
      } catch {
        // Leave the zeros. A failed read must not render as "you have no
        // minutes" — callers check `loading` before trusting the numbers.
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => { void load() })
    return () => { cancelled = true; subscription.unsubscribe() }
  }, [])

  const planLimit = plan ? PLAN_MINUTES[plan] : 0
  // Rounded: the badge renders this raw, and a fractional bonus balance would
  // otherwise show as "57.7133333 min left".
  const minutesRemaining = Math.round(planLimit > 0
    ? Math.max(0, planLimit - minutesUsed) + bonusBalance
    : bonusBalance)

  // The plan resolves independently of the usage fetch. Reporting loading=false
  // while plan is still null yields planLimit=0 and a red "0 min left" badge on
  // every load — callers must keep waiting until BOTH have landed.
  return { minutesUsed, bonusBalance, planLimit, minutesRemaining, loading: loading || planLoading }
}
