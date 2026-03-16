"use client"

import { useLocale } from 'next-intl'
import { usePathname } from 'next/navigation'
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Globe } from "lucide-react"
import { locales, localeNames, localeFlags, type Locale } from '@/i18n'

export function LanguageSwitcher() {
  const locale = useLocale() as Locale
  const pathname = usePathname()

  const handleLocaleChange = (newLocale: Locale) => {
    if (newLocale === locale) return

    // Strip any existing locale prefix from the pathname
    const segments = pathname.split('/')
    const firstSegment = segments[1]
    const strippedPath = (locales as readonly string[]).includes(firstSegment)
      ? '/' + segments.slice(2).join('/')
      : pathname
    const cleanPath = strippedPath === '' || strippedPath === '/' ? '/' : strippedPath

    // Build the target URL
    const newPath = newLocale === 'en'
      ? cleanPath
      : `/${newLocale}${cleanPath === '/' ? '' : cleanPath}`

    // Set the NEXT_LOCALE cookie so next-intl and middleware agree on the locale
    document.cookie = `NEXT_LOCALE=${newLocale};path=/;max-age=31536000;SameSite=Lax`

    window.location.href = newPath || '/'
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="flex items-center gap-2 px-3 py-2 h-auto text-[#94A3B8] hover:text-[#C084FC] hover:bg-[#A855F7]/10 border border-[#A855F7]/20 hover:border-[#A855F7]/50 rounded-lg transition-all duration-200"
          aria-label="Change language"
        >
          <Globe className="h-5 w-5 text-[#22D3EE]" strokeWidth={1.5} />
          <span className="text-sm font-medium hidden sm:inline">
            {localeFlags[locale]} {localeNames[locale]}
          </span>
          <span className="text-xs text-[#64748B] hidden sm:inline">▾</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52 bg-[#0F172A] border-[#A855F7]/30">
        <DropdownMenuLabel className="text-[#94A3B8] text-xs font-normal flex items-center gap-2 pb-1">
          <Globe className="h-3.5 w-3.5 text-[#22D3EE]" strokeWidth={1.5} />
          Select your language
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-[#A855F7]/20" />
        {locales.map((loc) => (
          <DropdownMenuItem
            key={loc}
            onClick={() => handleLocaleChange(loc)}
            className={`cursor-pointer text-[#94A3B8] hover:text-[#C084FC] hover:bg-[#A855F7]/10 flex items-center justify-between ${
              locale === loc ? 'bg-[#A855F7]/20 text-[#C084FC]' : ''
            }`}
          >
            <span className="flex items-center gap-2">
              <span className="text-lg">{localeFlags[loc]}</span>
              <span>{localeNames[loc]}</span>
            </span>
            {locale === loc && (
              <span className="text-[#22D3EE]">✓</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
