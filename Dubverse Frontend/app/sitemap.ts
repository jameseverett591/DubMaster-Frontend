import type { MetadataRoute } from 'next'
import { locales } from '@/i18n'

const BASE = 'https://dubmasterai.com'
const DEFAULT_LOCALE = 'en'

const PAGES: { path: string; changeFrequency: 'weekly' | 'monthly' | 'yearly'; priority: number }[] = [
  { path: '/', changeFrequency: 'weekly', priority: 1.0 },
  { path: '/pricing', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/signup', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/contact', changeFrequency: 'monthly', priority: 0.5 },
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/terms', changeFrequency: 'yearly', priority: 0.3 },
]

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = []
  for (const { path, changeFrequency, priority } of PAGES) {
    for (const locale of locales) {
      // localePrefix: 'as-needed' — the default locale is unprefixed, every
      // other public page lives at /<locale>/<path>.
      const prefix = locale === DEFAULT_LOCALE ? '' : `/${locale}`
      entries.push({ url: `${BASE}${prefix}${path}`, changeFrequency, priority })
    }
  }
  return entries
}
