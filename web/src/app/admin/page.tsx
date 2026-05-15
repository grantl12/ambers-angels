"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { getAuthState } from "@/lib/auth"
import { apiGet, apiPost, apiDelete } from "@/lib/api-client"

// ── types ────────────────────────────────────────────────────────────────────

type CoordinatorRequest = {
  username:    string
  fullName:    string | null
  email:       string
  city:        string | null
  part107:     boolean
  requestedAt: string | null
  reason:      string | null
}

type ApprovedPilot = {
  username:          string
  fullName:          string | null
  email:             string
  city:              string | null
  role:              string
  approvedAt:        string | null
  canDispatchDrones: boolean
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

  // test discord notification
  const [notifying, setNotifying] = useState(false)
  const [notifyMsg, setNotifyMsg] = useState<string | null>(null)

  async function sendTestNotification() {
    setNotifying(true)
    setNotifyMsg(null)
    try {
      await apiPost("/fema/test", {})
      setNotifyMsg("Test notification sent — check Discord.")
    } catch (e: unknown) {
      setNotifyMsg(e instanceof Error ? e.message : "Send failed.")
    } finally {
      setNotifying(false)
    }
  }

  // test data clear
  const [clearing, setClearing] = useState(false)
  const [clearMsg, setClearMsg] = useState<string | null>(null)

  async function clearTestData() {
    if (!confirm("Delete all manual alerts, search zones, and detection events? This cannot be undone.")) return
    setClearing(true)
    setClearMsg(null)
    try {
      const res = await apiDelete<{ cleared: { watchlist: number; vehicle_targets: number; detection_events: number } }>("/admin/test-data")
      setClearMsg(`Cleared — ${res.cleared.watchlist} watchlist, ${res.cleared.vehicle_targets} zones, ${res.cleared.detection_events} detections`)
      loadManualAlerts()
      loadHealth()
    } catch (e: unknown) {
      setClearMsg(e instanceof Error ? e.message : "Clear failed.")
    } finally {
      setClearing(false)
    }
  }

  // coordinator requests
  const [coordRequests,   setCoordRequests]   = useState<CoordinatorRequest[]>([])
  const [coordLoading,    setCoordLoading]    = useState(true)
  const [coordError,      setCoordError]      = useState<string | null>(null)
  const [approvingCoord,  setApprovingCoord]  = useState<string | null>(null)
  const [denyingCoord,    setDenyingCoord]    = useState<string | null>(null)

  // approved pilots + role management
  const [approvedPilots,      setApprovedPilots]      = useState<ApprovedPilot[]>([])
  const [settingRole,         setSettingRole]          = useState<string | null>(null)

  // manual alert form
  const [form,       setForm]       = useState(BLANK_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [alertMsg,   setAlertMsg]   = useState<string | null>(null)

  // active manual alerts
  const [manualAlerts, setManualAlerts] = useState<ManualAlerts>({ plates: [], vehicles: [] })

  const loadCoordRequests = useCallback(async () => {
    setCoordLoading(true)
    setCoordError(null)
    try {
      setCoordRequests(await apiGet<CoordinatorRequest[]>("/auth/coordinator-requests"))
    } catch {
      setCoordError("Failed to load coordinator requests.")
    } finally {
      setCoordLoading(false)
    }
  }, [])

  const loadApprovedPilots = useCallback(async () => {
    try {
      setApprovedPilots(await apiGet<ApprovedPilot[]>("/auth/pilots"))
    } catch { /* silent */ }
  }, [])

  const loadManualAlerts = useCallback(async () => {
    try {
      setManualAlerts(await apiGet<ManualAlerts>("/admin/manual-alerts"))
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    const auth = getAuthState()
    if (!auth || auth.role !== "admin") { router.replace("/map"); return }
    loadCoordRequests()
    loadApprovedPilots()
    loadManualAlerts()
    loadHealth()
    const interval = setInterval(loadHealth, 10_000)
    return () => clearInterval(interval)
  }, [router, loadCoordRequests, loadApprovedPilots, loadManualAlerts, loadHealth])

  async function approveCoordinator(username: string) {
    setApprovingCoord(username)
    try {
      await apiPost(`/auth/approve-coordinator/${username}`, {})
      setCoordRequests((prev) => prev.filter((r) => r.username !== username))
      loadApprovedPilots()
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Approval failed.")
    } finally {
      setApprovingCoord(null)
    }
  }

  async function denyCoordinator(username: string) {
    if (!confirm(`Deny coordinator request from @${username}? They'll be emailed and can reapply later.`)) return
    setDenyingCoord(username)
    try {
      await apiPost(`/auth/deny-coordinator/${username}`, {})
      setCoordRequests((prev) => prev.filter((r) => r.username !== username))
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Denial failed.")
    } finally {
      setDenyingCoord(null)
    }
  }

  async function setRole(username: string, role: string) {
    setSettingRole(username)
    try {
      await apiPost(`/auth/set-role/${username}`, { role })
      setApprovedPilots((prev) =>
        prev.map((p) => p.username === username ? { ...p, role } : p)
      )
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Role update failed.")
    } finally {
      setSettingRole(null)
    }
  }

  async function setDispatchPermission(username: string, canDispatch: boolean) {
    try {
      await apiPost(`/auth/admin/pilots/${username}/permissions`, { can_dispatch_drones: canDispatch })
      setApprovedPilots((prev) =>
        prev.map((p) => p.username === username ? { ...p, canDispatchDrones: canDispatch } : p)
      )
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Permission update failed.")
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
      const res = await apiPost<{ created: string[]; expires_at: string; zone: { lat: number; lng: number } | null }>("/admin/manual-alert", {
        plate:         form.plate     || null,
        color:         form.color     || null,
        body_type:     form.body_type || null,
        make:          form.make      || null,
        area:          form.area      || null,
        description:   form.description || null,
        alert_type:    form.alert_type,
        expires_hours: form.expires_hours,
      })
      const zoneNote = res.zone ? " — zone drawn on map" : ""
      setAlertMsg(`Created: ${res.created.join(", ")}${zoneNote}`)
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

        {/* ── Test Notification ── */}
        <section className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-5 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-sky-400">Test Discord Notification</h2>
            <p className="text-xs text-white/40 mt-0.5">
              Triggers a live FEMA IPAWS poll and fires any matching alerts to Discord. Use this to verify the webhook is wired up correctly.
            </p>
          </div>
          {notifyMsg && (
            <div className={`text-xs px-3 py-2 rounded-lg ${notifyMsg.includes("sent") ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
              {notifyMsg}
            </div>
          )}
          <button
            onClick={sendTestNotification}
            disabled={notifying}
            className="rounded-lg border border-sky-500/40 px-4 py-2 text-xs font-semibold text-sky-400 hover:bg-sky-500/10 disabled:opacity-50 transition-colors"
          >
            {notifying ? "Sending…" : "Send test notification"}
          </button>
        </section>

        {/* ── Coordinator Access Requests ── */}
        <section>
          <div className="mb-5">
            <h1 className="text-xl font-bold text-white">Coordinator Requests</h1>
            <p className="text-sm text-white/40 mt-1">Pilots requesting elevated coordinator access (LEO / mission-critical roles)</p>
          </div>

          {coordLoading && <div className="text-sm text-white/40">Loading…</div>}
          {coordError   && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{coordError}</div>}
          {!coordLoading && !coordError && coordRequests.length === 0 && (
            <div className="rounded-xl border border-white/10 bg-white/5 px-6 py-8 text-center text-sm text-white/40">
              No pending coordinator requests
            </div>
          )}

          <div className="space-y-3">
            {coordRequests.map((req) => (
              <div key={req.username} className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-white">{req.fullName ?? req.username}</span>
                      <span className="text-xs text-white/40">@{req.username}</span>
                      {req.part107 && (
                        <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-xs text-sky-400">Part 107</span>
                      )}
                    </div>
                    <div className="text-xs text-white/50 space-y-0.5">
                      <div>{req.email}</div>
                      {req.city && <div>{req.city}</div>}
                      {req.reason && <div className="text-white/70 italic">&ldquo;{req.reason}&rdquo;</div>}
                      {req.requestedAt && (
                        <div className="text-white/25">Requested {new Date(req.requestedAt).toLocaleDateString()}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => denyCoordinator(req.username)}
                      disabled={denyingCoord === req.username || approvingCoord === req.username}
                      className="rounded-lg border border-white/10 px-4 py-2 text-sm font-semibold text-white/40 hover:text-white/70 hover:border-white/20 disabled:opacity-50 transition-colors"
                    >
                      {denyingCoord === req.username ? "Denying…" : "Deny"}
                    </button>
                    <button
                      onClick={() => approveCoordinator(req.username)}
                      disabled={approvingCoord === req.username || denyingCoord === req.username}
                      className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50 transition-colors"
                    >
                      {approvingCoord === req.username ? "Approving…" : "Approve as Coordinator"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Active Pilots ── */}
        {approvedPilots.length > 0 && (
          <section>
            <div className="mb-4">
              <h2 className="text-lg font-bold text-white">Active Pilots</h2>
              <p className="text-sm text-white/40 mt-1">Manage roles for approved volunteers</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 divide-y divide-white/5">
              {approvedPilots.map((pilot) => (
                <div key={pilot.username} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-white">{pilot.fullName ?? pilot.username}</span>
                    <span className="ml-2 text-xs text-white/35">@{pilot.username}</span>
                    {pilot.city && <span className="ml-2 text-xs text-white/25">{pilot.city}</span>}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {(pilot.role === "coordinator" || pilot.role === "admin") && (
                      <label className="flex items-center gap-1.5 cursor-pointer" title="Allow this coordinator to dispatch autonomous drone missions">
                        <input
                          type="checkbox"
                          checked={!!pilot.canDispatchDrones}
                          onChange={(e) => setDispatchPermission(pilot.username, e.target.checked)}
                          className="accent-amber-500 w-3.5 h-3.5"
                        />
                        <span className="text-xs text-white/40">Dispatch drones</span>
                      </label>
                    )}
                    {settingRole === pilot.username ? (
                      <span className="text-xs text-white/40">Saving…</span>
                    ) : (
                      <select
                        value={pilot.role}
                        onChange={(e) => setRole(pilot.username, e.target.value)}
                        className={`rounded-lg border px-2 py-1.5 text-xs font-semibold focus:outline-none bg-neutral-800
                          ${pilot.role === "admin"       ? "border-purple-500/40 text-purple-400" :
                            pilot.role === "coordinator" ? "border-sky-500/40 text-sky-400" :
                                                          "border-white/10 text-white/50"}`}
                      >
                        <option value="pilot">Pilot</option>
                        <option value="coordinator">Coordinator</option>
                        <option value="admin">Admin</option>
                      </select>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

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

        {/* ── Clear test data ── */}
        <section className="rounded-xl border border-red-500/20 bg-red-500/5 p-5 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-red-400">Clear Test Data</h2>
            <p className="text-xs text-white/40 mt-0.5">
              Removes all manual alerts, search zones, and detection events. Use before a live mission.
            </p>
          </div>
          {clearMsg && (
            <div className="text-xs px-3 py-2 rounded-lg bg-white/5 text-white/60">{clearMsg}</div>
          )}
          <button
            onClick={clearTestData}
            disabled={clearing}
            className="rounded-lg border border-red-500/40 px-4 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/10 disabled:opacity-50 transition-colors"
          >
            {clearing ? "Clearing…" : "Clear all test data"}
          </button>
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
