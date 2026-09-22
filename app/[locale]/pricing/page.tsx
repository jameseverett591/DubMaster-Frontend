"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { ArrowLeft, Mic2, Check, X } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/use-t"

export default function PricingPage() {
  const t = useTranslations('landing')
  const tUi = useT()

  // landing.pricing* only exists in en.json for now — fall back to the
  // English literal instead of next-intl's missing-key output on other
  // locales. Translations land per-locale and light up automatically.
  const L = (key: string, en: string) => (t.has(key) ? t(key) : en)

  const plans = [
    {
      name: L('pricingFreeTier', 'Free'),
      price: L('pricingFreePrice', '$0'),
      renders: L('pricingFreeRenders', '3 min/month'),
      accent: "text-[#22D3EE]",
      border: "border-[#22D3EE]/30",
      cta: { label: tUi('Start free'), href: "/subscribe" },
    },
    {
      name: L('pricingProTier', 'Pro'),
      price: L('pricingProPrice', '$49/month'),
      renders: L('pricingProRenders', '30 min/month'),
      accent: "text-[#C084FC]",
      border: "border-[#A855F7]/50",
      cta: { label: tUi('Get Pro'), href: "/subscribe" },
    },
    {
      name: L('pricingPaygTier', 'Pay As You Go'),
      price: L('pricingPaygPrice', '$2.50/min'),
      renders: L('pricingPaygRenders', 'Your pace'),
      accent: "text-[#FDB022]",
      border: "border-[#FDB022]/30",
      cta: { label: tUi('Top up'), href: "/subscribe" },
    },
  ]

  const rows = [
    { feature: L('pricingStudioAccess', 'Studio access'), dm: L('pricingFull', 'Full'), dv: L('pricingFull', 'Full'), hg: L('pricingFull', 'Full') },
    { feature: L('pricingSceneSummaries', 'Scene summaries'), dm: true, dv: true, hg: true },
    { feature: L('pricingRulebook', 'Rulebook'), dm: true, dv: true, hg: true },
    { feature: L('pricingRenderMinutes', 'Render minutes'), dm: L('pricingFreeRenders', '3 min/month'), dv: L('pricingProRenders', '30 min/month'), hg: L('pricingPaygRenders', 'Your pace') },
    { feature: L('pricingPrice', 'Price'), dm: L('pricingFreePrice', '$0'), dv: L('pricingProPrice', '$49/month'), hg: L('pricingPaygPrice', '$2.50/min') },
  ]

  return (
    <div className="relative min-h-screen bg-[#020817] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(168,85,247,0.08)_0%,_transparent_50%)] pointer-events-none" />

      {/* Header — same chrome as privacy/terms */}
      <header className="sticky top-0 z-10 border-b border-[#A855F7]/20 bg-[#020817]/80 backdrop-blur-xl px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-[#A855F7] to-[#22D3EE]">
            <Mic2 className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-white">DubMaster</span>
        </Link>
        <Link
          href="/"
          className="text-[#94A3B8] hover:text-[#C084FC] flex items-center gap-2 text-sm transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {tUi('Back to Home')}
        </Link>
      </header>

      <main className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h1 className="text-3xl md:text-5xl font-bold text-center mb-4 tracking-tight">
          <span className="gradient-text-animated">{L('pricingTitle', 'Simple, Honest Pricing')}</span>
        </h1>
        <p className="text-[#94A3B8] text-lg text-center max-w-2xl mx-auto mb-16">{L('pricingSub', 'Upload, transcribe, translate, and edit for free. You only pay to render.')}</p>

        {/* Plan cards */}
        <div className="grid md:grid-cols-3 gap-6 mb-16">
          {plans.map((p) => (
            <Card key={p.name} className={`bg-[#0F0520]/40 ${p.border} border backdrop-blur-sm`}>
              <CardHeader>
                <CardTitle className={`text-2xl ${p.accent}`}>{p.name}</CardTitle>
                <p className="text-3xl font-bold text-white">{p.price}</p>
                <p className="text-sm text-[#94A3B8]">{p.renders}</p>
              </CardHeader>
              <CardContent>
                <Link href={p.cta.href}>
                  <Button className="w-full bg-gradient-to-r from-[#A855F7] to-[#22D3EE] hover:opacity-90 text-white cursor-pointer">
                    {p.cta.label}
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Comparison table — mirrors the landing section */}
        <div className="overflow-x-auto rounded-xl border border-[#A855F7]/20 bg-[#0F0520]/20 mb-16">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[#A855F7]/20">
                <th className="text-left py-5 px-6 text-[#94A3B8]">{tUi('Feature')}</th>
                <th className="py-5 px-6 text-[#22D3EE] font-bold text-lg">{L('pricingFreeTier', 'Free')}</th>
                <th className="py-5 px-6 text-[#C084FC] font-bold text-lg">{L('pricingProTier', 'Pro')}</th>
                <th className="py-5 px-6 text-[#FDB022] font-bold text-lg">{L('pricingPaygTier', 'Pay As You Go')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-[#A855F7]/10 hover:bg-[#A855F7]/5 transition-colors duration-200">
                  <td className="py-4 px-6 text-[#E2E8F0] font-medium">{row.feature}</td>
                  {(["dm", "dv", "hg"] as const).map((k) => (
                    <td key={k} className="py-4 px-6 text-center">
                      {typeof row[k] === "boolean" ? (
                        row[k]
                          ? <Check className="h-5 w-5 text-[#10B981] mx-auto drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                          : <X className="h-5 w-5 text-[#EF4444] mx-auto" />
                      ) : (
                        <span className={`font-semibold ${k === "dm" ? "text-[#22D3EE]" : k === "dv" ? "text-[#C084FC]" : "text-[#FDB022]"}`}>
                          {row[k]}
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Lip-sync add-on — the honest-cost explainer */}
        <Card className="bg-[#0F0520]/30 border-[#A855F7]/20 max-w-3xl mx-auto mb-16">
          <CardContent className="p-8">
            <h2 className="text-xl font-bold text-white mb-3">
              {tUi('Optional: AI lip sync add-on')}
            </h2>
            <p className="text-[#94A3B8] leading-relaxed whitespace-pre-line">
              {tUi("AI lip sync repaints the mouth region pixel-by-pixel — powerful on frontal, well-lit footage, fragile everywhere else. We bill it separately at vendor cost plus a small platform fee, powered by Sync Labs, so it never hides inside your render minutes.\n\nYour base render aligns audio in the time domain instead — the original face is never touched, and the QC Monitor's lip-sync score measures the alignment in milliseconds so you can verify it. Get the timing right in the editor first; most directors find that's all they need.")}
            </p>
          </CardContent>
        </Card>

        <p className="text-center text-[#64748B] text-sm">
          {tUi('Upload, transcribe, translate and edit for free — only renders are metered. Lip-sync add-on billed separately at cost.')}
        </p>
      </main>
    </div>
  )
}
