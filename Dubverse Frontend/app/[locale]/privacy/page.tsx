import Link from "next/link";
import { ArrowLeft, Mic2, Shield } from "lucide-react";

export default function PrivacyPage() {
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
            <Shield className="w-6 h-6 text-[#C084FC]" />
          </div>
          <h1 className="text-4xl font-bold text-white">Privacy Policy</h1>
        </div>
        <p className="text-xs text-[#64748B] mb-6">Last updated: January 2025</p>

        <hr className="border-[#A855F7]/20 mb-8" />

        <p className="text-[#94A3B8] leading-relaxed">
          At DubMaster, we are committed to protecting your privacy and handling your personal data with
          transparency and care. This Privacy Policy explains what information we collect, how we use it,
          and the rights you have over your data when you use the DubMaster service.
        </p>

        {/* Section 1 */}
        <h2 className="text-2xl font-bold text-white mb-4 mt-10">1. Information We Collect</h2>
        <p className="text-[#94A3B8] leading-relaxed mb-4">
          We collect only the data necessary to provide and improve our service:
        </p>

        <h3 className="text-lg font-semibold text-[#C084FC] mb-2 mt-6">Account Information</h3>
        <p className="text-[#94A3B8] leading-relaxed">
          When you create an account, we collect your name, email address, and a securely hashed version
          of your password. We never store your password in plain text.
        </p>

        <h3 className="text-lg font-semibold text-[#C084FC] mb-2 mt-6">Payment Information</h3>
        <p className="text-[#94A3B8] leading-relaxed">
          Payments are processed exclusively by Stripe, our PCI-DSS compliant payment processor. DubMaster
          never stores, transmits, or has access to your card details. We only retain a Stripe customer ID
          and subscription status linked to your account.
        </p>

        <h3 className="text-lg font-semibold text-[#C084FC] mb-2 mt-6">Usage Data</h3>
        <p className="text-[#94A3B8] leading-relaxed">
          We record activity such as videos uploaded, dubbing jobs submitted, languages selected, and
          dubbing minutes consumed. This data is used to enforce plan limits and analyse service usage.
        </p>

        <h3 className="text-lg font-semibold text-[#C084FC] mb-2 mt-6">Technical Data</h3>
        <p className="text-[#94A3B8] leading-relaxed">
          We may collect your IP address, browser type, operating system, and device information for
          security, diagnostics, and fraud prevention purposes.
        </p>

        {/* Section 2 */}
        <h2 className="text-2xl font-bold text-white mb-4 mt-10">2. How We Use Your Information</h2>
        <p className="text-[#94A3B8] leading-relaxed mb-2">
          The data we collect is used solely for the following purposes:
        </p>
        <ul className="list-disc list-inside space-y-2 text-[#94A3B8] leading-relaxed">
          <li>Provide, operate, and improve the DubMaster service</li>
          <li>Process payments and manage your subscription</li>
          <li>Send transactional emails such as confirmations, receipts, and account alerts</li>
          <li>Analyse aggregate usage patterns to develop and improve features</li>
          <li>Comply with applicable legal and regulatory obligations</li>
        </ul>

        {/* Section 3 */}
        <h2 className="text-2xl font-bold text-white mb-4 mt-10">3. Data Storage &amp; Security</h2>

        <h3 className="text-lg font-semibold text-[#C084FC] mb-2 mt-6">Database</h3>
        <p className="text-[#94A3B8] leading-relaxed">
          Account and usage data is stored on Supabase (PostgreSQL) with encryption at rest and in
          transit using TLS. Access to the database is restricted to authorised personnel only.
        </p>

        <h3 className="text-lg font-semibold text-[#C084FC] mb-2 mt-6">Video Processing</h3>
        <p className="text-[#94A3B8] leading-relaxed">
          Videos are processed via secure cloud infrastructure. Uploaded files are retained only as long
          as necessary to fulfil your dubbing request, after which they are deleted from our processing
          pipeline.
        </p>

        <h3 className="text-lg font-semibold text-[#C084FC] mb-2 mt-6">Payment Security</h3>
        <p className="text-[#94A3B8] leading-relaxed">
          All payment data is handled by Stripe with full PCI-DSS compliance. We never store card numbers,
          CVVs, or any sensitive financial details on our servers.
        </p>

        <h3 className="text-lg font-semibold text-[#C084FC] mb-2 mt-6">No Data Selling</h3>
        <p className="text-[#94A3B8] leading-relaxed">
          We will never sell, rent, or trade your personal data to third parties for any purpose.
        </p>

        {/* Section 4 */}
        <h2 className="text-2xl font-bold text-white mb-4 mt-10">4. Your Rights</h2>
        <p className="text-[#94A3B8] leading-relaxed mb-2">
          You have the following rights with respect to your personal data:
        </p>
        <ul className="list-disc list-inside space-y-2 text-[#94A3B8] leading-relaxed">
          <li>
            <span className="text-white font-medium">Access &amp; Correction:</span> View and update your
            account information at any time from your account settings.
          </li>
          <li>
            <span className="text-white font-medium">Data Export:</span> Request a copy of your data by
            contacting{" "}
            <a
              href="mailto:support@dubmaster.ai"
              className="text-[#C084FC] hover:text-[#A855F7] transition-colors"
            >
              support@dubmaster.ai
            </a>
            .
          </li>
          <li>
            <span className="text-white font-medium">Marketing Opt-out:</span> Withdraw consent for
            marketing communications at any time via the unsubscribe link in any email or through account
            settings.
          </li>
          <li>
            <span className="text-white font-medium">Right to Erasure:</span> Deleting your account will
            result in the removal of all associated personal data within 30 days.
          </li>
        </ul>

        {/* Section 5 */}
        <h2 className="text-2xl font-bold text-white mb-4 mt-10">5. Cookies</h2>

        <h3 className="text-lg font-semibold text-[#C084FC] mb-2 mt-6">Essential Cookies</h3>
        <p className="text-[#94A3B8] leading-relaxed">
          We use essential cookies to maintain your authenticated session via Supabase. These cookies are
          strictly necessary for the service to function and cannot be disabled.
        </p>

        <h3 className="text-lg font-semibold text-[#C084FC] mb-2 mt-6">Third-Party Tracking</h3>
        <p className="text-[#94A3B8] leading-relaxed">
          We do not use third-party tracking or advertising cookies without your explicit consent.
        </p>

        {/* Section 6 */}
        <h2 className="text-2xl font-bold text-white mb-4 mt-10">6. Contact</h2>
        <p className="text-[#94A3B8] leading-relaxed">
          If you have any questions about this Privacy Policy or wish to make a data request, please
          contact our privacy team:
        </p>
        <p className="mt-3 text-[#94A3B8] leading-relaxed">
          Email:{" "}
          <a
            href="mailto:privacy@dubmaster.ai"
            className="text-[#C084FC] hover:text-[#A855F7] transition-colors"
          >
            privacy@dubmaster.ai
          </a>
        </p>

        <hr className="border-[#A855F7]/20 mt-16 mb-6" />
        <p className="text-xs text-[#64748B]">
          This policy may be updated from time to time. Continued use of DubMaster after changes are
          posted constitutes your acceptance of the revised policy.
        </p>
      </main>
    </div>
  );
}
