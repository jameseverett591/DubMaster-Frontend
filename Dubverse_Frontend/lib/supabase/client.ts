import { createBrowserClient } from "@supabase/ssr"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createClient() {
  return createBrowserClient<any>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
}

/**
 * Clear corrupted Supabase auth cookies from the browser.
 * Call this when a JSON parse error occurs during auth operations.
 */
export function clearCorruptedAuthCookies() {
  document.cookie.split("; ").forEach((cookie) => {
    const name = cookie.split("=")[0]
    if (name.startsWith("sb-")) {
      document.cookie = `${name}=; path=/; max-age=0`
    }
  })
}
