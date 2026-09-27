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
        <div className="flex items-center gap-4 mb-3">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-[#A855F7]/20 to-[#22D3EE]/20 border border-[#A855F7]/30">
            <Shield className="w-6 h-6 text-[#C084FC]" />
          </div>
          <h1 className="text-4xl font-bold text-white">Privacy Policy</h1>
        </div>
        <p className="text-xs text-[#64748B] mb-6">Last updated: September 26, 2026</p>

        <hr className="border-[#A855F7]/20 mb-8" />

        <p className="text-[#94A3B8] leading-relaxed">{"This Privacy Policy explains what information DubMaster collects, how it is used, and the choices you have."}</p>

        <h2 className="text-2xl font-bold text-white mb-4 mt-10">{"1. Information We Collect"}</h2>
        <p className="text-[#94A3B8] leading-relaxed mb-3">{"DubMaster is an AI video dubbing platform. We collect only what is needed to run it:"}</p>
        <ul className="list-disc pl-6 space-y-1.5 text-[#94A3B8] leading-relaxed mb-3">
          <li>{"Account information: your email address and the sign-in details managed by our authentication provider (Supabase), including Google sign-in if you use it."}</li>
          <li>{"Payment information: payments are processed by Stripe. We never see or store your card number. We keep a Stripe customer ID, payment amounts, and payment status."}</li>
          <li>{"Content you upload: videos and audio files, and the transcripts, translations, voice settings and dubbed videos generated from them."}</li>
          <li>{"Voice samples: if you use voice cloning, the audio samples you provide."}</li>
          <li>{"YouTube data, only if you choose to connect YouTube (see section 3)."}</li>
          <li>{"Usage information: the minutes rendered and wallet balance needed for billing."}</li>
        </ul>
        <h2 className="text-2xl font-bold text-white mb-4 mt-10">{"2. How We Use Your Information"}</h2>
        <ul className="list-disc pl-6 space-y-1.5 text-[#94A3B8] leading-relaxed mb-3">
          <li>{"To provide the dubbing service: transcribing, translating, voicing and rendering your videos."}</li>
          <li>{"To bill you and to manage your account and wallet."}</li>
          <li>{"To keep the service secure and to fix errors."}</li>
        </ul>
        <p className="text-[#94A3B8] leading-relaxed mb-3">{"We do not sell your personal information or your content, and we do not use your content to advertise to you."}</p>
        <h2 className="text-2xl font-bold text-white mb-4 mt-10">{"3. YouTube Data and Google API Services"}</h2>
        <p className="text-[#94A3B8] leading-relaxed mb-3">{"DubMaster offers an optional \"Sign in with YouTube\" feature. If you use it, we request the youtube.readonly scope, which lets DubMaster read your own YouTube channel's list of videos."}</p>
        <ul className="list-disc pl-6 space-y-1.5 text-[#94A3B8] leading-relaxed mb-3">
          <li>{"We use this only to show you the videos on your own channel and to import the ones you choose for dubbing."}</li>
          <li>{"The access token is held in your browser for the current session only. It is not sent to or stored on our servers, and it is revoked when you sign out of YouTube inside DubMaster."}</li>
          <li>{"We do not sell, share or transfer YouTube data to third parties, and we do not use it for advertising."}</li>
          <li>{"You can revoke DubMaster's access at any time at https://myaccount.google.com/permissions."}</li>
        </ul>
        <p className="text-[#94A3B8] leading-relaxed mb-3">{"DubMaster's use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements."}</p>
        <p className="text-[#94A3B8] leading-relaxed mb-3">{"Videos you import by pasting a URL are downloaded from YouTube's public pages. You are responsible for having the right to import them (see our Terms of Service)."}</p>
        <h2 className="text-2xl font-bold text-white mb-4 mt-10">{"4. Third-Party Services"}</h2>
        <p className="text-[#94A3B8] leading-relaxed mb-3">{"To deliver the service we send data to the following providers, only as needed for their function:"}</p>
        <ul className="list-disc pl-6 space-y-1.5 text-[#94A3B8] leading-relaxed mb-3">
          <li>{"Stripe: payment processing."}</li>
          <li>{"Supabase: account authentication and our database."}</li>
          <li>{"Anthropic: language models used for translation and scene summaries (transcript text)."}</li>
          <li>{"Deepgram and Speechmatics: speech recognition and speaker identification (audio)."}</li>
          <li>{"Fish Audio and ElevenLabs: synthetic voice generation and voice cloning (text and voice samples)."}</li>
          <li>{"Sync.Labs: lip-sync processing (your video and the dubbed audio)."}</li>
          <li>{"Hume: emotion analysis (audio)."}</li>
          <li>{"RunPod: GPU compute that processes your media."}</li>
          <li>{"Cloudflare R2: storage for media files."}</li>
          <li>{"Google / YouTube OAuth: optional sign-in to browse your own channel."}</li>
        </ul>
        <p className="text-[#94A3B8] leading-relaxed mb-3">{"Each provider handles data under its own terms and privacy policy."}</p>
        <h2 className="text-2xl font-bold text-white mb-4 mt-10">{"5. Data We Store and Retention"}</h2>
        <p className="text-[#94A3B8] leading-relaxed mb-3">{"We store your dubbed video outputs, project data and uploaded source files so you can return to and edit your projects. Projects are kept indefinitely. Deleting a job deletes its files, and deleting your account deletes your data."}</p>
        <p className="text-[#94A3B8] leading-relaxed mb-3">{"Payment records may be retained as required for accounting and legal obligations."}</p>
        <h2 className="text-2xl font-bold text-white mb-4 mt-10">{"6. Share Links"}</h2>
        <p className="text-[#94A3B8] leading-relaxed mb-3">{"If you choose to share a finished dub, DubMaster creates a public link that is valid for 90 days. Anyone who has the link can view and download the dubbed video. Do not share the link with anyone you do not want to have the video."}</p>
        <h2 className="text-2xl font-bold text-white mb-4 mt-10">{"7. Your Rights"}</h2>
        <ul className="list-disc pl-6 space-y-1.5 text-[#94A3B8] leading-relaxed mb-3">
          <li>{"Access: you can ask what personal data we hold about you."}</li>
          <li>{"Deletion: you can delete individual jobs, or ask us to delete your account and data."}</li>
          <li>{"Portability: you can download your finished dubs, and you can ask us for a copy of your data."}</li>
        </ul>
        <p className="text-[#94A3B8] leading-relaxed mb-3">{"To exercise these rights, contact us at the address below."}</p>
        <h2 className="text-2xl font-bold text-white mb-4 mt-10">{"8. Security"}</h2>
        <p className="text-[#94A3B8] leading-relaxed mb-3">{"We use access controls and encrypted connections to protect your data. No system is perfectly secure, and we cannot guarantee absolute security."}</p>
        <h2 className="text-2xl font-bold text-white mb-4 mt-10">{"9. Contact"}</h2>
        <p className="text-[#94A3B8] leading-relaxed mb-3">{"DubMaster (an unincorporated business). For any privacy question or request:"}</p>
        <p className="text-[#94A3B8] leading-relaxed mb-3">Email:{" "}<a href="mailto:james.everett.jmpl@gmail.com" className="text-[#C084FC] hover:text-[#A855F7] transition-colors">james.everett.jmpl@gmail.com</a></p>

        <hr className="border-[#A855F7]/20 mt-16 mb-6" />
        <p className="text-xs text-[#64748B]">{"We may update this Privacy Policy from time to time. The date above shows the latest revision; continued use of the service means you accept the updated policy."}</p>
      </main>
    </div>
  );
}
