"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { getAuthState } from "@/lib/auth"
import { apiGet, apiPost } from "@/lib/api-client"

type Mission = {
  id:        string
  title:     string
  status:    string
  startedAt: string | null
  endedAt:   string | null
}

function elapsed(startedAt: string | null): string {
  if (!startedAt) return ""
  const ms = Date.now() - new Date(startedAt).getTime()
  const h  = Math.floor(ms / 3_600_000)
  const m  = Math.floor((ms % 3_600_000) / 60_000)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function fmt(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}

export default function MissionsPage() {
  const router   = useRouter()
  const [isAdmin,   setIsAdmin]   = useState(false)
  const [missions,  setMissions]  = useState<Mission[]>([])
  const [loading,   setLoading]   = useState(true)
  const [title,     setTitle]     = useState("")
  const [creating,  setCreating]  = useState(false)
  const [ending,    setEnding]    = useState<string | null>(null)
  const [showForm,  setShowForm]  = useState(false)
  const [tick,      setTick]      = useState(0)

  // refresh elapsed time every minute
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setMissions(await apiGet<Mission[]>("/missions/all"))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const auth = getAuthState()
    if (!auth) { router.replace("/login"); return }
    setIsAdmin(auth.role === "admin")
    load()
  }, [router, load])

  async function createMission(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setCreating(true)
    try {
      await apiPost("/missions", { title: title.trim() })
      setTitle("")
      setShowForm(false)
      load()
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to create mission.")
    } finally {
      setCreating(false)
    }
  }

  async function endMission(id: string, missionTitle: string) {
    if (!confirm(`End mission "${missionTitle}"?`)) return
    setEnding(id)
    try {
      await apiPost(`/missions/${id}/end`, {})
      load()
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to end mission.")
    } finally {
      setEnding(null)
    }
  }

  const active    = missions.filter((m) => m.status === "active")
  const completed = missions.filter((m) => m.status !== "active")

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10">
      <div className="max-w-3xl mx-auto space-y-8">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Missions</h1>
            <p className="text-sm text-white/40 mt-1">
              {active.length} active · {completed.length} completed
            </p>
          </div>
          {isAdmin && (
            <button
              onClick={() => setShowForm((v) => !v)}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-400 transition-colors"
            >
              {showForm ? "Cancel" : "+ New Mission"}
            </button>
          )}
        </div>

        {/* Create form */}
        {showForm && isAdmin && (
          <form onSubmit={createMission}
            className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5 space-y-3">
            <label className="block text-xs font-medium text-white/50 uppercase tracking-wider">
              Mission name
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Carroll County — April 2"
              autoFocus
              className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-amber-500/50"
            />
            <button
              type="submit"
              disabled={creating || !title.trim()}
              className="w-full rounded-lg bg-amber-500 py-2.5 text-sm font-semibold text-black hover:bg-amber-400 disabled:opacity-50 transition-colors"
            >
              {creating ? "Creating…" : "Start Mission"}
            </button>
          </form>
        )}

        {loading && <div className="text-sm text-white/40">Loading…</div>}

        {/* Active missions */}
        {active.length > 0 && (
          <section>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-500/70 mb-3">
              Active
            </p>
            <div className="space-y-2">
              {active.map((m) => (
                <div key={m.id}
                  className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                      <span className="font-semibold text-white truncate">{m.title}</span>
                    </div>
                    <div className="text-xs text-white/40 mt-1 pl-4">
                      Started {fmt(m.startedAt)}
                      {m.startedAt && (
                        <span className="ml-2 text-emerald-500/70" key={tick}>
                          · {elapsed(m.startedAt)} elapsed
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-white/20 mt-0.5 pl-4 font-mono">{m.id}</div>
                  </div>
                  {isAdmin && (
                    <button
                      onClick={() => endMission(m.id, m.title)}
                      disabled={ending === m.id}
                      className="shrink-0 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/60 hover:border-red-500/50 hover:text-red-400 disabled:opacity-40 transition-colors"
                    >
                      {ending === m.id ? "Ending…" : "End"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {!loading && active.length === 0 && (
          <div className="rounded-xl border border-white/10 bg-white/5 px-6 py-8 text-center text-sm text-white/30">
            No active missions
          </div>
        )}

        {/* Completed missions */}
        {completed.length > 0 && (
          <section>
            <p className="text-xs font-semibold uppercase tracking-widest text-white/25 mb-3">
              Completed
            </p>
            <div className="space-y-2">
              {completed.map((m) => (
                <div key={m.id}
                  className="rounded-xl border border-white/8 bg-white/3 p-4 flex items-center justify-between gap-4 opacity-60">
                  <div className="min-w-0">
                    <span className="font-medium text-white/70 truncate block">{m.title}</span>
                    <div className="text-xs text-white/30 mt-1">
                      {fmt(m.startedAt)} → {fmt(m.endedAt)}
                    </div>
                    <div className="text-xs text-white/15 mt-0.5 font-mono">{m.id}</div>
                  </div>
                  <button
                    onClick={() => router.push(`/debrief?mission=${m.id}`)}
                    className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/40 hover:text-white/70 hover:border-white/20 transition-colors"
                  >
                    Debrief →
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <button onClick={() => router.push("/map")}
          className="text-xs text-white/30 hover:text-white/60 transition-colors">
          ← Back to map
        </button>
      </div>
    </main>
  )
}
