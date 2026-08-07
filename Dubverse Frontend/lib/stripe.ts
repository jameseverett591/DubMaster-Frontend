import Stripe from "stripe"

let _stripe: Stripe | null = null

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set")
    _stripe = new Stripe(key, {
      apiVersion: "2026-02-25.clover",
      typescript: true,
    })
  }
  return _stripe
}

/** @deprecated Use getStripe() instead — kept for import compat */
export const stripe = {
  get checkout() { return getStripe().checkout },
  get subscriptions() { return getStripe().subscriptions },
  get billingPortal() { return getStripe().billingPortal },
  get webhooks() { return getStripe().webhooks },
} as unknown as Stripe

export const PLANS = {
  basic: {
    name: "Basic",
    monthlyPrice: 20,
    yearlyPrice: 192,
    minutesPerMonth: 45,
    features: [
      "45 minutes video/month",
      "Voice cloning from video",
      "Automatic dubbing",
      "50+ languages",
      "Basic QC report",
      "48hr turnaround",
      "Download rights",
      "Standard support",
    ],
  },
  premium: {
    name: "Premium",
    monthlyPrice: 49,
    yearlyPrice: 470,
    minutesPerMonth: 90,
    features: [
      "90 minutes video/month",
      "Professional timeline editor",
      "Advanced QC (7 metrics)",
      "24hr priority turnaround",
      "Manual voice refinement",
      "Emotion control (64 tags)",
      "Priority support",
      "Rollover unused minutes",
    ],
  },
  professional: {
    name: "Professional",
    monthlyPrice: 149,
    yearlyPrice: 1430,
    minutesPerMonth: -1, // unlimited
    features: [
      "Unlimited 2hr+ feature films/month",
      "All Premium features included",
      "Professional timeline editor",
      "Unlimited revisions",
      "Dedicated account manager",
      "White-label options",
      "API access",
      "Custom workflows",
      "SLA guarantees",
      "Human-in-the-loop QC",
      "Theatrical release quality",
      "Priority 12hr turnaround",
    ],
  },
} as const

export type PlanKey = keyof typeof PLANS

export const BONUS_PACKS = [
  {
    minutes: 10,
    price: 5,
    priceId: process.env.STRIPE_PRICE_BONUS_10 || "price_1T95pVRvIweJqT6RkIuvs57O",
    label: "10 min — $5",
  },
  {
    minutes: 20,
    price: 10,
    priceId: process.env.STRIPE_PRICE_BONUS_20 || "price_1T95tORvIweJqT6Ril5wiPDa",
    label: "20 min — $10",
  },
  {
    minutes: 45,
    price: 20,
    priceId: process.env.STRIPE_PRICE_BONUS_45 || "price_1T95uERvIweJqT6RdC9NBtQg",
    label: "45 min — $20",
    bestValue: true,
  },
] as const
