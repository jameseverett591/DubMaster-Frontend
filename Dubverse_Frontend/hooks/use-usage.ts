'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { usePlan } from '@/lib/use-plan'
import { API_BASE_URL } from '@/lib/api-client'

export interface UsageInfo {
  /** Included seconds consumed this period (from the quota row), in minutes. */
  minutesUsed: number
  /** Wallet balance in minutes — was "bonus" packs, now prepaid credit. */
  bonusBalance: number
  /** Included allowance for the tier: 30 pro / 3 free. */
  planLimit: number
  /** Included remaining + wallet, in minutes. Never negative. */
  minutesRemaining: number
  /** Wallet balance in seconds — kept for callers that want precision. */
  walletSeconds: number
  /** Under 5 min total remaining — drives the low-balance warning. */
  lowBalance: boolean
  loading: boolean
}

/** Real balance, read from /quota/balance — the same endpoint the Make Movie
 *  gate uses, so the badge can never disagree with the charge.
 *
 *  Replaces the old usage+bonus_minutes reads. The hook keeps the old field
 *  names (minutesUsed/bonusBalance/planLimit/minutesRemaining) so dashboard,
 *  profile and the editor header compile unchanged — the fields' MEANING
 *  moves from "plan minutes + packs" to "included seconds + wallet". */
export function useUsage(): UsageInfo {
  const { loading: planLoading } = usePlan()
  const [info, setInfo] = useState({
    minutesUsed: 0, bonusBalance: 0, planLimit: 0, minutesRemaining: 0,
    walletSeconds: 0, lowBalance: true,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()

    const load = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) { if (!cancelled) setLoading(false); return }

        const res = await fetch(`${API_BASE_URL}/api/quota/balance`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (!res.ok) throw new Error(`balance ${res.status}`)
        const b = await res.json()

        if (cancelled) return
        const includedUsed = (b.included_used_seconds || 0) / 60
        const includedRemaining = (b.included_remaining_seconds || 0) / 60
        const wallet = b.credit_balance_seconds || 0
        setInfo({
          minutesUsed: includedUsed,
          bonusBalance: wallet / 60,
          planLimit: (b.included_seconds || 0) / 60,
          minutesRemaining: Math.round(includedRemaining + wallet / 60),
          walletSeconds: wallet,
          lowBalance: !!b.low_balance,
        })
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

  return { ...info, loading: loading || planLoading }
}
