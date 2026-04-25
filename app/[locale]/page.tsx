"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useTranslations, useLocale } from "next-intl"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import {
  Upload,
  Play,
  Check,
  X,
  Mic2,
  Heart,
  Film,
  Shield,
  Globe,
  Zap,
  Settings2,
  GitBranch,
  Camera,
  Tv,
  ChevronRight,
  Sparkles,
  Brain,
  FileVideo,
  Menu,
  X as XIcon,
} from "lucide-react"
import Link from "next/link"
import { LanguageSwitcher } from "@/components/language-switcher"

/* ─── Floating particles component ─── */
function Particles() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {Array.from({ length: 30 }).map((_, i) => (
        <div
          key={i}
          className="absolute rounded-full opacity-0"
          style={{
            width: `${Math.random() * 4 + 2}px`,
            height: `${Math.random() * 4 + 2}px`,
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            background: i % 3 === 0 ? "#A855F7" : i % 3 === 1 ? "#22D3EE" : "#C084FC",
            boxShadow: `0 0 ${Math.random() * 10 + 5}px ${i % 2 === 0 ? "#A855F7" : "#22D3EE"}`,
            animation: `floatParticle ${Math.random() * 8 + 6}s ease-in-out ${Math.random() * 5}s infinite`,
          }}
        />
      ))}
    </div>
  )
}

/* ─── Glowing separator ─── */
function GlowSeparator() {
  return (
    <div className="w-full h-px bg-gradient-to-r from-transparent via-[#A855F7]/50 to-transparent" />
  )
}

/* Pricing section removed - users see plans on signup page */

