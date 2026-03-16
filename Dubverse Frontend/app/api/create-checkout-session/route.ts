import { NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"

// Map plan keys to Stripe Price IDs
// Replace these with your actual Stripe Price IDs after creating products
const PRICE_IDS: Record<string, Record<string, string>> = {
  basic: {
    month: process.env.STRIPE_PRICE_BASIC_MONTHLY || "",
    year: process.env.STRIPE_PRICE_BASIC_YEARLY || "",
  },
  premium: {
    month: process.env.STRIPE_PRICE_PREMIUM_MONTHLY || "",
    year: process.env.STRIPE_PRICE_PREMIUM_YEARLY || "",
  },
  professional: {
    month: process.env.STRIPE_PRICE_PROFESSIONAL_MONTHLY || "",
    year: process.env.STRIPE_PRICE_PROFESSIONAL_YEARLY || "",
  },
}

export async function POST(request: Request) {
  try {
    const { plan, interval, user_id, email } = await request.json()

    if (!plan || !interval || !user_id || !email) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const priceId = PRICE_IDS[plan]?.[interval]
    if (!priceId) {
      return NextResponse.json(
        { error: `No Stripe price configured for ${plan}/${interval}. Set STRIPE_PRICE_* env vars.` },
        { status: 400 }
      )
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3001"

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: {
        user_id,
        plan_type: plan,
        interval,
      },
      subscription_data: {
        metadata: {
          user_id,
          plan_type: plan,
        },
      },
      success_url: `${siteUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/subscribe`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err: unknown) {
    console.error("Stripe checkout error:", err)
    const message = err instanceof Error ? err.message : "Internal error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
