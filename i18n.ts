import { notFound } from 'next/navigation';
import { getRequestConfig } from 'next-intl/server';

// Supported locales
export const locales = ['en', 'es', 'hi', 'zh', 'fr', 'it', 'ru', 'ja', 'ko'] as const;
export type Locale = (typeof locales)[number];

export const localeNames: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
  hi: 'हिन्दी',
  zh: '中文',
  fr: 'Français',
  it: 'Italiano',
  ru: 'Русский',
  ja: '日本語',
  ko: '한국어',
};

export const localeFlags: Record<Locale, string> = {
  en: '🇺🇸',
  es: '🇪🇸',
  hi: '🇮🇳',
  zh: '🇨🇳',
  fr: '🇫🇷',
  it: '🇮🇹',
  ru: '🇷🇺',
  ja: '🇯🇵',
  ko: '🇰🇷',
};

export default getRequestConfig(async ({ requestLocale }) => {
  // Next.js 16 + next-intl: Use requestLocale instead of locale parameter
  const locale = await requestLocale;

  // Validate that the incoming `locale` parameter is valid
  if (!locales.includes(locale as Locale)) notFound();

  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});
