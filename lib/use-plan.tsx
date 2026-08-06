'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { type PlanType, type FeatureKey, planHasFeature, RECORDING_LIMITS, RECORDING_LIMIT_DEFAULT,
         UPLOAD_DURATION_LIMITS, UPLOAD_DURATION_DEFAULT } from '@/lib/plan-features'

interface PlanInfo {
  plan: PlanType | null
  loading: boolean
  isBasic: boolean
  isPremium: boolean
  isProfessional: boolean
  hasFeature: (feature: FeatureKey) => boolean
  recordingLimit: number
  /** Max length of an uploaded video, in seconds. Infinity = unlimited. */
  uploadDurationLimit: number
}

const PlanContext = createContext<PlanInfo>({
  plan: null,
  loading: true,
  isBasic: false,
  isPremium: false,
  isProfessional: false,
  hasFeature: () => false,
  recordingLimit: RECORDING_LIMIT_DEFAULT,
  uploadDurationLimit: UPLOAD_DURATION_DEFAULT,
})

export function PlanProvider({ children }: { children: React.ReactNode }) {
  const [plan, setPlan] = useState<PlanType | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    async function fetchPlan() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setLoading(false)
        return
      }

      const { data } = await supabase
        .from('subscriptions')
        .select('plan_type')
        .eq('user_id', user.id)
        .in('status', ['active', 'trialing'])
        .limit(1)
        .single()

      setPlan((data?.plan_type as PlanType) ?? null)
      setLoading(false)
    }

    fetchPlan()

    // Keep plan in sync if auth state changes (e.g. sign out)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      fetchPlan()
    })

    return () => subscription.unsubscribe()
  }, [])

  const value: PlanInfo = {
    plan,
    loading,
    isBasic: plan === 'basic',
    isPremium: plan === 'premium',
    isProfessional: plan === 'professional',
    hasFeature: (feature: FeatureKey) => planHasFeature(plan, feature),
    recordingLimit: plan ? RECORDING_LIMITS[plan] : RECORDING_LIMIT_DEFAULT,
    uploadDurationLimit: plan ? UPLOAD_DURATION_LIMITS[plan] : UPLOAD_DURATION_DEFAULT,
  }

  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>
}

export function usePlan(): PlanInfo {
  return useContext(PlanContext)
}
