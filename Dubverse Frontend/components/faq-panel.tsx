'use client'

import { useTranslations } from "next-intl"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"

/**
 * Studio dashboard FAQ tab — reuses the landing page's `landing.faq*`
 * message keys so every translated locale carries over for free.
 */
export function FaqPanel() {
  const t = useTranslations('landing')
  // Locals without the newer entries just show fewer questions — t.has()
  // keeps a half-translated locale from rendering raw key paths.
  const items = Array.from({ length: 10 }, (_, i) => i + 1)
    .filter((i) => t.has(`faq${i}Q`))
    .map((i) => ({ q: t(`faq${i}Q`), a: t(`faq${i}A`) }))

  return (
    <div className="relative">
      {/* Same glow frame as the upload box so the tab feels native */}
      <div className="absolute -inset-1 bg-gradient-to-r from-[#A855F7] via-[#FDB022] to-[#22D3EE] rounded-2xl opacity-30 blur-2xl" />
      <div className="relative bg-gradient-to-br from-[#0F172A]/60 to-[#1E293B]/60 backdrop-blur-2xl border-2 border-[#A855F7]/40 rounded-2xl p-6 md:p-8 shadow-[0_0_60px_rgba(168,85,247,0.3)]">
        <h2 className="text-2xl md:text-3xl font-bold text-center mb-8 tracking-tight text-white">
          {t('faqTitle')}
        </h2>
        <Accordion type="single" collapsible className="space-y-4 max-w-3xl mx-auto">
          {items.map((item, i) => (
            <AccordionItem
              key={i}
              value={`faq-${i}`}
              className="border border-[#A855F7]/15 rounded-lg px-6 bg-[#020817]/50 data-[state=open]:bg-[#0F0520]/30 data-[state=open]:border-[#A855F7]/30 transition-all duration-300"
            >
              <AccordionTrigger className="text-left hover:no-underline py-5 text-white hover:text-[#C084FC] cursor-pointer [&[data-state=open]]:text-[#C084FC] transition-colors duration-300">
                {item.q}
              </AccordionTrigger>
              <AccordionContent className="text-[#10B981] pb-5 text-base leading-relaxed whitespace-pre-line drop-shadow-[0_0_8px_rgba(16,185,129,0.15)]">
                {item.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </div>
  )
}
