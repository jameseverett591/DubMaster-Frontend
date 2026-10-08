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
        <div className="flex items-center gap-4 mb-3">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-[#A855F7]/20 to-[#22D3EE]/20 border border-[#A855F7]/30">
            <FileText className="w-6 h-6 text-[#C084FC]" />
          </div>
          <h1 className="text-4xl font-bold text-white">Terms of Service</h1>
        </div>
        <p className="text-xs text-[#64748B] mb-6">Last updated: September 26, 2026</p>

        <hr className="border-[#A855F7]/20 mb-8" />

        <p className="text-[#94A3B8] leading-relaxed">{"Please read these Terms of Service carefully before using DubMaster."}</p>

        <h2 className="text-2xl font-bold text-white mb-4 mt-10">{"1. Acceptance of Terms"}</h2>
        <p className="text-[#94A3B8] leading-relaxed mb-3">{"By creating an account or using DubMaster, you agree to these Terms of Service and to our Privacy Policy. You must be at least 18 years old, or have a parent or guardian's consent."}</p>
        <h2 className="text-2xl font-bold text-white mb-4 mt-10">{"2. Service Description"}</h2>
        <p className="text-[#94A3B8] leading-relaxed mb-3">{"DubMaster is an AI video dubbing platform. It transcribes the speech in your video, translates it, generates dubbed voices, and produces a dubbed video that you can review and edit."}</p>
        <h2 className="text-2xl font-bold text-white mb-4 mt-10">{"3. Your Responsibilities and Your Content"}</h2>
        <ul className="list-disc pl-6 space-y-1.5 text-[#94A3B8] leading-relaxed mb-3">
          <li>{"You must own, or have the necessary rights and permissions to use, everything you upload or import."}</li>
          <li>{"YouTube: you are responsible for having the right to any YouTube video you import into DubMaster, and for complying with YouTube's Terms of Service."}</li>
          <li>{"You are responsible for your account and for activity under it."}</li>
        </ul>
        <p className="text-[#94A3B8] leading-relaxed mb-3">{"You keep ownership of your content. You grant DubMaster the limited permission needed to process it and deliver the service."}</p>
        <h2 className="text-2xl font-bold text-white mb-4 mt-10">{"4. Payments"}</h2>
        <ul className="list-disc pl-6 space-y-1.5 text-[#94A3B8] leading-relaxed mb-3">
          <li>{"Free tier: 3 minutes of rendering per month."}</li>
          <li>{"Pro: $49 per month, which includes 30 minutes per month."}</li>
          <li>{"Pay As You Go: $2.50 per minute, charged from your prepaid wallet."}</li>
          <li>{"Wallet credits are non-refundable once used."}</li>
          <li>{"The lip-sync add-on is charged when you submit it, not when it completes."}</li>
        </ul>
        <p className="text-[#94A3B8] leading-relaxed mb-3">{"Prices and included minutes may change, and changes will be shown before you pay. Payments are processed by Stripe."}</p>
        <h2 className="text-2xl font-bold text-white mb-4 mt-10">{"5. Acceptable Use"}</h2>
        <p className="text-[#94A3B8] leading-relaxed mb-3">{"You may not use DubMaster to infringe copyright or any other right, to process illegal content, to impersonate a person in a deceptive or harmful way, or to attempt to disrupt or gain unauthorized access to the service."}</p>
        <h2 className="text-2xl font-bold text-white mb-4 mt-10">{"6. Share Links"}</h2>
        <p className="text-[#94A3B8] leading-relaxed mb-3">{"Share links you create are public for 90 days. Anyone with the link can view and download the video. You are responsible for what you share."}</p>
        <h2 className="text-2xl font-bold text-white mb-4 mt-10">{"7. Service Availability"}</h2>
        <p className="text-[#94A3B8] leading-relaxed mb-3">{"DubMaster is in beta. We do not guarantee uptime or that the service will be uninterrupted or error-free. AI output, including transcripts, translations and voices, may contain mistakes, and you should review it before publishing."}</p>
        <h2 className="text-2xl font-bold text-white mb-4 mt-10">{"8. Limitation of Liability"}</h2>
        <p className="text-[#94A3B8] leading-relaxed mb-3">{"To the fullest extent permitted by law, DubMaster is provided \"as is\" without warranties of any kind, and DubMaster is not liable for indirect, incidental or consequential damages, or for lost profits or data. Our total liability for any claim is limited to the amount you paid us in the three months before the claim arose."}</p>
        <h2 className="text-2xl font-bold text-white mb-4 mt-10">{"9. Termination"}</h2>
        <p className="text-[#94A3B8] leading-relaxed mb-3">{"You may stop using DubMaster at any time. We may suspend or end accounts that violate these Terms."}</p>
        <h2 className="text-2xl font-bold text-white mb-4 mt-10">{"10. Governing Law"}</h2>
        <p className="text-[#94A3B8] leading-relaxed mb-3">{"These Terms are governed by the laws of the Commonwealth of Pennsylvania, United States, without regard to its conflict-of-law rules."}</p>
        <h2 className="text-2xl font-bold text-white mb-4 mt-10">{"11. Contact"}</h2>
        <p className="text-[#94A3B8] leading-relaxed mb-3">{"DubMaster (an unincorporated business). Questions about these Terms:"}</p>
        <p className="text-[#94A3B8] leading-relaxed mb-3">Email:{" "}<a href="mailto:james.everett.jmpl@gmail.com" className="text-[#C084FC] hover:text-[#A855F7] transition-colors">james.everett.jmpl@gmail.com</a></p>

        <hr className="border-[#A855F7]/20 mt-16 mb-6" />
        <p className="text-xs text-[#64748B]">{"We may update these Terms from time to time. The date above shows the latest revision; continued use of the service means you accept the updated Terms."}</p>
      </main>
    </div>
  );
}
