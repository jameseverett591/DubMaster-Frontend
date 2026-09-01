'use client'

import { useMessages } from 'next-intl'
import { useCallback } from 'react'

/**
 * UI TRANSLATION, KEYED BY THE ENGLISH TEXT ITSELF.
 *
 * The product surface is ~1,100 strings across ~69 files. Naming a key for each
 * one is days of work and a bug source of its own, and it fails badly: a locale
 * that is only half filled in shows `editor.qc.timingLabel` to a paying
 * customer. Keying on the English means a missing translation renders the
 * English — degraded, never broken — which is what lets us ship the 35 locales
 * incrementally instead of all at once.
 *
 * This deliberately does NOT go through next-intl's `t()`. next-intl treats `.`
 * as a namespace separator, so "Adjust segment timing." would be read as a path
 * and miss. We look the string up in a flat `ui` dictionary ourselves, so any
 * punctuation is safe and the fallback is guaranteed rather than hoped for.
 *
 *   const t = useT()
 *   <Button>{t('Generate Speech')}</Button>
 *   t('Deleting {count} segments', { count: 3 })
 */
export function useT() {
  const messages = useMessages() as Record<string, unknown> | undefined
  const dict = (messages?.ui ?? {}) as Record<string, string>

  return useCallback(
    (en: string, vars?: Record<string, string | number>) => {
      const out = dict[en] ?? en
      if (!vars) return out
      return out.replace(/\{(\w+)\}/g, (whole, name) =>
        name in vars ? String(vars[name]) : whole
      )
    },
    [dict]
  )
}
