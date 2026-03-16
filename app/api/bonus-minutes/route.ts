import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data } = await supabase
      .from("bonus_minutes")
      .select("balance")
      .eq("user_id", user.id)
      .single()

    return NextResponse.json({ balance: data?.balance || 0 })
  } catch {
    return NextResponse.json({ balance: 0 })
  }
}
