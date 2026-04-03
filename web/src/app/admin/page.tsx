"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { getAuthState } from "@/lib/auth"
import { apiGet, apiPost, apiDelete } from "@/lib/api-client"

// ── types ────────────────────────────────────────────────────────────────────

type PendingPilot = {
  username:  string
  fullName:  string | null
  email:     string
  city:      string | null
  drones:    string[] | null
  part107:   boolean
  createdAt: string | null
}

type ManualPlate = {
  plate:       string
  description: string | null
  alertType:   string
  addedAt:     string | null
}

type ManualVehicle = {
  id:        number
  headline:  string
  color:     string | null
  bodyType:  string | null
  make:      string | null
  area:      string | null
  alertType: string
  expiresAt: string | null
}

type ManualAlerts = { plates: ManualPlate[]; vehicles: ManualVehicle[] }

type SystemHealth = {
  status: string
  database: string
  worker: string
  nginx: string
  rtmp_feeds: { active: number; configured: number }
  watchlist_entries: number
  detections_last_1h: number
  last_detection_at: string | null
}

const BLANK_FORM = {
  plate: "", color: "", body_type: "", make: "",
  area: "", description: "", alert_type: "amber", expires_hours: 24,
}

// ── component ─────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const router = useRouter()

  // system health
  const [health, setHealth] = useState<SystemHealth | null>(null)

  const loadHealth = useCallback(async () => {
    try {
      setHealth(await apiGet<SystemHealth>("/health"))
    } catch { /* silent */ }
  }, [])

  // pilot approvals
  const [pilots,    setPilots]    = useState<PendingPilot[]>([])
  const [pilotsLoading, setPilotsLoading] = useState(true)
  const [pilotsError,   setPilotsError]   = useState<string | null>(null)
  const [approving, setApproving] = useState<string | null>(null)

  // manual alert form
  const [form,       setForm]       = useState(BLANK_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [alertMsg,   setAlertMsg]   = useState<string | null>(null)

  // active manual alerts
  const [manualAlerts, setManualAlerts] = useState<ManualAlerts>({ plates: [], vehicles: [] })

  const loadPilots = useCallback(async () => {
    setPilotsLoading(true)
    setPilotsError(null)
    try {
      setPilots(await apiGet<PendingPilot[]>("/auth/pending"))
    } catch {
      setPilotsError("Failed to load pending pilots.")
    } finally {
      setPilotsLoading(false)
    }
  }, [])

  const loadManualAlerts = useCallback(async () => {
    try {
      setManualAlerts(await apiGet<ManualAlerts>("/admin/manual-alerts"))
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    const auth = getAuthState()
    if (!auth || auth.role !== "admin") { router.replace("/map"); return }
    loadPilots()
    loadManualAlerts()
    loadHealth()
    const interval = setInterval(loadHealth, 10_000)
    return () => clearInterval(interval)
  }, [router, loadPilots, loadManualAlerts, loadHealth])

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

  async function submitAlert(e: React.FormEvent) {
    e.preventDefault()
    if (!form.plate && !form.color && !form.body_type && !form.make) {
      setAlertMsg("Enter a plate or at least one vehicle field.")
      return
    }
    setSubmitting(true)
    setAlertMsg(null)
    try {
      const res = await apiPost<{ created: string[]; expires_at: string }>("/admin/manual-alert", {
        plate:         form.plate     || null,
        color:         form.color     || null,
        body_type:     form.body_type || null,
        make:          form.make      || null,
        area:          form.area      || null,
        description:   form.description || null,
        alert_type:    form.alert_type,
        expires_hours: form.expires_hours,
      })
      setAlertMsg(`Created: ${res.created.join(", ")}`)
      setForm(BLANK_FORM)
      loadManualAlerts()
    } catch (e: unknown) {
      setAlertMsg(e instanceof Error ? e.message : "Failed to create alert.")
    } finally {
      setSubmitting(false)
    }
  }

  async function deletePlate(plate: string) {
    await apiDelete(`/admin/manual-alert/plate/${plate}`).catch(() => null)
    loadManualAlerts()
  }

  async function deleteVehicle(id: number) {
    await apiDelete(`/admin/manual-alert/vehicle/${id}`).catch(() => null)
    loadManualAlerts()
  }

  const field = (key: keyof typeof BLANK_FORM) => ({
    value: String(form[key]),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value })),
  })

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10">
      <div className="max-w-3xl mx-auto space-y-10">

        {/* ── System Status ── */}
        <section>
          <div className="mb-4">
            <h2 className="text-lg font-bold text-white">System Status</h2>
            <p className="text-xs text-white/40 mt-0.5">Refreshes every 10 seconds</p>
          </div>

          {!health ? (
            <div className="text-sm text-white/40">Checking…</div>
          ) : (
            <div className="rounded-xl border border-white/10 bg-white/5 divide-y divide-white/5">
              {/* Overall banner */}
              <div className={`flex items-center gap-3 px-5 py-3 rounded-t-xl ${health.status === "healthy" ? "bg-emerald-500/10" : "bg-amber-500/10"}`}>
                <span className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${health.status === "healthy" ? "bg-emerald-400" : "bg-amber-400"} shadow-[0_0_6px_2px] ${health.status === "healthy" ? "shadow-emerald-500/50" : "shadow-amber-500/50"}`} />
                <span className={`text-sm font-semibold uppercase tracking-wide ${health.status === "healthy" ? "text-emerald-400" : "text-amber-400"}`}>
                  {health.status}
                </span>
              </div>

              {/* Service rows */}
              {[
                { label: "Database",    ok: health.database === "connected" },
                { label: "Worker",      ok: health.worker   === "running"   },
                { label: "Nginx",       ok: health.nginx    === "running"   },
              ].map(({ label, ok }) => (
                <div key={label} className="flex items-center justify-between px-5 py-3">
                  <span className="text-sm text-white/70">{label}</span>
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-400" : "bg-red-400"}`} />
                    <span className={`text-xs font-medium ${ok ? "text-emerald-400" : "text-red-400"}`}>
                      {ok ? "running" : "stopped"}
                    </span>
                  </div>
                </div>
              ))}

              {/* RTMP feeds */}
              <div className="flex items-center justify-between px-5 py-3">
                <span className="text-sm text-white/70">RTMP Feeds</span>
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${health.rtmp_feeds.active > 0 ? "bg-emerald-400" : "bg-white/20"}`} />
                  <span className={`text-xs font-medium ${health.rtmp_feeds.active > 0 ? "text-emerald-400" : "text-white/40"}`}>
                    {health.rtmp_feeds.active} / {health.rtmp_feeds.configured} active
                  </span>
                </div>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 divide-x divide-white/5 rounded-b-xl">
                <div className="px-5 py-3 text-center">
                  <div className="text-lg font-bold text-white">{health.watchlist_entries}</div>
                  <div className="text-xs text-white/40 mt-0.5">Watchlist</div>
                </div>
                <div className="px-5 py-3 text-center">
                  <div className="text-lg font-bold text-white">{health.detections_last_1h}</div>
                  <div className="text-xs text-white/40 mt-0.5">Detections (1h)</div>
                </div>
                <div className="px-5 py-3 text-center">
                  <div className="text-sm font-semibold text-white truncate">
                    {health.last_detection_at
                      ? new Date(health.last_detection_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                      : "—"}
                  </div>
                  <div className="text-xs text-white/40 mt-0.5">Last Hit</div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ── Pilot Approvals ── */}
        <section>
          <div className="mb-5">
            <h1 className="text-xl font-bold text-white">Pilot Approvals</h1>
            <p className="text-sm text-white/40 mt-1">New registrations waiting for approval</p>
          </div>

          {pilotsLoading && <div className="text-sm text-white/40">Loading…</div>}
          {pilotsError   && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{pilotsError}</div>}
          {!pilotsLoading && !pilotsError && pilots.length === 0 && (
            <div className="rounded-xl border border-white/10 bg-white/5 px-6 py-8 text-center text-sm text-white/40">
              No pending approvals
            </div>
          )}

          <div className="space-y-3">
            {pilots.map((pilot) => (
              <div key={pilot.username} className="rounded-xl border border-white/10 bg-white/5 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-white">{pilot.fullName ?? pilot.username}</span>
                      <span className="text-xs text-white/40">@{pilot.username}</span>
                      {pilot.part107 && (
                        <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-xs text-sky-400">Part 107</span>
                      )}
                    </div>
                    <div className="text-xs text-white/50 space-y-0.5">
                      <div>{pilot.email}</div>
                      {pilot.city && <div>{pilot.city}</div>}
                      {pilot.drones && pilot.drones.length > 0 && (
                        <div className="text-white/30">{pilot.drones.join(", ")}</div>
                      )}
                      {pilot.createdAt && (
                        <div className="text-white/25">Registered {new Date(pilot.createdAt).toLocaleDateString()}</div>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => approve(pilot.username)}
                    disabled={approving === pilot.username}
                    className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                  >
                    {approving === pilot.username ? "Approving…" : "Approve"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Manual Alert Criteria ── */}
        <section>
          <div className="mb-5">
            <h2 className="text-lg font-bold text-white">Test Alert Criteria</h2>
            <p className="text-sm text-white/40 mt-1">
              Manually inject a plate or vehicle target — drones will treat it as a live alert
            </p>
          </div>

          <form onSubmit={submitAlert} className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-white/60 mb-1">Plate (optional)</label>
                <input {...field("plate")} placeholder="ABC1234"
                  className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-amber-500/50" />
              </div>
              <div>
                <label className="block text-xs font-medium text-white/60 mb-1">Alert type</label>
                <select {...field("alert_type")}
                  className="w-full rounded-lg bg-neutral-800 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50">
                  <option value="amber">AMBER</option>
                  <option value="silver">SILVER</option>
                  <option value="blue">BLUE</option>
                  <option value="test">TEST</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-white/60 mb-1">Color</label>
                <input {...field("color")} placeholder="Silver"
                  className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-amber-500/50" />
              </div>
              <div>
                <label className="block text-xs font-medium text-white/60 mb-1">Body type</label>
                <input {...field("body_type")} placeholder="Sedan"
                  className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-amber-500/50" />
              </div>
              <div>
                <label className="block text-xs font-medium text-white/60 mb-1">Make</label>
                <input {...field("make")} placeholder="Honda"
                  className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-amber-500/50" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-white/60 mb-1">Area / description</label>
                <input {...field("area")} placeholder="Carroll County, GA"
                  className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-amber-500/50" />
              </div>
              <div>
                <label className="block text-xs font-medium text-white/60 mb-1">Expires in (hours)</label>
                <select {...field("expires_hours")}
                  className="w-full rounded-lg bg-neutral-800 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50">
                  {[1, 4, 8, 24, 48, 72].map((h) => (
                    <option key={h} value={h}>{h}h</option>
                  ))}
                </select>
              </div>
            </div>

            {alertMsg && (
              <div className={`text-xs px-3 py-2 rounded-lg ${alertMsg.startsWith("Created") ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
                {alertMsg}
              </div>
            )}

            <button type="submit" disabled={submitting}
              className="w-full rounded-lg bg-amber-500 py-2.5 text-sm font-semibold text-black hover:bg-amber-400 disabled:opacity-50 transition-colors">
              {submitting ? "Injecting…" : "Inject Test Alert"}
            </button>
          </form>

          {/* Active manual alerts */}
          {(manualAlerts.plates.length > 0 || manualAlerts.vehicles.length > 0) && (
            <div className="mt-4 space-y-2">
              <p className="text-xs font-medium text-white/40 uppercase tracking-wider">Active test alerts</p>
              {manualAlerts.plates.map((p) => (
                <div key={p.plate} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-2">
                  <div className="text-sm text-white">
                    <span className="font-mono font-semibold">{p.plate}</span>
                    <span className="ml-2 text-xs text-white/40">{p.alertType.toUpperCase()} plate</span>
                  </div>
                  <button onClick={() => deletePlate(p.plate)}
                    className="text-xs text-red-400/60 hover:text-red-400 transition-colors">Remove</button>
                </div>
              ))}
              {manualAlerts.vehicles.map((v) => (
                <div key={v.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-2">
                  <div className="text-sm text-white">
                    <span className="font-semibold">{v.headline}</span>
                    {v.area && <span className="ml-2 text-xs text-white/40">{v.area}</span>}
                    <span className="ml-2 text-xs text-amber-500/60">{v.alertType.toUpperCase()}</span>
                  </div>
                  <button onClick={() => deleteVehicle(v.id)}
                    className="text-xs text-red-400/60 hover:text-red-400 transition-colors">Remove</button>
                </div>
              ))}
            </div>
          )}
        </section>

        <div>
          <button onClick={() => router.push("/map")}
            className="text-xs text-white/30 hover:text-white/60 transition-colors">
            ← Back to map
          </button>
        </div>
      </div>
    </main>
  )
}
