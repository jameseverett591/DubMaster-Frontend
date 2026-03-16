"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  User, CreditCard, Settings, Crown,
  ExternalLink, Loader2, Clock, Plus, AlertTriangle, Trash2,
} from "lucide-react"
import Link from "next/link"
import { BonusMinutesDialog } from "@/components/bonus-minutes-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Header } from "@/components/header"
import type { Database } from "@/lib/supabase/types"

type Profile = Database["public"]["Tables"]["profiles"]["Row"]
type Subscription = Database["public"]["Tables"]["subscriptions"]["Row"]
type Usage = Database["public"]["Tables"]["usage"]["Row"]
type Payment = Database["public"]["Tables"]["payments"]["Row"]

const PLAN_LIMITS: Record<string, number> = { basic: 45, premium: 90, professional: -1 }
const PLAN_COLORS: Record<string, string> = {
  basic: "#22D3EE",
  premium: "#A855F7",
  professional: "#FDB022",
}

export default function AccountPage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [usage, setUsage] = useState<Usage | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [email, setEmail] = useState("")
  const [fullName, setFullName] = useState("")
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [bonusBalance, setBonusBalance] = useState(0)
  const [bonusDialogOpen, setBonusDialogOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState("")
  const [deleting, setDeleting] = useState(false)

  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push("/signin"); return }

    setEmail(user.email || "")

    const { data: profileData } = await supabase.from("profiles").select("*").eq("id", user.id).single() as { data: Profile | null }
    const { data: subData } = await supabase.from("subscriptions").select("*").eq("user_id", user.id).in("status", ["active", "trialing"]).limit(1).single() as { data: Subscription | null }
    const { data: usageData } = await supabase.from("usage").select("*").eq("user_id", user.id).order("month", { ascending: false }).limit(1).single() as { data: Usage | null }
    const { data: paymentsData } = await supabase.from("payments").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(10) as { data: Payment[] | null }

    const { data: bonusData } = await supabase.from("bonus_minutes").select("balance").eq("user_id", user.id).single() as { data: { balance: number } | null }

    if (profileData) {
      setProfile(profileData)
      setFullName(profileData.full_name || "")
    }
    if (subData) setSubscription(subData)
    if (usageData) setUsage(usageData)
    if (paymentsData) setPayments(paymentsData)
    if (bonusData) setBonusBalance(bonusData.balance)

    setLoading(false)
  }

  async function updateProfile() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    setSaving(true)
    await supabase.from("profiles").update({
      full_name: fullName,
      updated_at: new Date().toISOString(),
    }).eq("id", user.id)
    setSaving(false)
  }

  async function handleManageBilling() {
    if (!subscription?.stripe_customer_id) return
    const res = await fetch("/api/create-portal-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customer_id: subscription.stripe_customer_id }),
    })
    const { url } = await res.json()
    if (url) window.location.href = url
  }

  async function handleDeleteAccount() {
    setDeleting(true)
    try {
      const res = await fetch("/api/delete-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
      const { error } = await res.json()
      if (error) throw new Error(error)
      await supabase.auth.signOut()
      router.push("/")
      router.refresh()
    } catch (err) {
      console.error("Failed to delete account:", err)
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#020817] flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-[#A855F7] animate-spin" />
      </div>
    )
  }

  const planLimit = PLAN_LIMITS[subscription?.plan_type || "basic"] || 45
  const minutesUsed = usage?.minutes_used || 0
  const usagePercent = planLimit > 0 ? Math.min((minutesUsed / planLimit) * 100, 100) : 0
  const planColor = PLAN_COLORS[subscription?.plan_type || "basic"] || "#22D3EE"

  return (
    <div className="min-h-screen bg-[#020817] relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(168,85,247,0.08)_0%,_transparent_50%)]" />

      <Header />

      <div className="relative z-10 max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-white mb-6">Account Settings</h1>

        <Tabs defaultValue="profile" className="space-y-6">
          <TabsList className="bg-[#0F172A] border border-[#1E293B]">
            <TabsTrigger value="profile" className="data-[state=active]:bg-[#1E293B] cursor-pointer">
              <User className="h-4 w-4 mr-2" />
              Profile
            </TabsTrigger>
            <TabsTrigger value="subscription" className="data-[state=active]:bg-[#1E293B] cursor-pointer">
              <Crown className="h-4 w-4 mr-2" />
              Subscription
            </TabsTrigger>
            <TabsTrigger value="billing" className="data-[state=active]:bg-[#1E293B] cursor-pointer">
              <CreditCard className="h-4 w-4 mr-2" />
              Billing
            </TabsTrigger>
            <TabsTrigger value="settings" className="data-[state=active]:bg-[#1E293B] cursor-pointer">
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </TabsTrigger>
          </TabsList>

          {/* Profile Tab */}
          <TabsContent value="profile">
            <Card className="bg-[#0F172A]/80 border-[#1E293B]">
              <CardHeader>
                <CardTitle className="text-white">Profile Information</CardTitle>
                <CardDescription className="text-[#94A3B8]">
                  Update your personal details
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-[#94A3B8]">Email</Label>
                  <Input
                    value={email}
                    disabled
                    className="bg-[#020817] border-[#334155] text-[#64748B]"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-[#94A3B8]">Full Name</Label>
                  <Input
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="bg-[#020817] border-[#334155] text-white focus:border-[#A855F7]"
                  />
                </div>
                <Button
                  onClick={updateProfile}
                  disabled={saving}
                  className="bg-gradient-to-r from-[#A855F7] to-[#7C3AED] text-white cursor-pointer disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save Changes"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Subscription Tab */}
          <TabsContent value="subscription" className="space-y-6">
            <Card className="bg-[#0F172A]/80 border-[#1E293B]">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-white">Current Plan</CardTitle>
                    <CardDescription className="text-[#94A3B8]">
                      Manage your subscription
                    </CardDescription>
                  </div>
                  {subscription && (
                    <Badge
                      className="text-sm font-semibold capitalize"
                      style={{
                        backgroundColor: `${planColor}20`,
                        color: planColor,
                        borderColor: `${planColor}40`,
                      }}
                    >
                      {subscription.plan_type}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {subscription ? (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-[#64748B] uppercase tracking-wider">Status</p>
                        <p className="text-white capitalize mt-1">{subscription.status}</p>
                      </div>
                      <div>
                        <p className="text-xs text-[#64748B] uppercase tracking-wider">Renews</p>
                        <p className="text-white mt-1">
                          {subscription.current_period_end
                            ? new Date(subscription.current_period_end).toLocaleDateString()
                            : "—"}
                        </p>
                      </div>
                    </div>

                    {subscription.cancel_at_period_end && (
                      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-yellow-400 text-sm">
                        Your subscription will end on{" "}
                        {new Date(subscription.current_period_end!).toLocaleDateString()}.
                      </div>
                    )}

                    {/* Usage */}
                    {planLimit > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-[#94A3B8]">Monthly Usage</span>
                          <span className="text-white font-medium">
                            {minutesUsed} / {planLimit} minutes
                          </span>
                        </div>
                        <Progress value={usagePercent} className="h-2" />
                        {usagePercent >= 80 && (
                          <p className="text-yellow-400 text-xs">
                            {usagePercent >= 100
                              ? "Usage limit reached. Upgrade for more minutes."
                              : "Approaching usage limit."}
                          </p>
                        )}
                      </div>
                    )}

                    {planLimit < 0 && (
                      <p className="text-[#10B981] text-sm font-medium">
                        Unlimited usage on Professional plan
                      </p>
                    )}

                    {/* Bonus Minutes */}
                    <div className="bg-[#0F172A] rounded-lg p-4 border border-[#1E293B] space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-[#22D3EE]" />
                          <span className="text-[#94A3B8] text-sm">Bonus Minutes Banked</span>
                        </div>
                        <span className="text-[#22D3EE] font-semibold">{bonusBalance} minutes</span>
                      </div>
                      <p className="text-[#64748B] text-xs">
                        Bonus minutes never expire and carry over month-to-month. Used after your plan minutes.
                      </p>
                      <Button
                        onClick={() => setBonusDialogOpen(true)}
                        size="sm"
                        variant="outline"
                        className="border-[#22D3EE]/30 text-[#22D3EE] hover:bg-[#22D3EE]/10 cursor-pointer mt-1"
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Buy More Minutes
                      </Button>
                    </div>

                    <div className="flex gap-3">
                      <Button
                        onClick={handleManageBilling}
                        variant="outline"
                        className="border-[#334155] text-[#E2E8F0] hover:bg-[#1E293B] cursor-pointer"
                      >
                        Manage Subscription
                      </Button>
                      {subscription.plan_type !== "professional" && (
                        <Button asChild className="bg-gradient-to-r from-[#A855F7] to-[#7C3AED] text-white">
                          <Link href="/subscribe?upgrade=true">Upgrade Plan</Link>
                        </Button>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-[#94A3B8] mb-4">No active subscription</p>
                    <Button asChild className="bg-gradient-to-r from-[#A855F7] to-[#22D3EE] text-white">
                      <Link href="/subscribe">Choose a Plan</Link>
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Billing Tab */}
          <TabsContent value="billing">
            <Card className="bg-[#0F172A]/80 border-[#1E293B]">
              <CardHeader>
                <CardTitle className="text-white">Billing History</CardTitle>
                <CardDescription className="text-[#94A3B8]">
                  View your invoices and payment history
                </CardDescription>
              </CardHeader>
              <CardContent>
                {payments.length > 0 ? (
                  <div className="space-y-3">
                    {payments.map((payment) => (
                      <div
                        key={payment.id}
                        className="flex items-center justify-between py-3 border-b border-[#1E293B] last:border-0"
                      >
                        <div>
                          <p className="text-white text-sm">
                            ${(payment.amount / 100).toFixed(2)}{" "}
                            <span className="uppercase text-[#64748B]">{payment.currency}</span>
                          </p>
                          <p className="text-[#64748B] text-xs">
                            {new Date(payment.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <Badge
                            variant="outline"
                            className={
                              payment.status === "succeeded"
                                ? "border-green-500/30 text-green-400"
                                : "border-red-500/30 text-red-400"
                            }
                          >
                            {payment.status}
                          </Badge>
                          {payment.invoice_url && (
                            <a
                              href={payment.invoice_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[#C084FC] hover:text-[#A855F7]"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[#64748B] text-center py-8">No payments yet</p>
                )}

                {subscription?.stripe_customer_id && (
                  <Button
                    onClick={handleManageBilling}
                    variant="outline"
                    className="mt-4 border-[#334155] text-[#E2E8F0] hover:bg-[#1E293B] cursor-pointer"
                  >
                    <CreditCard className="h-4 w-4 mr-2" />
                    Update Payment Method
                  </Button>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings">
            <Card className="bg-[#0F172A]/80 border-[#1E293B]">
              <CardHeader>
                <CardTitle className="text-white">Preferences</CardTitle>
                <CardDescription className="text-[#94A3B8]">
                  Configure your account settings
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between py-3 border-b border-[#1E293B]">
                  <div>
                    <p className="text-white text-sm">Default target language</p>
                    <p className="text-[#64748B] text-xs">Language to dub videos into</p>
                  </div>
                  <Badge variant="outline" className="border-[#334155] text-[#94A3B8]">
                    English
                  </Badge>
                </div>
                <div className="flex items-center justify-between py-3 border-b border-[#1E293B]">
                  <div>
                    <p className="text-white text-sm">Email notifications</p>
                    <p className="text-[#64748B] text-xs">Receive emails when dubbing completes</p>
                  </div>
                  <Badge variant="outline" className="border-green-500/30 text-green-400">
                    Enabled
                  </Badge>
                </div>
              </CardContent>
            </Card>

            {/* Danger Zone */}
            <Card className="bg-[#0F172A]/80 border-red-500/30">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-red-400" />
                  <CardTitle className="text-red-400">Danger Zone</CardTitle>
                </div>
                <CardDescription className="text-[#94A3B8]">
                  Irreversible and destructive actions
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-white text-sm font-medium">Delete Account</p>
                    <p className="text-[#64748B] text-xs mt-0.5">
                      Permanently delete your account and all associated data. This cannot be undone.
                    </p>
                  </div>
                  <Button
                    onClick={() => setDeleteConfirmOpen(true)}
                    variant="outline"
                    className="border-red-500/50 text-red-400 hover:bg-red-500/10 hover:border-red-500 cursor-pointer ml-4 shrink-0"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete Account
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Delete Account Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={(open) => { setDeleteConfirmOpen(open); if (!open) setDeleteConfirmText("") }}>
        <DialogContent className="bg-[#0F172A] border-red-500/30 max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="h-5 w-5 text-red-400" />
              <DialogTitle className="text-white">Delete Account</DialogTitle>
            </div>
            <DialogDescription className="text-[#94A3B8]">
              This action is permanent and cannot be undone. All your data including projects, dubbing history, and subscription will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400">
              You will lose all your projects, dubbing history, and remaining subscription minutes.
            </div>
            <div className="space-y-2">
              <Label className="text-[#94A3B8] text-sm">
                Type <span className="text-white font-mono font-semibold">DELETE</span> to confirm
              </Label>
              <Input
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="DELETE"
                className="bg-[#020817] border-[#334155] text-white focus:border-red-500"
              />
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => { setDeleteConfirmOpen(false); setDeleteConfirmText("") }}
                className="flex-1 border-[#334155] text-[#94A3B8] hover:bg-[#1E293B] cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                onClick={handleDeleteAccount}
                disabled={deleteConfirmText !== "DELETE" || deleting}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white cursor-pointer disabled:opacity-50"
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
                {deleting ? "Deleting..." : "Delete Forever"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <BonusMinutesDialog
        open={bonusDialogOpen}
        onOpenChange={setBonusDialogOpen}
        planMinutesUsed={minutesUsed}
        planMinutesLimit={planLimit}
        bonusBalance={bonusBalance}
        planType={subscription?.plan_type}
      />
    </div>
  )
}
