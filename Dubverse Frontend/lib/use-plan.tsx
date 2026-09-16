'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { API_BASE_URL } from '@/lib/api-client'
import {
  type PlanType,
  RECORDING_LIMIT,
  UPLOAD_DURATION_LIMIT,
} from '@/lib/plan-features'

interface PlanInfo {
  /** 'free' | 'pro', from the backend's quota service. null = signed out. */
  plan: PlanType | null
  loading: boolean
  isPro: boolean
  /** Flat 120-min recorder cap for everyone — technical ceiling, not a gate. */
  recordingLimit: number
  /** Flat 120-min upload cap for everyone — enforced server-side too. */
  uploadDurationLimit: number
}

const PlanContext = createContext<PlanInfo>({
  plan: null,
  loading: true,
  isPro: false,
  recordingLimit: RECORDING_LIMIT,
  uploadDurationLimit: UPLOAD_DURATION_LIMIT,
})

// Last successfully fetched tier, cached so a flaky /quota/balance call can't
// strip a paying user's pro status mid-session (the subscriptions fetch had
// the same failure mode — every gated editor tab vanished when it errored).
// A signed-out user clears it; a failed fetch keeps it.
const PLAN_CACHE_KEY = 'dubverse.plan'
// Legacy cached values still count as paid — a stale 'professional' in
// localStorage means "paying customer", which is exactly 'pro' now.
const PAID_ALIASES = new Set(['pro', 'basic', 'premium', 'professional'])

function readCachedPlan(): PlanType | null {
  if (typeof window === 'undefined') return null
  const cached = localStorage.getItem(PLAN_CACHE_KEY)
  if (!cached) return null
  return PAID_ALIASES.has(cached) ? 'pro' : 'free'
}

export function PlanProvider({ children }: { children: React.ReactNode }) {
  const [plan, setPlan] = useState<PlanType | null>(readCachedPlan)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    async function fetchPlan() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setPlan(null)
        localStorage.removeItem(PLAN_CACHE_KEY)
        setLoading(false)
        return
      }

      // The backend resolves tier from subscriptions (tier_for) and stamps it
      // on the quota row — one source of truth for "who is pro".
      try {
        const res = await fetch(`${API_BASE_URL}/api/quota/balance`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (!res.ok) throw new Error(`balance ${res.status}`)
        const data = await res.json()
        const next: PlanType = data.tier === 'pro' ? 'pro' : 'free'
        setPlan(next)
        localStorage.setItem(PLAN_CACHE_KEY, next)
      } catch (e) {
        console.warn('[PLAN] balance fetch failed — keeping cached tier', e)
      }
      setLoading(false)
    }

    fetchPlan()

    // Keep tier in sync if auth state changes (e.g. sign out)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      fetchPlan()
    })

    return () => subscription.unsubscribe()
  }, [])

  const value: PlanInfo = {
    plan,
    loading,
    isPro: plan === 'pro',
    recordingLimit: RECORDING_LIMIT,
    uploadDurationLimit: UPLOAD_DURATION_LIMIT,
  }

  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>
}

export function usePlan(): PlanInfo {
  return useContext(PlanContext)
}
