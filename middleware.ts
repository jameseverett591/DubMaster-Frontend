import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import createMiddleware from 'next-intl/middleware'
import { locales } from './i18n'

// Routes that require authentication (WITHOUT locale prefix)
const PROTECTED_ROUTES = ["/studio", "/editor", "/dashboard", "/account"]
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

  const currentPath = `/${pathnameWithoutLocale}`

  // Only call Supabase auth for routes that actually need it
  const needsAuth = PROTECTED_ROUTES.some((route) => currentPath.startsWith(route)) ||
    AUTH_ROUTES.some((route) => currentPath.startsWith(route))

  if (!needsAuth) {
    return intlResponse || NextResponse.next({ request })
  }

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

  // Redirect authenticated users away from auth pages
  if (user && AUTH_ROUTES.some((route) => currentPath.startsWith(route))) {
    const url = request.nextUrl.clone()
    // Every signed-in user owns the studio — free tier renders 3 min/month
    // plus the wallet, so there is no "subscribed or not" fork anymore.
    url.pathname = "/studio"
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
