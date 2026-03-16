"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Mic2, Mail, Send, Loader2, CheckCircle, ArrowLeft } from "lucide-react"

const SUBJECT_OPTIONS = [
  "General Inquiry",
  "Technical Support",
  "Billing Question",
  "Feature Request",
  "Partnership",
  "Other",
]

export default function ContactPage() {
  const router = useRouter()

  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [subject, setSubject] = useState("")
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState("")

  const resetForm = () => {
    setName("")
    setEmail("")
    setSubject("")
    setMessage("")
    setError("")
    setSuccess(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, subject, message }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.")
      } else {
        setSuccess(true)
      }
    } catch (err) {
      setError("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen bg-[#020817] relative overflow-hidden"
      style={{ fontFamily: "inherit" }}
    >
      {/* Background glows */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at top, rgba(168,85,247,0.15) 0%, transparent 60%), radial-gradient(ellipse at bottom right, rgba(34,211,238,0.1) 0%, transparent 60%)",
        }}
      />

      {/* Sticky header */}
      <header className="sticky top-0 z-50 border-b border-[#1E293B] bg-[#020817]/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#A855F7] to-[#22D3EE] flex items-center justify-center">
              <Mic2 className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-[#A855F7] to-[#22D3EE] bg-clip-text text-transparent">
              DubMaster
            </span>
          </Link>
          <Link
            href="/"
            className="flex items-center gap-2 text-[#94A3B8] hover:text-white transition-colors text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>
        </div>
      </header>

      {/* Main content */}
      <main className="relative z-10 max-w-2xl mx-auto px-6 py-16">
        {/* Page title */}
        <div className="mb-10 text-center">
          <h1 className="text-4xl font-bold text-white mb-3">Contact Us</h1>
          <p className="text-[#94A3B8]">
            Have a question or need help? We&apos;d love to hear from you.
          </p>
        </div>

        {success ? (
          /* Success card */
          <Card className="bg-[#0F172A]/80 border-[#A855F7]/30 backdrop-blur-sm overflow-hidden">
            <div className="h-1 w-full bg-gradient-to-r from-[#A855F7] to-[#22D3EE]" />
            <CardContent className="flex flex-col items-center gap-4 py-14 px-6 text-center">
              <CheckCircle className="w-16 h-16 text-[#A855F7]" />
              <CardTitle className="text-2xl font-bold text-white">Message Sent!</CardTitle>
              <CardDescription className="text-[#94A3B8] text-base">
                We&apos;ll get back to you within 24 hours.
              </CardDescription>
              <Button
                onClick={resetForm}
                className="mt-4 bg-gradient-to-r from-[#A855F7] to-[#22D3EE] text-white font-semibold px-6"
              >
                Send Another Message
              </Button>
            </CardContent>
          </Card>
        ) : (
          /* Contact form card */
          <Card className="bg-[#0F172A]/80 border-[#A855F7]/30 backdrop-blur-sm overflow-hidden">
            <div className="h-1 w-full bg-gradient-to-r from-[#A855F7] to-[#22D3EE]" />
            <CardHeader className="px-6 pt-6 pb-2">
              <CardTitle className="text-white text-xl">Send a Message</CardTitle>
              <CardDescription className="text-[#94A3B8]">
                Fill out the form below and we&apos;ll respond as soon as possible.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-6 pb-8">
              <form onSubmit={handleSubmit} className="space-y-5">
                {/* Name */}
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-[#94A3B8]">
                    Name
                  </Label>
                  <Input
                    id="name"
                    type="text"
                    placeholder="Your full name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="bg-[#020817] border-[#334155] text-white placeholder:text-[#475569] focus:border-[#A855F7] focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                </div>

                {/* Email */}
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-[#94A3B8]">
                    Email
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="bg-[#020817] border-[#334155] text-white placeholder:text-[#475569] focus:border-[#A855F7] focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                </div>

                {/* Subject */}
                <div className="space-y-2">
                  <Label htmlFor="subject" className="text-[#94A3B8]">
                    Subject
                  </Label>
                  <Select value={subject} onValueChange={setSubject} required>
                    <SelectTrigger
                      id="subject"
                      className="bg-[#020817] border-[#334155] text-white focus:border-[#A855F7] focus:ring-0 data-[placeholder]:text-[#475569]"
                    >
                      <SelectValue placeholder="Select a subject" />
                    </SelectTrigger>
                    <SelectContent className="bg-[#0F172A] border-[#334155] text-white">
                      {SUBJECT_OPTIONS.map((option) => (
                        <SelectItem
                          key={option}
                          value={option}
                          className="focus:bg-[#1E293B] focus:text-white"
                        >
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Message */}
                <div className="space-y-2">
                  <Label htmlFor="message" className="text-[#94A3B8]">
                    Message
                  </Label>
                  <Textarea
                    id="message"
                    placeholder="Write your message here..."
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    required
                    rows={5}
                    className="bg-[#020817] border-[#334155] text-white placeholder:text-[#475569] focus:border-[#A855F7] focus-visible:ring-0 focus-visible:ring-offset-0 resize-none"
                  />
                </div>

                {/* Error */}
                {error && (
                  <p className="text-red-500 text-sm">{error}</p>
                )}

                {/* Submit */}
                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-[#A855F7] to-[#22D3EE] text-white font-semibold"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4 mr-2" />
                      Send Message
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Contact info */}
        <div className="mt-8 flex flex-col items-center gap-2 text-center">
          <div className="flex items-center gap-2 text-[#94A3B8] text-sm">
            <Mail className="w-4 h-4 text-[#A855F7]" />
            <a
              href="mailto:support@dubmaster.ai"
              className="hover:text-white transition-colors"
            >
              support@dubmaster.ai
            </a>
          </div>
          <p className="text-[#475569] text-xs">
            We typically respond within 24 hours
          </p>
        </div>
      </main>
    </div>
  )
}
