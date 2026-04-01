"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { getAuthState } from "@/lib/auth"
import { apiGet, apiPost } from "@/lib/api-client"

type PendingPilot = {
  username:  string
  fullName:  string | null
  email:     string
  city:      string | null
  drones:    string[] | null
  part107:   boolean
  createdAt: string | null
}

export default function AdminPage() {
  const router = useRouter()
  const [pilots,   setPilots]   = useState<PendingPilot[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [approving, setApproving] = useState<string | null>(null)

  useEffect(() => {
    const auth = getAuthState()
    if (!auth || auth.role !== "admin") {
      router.replace("/map")
      return
    }
    load()
  }, [router])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await apiGet<PendingPilot[]>("/auth/pending")
      setPilots(data)
    } catch {
      setError("Failed to load pending pilots.")
    } finally {
      setLoading(false)
    }
  }

  async function approve(username: string) {
    setApproving(username)
    try {
      await apiPost(`/auth/approve/${username}`, {})
      setPilots((prev) => prev.filter((p) => p.username !== username))
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Approval failed.")
    } finally {
      setApproving(null)
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="text-xl font-bold text-white">Pilot Approvals</h1>
          <p className="text-sm text-white/40 mt-1">
            New pilot registrations waiting for admin approval
          </p>
        </div>

        {loading && (
          <div className="text-sm text-white/40">Loading…</div>
        )}

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {!loading && !error && pilots.length === 0 && (
          <div className="rounded-xl border border-white/10 bg-white/5 px-6 py-10 text-center">
            <div className="text-2xl mb-3">✓</div>
            <p className="text-sm text-white/50">No pending approvals</p>
          </div>
        )}

        <div className="space-y-3">
          {pilots.map((pilot) => (
            <div
              key={pilot.username}
              className="rounded-xl border border-white/10 bg-white/5 p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-white">
                      {pilot.fullName ?? pilot.username}
                    </span>
                    <span className="text-xs text-white/40">@{pilot.username}</span>
                    {pilot.part107 && (
                      <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-xs text-sky-400">
                        Part 107
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-white/50 space-y-0.5">
                    <div>{pilot.email}</div>
                    {pilot.city && <div>{pilot.city}</div>}
                    {pilot.drones && pilot.drones.length > 0 && (
                      <div className="text-white/30">{pilot.drones.join(", ")}</div>
                    )}
                    {pilot.createdAt && (
                      <div className="text-white/25">
                        Registered {new Date(pilot.createdAt).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => approve(pilot.username)}
                  disabled={approving === pilot.username}
                  className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {approving === pilot.username ? "Approving…" : "Approve"}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8">
          <button
            onClick={() => router.push("/map")}
            className="text-xs text-white/30 hover:text-white/60 transition-colors"
          >
            ← Back to map
          </button>
        </div>
      </div>
    </main>
  )
}
