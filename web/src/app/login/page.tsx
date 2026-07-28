"use client"

import { Suspense, useState, useEffect, useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { env } from "@/lib/env"
import { setAuth } from "@/lib/auth"

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (cfg: object) => void
          renderButton: (el: HTMLElement, cfg: object) => void
          prompt: () => void
        }
      }
    }
  }
}

function LoginForm() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error,    setError]    = useState<string | null>(null)
  const [loading,  setLoading]  = useState(false)
  const [pending,  setPending]  = useState(false)
  const welcome = searchParams.get("welcome") === "1"
  const expired = searchParams.get("expired") === "1"
  const from    = searchParams.get("from") ?? "/map"

  // If already logged in, bounce to map
  useEffect(() => {
    if (typeof window !== "undefined" && localStorage.getItem("aa_token")) {
      router.replace("/map")
    }
  }, [router])

  // ── SSO shared handler ────────────────────────────────────────────────────
  const handleSSOToken = useCallback(async (provider: "google", token: string) => {
    setError(null)
    setLoading(true)
    try {
      const endpoint = provider === "google" ? "/auth/google" : "/auth/apple"
      const body     = provider === "google" ? { id_token: token } : { identity_token: token }
      const res = await fetch(`${env.apiBaseUrl}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.detail ?? "SSO sign-in failed.")
        return
      }
      if (data.registration_token) {
        // New SSO user — send to registration with pre-filled email
        const params = new URLSearchParams({ sso_token: data.registration_token, email: data.email ?? "" })
        router.replace(`/pilot/register?${params}`)
        return
      }
      setAuth({
        token:    data.access_token,
        username: data.username,
        fullName: data.full_name ?? null,
        role:     data.role,
        status:   data.status,
      })
      if (data.status === "pending") { setPending(true); return }
      router.replace(from)
    } catch {
      setError("SSO sign-in failed. Please try again.")
    } finally {
      setLoading(false)
    }
  }, [router, from])

  // ── Google Identity Services button ───────────────────────────────────────
  useEffect(() => {
    if (!env.googleClientId) return
    const scriptId = "gis-script"
    if (!document.getElementById(scriptId)) {
      const s = document.createElement("script")
      s.id  = scriptId
      s.src = "https://accounts.google.com/gsi/client"
      s.async = true
      s.defer = true
      document.head.appendChild(s)
    }

    function initGoogle() {
      if (!window.google?.accounts?.id) return
      window.google.accounts.id.initialize({
        client_id: env.googleClientId,
        callback: (resp: { credential: string }) => handleSSOToken("google", resp.credential),
      })
      const btn = document.getElementById("google-signin-btn")
      if (btn) {
        window.google.accounts.id.renderButton(btn, {
          theme: "filled_black",
          size: "large",
          width: btn.offsetWidth || 320,
          text: "signin_with",
          shape: "rectangular",
        })
      }
    }

    // Script may already be loaded
    if (window.google?.accounts?.id) {
      initGoogle()
    } else {
      const s = document.getElementById(scriptId) as HTMLScriptElement | null
      if (s) s.onload = initGoogle
    }
  }, [handleSSOToken])

  // ── Email / password login ────────────────────────────────────────────────
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch(`${env.apiBaseUrl}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim().toLowerCase(), password }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.detail ?? "Login failed"); return }
      setAuth({
        token:    data.access_token,
        username: data.username,
        fullName: data.full_name ?? null,
        role:     data.role,
        status:   data.status,
      })
      if (data.status === "pending") { setPending(true); return }
      router.replace(from)
    } catch {
      setError("Could not reach the server. Check your connection.")
    } finally {
      setLoading(false)
    }
  }

  if (pending) {
    return (
      <main className="min-h-screen bg-neutral-950 flex items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-xl border border-amber-500/30 bg-amber-500/10 p-8 text-center">
          <div className="text-3xl mb-4">⏳</div>
          <h2 className="text-lg font-semibold text-amber-300 mb-2">Awaiting Approval</h2>
          <p className="text-sm text-white/50 leading-relaxed">
            Your account has been created. An admin will approve you before you can access the mission dashboard.
            Check back soon or contact your mission coordinator.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-neutral-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">

        {welcome && (
          <div className="mb-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-center text-sm text-emerald-400">
            Account created! Sign in to access the dashboard.
          </div>
        )}

        {expired && (
          <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-center text-sm text-amber-400">
            Your session expired. Sign in again to continue.
          </div>
        )}

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="text-2xl font-bold tracking-tight text-white mb-1">
            Amber&apos;s <span className="text-amber-400">Angels</span>
          </div>
          <div className="text-xs text-white/40 uppercase tracking-widest">Mission Dashboard</div>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-5">
          <h1 className="text-sm font-semibold text-white/70 uppercase tracking-widest">Sign In</h1>

          {/* Google SSO */}
          {env.googleClientId && (
            <>
              <div id="google-signin-btn" className="w-full" />
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-white/10" />
                <span className="text-xs text-white/30">or</span>
                <div className="flex-1 h-px bg-white/10" />
              </div>
            </>
          )}

          {/* Username / password */}
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs text-white/50 mb-1.5">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
                autoCapitalize="none"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-white/20 focus:border-sky-500/60 focus:outline-none"
                placeholder="your username"
              />
            </div>

            <div>
              <label className="block text-xs text-white/50 mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-white/20 focus:border-sky-500/60 focus:outline-none"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-sky-500 py-2.5 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-xs text-white/30">
          New pilot?{" "}
          <a href="/pilot/register" className="text-sky-400 hover:text-sky-300">
            Register here
          </a>
        </p>
      </div>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
