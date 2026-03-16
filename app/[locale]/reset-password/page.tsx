"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Mic2,
  Lock,
  Eye,
  EyeOff,
  CheckCircle,
  Loader2,
} from "lucide-react";
import Link from "next/link";

function ResetPasswordContent() {
  const router = useRouter();
  const supabase = createClient();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setSessionReady(true);
      } else {
        setError(
          "Invalid or expired reset link. Please request a new one."
        );
      }
    };
    checkSession();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
    } else {
      setSuccess(true);
      setTimeout(() => {
        router.push("/studio");
      }, 2000);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-[#020817] flex items-center justify-center p-4">
        {/* Background glows */}
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          <div
            className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full opacity-20 blur-3xl"
            style={{
              background:
                "radial-gradient(circle, #A855F7 0%, transparent 70%)",
            }}
          />
          <div
            className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full opacity-20 blur-3xl"
            style={{
              background:
                "radial-gradient(circle, #22D3EE 0%, transparent 70%)",
            }}
          />
        </div>

        <Card className="w-full max-w-md bg-[#020817]/80 border-[#A855F7]/30 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-[#A855F7] via-[#22D3EE] to-[#A855F7]" />
          <CardContent className="flex flex-col items-center gap-4 pt-10 pb-8">
            <CheckCircle className="w-16 h-16 text-green-400" />
            <CardTitle className="text-white text-2xl font-bold">
              Password Updated!
            </CardTitle>
            <CardDescription className="text-slate-400 text-center">
              You&apos;ll be redirected to the studio shortly.
            </CardDescription>
            <Link
              href="/studio"
              className="text-[#A855F7] hover:text-[#22D3EE] transition-colors text-sm underline underline-offset-4"
            >
              Go to Studio now
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!sessionReady && !error) {
    return (
      <div className="min-h-screen bg-[#020817] flex items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-[#A855F7]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#020817] flex items-center justify-center p-4">
      {/* Background glows */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full opacity-20 blur-3xl"
          style={{
            background:
              "radial-gradient(circle, #A855F7 0%, transparent 70%)",
          }}
        />
        <div
          className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full opacity-20 blur-3xl"
          style={{
            background:
              "radial-gradient(circle, #22D3EE 0%, transparent 70%)",
          }}
        />
      </div>

      <Card className="w-full max-w-md bg-[#020817]/80 border-[#A855F7]/30 relative overflow-hidden">
        {/* Top gradient line */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-[#A855F7] via-[#22D3EE] to-[#A855F7]" />

        <CardHeader className="text-center pb-4 pt-8">
          {/* Logo */}
          <Link href="/" className="flex items-center justify-center gap-2 mb-6">
            <div className="w-10 h-10 bg-gradient-to-r from-[#A855F7] to-[#22D3EE] rounded-xl flex items-center justify-center">
              <Mic2 className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-[#A855F7] to-[#22D3EE] bg-clip-text text-transparent">
              DubMaster
            </span>
          </Link>

          <CardTitle className="text-2xl font-bold text-white">
            Set New Password
          </CardTitle>
          <CardDescription className="text-slate-400">
            Enter your new password below.
          </CardDescription>
        </CardHeader>

        <CardContent className="pb-8">
          {error && !sessionReady ? (
            <div className="flex flex-col items-center gap-4 text-center">
              <p className="text-red-400 text-sm">{error}</p>
              <Link
                href="/signin"
                className="text-[#A855F7] hover:text-[#22D3EE] transition-colors text-sm underline underline-offset-4"
              >
                Back to Sign In
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* New Password */}
              <div className="space-y-2">
                <Label htmlFor="new-password" className="text-slate-300 text-sm">
                  New Password
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    id="new-password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Min. 6 characters"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={6}
                    className="pl-10 pr-10 bg-[#0F172A] border-[#334155] text-white placeholder:text-slate-500 focus:border-[#A855F7] focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
                    tabIndex={-1}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Confirm Password */}
              <div className="space-y-2">
                <Label htmlFor="confirm-password" className="text-slate-300 text-sm">
                  Confirm Password
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    id="confirm-password"
                    type={showConfirm ? "text" : "password"}
                    placeholder="Repeat your new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={6}
                    className="pl-10 pr-10 bg-[#0F172A] border-[#334155] text-white placeholder:text-slate-500 focus:border-[#A855F7] focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
                    tabIndex={-1}
                    aria-label={showConfirm ? "Hide password" : "Show password"}
                  >
                    {showConfirm ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Inline error (form-level) */}
              {error && sessionReady && (
                <p className="text-red-400 text-sm text-center">{error}</p>
              )}

              {/* Submit */}
              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-[#A855F7] to-[#22D3EE] text-white font-semibold hover:opacity-90 transition-opacity disabled:opacity-60"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : null}
                {loading ? "Updating..." : "Update Password"}
              </Button>

              <p className="text-center text-sm text-slate-400">
                Remembered your password?{" "}
                <Link
                  href="/signin"
                  className="text-[#A855F7] hover:text-[#22D3EE] transition-colors underline underline-offset-4"
                >
                  Sign in
                </Link>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#020817] flex items-center justify-center">
          <Loader2 className="w-10 h-10 animate-spin text-[#A855F7]" />
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
