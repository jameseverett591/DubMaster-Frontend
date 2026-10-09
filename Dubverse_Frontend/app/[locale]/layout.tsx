import { getMessages } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { locales } from '@/i18n';
import { PlanProvider } from '@/lib/use-plan';
import { AppIntlProvider } from '@/components/intl-provider';

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  // Next.js 16: params is now a Promise that must be awaited
  const { locale } = await params;

  // Validate that the incoming locale parameter is valid
  if (!locales.includes(locale as any)) {
    notFound();
  }

  // Providing all messages to the client side
  const messages = await getMessages();

  return (
    <AppIntlProvider locale={locale} messages={messages}>
      <PlanProvider>
        {children}
      </PlanProvider>
    </AppIntlProvider>
  );
}
