import Link from "next/link";
import { ArrowLeft, Mic2, FileText } from "lucide-react";

export default function TermsPage() {
  return (
    <div className="relative min-h-screen bg-[#020817] text-white">
      {/* Background glow */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(168,85,247,0.08)_0%,_transparent_50%)] pointer-events-none" />

      {/* Header */}
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
          Back to Home
        </Link>
      </header>

      {/* Content */}
      <main className="relative max-w-4xl mx-auto px-6 py-16">
        {/* Page heading */}
        <div className="flex items-center gap-4 mb-3">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-[#A855F7]/20 to-[#22D3EE]/20 border border-[#A855F7]/30">
            <FileText className="w-6 h-6 text-[#C084FC]" />
          </div>
          <h1 className="text-4xl font-bold text-white">Terms of Service</h1>
        </div>
        <p className="text-xs text-[#64748B] mb-6">Last updated: January 2025</p>

        <hr className="border-[#A855F7]/20 mb-8" />

        <p className="text-[#94A3B8] leading-relaxed">
          By accessing or using DubMaster, you agree to be bound by these Terms of Service. Please read
          them carefully before using the service. If you do not agree to these terms, you may not use
          DubMaster.
        </p>

        {/* Section 1 */}
        <h2 className="text-2xl font-bold text-white mb-4 mt-10">1. Acceptance of Terms</h2>

        <h3 className="text-lg font-semibold text-[#C084FC] mb-2 mt-6">Agreement</h3>
        <p className="text-[#94A3B8] leading-relaxed">
          Using DubMaster — including browsing the platform, creating an account, or submitting any
          content — constitutes your acceptance of these Terms of Service and our Privacy Policy.
        </p>

        <h3 className="text-lg font-semibold text-[#C084FC] mb-2 mt-6">Eligibility</h3>
        <p className="text-[#94A3B8] leading-relaxed">
          You must be at least 18 years of age to use DubMaster. Users under 18 may only use the service
          with verifiable parental or guardian consent.
        </p>

        <h3 className="text-lg font-semibold text-[#C084FC] mb-2 mt-6">Commercial Use</h3>
        <p className="text-[#94A3B8] leading-relaxed">
          Use of DubMaster for commercial purposes requires an active paid subscription at the appropriate
          tier. Free plan usage is limited to personal, non-commercial projects.
        </p>

        {/* Section 2 */}
        <h2 className="text-2xl font-bold text-white mb-4 mt-10">2. Service Description</h2>

        <h3 className="text-lg font-semibold text-[#C084FC] mb-2 mt-6">What We Provide</h3>
        <p className="text-[#94A3B8] leading-relaxed">
          DubMaster provides AI-powered video dubbing and translation services, enabling users to localise
          video content into multiple languages using synthetic voice technology.
        </p>

        <h3 className="text-lg font-semibold text-[#C084FC] mb-2 mt-6">Availability</h3>
        <p className="text-[#94A3B8] leading-relaxed">
          The service is provided &quot;as-is&quot; with reasonable uptime targets. We strive for high
          availability but do not guarantee uninterrupted access. Scheduled maintenance will be communicated
          in advance where possible.
        </p>

        <h3 className="text-lg font-semibold text-[#C084FC] mb-2 mt-6">Changes to Features</h3>
        <p className="text-[#94A3B8] leading-relaxed">
          DubMaster reserves the right to modify, add, or remove features at any time. Where material
          changes affect paid subscribers, reasonable notice will be provided.
        </p>

        {/* Section 3 */}
        <h2 className="text-2xl font-bold text-white mb-4 mt-10">3. Subscription &amp; Payments</h2>

        <h3 className="text-lg font-semibold text-[#C084FC] mb-2 mt-6">Billing</h3>
        <p className="text-[#94A3B8] leading-relaxed">
          Paid subscriptions are billed on a monthly or annual basis via Stripe. By subscribing, you
          authorise DubMaster to charge your payment method at the start of each billing period.
        </p>

        <h3 className="text-lg font-semibold text-[#C084FC] mb-2 mt-6">Refund Policy</h3>
        <p className="text-[#94A3B8] leading-relaxed">
          Subscription fees are non-refundable. No refunds or credits are issued for partial months or
          unused dubbing minutes, except where required by applicable law.
        </p>

        <h3 className="text-lg font-semibold text-[#C084FC] mb-2 mt-6">Cancellation</h3>
        <p className="text-[#94A3B8] leading-relaxed">
          You may cancel your subscription at any time. Cancellation takes effect at the end of the
          current billing period; you retain access to paid features until that date.
        </p>

        <h3 className="text-lg font-semibold text-[#C084FC] mb-2 mt-6">Minute Rollover</h3>
        <p className="text-[#94A3B8] leading-relaxed">
          Unused dubbing minutes do not roll over to the next billing period unless explicitly stated in
          your plan. The Premium plan includes a rollover allowance as described on the pricing page.
        </p>

        {/* Section 4 */}
        <h2 className="text-2xl font-bold text-white mb-4 mt-10">4. Acceptable Use</h2>
        <p className="text-[#94A3B8] leading-relaxed mb-2">
          By using DubMaster, you agree to the following obligations:
        </p>
        <ul className="list-disc list-inside space-y-2 text-[#94A3B8] leading-relaxed">
          <li>
            You own or hold all necessary rights and licences to any content you upload to the platform.
          </li>
          <li>
            You will not upload or distribute content that is illegal, harmful, defamatory, obscene, or
            that infringes the intellectual property rights of any third party.
          </li>
          <li>
            You will not reverse engineer, decompile, scrape, or attempt to extract source code or model
            weights from the DubMaster platform.
          </li>
          <li>
            You will not share your account credentials with any other person or allow unauthorised access
            to your account.
          </li>
        </ul>

        {/* Section 5 */}
        <h2 className="text-2xl font-bold text-white mb-4 mt-10">5. Intellectual Property</h2>

        <h3 className="text-lg font-semibold text-[#C084FC] mb-2 mt-6">Your Content</h3>
        <p className="text-[#94A3B8] leading-relaxed">
          You retain full ownership of all content you upload and the dubbed output generated from it.
          DubMaster makes no claim of ownership over your videos or audio.
        </p>

        <h3 className="text-lg font-semibold text-[#C084FC] mb-2 mt-6">DubMaster Platform</h3>
        <p className="text-[#94A3B8] leading-relaxed">
          DubMaster retains all rights to the platform, website, software, AI models, and related
          technology. Nothing in these Terms grants you any ownership interest in the DubMaster service
          or its underlying technology.
        </p>

        <h3 className="text-lg font-semibold text-[#C084FC] mb-2 mt-6">Processing Licence</h3>
        <p className="text-[#94A3B8] leading-relaxed">
          By uploading content, you grant DubMaster a limited, non-exclusive, royalty-free licence to
          process, store, and transform your content solely for the purpose of delivering the requested
          dubbing service to you.
        </p>

        {/* Section 6 */}
        <h2 className="text-2xl font-bold text-white mb-4 mt-10">6. Limitation of Liability</h2>

        <h3 className="text-lg font-semibold text-[#C084FC] mb-2 mt-6">Translation Quality</h3>
        <p className="text-[#94A3B8] leading-relaxed">
          DubMaster applies reasonable efforts to provide accurate translations and natural-sounding dubs.
          However, we are not liable for errors, inaccuracies, or misrepresentations in AI-generated
          translations or voice output. You are responsible for reviewing output before distribution.
        </p>

        <h3 className="text-lg font-semibold text-[#C084FC] mb-2 mt-6">Liability Cap</h3>
        <p className="text-[#94A3B8] leading-relaxed">
          To the maximum extent permitted by applicable law, DubMaster&apos;s total liability to you for
          any claims arising under or in connection with these Terms shall not exceed the total fees paid
          by you to DubMaster in the three months immediately preceding the event giving rise to the claim.
        </p>

        {/* Section 7 */}
        <h2 className="text-2xl font-bold text-white mb-4 mt-10">7. Termination</h2>

        <h3 className="text-lg font-semibold text-[#C084FC] mb-2 mt-6">By DubMaster</h3>
        <p className="text-[#94A3B8] leading-relaxed">
          We reserve the right to suspend or permanently terminate accounts found to be in violation of
          these Terms of Service, with or without prior notice depending on the severity of the violation.
        </p>

        <h3 className="text-lg font-semibold text-[#C084FC] mb-2 mt-6">By You</h3>
        <p className="text-[#94A3B8] leading-relaxed">
          You may cancel and delete your account at any time through your account settings or by contacting
          our support team. Upon deletion, your data will be removed in accordance with our Privacy Policy.
        </p>

        {/* Section 8 */}
        <h2 className="text-2xl font-bold text-white mb-4 mt-10">8. Contact</h2>
        <p className="text-[#94A3B8] leading-relaxed">
          For any legal questions or concerns regarding these Terms of Service, please contact us:
        </p>
        <p className="mt-3 text-[#94A3B8] leading-relaxed">
          Email:{" "}
          <a
            href="mailto:legal@dubmaster.ai"
            className="text-[#C084FC] hover:text-[#A855F7] transition-colors"
          >
            legal@dubmaster.ai
          </a>
        </p>

        <hr className="border-[#A855F7]/20 mt-16 mb-6" />
        <p className="text-xs text-[#64748B]">
          DubMaster reserves the right to update these Terms of Service at any time. Continued use of the
          service following any changes constitutes your acceptance of the updated terms.
        </p>
      </main>
    </div>
  );
}
