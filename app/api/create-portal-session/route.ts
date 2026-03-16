import { NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"

export async function POST(request: Request) {
  try {
    const { customer_id } = await request.json()

    if (!customer_id) {
      return NextResponse.json({ error: "Missing customer_id" }, { status: 400 })
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3001"

    const session = await stripe.billingPortal.sessions.create({
      customer: customer_id,
      return_url: `${siteUrl}/account`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err: unknown) {
    console.error("Portal session error:", err)
    const message = err instanceof Error ? err.message : "Internal error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
