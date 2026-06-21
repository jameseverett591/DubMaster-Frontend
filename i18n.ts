import { notFound } from 'next/navigation';
import { getRequestConfig } from 'next-intl/server';

// Supported locales
export const locales = [
  'en', 'es', 'pt', 'fr', 'de', 'it', 'nl', 'pl', 'ro', 'sv', 'no', 'da', 'fi',
  'ru', 'uk', 'cs', 'hu', 'el', 'tr',
  'ar', 'he', 'ur', 'fa',
  'hi', 'bn', 'pa', 'ta',
  'zh', 'ja', 'ko', 'vi', 'th', 'id', 'ms', 'tl',
  'sw',
] as const;
export type Locale = (typeof locales)[number];

export const localeNames: Record<Locale, string> = {
  // European — Romance
  en: 'English',
  es: 'Español',
  pt: 'Português',
  fr: 'Français',
  it: 'Italiano',
  ro: 'Română',
  // European — Germanic
  de: 'Deutsch',
  nl: 'Nederlands',
  sv: 'Svenska',
  no: 'Norsk',
  da: 'Dansk',
  fi: 'Suomi',
  // European — Slavic & other
  ru: 'Русский',
  uk: 'Українська',
  pl: 'Polski',
  cs: 'Čeština',
  hu: 'Magyar',
  el: 'Ελληνικά',
  tr: 'Türkçe',
  // Middle East
  ar: 'العربية',
  he: 'עברית',
  ur: 'اردو',
  fa: 'فارسی',
  // South Asian
  hi: 'हिन्दी',
  bn: 'বাংলা',
  pa: 'ਪੰਜਾਬੀ',
  ta: 'தமிழ்',
  // East & Southeast Asian
  zh: '中文',
  ja: '日本語',
  ko: '한국어',
  vi: 'Tiếng Việt',
  th: 'ภาษาไทย',
  id: 'Bahasa Indonesia',
  ms: 'Bahasa Melayu',
  tl: 'Filipino',
  // African
  sw: 'Kiswahili',
};

export const localeFlags: Record<Locale, string> = {
  en: '🇺🇸',
  es: '🇪🇸',
  pt: '🇧🇷',
  fr: '🇫🇷',
  it: '🇮🇹',
  ro: '🇷🇴',
  de: '🇩🇪',
  nl: '🇳🇱',
  sv: '🇸🇪',
  no: '🇳🇴',
  da: '🇩🇰',
  fi: '🇫🇮',
  ru: '🇷🇺',
  uk: '🇺🇦',
  pl: '🇵🇱',
  cs: '🇨🇿',
  hu: '🇭🇺',
  el: '🇬🇷',
  tr: '🇹🇷',
  ar: '🇸🇦',
  he: '🇮🇱',
  ur: '🇵🇰',
  fa: '🇮🇷',
  hi: '🇮🇳',
  bn: '🇧🇩',
  pa: '🇮🇳',
  ta: '🇮🇳',
  zh: '🇨🇳',
  ja: '🇯🇵',
  ko: '🇰🇷',
  vi: '🇻🇳',
  th: '🇹🇭',
  id: '🇮🇩',
  ms: '🇲🇾',
  tl: '🇵🇭',
  sw: '🇰🇪',
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
