import { NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"
import { createServiceClient } from "@/lib/supabase/server"
import Stripe from "stripe"

export async function POST(request: Request) {
  try {
    const { session_id } = await request.json()
    if (!session_id) {
      return NextResponse.json({ error: "Missing session_id" }, { status: 400 })
    }

    // Retrieve the session with the subscription expanded
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ["subscription"],
    })

    if (session.payment_status !== "paid") {
      return NextResponse.json({ error: "Payment not completed" }, { status: 402 })
    }

    const userId = session.metadata?.user_id
    const planType = session.metadata?.plan_type
    if (!userId || !planType) {
      return NextResponse.json({ error: "Missing metadata on session" }, { status: 400 })
    }

    const sub = session.subscription as Stripe.Subscription
    if (!sub) {
      return NextResponse.json({ error: "No subscription on session" }, { status: 400 })
    }

    const supabase = await createServiceClient()

    const item = sub.items?.data?.[0]
    const row = {
      user_id: userId,
      stripe_customer_id: sub.customer as string,
      stripe_subscription_id: sub.id,
      plan_type: planType,
      status: "active",
      current_period_start: item?.current_period_start
        ? new Date(item.current_period_start * 1000).toISOString()
        : new Date().toISOString(),
      current_period_end: item?.current_period_end
        ? new Date(item.current_period_end * 1000).toISOString()
        : new Date().toISOString(),
      cancel_at_period_end: sub.cancel_at_period_end ?? false,
      updated_at: new Date().toISOString(),
    }

    // Match webhook pattern: update if row exists for user, else insert
    const { data: existing } = await supabase
      .from("subscriptions")
      .select("id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle()

    const { error } = existing
      ? await supabase.from("subscriptions").update(row).eq("user_id", userId)
      : await supabase.from("subscriptions").insert(row)

    if (error) {
      console.error("Supabase upsert error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Ensure a usage row exists for this month
    const month = new Date().toISOString().slice(0, 7) + "-01"
    const { data: usageRow } = await supabase
      .from("usage")
      .select("id")
      .eq("user_id", userId)
      .eq("month", month)
      .maybeSingle()
    if (!usageRow) {
      await supabase.from("usage").insert({ user_id: userId, month, minutes_used: 0 })
    }

    return NextResponse.json({ success: true, plan: planType })
  } catch (err) {
    console.error("activate-subscription error:", err)
    const message = err instanceof Error ? err.message : "Internal error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
