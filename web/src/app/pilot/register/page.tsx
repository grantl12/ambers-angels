"use client"

import { Suspense, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { env } from "@/lib/env"
import { setAuth } from "@/lib/auth"

function RegisterForm() {
  const router       = useRouter()
  const searchParams = useSearchParams()

  // Pre-filled from SSO redirect
  const ssoToken     = searchParams.get("sso_token") ?? ""
  const ssoEmail     = searchParams.get("email") ?? ""

  const [username,   setUsername]   = useState("")
  const [email,      setEmail]      = useState(ssoEmail)
  const [password,   setPassword]   = useState("")
  const [confirm,    setConfirm]    = useState("")
  const [fullName,   setFullName]   = useState("")
  const [city,       setCity]       = useState("")
  const [hasDrone,   setHasDrone]   = useState(false)
  const [certNumber, setCertNumber] = useState("")
  const [error,      setError]      = useState<string | null>(null)
  const [loading,    setLoading]    = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password !== confirm) { setError("Passwords do not match."); return }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return }
    setLoading(true)
    try {
      const body: Record<string, unknown> = {
        username:   username.trim().toLowerCase(),
        email:      email.trim().toLowerCase(),
        password,
        full_name:  fullName.trim() || null,
        city:       city.trim() || null,
        part107:    hasDrone,
        cert_number: certNumber.trim() || null,
      }
      if (ssoToken) body.sso_token = ssoToken

      const endpoint = ssoToken ? "/auth/sso-complete" : "/auth/register"
      const res = await fetch(`${env.apiBaseUrl}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.detail ?? "Registration failed."); return }

      setAuth({
        token:    data.access_token,
        username: data.username,
        fullName: data.full_name ?? null,
        role:     data.role,
        status:   data.status,
      })
      router.replace(data.status === "pending" ? "/login?welcome=1" : "/map")
    } catch {
      setError("Could not reach the server. Check your connection.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-2xl font-bold tracking-tight text-white mb-1">
            Amber&apos;s <span className="text-amber-400">Angels</span>
          </div>
          <div className="text-xs text-white/40 uppercase tracking-widest">Volunteer Registration</div>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
          <h1 className="text-sm font-semibold text-white/70 uppercase tracking-widest">Create Account</h1>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-white/50 mb-1.5">Username <span className="text-red-400">*</span></label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoCapitalize="none"
                  autoComplete="username"
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-white/20 focus:border-sky-500/60 focus:outline-none"
                  placeholder="johndoe"
                />
              </div>
              <div>
                <label className="block text-xs text-white/50 mb-1.5">City</label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  autoComplete="address-level2"
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-white/20 focus:border-sky-500/60 focus:outline-none"
                  placeholder="Atlanta, GA"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-white/50 mb-1.5">Full Name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-white/20 focus:border-sky-500/60 focus:outline-none"
                placeholder="John Doe"
              />
            </div>

            <div>
              <label className="block text-xs text-white/50 mb-1.5">Email <span className="text-red-400">*</span></label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                readOnly={!!ssoToken}
                autoComplete="email"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-white/20 focus:border-sky-500/60 focus:outline-none disabled:opacity-60"
                placeholder="you@example.com"
              />
            </div>

            {!ssoToken && (
              <>
                <div>
                  <label className="block text-xs text-white/50 mb-1.5">Password <span className="text-red-400">*</span></label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-white/20 focus:border-sky-500/60 focus:outline-none"
                    placeholder="Minimum 8 characters"
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/50 mb-1.5">Confirm Password <span className="text-red-400">*</span></label>
                  <input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    autoComplete="new-password"
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-white/20 focus:border-sky-500/60 focus:outline-none"
                    placeholder="••••••••"
                  />
                </div>
              </>
            )}

            {/* Optional upgrade info */}
            <div className="rounded-lg border border-white/5 bg-white/3 p-3 space-y-3">
              <p className="text-xs text-white/40 leading-relaxed">
                Optional: if you are a licensed drone pilot or work in public safety, you can provide your ID number to request an upgraded role after registration.
              </p>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hasDrone}
                  onChange={(e) => setHasDrone(e.target.checked)}
                  className="w-4 h-4 rounded border-white/20 bg-white/5 accent-sky-500"
                />
                <span className="text-xs text-white/60">I have a drone or Part 107 certificate</span>
              </label>
              {hasDrone && (
                <div>
                  <label className="block text-xs text-white/50 mb-1.5">Certificate / ID Number</label>
                  <input
                    type="text"
                    value={certNumber}
                    onChange={(e) => setCertNumber(e.target.value)}
                    autoCapitalize="characters"
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-white/20 focus:border-sky-500/60 focus:outline-none"
                    placeholder="FAA-107-XXXXXX or badge number"
                  />
                </div>
              )}
            </div>

            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-amber-500 py-2.5 text-sm font-semibold text-black hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "Creating account…" : "Create Account"}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-xs text-white/30">
          Already have an account?{" "}
          <a href="/login" className="text-sky-400 hover:text-sky-300">
            Sign in
          </a>
        </p>
      </div>
    </main>
  )
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  )
}
