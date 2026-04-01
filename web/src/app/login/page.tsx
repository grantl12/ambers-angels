"use client"

import { Suspense, useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { env } from "@/lib/env"
import { setAuth } from "@/lib/auth"

function LoginForm() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error,    setError]    = useState<string | null>(null)
  const [loading,  setLoading]  = useState(false)
  const [pending,  setPending]  = useState(false)

  // If already logged in, bounce to map
  useEffect(() => {
    if (typeof window !== "undefined" && localStorage.getItem("aa_token")) {
      router.replace("/map")
    }
  }, [router])

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
      if (!res.ok) {
        setError(data.detail ?? "Login failed")
        return
      }

      setAuth({
        token:    data.access_token,
        username: data.username,
        fullName: data.full_name ?? null,
        role:     data.role,
        status:   data.status,
      })

      if (data.status === "pending") {
        setPending(true)
        return
      }

      const from = searchParams.get("from") ?? "/map"
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

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="text-2xl font-bold tracking-tight text-white mb-1">
            Amber&apos;s <span className="text-amber-400">Angels</span>
          </div>
          <div className="text-xs text-white/40 uppercase tracking-widest">Mission Dashboard</div>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-6">
          <h1 className="text-sm font-semibold text-white/70 uppercase tracking-widest mb-5">Sign In</h1>

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
          <a href="/pilot/register.html" className="text-sky-400 hover:text-sky-300">
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
