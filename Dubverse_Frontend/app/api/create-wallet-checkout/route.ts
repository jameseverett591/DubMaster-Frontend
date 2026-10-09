import { NextResponse } from "next/server"
import { getStripe } from "@/lib/stripe"

// Wallet deposit. The price uses custom_unit_amount: Stripe's hosted page
// collects any amount >= $10 (preset $25). The webhook reads
// session.amount_total and credits the wallet at $2.50/min — this route
// never sees the number.
export async function POST(request: Request) {
  try {
    const { user_id, email } = await request.json()

    if (!user_id || !email) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const priceId = process.env.STRIPE_PRICE_WALLET_CREDIT
    if (!priceId) {
      return NextResponse.json(
        { error: "STRIPE_PRICE_WALLET_CREDIT is not configured" },
        { status: 400 }
      )
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3001"

    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: {
        user_id,
        type: "wallet_credit",
      },
      success_url: `${siteUrl}/success?session_id={CHECKOUT_SESSION_ID}&wallet=true`,
      cancel_url: `${siteUrl}/studio`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err: unknown) {
    console.error("Wallet checkout error:", err)
    const message = err instanceof Error ? err.message : "Internal error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
