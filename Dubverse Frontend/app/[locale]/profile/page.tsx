"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Header } from "@/components/header"
import {
  Camera, Loader2, Crown, Clock, Settings,
  Mail, CalendarDays, Pencil, Check, X,
  Phone, MapPin, Lock, Eye, EyeOff,
} from "lucide-react"
import Link from "next/link"
import type { Database } from "@/lib/supabase/types"
import { PLAN_MINUTES, PLAN_MINUTES_DEFAULT, type PlanType } from "@/lib/plan-features"
import { useT } from '@/lib/use-t'

type Profile = Database["public"]["Tables"]["profiles"]["Row"]
type Subscription = Database["public"]["Tables"]["subscriptions"]["Row"]
type Usage = Database["public"]["Tables"]["usage"]["Row"]

const PLAN_COLORS: Record<string, string> = {
  basic: "#22D3EE",
  premium: "#A855F7",
  professional: "#FDB022",
}


export default function ProfilePage() {
  const t = useT()
  const [profile, setProfile]           = useState<Profile | null>(null)
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [usage, setUsage]               = useState<Usage | null>(null)
  const [email, setEmail]               = useState("")
  const [memberSince, setMemberSince]   = useState("")

  // Name
  const [fullName, setFullName]         = useState("")
  const [editingName, setEditingName]   = useState(false)
  const [draftName, setDraftName]       = useState("")
  const [savingName, setSavingName]     = useState(false)

  // Avatar
  const [avatarUrl, setAvatarUrl]         = useState<string | null>(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Contact info
  const [phone, setPhone]               = useState("")
  const [address, setAddress]           = useState("")
  const [savingContact, setSavingContact] = useState(false)
  const [contactSaved, setContactSaved] = useState(false)

  // Password
  const [newPassword, setNewPassword]         = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showNew, setShowNew]                 = useState(false)
  const [showConfirm, setShowConfirm]         = useState(false)
  const [savingPassword, setSavingPassword]   = useState(false)
  const [passwordMsg, setPasswordMsg]         = useState<{ ok: boolean; text: string } | null>(null)

  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push("/signin"); return }

    setEmail(user.email || "")
    if (user.created_at) {
      setMemberSince(new Date(user.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" }))
    }

    const meta = (user.user_metadata || {}) as Record<string, string>
    setPhone(meta.phone || "")
    setAddress(meta.address || "")

    const [{ data: profileData }, { data: subData }, { data: usageData }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase.from("subscriptions").select("*").eq("user_id", user.id).in("status", ["active", "trialing"]).limit(1).single(),
      supabase.from("usage").select("*").eq("user_id", user.id).order("month", { ascending: false }).limit(1).single(),
    ])

    if (profileData) {
      setProfile(profileData as Profile)
      setFullName(profileData.full_name || "")
      setAvatarUrl(profileData.avatar_url || null)
    }
    if (subData) setSubscription(subData as Subscription)
    if (usageData) setUsage(usageData as Usage)

    setLoading(false)
  }

  async function saveName() {
    if (!profile) return
    setSavingName(true)
    await supabase.from("profiles").update({ full_name: draftName, updated_at: new Date().toISOString() }).eq("id", profile.id)
    setFullName(draftName)
    setEditingName(false)
    setSavingName(false)
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !profile) return
    setUploadingAvatar(true)
    const ext = file.name.split(".").pop()
    const path = `${profile.id}/avatar.${ext}`
    const { error: uploadError } = await supabase.storage.from("avatars").upload(path, file, { upsert: true })
    if (!uploadError) {
      const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(path)
      await supabase.from("profiles").update({ avatar_url: publicUrl, updated_at: new Date().toISOString() }).eq("id", profile.id)
      setAvatarUrl(publicUrl + `?t=${Date.now()}`)
    }
    setUploadingAvatar(false)
  }

  async function saveContact() {
    setSavingContact(true)
    await supabase.auth.updateUser({ data: { phone, address } })
    setSavingContact(false)
    setContactSaved(true)
    setTimeout(() => setContactSaved(false), 2500)
  }

  async function changePassword() {
    setPasswordMsg(null)
    if (newPassword.length < 8) {
      setPasswordMsg({ ok: false, text: "Password must be at least 8 characters." })
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ ok: false, text: "Passwords do not match." })
      return
    }
    setSavingPassword(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setSavingPassword(false)
    if (error) {
      setPasswordMsg({ ok: false, text: error.message })
    } else {
      setNewPassword("")
      setConfirmPassword("")
      setPasswordMsg({ ok: true, text: "Password updated successfully." })
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#020817] flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-[#A855F7] animate-spin" />
      </div>
    )
  }

  const planType   = subscription?.plan_type || "basic"
  const planColor  = PLAN_COLORS[planType] || "#22D3EE"
  const planLimit  = PLAN_MINUTES[planType as PlanType] ?? PLAN_MINUTES_DEFAULT
  const minutesUsed = usage?.minutes_used || 0
  const usagePct   = planLimit > 0 ? Math.min((minutesUsed / planLimit) * 100, 100) : 0

  const initials = fullName
    ? fullName.trim().split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()
    : email.slice(0, 2).toUpperCase()

  return (
    <div className="min-h-screen bg-[#020817] relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(168,85,247,0.08)_0%,_transparent_50%)]" />
      <Header />

      <div className="relative z-10 max-w-3xl mx-auto px-4 py-10 space-y-6">

        {/* ── Hero card ── */}
        <div className="bg-[#0F172A]/80 border border-[#1E293B] rounded-2xl p-8">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">

            {/* Avatar */}
            <div className="relative shrink-0">
              <div className="w-24 h-24 rounded-full overflow-hidden bg-gradient-to-br from-[#A855F7] to-[#22D3EE] flex items-center justify-center text-2xl font-bold text-white">
                {avatarUrl
                  ? <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" />
                  : initials}
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingAvatar}
                className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-[#A855F7] flex items-center justify-center hover:bg-[#9333EA] transition-colors shadow-lg"
                title={t('Change photo')}
              >
                {uploadingAvatar
                  ? <Loader2 className="h-3.5 w-3.5 text-white animate-spin" />
                  : <Camera className="h-3.5 w-3.5 text-white" />}
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
            </div>

            {/* Name + meta */}
            <div className="flex-1 text-center sm:text-left space-y-2">
              {editingName ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={draftName}
                    onChange={e => setDraftName(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setEditingName(false) }}
                    className="bg-[#020817] border-[#A855F7]/50 text-white text-xl font-bold h-10 w-52"
                    autoFocus
                  />
                  <button onClick={saveName} disabled={savingName} className="text-[#22D3EE] hover:text-white transition-colors">
                    {savingName ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  </button>
                  <button onClick={() => setEditingName(false)} className="text-[#64748B] hover:text-white transition-colors">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 justify-center sm:justify-start">
                  <h1 className="text-2xl font-bold text-white">{fullName || "Unnamed Creator"}</h1>
                  <button
                    onClick={() => { setDraftName(fullName); setEditingName(true) }}
                    className="text-[#64748B] hover:text-[#C084FC] transition-colors"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 justify-center sm:justify-start">
                <Badge
                  className="capitalize text-xs font-semibold"
                  style={{ backgroundColor: `${planColor}20`, color: planColor, borderColor: `${planColor}40` }}
                >
                  <Crown className="h-3 w-3 mr-1" />{planType}
                </Badge>
                <span className="text-[#64748B] text-sm flex items-center gap-1">
                  <Mail className="h-3.5 w-3.5" />{email}
                </span>
                {memberSince && (
                  <span className="text-[#64748B] text-sm flex items-center gap-1">
                    <CalendarDays className="h-3.5 w-3.5" />Member since {memberSince}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Contact info ── */}
        <div className="bg-[#0F172A]/80 border border-[#1E293B] rounded-2xl p-6 space-y-5">
          <h2 className="text-white font-semibold">{t('Contact Information')}</h2>

          <div className="space-y-2">
            <Label className="text-[#94A3B8] flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5" />{t('Phone Number')}
            </Label>
            <Input
              type="tel"
              placeholder="+1 555 000 0000"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              className="bg-[#020817] border-[#334155] text-white focus:border-[#A855F7] placeholder:text-[#334155]"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-[#94A3B8] flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />{t('Address')}
            </Label>
            <Input
              type="text"
              placeholder="123 Main St, City, Country"
              value={address}
              onChange={e => setAddress(e.target.value)}
              className="bg-[#020817] border-[#334155] text-white focus:border-[#A855F7] placeholder:text-[#334155]"
            />
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={saveContact}
              disabled={savingContact}
              className="bg-gradient-to-r from-[#A855F7] to-[#7C3AED] text-white disabled:opacity-50"
            >
              {savingContact ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {savingContact ? "Saving…" : "Save Contact Info"}
            </Button>
            {contactSaved && (
              <span className="text-[#10B981] text-sm flex items-center gap-1">
                <Check className="h-4 w-4" />{t('Saved')}
              </span>
            )}
          </div>
        </div>

        {/* ── Password ── */}
        <div className="bg-[#0F172A]/80 border border-[#1E293B] rounded-2xl p-6 space-y-5">
          <h2 className="text-white font-semibold flex items-center gap-2">
            <Lock className="h-4 w-4 text-[#A855F7]" />{t('Change Password')}
          </h2>

          <div className="space-y-2">
            <Label className="text-[#94A3B8]">{t('New Password')}</Label>
            <div className="relative">
              <Input
                type={showNew ? "text" : "password"}
                placeholder={t('Min 8 characters')}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className="bg-[#020817] border-[#334155] text-white focus:border-[#A855F7] pr-10 placeholder:text-[#334155]"
              />
              <button
                type="button"
                onClick={() => setShowNew(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-[#94A3B8]"
              >
                {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-[#94A3B8]">{t('Confirm New Password')}</Label>
            <div className="relative">
              <Input
                type={showConfirm ? "text" : "password"}
                placeholder={t('Repeat password')}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") changePassword() }}
                className="bg-[#020817] border-[#334155] text-white focus:border-[#A855F7] pr-10 placeholder:text-[#334155]"
              />
              <button
                type="button"
                onClick={() => setShowConfirm(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-[#94A3B8]"
              >
                {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {passwordMsg && (
            <p className={`text-sm flex items-center gap-1.5 ${passwordMsg.ok ? "text-[#10B981]" : "text-red-400"}`}>
              {passwordMsg.ok ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
              {passwordMsg.text}
            </p>
          )}

          <Button
            onClick={changePassword}
            disabled={savingPassword || !newPassword}
            className="bg-gradient-to-r from-[#A855F7] to-[#7C3AED] text-white disabled:opacity-50"
          >
            {savingPassword ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Lock className="h-4 w-4 mr-2" />}
            {savingPassword ? "Updating…" : "Update Password"}
          </Button>
        </div>

        {/* ── Usage card ── */}
        <div className="bg-[#0F172A]/80 border border-[#1E293B] rounded-2xl p-6 space-y-4">
          <h2 className="text-white font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4 text-[#22D3EE]" />{t("This Month's Usage")}
          </h2>

          {planLimit > 0 ? (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-[#94A3B8]">{t('Minutes dubbed')}</span>
                <span className="text-white font-medium">{minutesUsed} / {planLimit} min</span>
              </div>
              <Progress value={usagePct} className="h-2" />
              {usagePct >= 80 && (
                <p className="text-yellow-400 text-xs">
                  {usagePct >= 100 ? t('Limit reached — upgrade for more.') : t('Approaching your monthly limit.')}
                </p>
              )}
            </div>
          ) : (
            <p className="text-[#10B981] text-sm font-medium">{t('Unlimited usage on Professional plan')}</p>
          )}

          {planType !== "professional" && (
            <Button asChild size="sm" className="bg-gradient-to-r from-[#A855F7] to-[#7C3AED] text-white">
              <Link href="/subscribe?upgrade=true">
                <Crown className="h-3.5 w-3.5 mr-1.5" />{t('Upgrade Plan')}
              </Link>
            </Button>
          )}
        </div>

        {/* ── Quick links ── */}
        <div className="bg-[#0F172A]/80 border border-[#1E293B] rounded-2xl p-6">
          <h2 className="text-white font-semibold mb-4">{t('Quick Links')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Link
              href="/account"
              className="flex items-center gap-3 p-3 rounded-xl border border-[#1E293B] hover:border-[#A855F7]/40 hover:bg-[#A855F7]/5 transition-all text-[#94A3B8] hover:text-[#C084FC]"
            >
              <Settings className="h-4 w-4 shrink-0" />
              <div>
                <p className="text-sm font-medium">{t('Account Settings')}</p>
                <p className="text-xs text-[#64748B]">{t('Billing, subscription, preferences')}</p>
              </div>
            </Link>
            <Link
              href="/studio"
              className="flex items-center gap-3 p-3 rounded-xl border border-[#1E293B] hover:border-[#22D3EE]/40 hover:bg-[#22D3EE]/5 transition-all text-[#94A3B8] hover:text-[#22D3EE]"
            >
              <Crown className="h-4 w-4 shrink-0" />
              <div>
                <p className="text-sm font-medium">{t('Studio')}</p>
                <p className="text-xs text-[#64748B]">{t('Your dubbing projects')}</p>
              </div>
            </Link>
          </div>
        </div>

      </div>
    </div>
  )
}
