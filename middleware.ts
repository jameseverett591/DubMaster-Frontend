import { createServerClient } from "@supabase/ssr"
import { createClient } from "@supabase/supabase-js"
import { NextResponse, type NextRequest } from "next/server"
import createMiddleware from 'next-intl/middleware'
import { locales } from './i18n'

// Routes that require authentication (WITHOUT locale prefix)
const PROTECTED_ROUTES = ["/studio", "/editor", "/account"]
// Routes that require an active subscription
const SUBSCRIPTION_ROUTES = ["/studio", "/editor"]
// Routes only for unauthenticated users
const AUTH_ROUTES = ["/signin", "/signup"]

// Create i18n middleware
const intlMiddleware = createMiddleware({
  locales,
  defaultLocale: 'en',
  localePrefix: 'as-needed',
  localeDetection: true
})

export async function middleware(request: NextRequest) {
  // First, handle i18n routing
  const intlResponse = intlMiddleware(request)

  // Get the locale from the pathname
  const pathname = request.nextUrl.pathname
  const pathnameHasLocale = locales.some(
    (locale) => pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`
  )

  // Remove locale prefix for route checking
  const pathnameWithoutLocale = pathnameHasLocale
    ? pathname.split('/').slice(2).join('/')
    : pathname.substring(1)

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  let user = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch {
    // Corrupted auth cookies — clear them and continue as unauthenticated
    const response = NextResponse.next({ request })
    request.cookies.getAll().forEach((cookie) => {
      if (cookie.name.startsWith("sb-")) {
        response.cookies.delete(cookie.name)
      }
    })
    const pathname = request.nextUrl.pathname
    if (PROTECTED_ROUTES.some((route) => pathname.startsWith(route))) {
      const url = request.nextUrl.clone()
      url.pathname = "/signin"
      const redirect = NextResponse.redirect(url)
      request.cookies.getAll().forEach((cookie) => {
        if (cookie.name.startsWith("sb-")) {
          redirect.cookies.delete(cookie.name)
        }
      })
      return redirect
    }
    return response
  }

  const currentPath = `/${pathnameWithoutLocale}`

  // Redirect authenticated users away from auth pages
  if (user && AUTH_ROUTES.some((route) => currentPath.startsWith(route))) {
    const url = request.nextUrl.clone()
    // Only redirect to /studio if user has an active subscription, otherwise go home
    const serviceClientForAuth = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!
    )
    const { data: authSub } = await serviceClientForAuth
      .from("subscriptions")
      .select("status")
      .eq("user_id", user.id)
      .in("status", ["active", "trialing"])
      .limit(1)
      .single()
    url.pathname = authSub ? "/studio" : "/"
    return NextResponse.redirect(url)
  }

  // Redirect unauthenticated users to signin
  if (!user && PROTECTED_ROUTES.some((route) => currentPath.startsWith(route))) {
    const url = request.nextUrl.clone()
    // Preserve locale in redirect
    const locale = pathname.split('/')[1]
    const localePrefix = locales.includes(locale as any) && locale !== 'en' ? `/${locale}` : ''
    url.pathname = `${localePrefix}/signin`
    url.searchParams.set("redirect", pathname)
    return NextResponse.redirect(url)
  }

  // Check subscription for protected routes (use service role to bypass RLS)
  if (user && SUBSCRIPTION_ROUTES.some((route) => currentPath.startsWith(route))) {
    const serviceClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!
    )
    const { data: subscription } = await serviceClient
      .from("subscriptions")
      .select("plan_type, status")
      .eq("user_id", user.id)
      .in("status", ["active", "trialing"])
      .limit(1)
      .single()

    if (!subscription) {
      const url = request.nextUrl.clone()
      url.pathname = "/subscribe"
      return NextResponse.redirect(url)
    }

    // Editor requires Premium or Professional
    if (currentPath.startsWith("/editor") && subscription.plan_type === "basic") {
      const url = request.nextUrl.clone()
      // Preserve locale in redirect
      const locale = pathname.split('/')[1]
      const localePrefix = locales.includes(locale as any) && locale !== 'en' ? `/${locale}` : ''
      url.pathname = `${localePrefix}/subscribe`
      url.searchParams.set("upgrade", "true")
      return NextResponse.redirect(url)
    }
  }

  // Return the i18n response with Supabase cookies
  return intlResponse || supabaseResponse
}

export const config = {
  matcher: [
    // Match all pathnames except for:
    // - API routes
    // - auth routes (handled by Supabase directly)
    // - _next (Next.js internals)
    // - static files (images, fonts, etc.)
    '/((?!api|auth|_next|_vercel|.*\\..*).*)',
    // Also match root
    '/'
  ],
}