export default function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [videoMode, setVideoMode] = useState<"original" | "dubbed" | "split">("split")
  const [scrollY, setScrollY] = useState(0)
  const router = useRouter()
  const t = useTranslations('landing')
  const locale = useLocale()

  // Redirect authenticated users with an active subscription to /studio
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return
        const { data: subscription } = await supabase
          .from("subscriptions")
          .select("status")
          .eq("user_id", session.user.id)
          .in("status", ["active", "trialing"])
          .limit(1)
          .maybeSingle()
        if (subscription) {
          router.replace(`/${locale}/studio`)
        }
      } catch {
        // Ignore auth errors on landing page
      }
    }
    checkAuth()
  }, [router])

  useEffect(() => {
    const handleScroll = () => setScrollY(window.scrollY)
    window.addEventListener("scroll", handleScroll, { passive: true })
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  return (
    <div className="min-h-screen bg-[#020817] text-[#E2E8F0]">
      {/* ── Global CSS for animations ── */}
      <style jsx global>{`
        @keyframes gradientFlow {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        @keyframes floatParticle {
          0%, 100% { opacity: 0; transform: translateY(0) translateX(0); }
          10% { opacity: 0.8; }
          90% { opacity: 0.8; }
          50% { transform: translateY(-80px) translateX(30px); }
        }
        @keyframes pulseGlow {
          0%, 100% { box-shadow: 0 0 20px rgba(168,85,247,0.3), 0 0 40px rgba(34,211,238,0.1); }
          50% { box-shadow: 0 0 30px rgba(168,85,247,0.5), 0 0 60px rgba(34,211,238,0.2); }
        }
        @keyframes auroraShift {
          0% { transform: rotate(0deg) scale(1); opacity: 0.3; }
          33% { transform: rotate(120deg) scale(1.1); opacity: 0.4; }
          66% { transform: rotate(240deg) scale(0.9); opacity: 0.3; }
          100% { transform: rotate(360deg) scale(1); opacity: 0.3; }
        }
        @keyframes borderRotate {
          0% { --angle: 0deg; }
          100% { --angle: 360deg; }
        }
        .gradient-text-animated {
          background: linear-gradient(90deg, #A855F7, #22D3EE, #3B82F6, #A855F7);
          background-size: 300% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: gradientFlow 4s ease-in-out infinite;
        }
        .card-glow:hover {
          transform: scale(1.03);
          box-shadow: 0 0 30px rgba(168,85,247,0.2), 0 0 60px rgba(34,211,238,0.1);
        }
        .btn-glow {
          transition: all 300ms ease-out;
        }
        .btn-glow:hover {
          box-shadow: 0 0 25px rgba(168,85,247,0.4), 0 0 50px rgba(34,211,238,0.2);
          transform: translateY(-1px);
        }
        .fade-in-section {
          opacity: 0;
          transform: translateY(20px);
          animation: fadeInUp 0.6s ease-out forwards;
        }
        @keyframes fadeInUp {
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pricingPulse {
          0%, 100% { box-shadow: 0 0 20px rgba(168,85,247,0.3); }
          50% { box-shadow: 0 0 35px rgba(168,85,247,0.5); }
        }
      `}</style>

      {/* ══════════ NAVIGATION ══════════ */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#020817]/70 backdrop-blur-xl border-b border-[#A855F7]/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-[#A855F7] to-[#22D3EE] rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(168,85,247,0.4)]">
                <Mic2 className="h-5 w-5 text-white" />
              </div>
              <span className="text-xl font-bold text-white">DubMaster</span>
            </div>

            <div className="hidden md:flex items-center gap-8">
              <a href="#features" className="text-sm text-[#94A3B8] hover:text-[#C084FC] transition-colors duration-300">{t('navFeatures')}</a>
              <a href="#how-it-works" className="text-sm text-[#94A3B8] hover:text-[#C084FC] transition-colors duration-300">{t('navHowItWorks')}</a>
              <Link href="/signup" className="text-sm text-[#94A3B8] hover:text-[#C084FC] transition-colors duration-300">{t('navPricing')}</Link>
              <a href="#faq" className="text-sm text-[#94A3B8] hover:text-[#C084FC] transition-colors duration-300">{t('navFaq')}</a>
            </div>

            <div className="hidden md:flex items-center gap-4">
              <LanguageSwitcher />
              <Button asChild variant="ghost" className="text-[#94A3B8] hover:text-white hover:bg-[#A855F7]/10 transition-all duration-300 cursor-pointer">
                <Link href="/signin">{t('signIn')}</Link>
              </Button>
              <Button asChild className="bg-gradient-to-r from-[#A855F7] to-[#22D3EE] hover:opacity-90 btn-glow font-semibold cursor-pointer">
                <Link href="/signup">{t('getStarted')}</Link>
              </Button>
            </div>

            <button
              className="md:hidden p-2 text-white"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <XIcon className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden bg-[#020817]/95 backdrop-blur-xl border-t border-[#A855F7]/10 p-4">
            <div className="flex flex-col gap-4">
              <a href="#features" className="text-sm text-[#94A3B8] hover:text-[#C084FC]">{t('navFeatures')}</a>
              <a href="#how-it-works" className="text-sm text-[#94A3B8] hover:text-[#C084FC]">{t('navHowItWorks')}</a>
              <Link href="/signup" className="text-sm text-[#94A3B8] hover:text-[#C084FC]">{t('navPricing')}</Link>
              <a href="#faq" className="text-sm text-[#94A3B8] hover:text-[#C084FC]">{t('navFaq')}</a>
              <div className="flex items-center gap-2 pt-1">
                <span className="text-sm text-[#64748B]">Language:</span>
                <LanguageSwitcher />
              </div>
              <Button asChild variant="outline" className="w-full border-[#A855F7]/30 text-[#C084FC] hover:bg-[#A855F7]/10 cursor-pointer">
                <Link href="/signin">{t('signIn')}</Link>
              </Button>
              <Button asChild className="w-full bg-gradient-to-r from-[#A855F7] to-[#22D3EE] cursor-pointer">
                <Link href="/signup">{t('getStarted')}</Link>
              </Button>
            </div>
          </div>
        )}
      </nav>

      {/* ══════════ SECTION 1: HERO ══════════ */}
      <section className="relative min-h-screen flex items-center justify-center pt-16 overflow-hidden">
        {/* Aurora background */}
        <div className="absolute inset-0 bg-[#020817]" />
        <div
          className="absolute top-[-50%] left-[-50%] w-[200%] h-[200%]"
          style={{
            background: "radial-gradient(ellipse at 30% 50%, rgba(168,85,247,0.15) 0%, transparent 50%), radial-gradient(ellipse at 70% 50%, rgba(34,211,238,0.1) 0%, transparent 50%)",
            animation: "auroraShift 20s ease-in-out infinite",
            transform: `translateY(${scrollY * 0.1}px)`,
          }}
        />

        {/* Grid overlay */}
        <div className="absolute inset-0 opacity-[0.07]" style={{
          backgroundImage: `linear-gradient(rgba(34,211,238,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.3) 1px, transparent 1px)`,
          backgroundSize: '60px 60px'
        }} />

        <Particles />

        <div
          className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center"
          style={{ transform: `translateY(${scrollY * -0.15}px)` }}
        >
          {/* Badge */}
          <Badge className="mb-8 bg-[#A855F7]/10 text-[#C084FC] border-[#A855F7]/30 px-5 py-2.5 text-sm shadow-[0_0_15px_rgba(168,85,247,0.2)]">
            <Sparkles className="h-4 w-4 mr-2 text-[#22D3EE]" />
            {t('heroBadge')}
          </Badge>

          {/* Main headline */}
          <h1 className="text-[48px] md:text-[96px] font-extrabold mb-6 leading-[1.05] tracking-tight">
            <span className="gradient-text-animated drop-shadow-[0_0_30px_rgba(168,85,247,0.3)]">
              {t('heroLine1')}
            </span>
            <br />
            <span className="text-white drop-shadow-[0_0_20px_rgba(255,255,255,0.15)]">
              {t('heroLine2')}
            </span>
          </h1>

          {/* Subheadline */}
          <p className="text-xl md:text-2xl text-[#94A3B8] max-w-3xl mx-auto mb-12">
            {t('heroSub')}
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
            <Button asChild size="lg" className="bg-gradient-to-r from-[#A855F7] to-[#7C3AED] hover:opacity-90 text-lg px-8 py-6 btn-glow font-semibold shadow-[0_0_20px_rgba(168,85,247,0.3)]">
              <Link href="/signup">
                <Upload className="mr-2 h-5 w-5" />
                {t('getStarted')}
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="border-[#22D3EE]/40 text-[#22D3EE] hover:bg-[#22D3EE]/10 text-lg px-8 py-6 btn-glow shadow-[0_0_15px_rgba(34,211,238,0.1)]">
              <a href="#how-it-works">
                <Play className="mr-2 h-5 w-5" />
                {t('navHowItWorks')}
              </a>
            </Button>
          </div>

          {/* Stats bar - glassmorphism */}
          <div className="inline-flex flex-wrap items-center justify-center gap-8 md:gap-12 mb-16 px-8 py-5 rounded-2xl bg-gradient-to-r from-[#A855F7]/10 via-[#22D3EE]/5 to-[#A855F7]/10 backdrop-blur-md border border-[#A855F7]/20 shadow-[0_0_30px_rgba(168,85,247,0.1)]">
            {[
              { value: "99%", label: "Emotion" },
              { value: "Voice", label: "Cloning" },
              { value: "24-48hr", label: "Turnaround" },
              { value: "$500-2K", label: "per film" },
            ].map((stat, i) => (
              <div key={i} className="text-center">
                <div className="text-2xl md:text-3xl font-bold text-[#FDB022] drop-shadow-[0_0_15px_rgba(253,176,34,0.4)]">
                  {stat.value}
                </div>
                <div className="text-sm text-[#94A3B8]">{stat.label}</div>
              </div>
            ))}
          </div>

          {/* Hero video placeholder */}
          <div className="relative max-w-4xl mx-auto rounded-xl overflow-hidden border border-[#A855F7]/30 bg-[#020817] shadow-[0_0_40px_rgba(168,85,247,0.15)]">
            <div className="aspect-video flex items-center justify-center">
              <div className="grid grid-cols-2 w-full h-full">
                <div className="bg-gradient-to-br from-[#0F0520] to-[#020817] flex items-center justify-center border-r border-[#A855F7]/20">
                  <div className="text-center">
                    <p className="text-[#94A3B8] mb-2">{t('originalCantonese')}</p>
                    <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto border border-white/10 cursor-pointer hover:bg-white/10 transition-all duration-300">
                      <Play className="h-8 w-8 text-white" />
                    </div>
                  </div>
                </div>
                <div className="bg-gradient-to-br from-[#020817] to-[#0F0520] flex items-center justify-center">
                  <div className="text-center">
                    <p className="text-[#94A3B8] mb-2">{t('englishDubbed')}</p>
                    <div className="w-16 h-16 rounded-full bg-[#A855F7]/10 flex items-center justify-center mx-auto border border-[#A855F7]/30 cursor-pointer hover:bg-[#A855F7]/20 transition-all duration-300 shadow-[0_0_20px_rgba(168,85,247,0.2)]">
                      <Play className="h-8 w-8 text-[#C084FC]" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <GlowSeparator />

      {/* ══════════ SECTION 2: PROBLEM/SOLUTION ══════════ */}
      <section className="py-24 bg-[#020817]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl md:text-5xl font-bold text-center mb-16 tracking-tight">
            <span className="gradient-text-animated">{t('problemTitle')}</span>
          </h2>

          <div className="grid md:grid-cols-2 gap-0 md:gap-0 relative">
            {/* Glowing divider */}
            <div className="hidden md:block absolute left-1/2 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-[#22D3EE]/50 to-transparent shadow-[0_0_10px_rgba(34,211,238,0.3)]" />

            {/* Traditional */}
            <Card className="bg-gradient-to-br from-[#1A0000]/30 to-[#020817] border-[#EF4444]/20 rounded-none md:rounded-l-xl md:rounded-r-none card-glow transition-all duration-300">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-[#EF4444] text-xl">
                  <X className="h-6 w-6 drop-shadow-[0_0_8px_rgba(239,68,68,0.5)]" />
                  {t('traditionalStudios')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {[t('traditional1'), t('traditional2'), t('traditional3'), t('traditional4'), t('traditional5')].map((item, i) => (
                  <div key={i} className="flex items-center gap-3 text-[#94A3B8]">
                    <X className="h-4 w-4 text-[#EF4444] shrink-0 drop-shadow-[0_0_5px_rgba(239,68,68,0.4)]" />
                    <span>{item}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* DubMaster */}
            <Card className="bg-gradient-to-br from-[#0F0520]/50 to-[#020817] border-[#A855F7]/30 rounded-none md:rounded-r-xl md:rounded-l-none card-glow transition-all duration-300">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-[#10B981] text-xl">
                  <Check className="h-6 w-6 drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                  {t('dubmaster')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {[t('dubmaster1'), t('dubmaster2'), t('dubmaster3'), t('dubmaster4'), t('dubmaster5')].map((item, i) => (
                  <div key={i} className="flex items-center gap-3 text-[#E2E8F0]">
                    <Check className="h-4 w-4 text-[#10B981] shrink-0 drop-shadow-[0_0_5px_rgba(16,185,129,0.4)]" />
                    <span>{item}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <GlowSeparator />

      {/* ══════════ SECTION 3: DEMO VIDEO ══════════ */}
      <section className="py-24 bg-gradient-to-b from-[#020817] via-[#1E0A3C]/20 to-[#020817]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-5xl font-bold mb-4 tracking-tight">
              <span className="gradient-text-animated">{t('demoTitle')}</span>
            </h2>
            <p className="text-[#94A3B8] text-lg">{t('demoSub')}</p>
          </div>

          {/* Video toggle buttons */}
          <div className="flex items-center justify-center gap-2 mb-6">
            {(["original", "dubbed", "split"] as const).map((mode) => (
              <Button
                key={mode}
                variant={videoMode === mode ? "default" : "outline"}
                className={`transition-all duration-300 cursor-pointer ${videoMode === mode
                  ? "bg-gradient-to-r from-[#A855F7] to-[#7C3AED] shadow-[0_0_15px_rgba(168,85,247,0.3)]"
                  : "border-[#A855F7]/20 text-[#94A3B8] hover:text-[#C084FC] hover:border-[#A855F7]/40"
                }`}
                onClick={() => setVideoMode(mode)}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </Button>
            ))}
          </div>

          {/* Video player */}
          <div className="relative max-w-5xl mx-auto rounded-xl overflow-hidden border border-[#A855F7]/30 bg-[#020817] shadow-[0_0_50px_rgba(168,85,247,0.15)]">
            <div className="aspect-video flex items-center justify-center bg-gradient-to-br from-[#0F0520] to-[#020817]">
              <div className="text-center">
                <div className="w-20 h-20 rounded-full bg-[#A855F7]/10 flex items-center justify-center mx-auto mb-4 cursor-pointer hover:bg-[#A855F7]/20 transition-all duration-300 border border-[#A855F7]/30 shadow-[0_0_30px_rgba(168,85,247,0.2)]"
                  style={{ animation: "pulseGlow 3s ease-in-out infinite" }}
                >
                  <Play className="h-10 w-10 text-[#C084FC]" />
                </div>
                <p className="text-[#94A3B8]">{t('clickToPlay')}</p>
              </div>
            </div>
          </div>

          <p className="text-center mt-8 text-lg text-[#C084FC] italic">
            &ldquo;{t('demoQuote')}&rdquo;
          </p>
        </div>
      </section>

      <GlowSeparator />

      {/* ══════════ SECTION 4: TARGET AUDIENCES ══════════ */}
      <section className="py-24 bg-[#1E0A3C]/10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl md:text-5xl font-bold text-center mb-16 tracking-tight text-white">{t('marketsTitle')}</h2>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: Film,
                title: t('bollywoodTitle'),
                headline: t('bollywoodHeadline'),
                body: t('bollywoodBody'),
                stats: t('bollywoodStats'),
                cta: t('bollywoodCta'),
              },
              {
                icon: Camera,
                title: t('indieTitle'),
                headline: t('indieHeadline'),
                body: t('indieBody'),
                stats: t('indieStats'),
                cta: t('indieCta'),
              },
              {
                icon: Tv,
                title: t('streamingTitle'),
                headline: t('streamingHeadline'),
                body: t('streamingBody'),
                stats: t('streamingStats'),
                cta: t('streamingCta'),
              },
            ].map((card, i) => (
              <Card
                key={i}
                className="bg-[#020817]/80 border-[#A855F7]/15 hover:border-[#A855F7]/40 transition-all duration-300 group cursor-pointer card-glow relative overflow-hidden"
              >
                {/* Top gradient border */}
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#A855F7]/50 to-transparent" />
                <CardHeader>
                  <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-[#A855F7]/20 to-[#22D3EE]/10 flex items-center justify-center mb-4 group-hover:shadow-[0_0_20px_rgba(168,85,247,0.3)] transition-all duration-300">
                    <card.icon className="h-6 w-6 text-[#C084FC]" />
                  </div>
                  <CardDescription className="text-[#C084FC]">{card.title}</CardDescription>
                  <CardTitle className="text-xl text-white">{card.headline}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-[#94A3B8]">{card.body}</p>
                  <p className="text-[#FDB022] font-semibold drop-shadow-[0_0_8px_rgba(253,176,34,0.3)]">{card.stats}</p>
                  <Button variant="ghost" className="p-0 text-[#22D3EE] hover:text-[#22D3EE]/80 group-hover:translate-x-1 transition-transform duration-300 cursor-pointer">
                    {card.cta} <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <GlowSeparator />

      {/* ══════════ SECTION 5: HOW IT WORKS ══════════ */}
      <section id="how-it-works" className="py-24 bg-[#020817]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl md:text-5xl font-bold text-center mb-16 tracking-tight">
            <span className="gradient-text-animated">{t('stepsTitle')}</span>
          </h2>

          <div className="grid md:grid-cols-3 gap-8 mb-12">
            {[
              { icon: Upload, title: t('step1Title'), desc: t('step1Desc'), step: 1 },
              { icon: Brain,  title: t('step2Title'), desc: t('step2Desc'), step: 2 },
              { icon: FileVideo, title: t('step3Title'), desc: t('step3Desc'), step: 3 },
            ].map((step, i) => (
              <div key={i} className="text-center relative">
                {i < 2 && (
                  <div className="hidden md:block absolute top-12 left-[60%] w-[80%] h-0.5 bg-gradient-to-r from-[#A855F7] via-[#22D3EE] to-transparent" />
                )}
                <div className="w-24 h-24 rounded-full bg-gradient-to-br from-[#A855F7]/15 to-[#22D3EE]/10 flex items-center justify-center mx-auto mb-6 relative border border-[#A855F7]/20 shadow-[0_0_20px_rgba(168,85,247,0.15)]">
                  <step.icon className="h-10 w-10 text-[#C084FC]" />
                  <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-gradient-to-r from-[#A855F7] to-[#22D3EE] flex items-center justify-center text-sm font-bold text-white shadow-[0_0_10px_rgba(168,85,247,0.4)]">
                    {step.step}
                  </div>
                </div>
                <h3 className="text-xl font-semibold mb-3 text-white">{step.title}</h3>
                <p className="text-[#94A3B8] whitespace-pre-line">{step.desc}</p>
              </div>
            ))}
          </div>

          {/* Tech specs accordion */}
          <Accordion type="single" collapsible className="max-w-3xl mx-auto">
            <AccordionItem value="tech" className="border-[#A855F7]/20">
              <AccordionTrigger className="text-[#22D3EE] hover:no-underline hover:text-[#22D3EE]/80 cursor-pointer">
                {t('techDetails')}
              </AccordionTrigger>
              <AccordionContent className="text-[#94A3B8] space-y-2">
                <p><strong className="text-[#C084FC]">Voice Cloning:</strong> Fish Audio S1 (zero-shot, 30-60s samples)</p>
                <p><strong className="text-[#C084FC]">Emotion Analysis:</strong> Hume AI + emotion2vec</p>
                <p><strong className="text-[#C084FC]">Quality Control:</strong> Azure Speech, SyncNet, Claude synthesis</p>
                <p><strong className="text-[#C084FC]">Lip-Sync:</strong> Industry-standard LSE-D scoring</p>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </section>

      <GlowSeparator />

      {/* ══════════ SECTION 6: FEATURE GRID ══════════ */}
      <section id="features" className="py-24 bg-[#1E0A3C]/10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl md:text-5xl font-bold text-center mb-16 tracking-tight text-white">{t('featuresTitle')}</h2>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { icon: Mic2, title: "Voice Cloning", desc: "Preserves original actor's voice, accent, and speaking patterns" },
              { icon: Heart, title: "99% Emotion", desc: "Verified by emotion2vec - maintains emotional authenticity" },
              { icon: Film, title: "Frame-Perfect Sync", desc: "SyncNet LSE-D industry-standard lip-sync analysis" },
              { icon: Shield, title: "7-Metric QC", desc: "Azure Speech, Hume AI, SyncNet, emotion2vec validation" },
              { icon: Globe, title: "50+ Languages", desc: "Optimized for Asian cinema - Cantonese, Mandarin, Hindi, Tamil" },
              { icon: Zap, title: "Fast Turnaround", desc: "24-48 hours for features, real-time for short content" },
              { icon: Settings2, title: "Professional Editor", desc: "Frame-by-frame control, manual refinement, perfect results" },
              { icon: GitBranch, title: "Dual-Mode", desc: "Automatic for creators, Professional for studios" },
            ].map((feature, i) => (
              <Card
                key={i}
                className="bg-[#020817]/80 border-[#A855F7]/15 hover:border-[#A855F7]/40 transition-all duration-300 card-glow cursor-pointer relative overflow-hidden"
              >
                {/* Top purple gradient border */}
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#A855F7]/40 to-transparent" />
                <CardContent className="pt-6">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#A855F7]/20 to-[#22D3EE]/10 flex items-center justify-center mb-4">
                    <feature.icon className="h-5 w-5 text-[#C084FC]" />
                  </div>
                  <h3 className="font-semibold mb-2 text-white">{feature.title}</h3>
                  <p className="text-sm text-[#94A3B8]">{feature.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <GlowSeparator />

      {/* ══════════ SECTION 7: COMPARISON TABLE ══════════ */}
      <section className="py-24 bg-[#020817]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl md:text-5xl font-bold text-center mb-16 tracking-tight">
            <span className="gradient-text-animated">{t('comparisonTitle')}</span>
          </h2>

          <div className="overflow-x-auto rounded-xl border border-[#A855F7]/20 bg-[#0F0520]/20">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-[#A855F7]/20">
                  <th className="text-left py-5 px-6 text-[#94A3B8]">Feature</th>
                  <th className="py-5 px-6 text-[#C084FC] font-bold text-lg">DubMaster</th>
                  <th className="py-5 px-6 text-[#64748B]">Dubverse.ai</th>
                  <th className="py-5 px-6 text-[#64748B]">HeyGen</th>
                  <th className="py-5 px-6 text-[#64748B]">Traditional</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { feature: "Voice Cloning", dm: true, dv: false, hg: false, tr: true },
                  { feature: "Emotion (99%)", dm: true, dv: false, hg: false, tr: true },
                  { feature: "Action/Martial Arts", dm: true, dv: false, hg: false, tr: true },
                  { feature: "Cost", dm: "$500-2K", dv: "$XXX", hg: "$XXX", tr: "$50K-100K" },
                  { feature: "Turnaround", dm: "24-48hr", dv: "XX days", hg: "XX days", tr: "6-8 weeks" },
                  { feature: "Professional QC", dm: "7 tools", dv: "Basic", hg: "Basic", tr: "Manual" },
                  { feature: "Timeline Editor", dm: true, dv: false, hg: false, tr: true },
                ].map((row, i) => (
                  <tr key={i} className="border-b border-[#A855F7]/10 hover:bg-[#A855F7]/5 transition-colors duration-200">
                    <td className="py-4 px-6 text-[#E2E8F0] font-medium">{row.feature}</td>
                    <td className="py-4 px-6 text-center">
                      {typeof row.dm === "boolean" ? (
                        row.dm ? <Check className="h-5 w-5 text-[#10B981] mx-auto drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]" /> : <X className="h-5 w-5 text-[#EF4444] mx-auto drop-shadow-[0_0_8px_rgba(239,68,68,0.5)]" />
                      ) : (
                        <span className="text-[#C084FC] font-semibold">{row.dm}</span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-center">
                      {typeof row.dv === "boolean" ? (
                        row.dv ? <Check className="h-5 w-5 text-[#10B981] mx-auto" /> : <X className="h-5 w-5 text-[#EF4444] mx-auto drop-shadow-[0_0_5px_rgba(239,68,68,0.3)]" />
                      ) : (
                        <span className="text-[#64748B]">{row.dv}</span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-center">
                      {typeof row.hg === "boolean" ? (
                        row.hg ? <Check className="h-5 w-5 text-[#10B981] mx-auto" /> : <X className="h-5 w-5 text-[#EF4444] mx-auto drop-shadow-[0_0_5px_rgba(239,68,68,0.3)]" />
                      ) : (
                        <span className="text-[#64748B]">{row.hg}</span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-center">
                      {typeof row.tr === "boolean" ? (
                        row.tr ? <Check className="h-5 w-5 text-[#10B981] mx-auto drop-shadow-[0_0_5px_rgba(16,185,129,0.3)]" /> : <X className="h-5 w-5 text-[#EF4444] mx-auto" />
                      ) : (
                        <span className="text-[#64748B]">{row.tr}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <GlowSeparator />

      {/* ══════════ SECTION 9: SOCIAL PROOF ══════════ */}
      <section className="py-24 bg-[#020817]">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <Card className="bg-[#0F0520]/30 border-[#A855F7]/20 p-8 md:p-12 relative overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(168,85,247,0.08)_0%,_transparent_70%)]" />
            <CardContent className="relative z-10">
              <p className="text-xl md:text-2xl text-[#E2E8F0] italic leading-relaxed mb-8">
                &ldquo;{t('testimonial')}&rdquo;
              </p>
              <p className="text-sm text-[#94A3B8]">{t('testimonialSub')}</p>
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center justify-center gap-6 mt-12">
            {[
              "99% Emotion Preservation",
              "SyncNet LSE-D Certified",
              "Azure Powered",
            ].map((badge, i) => (
              <Badge key={i} variant="outline" className="border-[#A855F7]/30 text-[#C084FC] px-4 py-2 shadow-[0_0_10px_rgba(168,85,247,0.15)]">
                {badge}
              </Badge>
            ))}
          </div>
        </div>
      </section>

      <GlowSeparator />

      {/* ══════════ SECTION 10: FAQ ══════════ */}
      <section id="faq" className="py-24 bg-[#1E0A3C]/10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl md:text-5xl font-bold text-center mb-16 tracking-tight text-white">{t('faqTitle')}</h2>

          <Accordion type="single" collapsible className="space-y-4">
            {[
              { q: t('faq1Q'), a: t('faq1A') },
              { q: t('faq2Q'), a: t('faq2A') },
              { q: t('faq3Q'), a: t('faq3A') },
              { q: t('faq4Q'), a: t('faq4A') },
              { q: t('faq5Q'), a: t('faq5A') },
              { q: t('faq6Q'), a: t('faq6A') },
            ].map((item, i) => (
              <AccordionItem key={i} value={`faq-${i}`} className="border border-[#A855F7]/15 rounded-lg px-6 bg-[#020817]/50 data-[state=open]:bg-[#0F0520]/30 data-[state=open]:border-[#A855F7]/30 transition-all duration-300">
                <AccordionTrigger className="text-left hover:no-underline py-6 text-white hover:text-[#C084FC] cursor-pointer [&[data-state=open]]:text-[#C084FC] transition-colors duration-300">
                  {item.q}
                </AccordionTrigger>
                <AccordionContent className="text-[#10B981] pb-6 text-base leading-relaxed drop-shadow-[0_0_8px_rgba(16,185,129,0.15)]">
                  {item.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      <GlowSeparator />

      {/* ══════════ SECTION 11: FINAL CTA ══════════ */}
      <section className="py-24 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[#020817] via-[#A855F7]/10 to-[#020817]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(168,85,247,0.1)_0%,_transparent_60%)]" />
        <Particles />

        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-5xl font-extrabold mb-6 tracking-tight">
            <span className="gradient-text-animated">{t('ctaTitle')}</span>
          </h2>
          <p className="text-xl text-[#94A3B8] mb-10">{t('ctaSub')}</p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
            <Button size="lg" className="bg-gradient-to-r from-[#A855F7] to-[#22D3EE] text-white hover:opacity-90 text-lg px-8 py-6 font-semibold btn-glow shadow-[0_0_25px_rgba(168,85,247,0.3)] cursor-pointer">
              {t('ctaPrimary')}
            </Button>
            <Button size="lg" variant="outline" className="border-[#A855F7]/30 text-[#C084FC] hover:bg-[#A855F7]/10 text-lg px-8 py-6 btn-glow cursor-pointer">
              {t('ctaSecondary')}
            </Button>
          </div>

          <p className="text-sm text-[#94A3B8]">{t('ctaNote')}</p>
        </div>
      </section>

      {/* ══════════ FOOTER ══════════ */}
      <footer className="py-16 bg-[#020817] border-t border-[#A855F7]/10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-12">
            {/* Logo */}
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 bg-gradient-to-br from-[#A855F7] to-[#22D3EE] rounded-lg flex items-center justify-center shadow-[0_0_10px_rgba(168,85,247,0.3)]">
                  <Mic2 className="h-5 w-5 text-white" />
                </div>
                <span className="text-xl font-bold text-white">DubMaster</span>
              </div>
              <p className="text-sm text-[#64748B]">{t('footerTagline')}</p>
            </div>

            {/* Links */}
            {[
              { title: t('footerProduct'), links: [
                { label: "Features", href: "#features" },
                { label: "Pricing", href: "/subscribe" },
                { label: "How It Works", href: "#how-it-works" },
              ]},
              { title: t('footerCompany'), links: [
                { label: "About", href: "#" },
                { label: "Blog", href: "#" },
                { label: "Careers", href: "#" },
              ]},
              { title: t('footerResources'), links: [
                { label: "Documentation", href: "#" },
                { label: "API Docs", href: "#" },
                { label: "Support", href: "/contact" },
                { label: "Status Page", href: "#" },
              ]},
              { title: t('footerLegal'), links: [
                { label: "Terms", href: "/terms" },
                { label: "Privacy", href: "/privacy" },
                { label: "Security", href: "#" },
              ]},
            ].map((col, i) => (
              <div key={i}>
                <h4 className="font-semibold mb-4 text-white">{col.title}</h4>
                <ul className="space-y-2">
                  {col.links.map((link, j) => (
                    <li key={j}>
                      <Link href={link.href} className="text-sm text-[#64748B] hover:text-[#C084FC] transition-colors duration-300 cursor-pointer">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="border-t border-[#A855F7]/10 pt-8 text-center text-sm text-[#64748B]">
            {t('footerCopyright')}
          </div>
        </div>
      </footer>
    </div>
  )
}
