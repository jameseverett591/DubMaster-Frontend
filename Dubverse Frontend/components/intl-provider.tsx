'use client'

import { NextIntlClientProvider, IntlErrorCode, type IntlError } from 'next-intl'
import type { AbstractIntlMessages } from 'next-intl'

/**
 * The `ui` namespace (lib/use-t.ts) deliberately keys on the raw English
 * string, including ones ending in "." or "...". next-intl's own `t()`
 * treats "." as nesting syntax and would misresolve those, but we never call
 * next-intl's `t()` on this namespace — `useT()` does a flat
 * `messages.ui[en]` lookup directly, bypassing that resolution entirely.
 *
 * The provider still dev-mode-validates every key in `messages` up front,
 * INVALID_KEY included, regardless of how (or whether) a namespace is ever
 * consumed through next-intl's own APIs. That validation is purely
 * diagnostic — it never mutates or strips `messages` (see use-intl's
 * initializeConfig: `messages: messages || undefined`) — so `ui` reaches
 * useT() intact either way, and it's dev-only besides. Silence just this
 * known-harmless code so real errors (MISSING_MESSAGE in the namespaces
 * that do go through next-intl's own t()) still surface.
 *
 * Lives in its own 'use client' module — not inline in the server-component
 * layout — because a plain function defined in a Server Component can't
 * cross the RSC boundary as a prop to a Client Component.
 */
function onIntlError(error: IntlError) {
  if (error.code === IntlErrorCode.INVALID_KEY) return
  console.error(error)
}

export function AppIntlProvider({
  locale,
  messages,
  children,
}: {
  locale: string
  messages: AbstractIntlMessages
  children: React.ReactNode
}) {
  return (
    <NextIntlClientProvider locale={locale} messages={messages} onError={onIntlError}>
      {children}
    </NextIntlClientProvider>
  )
}
