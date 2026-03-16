import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const type = searchParams.get("type")
  const plan = searchParams.get("plan")
  const interval = searchParams.get("interval")
  const next = searchParams.get("next") ?? "/studio"

  // Password recovery — redirect to reset-password page
  // Supabase will have already set the session via the URL hash on the client
  if (type === "recovery") {
    return NextResponse.redirect(`${origin}/reset-password`)
  }

  if (code) {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch {
              // Ignore - called from Server Component
            }
          },
        },
      }
    )

    try {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code)
      if (!error && data.user) {
        // If plan and interval are provided, redirect to checkout page
        // The checkout page will handle creating the Stripe session
        if (plan && interval) {
          return NextResponse.redirect(
            `${origin}/checkout?plan=${plan}&interval=${interval}&email=${encodeURIComponent(data.user.email || '')}`
          )
        }

        // Otherwise, use the next parameter or default to studio
        return NextResponse.redirect(`${origin}${next}`)
      }
    } catch {
      // JSON parse error from corrupted session data — redirect to signin
    }
  }

  return NextResponse.redirect(`${origin}/signin?error=auth`)
}
