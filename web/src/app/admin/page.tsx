"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { getAuthState, getToken } from "@/lib/auth"
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api-client"
import { env } from "@/lib/env"

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

type PendingPilot = {
  username:  string
  fullName:  string | null
  email:     string
  city:      string | null
  drones:    string[] | null
  part107:   boolean
  createdAt: string | null
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

type BoloSource = {
  id:             number
  name:           string
  url:            string
  source_type:    string
  state:          string | null
  css_selector:   string | null
  active:         boolean
  last_crawled_at: string | null
  created_at:     string | null
}

type ActiveAlert = {
  id:             number
  femaIdentifier: string | null
  alertType:      string
  headline:       string | null
  area:           string | null
  addedAt:        string | null
}

type AuditLogEntry = {
  id:        number
  username:  string
  action:    string
  details:   Record<string, unknown> | null
  createdAt: string
}

type SystemHealth = {
  status: string
  database: string
  worker: string
  nginx: string
  rtmp_feeds: { active: number }
  watchlist_entries: number
  detections_last_1h: number
  last_detection_at: string | null
}

const BLANK_FORM = {
  plate: "", color: "", body_type: "", make: "",
  area: "", description: "", alert_type: "amber", expires_hours: 24,
  is_demo: false,
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

  async function clearTestData(fullReset = false) {
    const msg = fullReset
      ? "FULL DEMO RESET — deletes all test data INCLUDING alerted detections. Use before CPD/RTCC presentations. Cannot be undone."
      : "Delete all test alerts, search zones, and non-alerted detections? Cannot be undone."
    if (!confirm(msg)) return
    setClearing(true)
    setClearMsg(null)
    try {
      const url = fullReset ? "/admin/test-data?full_reset=true" : "/admin/test-data"
      const res = await apiDelete<{ cleared: { watchlist: number; vehicle_targets: number; detection_events: number } }>(url)
      setClearMsg(`Cleared — ${res.cleared.watchlist} watchlist, ${res.cleared.vehicle_targets} zones, ${res.cleared.detection_events} detections`)
      loadManualAlerts()
      loadHealth()
    } catch (e: unknown) {
      setClearMsg(e instanceof Error ? e.message : "Clear failed.")
    } finally {
      setClearing(false)
    }
  }

  // pending user registrations
  const [pendingPilots,   setPendingPilots]   = useState<PendingPilot[]>([])
  const [denyingPilot,    setDenyingPilot]    = useState<string | null>(null)
  const [removingPilot,   setRemovingPilot]   = useState<string | null>(null)
  const [approvingPilot,  setApprovingPilot]  = useState<string | null>(null)

  const loadPendingPilots = useCallback(async () => {
    try {
      setPendingPilots(await apiGet<PendingPilot[]>("/auth/pending"))
    } catch { /* silent */ }
  }, [])

  async function approvePilot(username: string) {
    setApprovingPilot(username)
    try {
      await apiPost(`/auth/approve/${username}`, {})
      setPendingPilots((prev) => prev.filter((p) => p.username !== username))
      loadApprovedPilots()
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Approval failed.")
    } finally {
      setApprovingPilot(null)
    }
  }

  async function denyPilot(username: string) {
    if (!confirm(`Deny and delete registration for @${username}? This cannot be undone.`)) return
    setDenyingPilot(username)
    try {
      await apiDelete(`/auth/pending/${username}`)
      setPendingPilots((prev) => prev.filter((p) => p.username !== username))
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Deny failed.")
    } finally {
      setDenyingPilot(null)
    }
  }

  async function removePilot(username: string) {
    if (!confirm(`Remove @${username} from the platform? Their account will be deleted.`)) return
    setRemovingPilot(username)
    try {
      await apiDelete(`/auth/pilots/${username}`)
      setApprovedPilots((prev) => prev.filter((p) => p.username !== username))
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Remove failed.")
    } finally {
      setRemovingPilot(null)
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

  // active FEMA/NWS alerts + resolution
  const [activeAlerts,  setActiveAlerts]  = useState<ActiveAlert[]>([])
  const [resolvingId,   setResolvingId]   = useState<string | null>(null)
  const [resolveMsg,    setResolveMsg]    = useState<string | null>(null)

  // audit log
  const [auditLog,        setAuditLog]        = useState<AuditLogEntry[]>([])
  const [auditLoading,    setAuditLoading]    = useState(false)
  const [auditError,      setAuditError]      = useState<string | null>(null)
  const [auditLoaded,     setAuditLoaded]     = useState(false)

  // BOLO ingestor
  const [boloFile,      setBoloFile]      = useState<File | null>(null)
  const [boloUploading, setBoloUploading] = useState(false)
  const [boloResult,    setBoloResult]    = useState<{plate:string;person:string|null;case:string|null;vehicle:string|null;color:string|null;alert_type:string;headline:string|null;area:string|null} | null>(null)
  const [boloError,     setBoloError]     = useState<string | null>(null)

  // BOLO crawler sources
  const [boloSources,       setBoloSources]       = useState<BoloSource[]>([])
  const [boloSourcesLoaded, setBoloSourcesLoaded] = useState(false)
  const [newSourceName,     setNewSourceName]     = useState("")
  const [newSourceUrl,      setNewSourceUrl]      = useState("")
  const [newSourceType,     setNewSourceType]     = useState<"rss" | "html">("rss")
  const [newSourceState,    setNewSourceState]    = useState("")
  const [boloSourceMsg,     setBoloSourceMsg]     = useState<string | null>(null)

  const loadAuditLog = useCallback(async () => {
    setAuditLoading(true)
    setAuditError(null)
    try {
      setAuditLog(await apiGet<AuditLogEntry[]>("/admin/audit-log?limit=100"))
      setAuditLoaded(true)
    } catch (e: unknown) {
      setAuditError(e instanceof Error ? e.message : "Failed to load audit log.")
    } finally {
      setAuditLoading(false)
    }
  }, [])

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

  const loadActiveAlerts = useCallback(async () => {
    try {
      setActiveAlerts(await apiGet<ActiveAlert[]>("/fema/alerts"))
    } catch { /* silent */ }
  }, [])

  async function resolveAlert(femaIdentifier: string, headline: string | null) {
    const reason = prompt(`Cancel alert: "${headline ?? femaIdentifier}"\n\nEnter reason (e.g. "child found safe", "test cleanup"):`)
    if (reason === null) return
    if (!reason.trim()) { window.alert("Reason is required."); return }
    setResolvingId(femaIdentifier)
    setResolveMsg(null)
    try {
      await apiPost("/alerts/resolve", { fema_identifier: femaIdentifier, reason: reason.trim() })
      setResolveMsg(`Cancelled: ${headline ?? femaIdentifier}`)
      loadActiveAlerts()
      loadHealth()
    } catch (e: unknown) {
      setResolveMsg(e instanceof Error ? e.message : "Cancel failed.")
    } finally {
      setResolvingId(null)
    }
  }

  async function uploadBolo() {
    if (!boloFile) return
    setBoloUploading(true)
    setBoloError(null)
    setBoloResult(null)
    try {
      const form = new FormData()
      form.append("file", boloFile)
      const token = getToken()
      const res = await fetch(`${env.apiBaseUrl}/admin/ingest-bolo`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(err.detail ?? `Upload failed: ${res.status}`)
      }
      setBoloResult(await res.json())
      setBoloFile(null)
      loadActiveAlerts()
    } catch (e: unknown) {
      setBoloError(e instanceof Error ? e.message : "Upload failed")
    } finally {
      setBoloUploading(false)
    }
  }

  async function loadBoloSources() {
    try {
      const data = await apiGet<BoloSource[]>("/admin/bolo-sources")
      setBoloSources(data)
      setBoloSourcesLoaded(true)
    } catch { /* ignore */ }
  }

  async function toggleBoloSource(id: number, active: boolean) {
    try {
      await apiPatch(`/admin/bolo-sources/${id}`, { active })
      setBoloSources(prev => prev.map(s => s.id === id ? { ...s, active } : s))
    } catch (e: unknown) {
      setBoloSourceMsg(e instanceof Error ? e.message : "Update failed")
    }
  }

  async function deleteBoloSource(id: number) {
    try {
      const token = getToken()
      const res = await fetch(`${env.apiBaseUrl}/admin/bolo-sources/${id}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`)
      setBoloSources(prev => prev.filter(s => s.id !== id))
    } catch (e: unknown) {
      setBoloSourceMsg(e instanceof Error ? e.message : "Delete failed")
    }
  }

  async function addBoloSource() {
    if (!newSourceName.trim() || !newSourceUrl.trim()) return
    setBoloSourceMsg(null)
    try {
      await apiPost("/admin/bolo-sources", {
        name: newSourceName.trim(),
        url: newSourceUrl.trim(),
        source_type: newSourceType,
        state: newSourceState.trim().toUpperCase() || null,
      })
      setNewSourceName("")
      setNewSourceUrl("")
      setNewSourceState("")
      await loadBoloSources()
      setBoloSourceMsg("Source added.")
    } catch (e: unknown) {
      setBoloSourceMsg(e instanceof Error ? e.message : "Add failed")
    }
  }

  useEffect(() => {
    const auth = getAuthState()
    if (!auth || auth.role !== "admin") { router.replace("/map"); return }
    loadPendingPilots()
    loadCoordRequests()
    loadApprovedPilots()
    loadManualAlerts()
    loadActiveAlerts()
    loadHealth()
    loadBoloSources()
    const interval = setInterval(loadHealth, 10_000)
    return () => clearInterval(interval)
  }, [router, loadPendingPilots, loadCoordRequests, loadApprovedPilots, loadManualAlerts, loadActiveAlerts, loadHealth])

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
        is_demo:       form.is_demo,
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
                  <span className={`h-2 w-2 rounded-full ${health.rtmp_feeds.active > 0 ? "bg-emerald-400" : "bg-sky-400/50"}`} />
                  <span className={`text-xs font-medium ${health.rtmp_feeds.active > 0 ? "text-emerald-400" : "text-sky-400/60"}`}>
                    {health.rtmp_feeds.active > 0 ? `${health.rtmp_feeds.active} active` : "Ready"}
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

        {/* ── Active Alerts ── */}
        <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-amber-400">Active Alerts</h2>
              <p className="text-xs text-white/40 mt-0.5">
                {activeAlerts.length === 0
                  ? "No active alerts"
                  : `${activeAlerts.length} alert${activeAlerts.length !== 1 ? "s" : ""} currently active — coordinators and pilots are being notified`}
              </p>
            </div>
            <button
              onClick={loadActiveAlerts}
              className="text-xs text-white/30 hover:text-white/60 transition-colors"
            >
              Refresh
            </button>
          </div>
          {resolveMsg && (
            <div className={`text-xs px-3 py-2 rounded-lg ${resolveMsg.startsWith("Cancelled") ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
              {resolveMsg}
            </div>
          )}
          {activeAlerts.length > 0 && (
            <div className="space-y-2">
              {activeAlerts.map((fAlert) => (
                <div key={fAlert.femaIdentifier ?? fAlert.id} className="flex items-center gap-3 rounded-lg bg-white/5 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${
                        fAlert.alertType === "amber" ? "bg-amber-500/20 text-amber-400" :
                        fAlert.alertType === "silver" ? "bg-blue-400/20 text-blue-300" :
                        fAlert.alertType === "blue" ? "bg-sky-500/20 text-sky-300" :
                        "bg-white/10 text-white/60"
                      }`}>{fAlert.alertType}</span>
                      {fAlert.addedAt && (
                        <span className="text-xs text-white/25">
                          {new Date(fAlert.addedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-white/80 truncate">{fAlert.headline ?? "—"}</div>
                    {fAlert.area && <div className="text-xs text-white/40 mt-0.5">{fAlert.area}</div>}
                    {fAlert.femaIdentifier && (
                      <div className="text-xs text-white/20 mt-0.5 font-mono">{fAlert.femaIdentifier}</div>
                    )}
                  </div>
                  <button
                    onClick={() => fAlert.femaIdentifier && resolveAlert(fAlert.femaIdentifier, fAlert.headline)}
                    disabled={!fAlert.femaIdentifier || resolvingId === fAlert.femaIdentifier}
                    className="shrink-0 rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/10 disabled:opacity-40 transition-colors"
                  >
                    {resolvingId === fAlert.femaIdentifier ? "Cancelling…" : "Cancel alert"}
                  </button>
                </div>
              ))}
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

        {/* ── Pending Registrations ── */}
        {pendingPilots.length > 0 && (
          <section>
            <div className="mb-5">
              <h2 className="text-xl font-bold text-white">Pending Registrations</h2>
              <p className="text-sm text-white/40 mt-1">New volunteers waiting for approval</p>
            </div>
            <div className="space-y-3">
              {pendingPilots.map((pilot) => (
                <div key={pilot.username} className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5">
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
                          <div>{pilot.drones.join(", ")}</div>
                        )}
                        {pilot.createdAt && (
                          <div className="text-white/25">Registered {new Date(pilot.createdAt).toLocaleDateString()}</div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => denyPilot(pilot.username)}
                        disabled={denyingPilot === pilot.username || approvingPilot === pilot.username}
                        className="rounded-lg border border-red-500/40 px-3 py-2 text-sm font-semibold text-red-400 hover:bg-red-500/10 disabled:opacity-50 transition-colors"
                      >
                        {denyingPilot === pilot.username ? "Denying…" : "Deny"}
                      </button>
                      <button
                        onClick={() => approvePilot(pilot.username)}
                        disabled={approvingPilot === pilot.username || denyingPilot === pilot.username}
                        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                      >
                        {approvingPilot === pilot.username ? "Approving…" : "Approve"}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

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
                    {pilot.role !== "admin" && (
                      <button
                        onClick={() => removePilot(pilot.username)}
                        disabled={removingPilot === pilot.username}
                        className="rounded-lg border border-red-500/30 px-2 py-1.5 text-xs font-semibold text-red-400/70 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50 transition-colors"
                        title="Remove pilot from platform"
                      >
                        {removingPilot === pilot.username ? "…" : "Remove"}
                      </button>
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                  <option value="bolo">BOLO</option>
                  <option value="test">TEST</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

            {/* Demo Run toggle */}
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <div
                onClick={() => setForm((f) => ({ ...f, is_demo: !f.is_demo }))}
                className={`relative w-10 h-5 rounded-full transition-colors ${form.is_demo ? "bg-emerald-500" : "bg-white/15"}`}
              >
                <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${form.is_demo ? "translate-x-5" : "translate-x-0"}`} />
              </div>
              <span className="text-xs text-white/60">
                <span className={form.is_demo ? "text-emerald-400 font-semibold" : ""}>Demo Run</span>
                {form.is_demo && <span className="ml-1 text-emerald-400/60">— data preserved across cleanup</span>}
              </span>
            </label>

            {alertMsg && (
              <div className={`text-xs px-3 py-2 rounded-lg ${alertMsg.startsWith("Created") ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
                {alertMsg}
              </div>
            )}

            <button type="submit" disabled={submitting}
              className={`w-full rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50 transition-colors ${form.is_demo ? "bg-emerald-500 text-black hover:bg-emerald-400" : "bg-amber-500 text-black hover:bg-amber-400"}`}>
              {submitting ? "Injecting…" : form.is_demo ? "Inject Demo Alert" : "Inject Test Alert"}
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

        {/* ── BOLO Ingestor ── */}
        <section className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-5 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-sky-400">BOLO Ingestor</h2>
            <p className="text-xs text-white/40 mt-0.5">
              Upload a screenshot of a social media or law enforcement BOLO. Claude extracts the plate, vehicle, and person automatically.
            </p>
          </div>
          <label htmlFor="bolo-upload"
            className="flex items-center gap-2 cursor-pointer rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/60 hover:bg-white/10 transition-colors">
            {boloFile ? boloFile.name : "Choose screenshot…"}
          </label>
          <input id="bolo-upload" type="file" accept="image/*" className="hidden"
            onChange={(e) => { setBoloFile(e.target.files?.[0] ?? null); setBoloResult(null); setBoloError(null) }} />
          {boloFile && (
            <button onClick={uploadBolo} disabled={boloUploading}
              className="w-full rounded-lg py-2.5 text-sm font-semibold bg-sky-500 text-black hover:bg-sky-400 disabled:opacity-50 transition-colors">
              {boloUploading ? "Extracting with Claude…" : "Ingest BOLO"}
            </button>
          )}
          {boloError && (
            <div className="text-xs px-3 py-2 rounded-lg bg-red-500/10 text-red-400">{boloError}</div>
          )}
          {boloResult && (
            <div className="space-y-1 px-3 py-3 rounded-lg bg-white/5 border border-emerald-500/20 text-xs">
              <div className="font-semibold text-emerald-400 mb-2">✓ Added to watchlist</div>
              <div><span className="text-white/40">Plate </span><span className="font-mono font-bold text-white">{boloResult.plate}</span></div>
              {boloResult.person  && <div><span className="text-white/40">Person  </span><span className="text-white">{boloResult.person}</span></div>}
              {boloResult.vehicle && <div><span className="text-white/40">Vehicle </span><span className="text-white">{boloResult.vehicle}{boloResult.color ? ` · ${boloResult.color}` : ""}</span></div>}
              {boloResult.area    && <div><span className="text-white/40">Area    </span><span className="text-white">{boloResult.area}</span></div>}
              {boloResult.case    && <div><span className="text-white/40">Case    </span><span className="text-white">{boloResult.case}</span></div>}
            </div>
          )}
        </section>

        {/* ── BOLO Crawler Sources ── */}
        <section className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-5 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-sm font-semibold text-orange-400">BOLO Crawler Sources</h2>
              <p className="text-xs text-white/40 mt-0.5">
                RSS feeds and HTML pages crawled every 15 min for actionable BOLOs. Extraction runs locally — no API calls per post.
              </p>
            </div>
            {!boloSourcesLoaded && (
              <button onClick={loadBoloSources} className="text-xs text-orange-400 hover:text-orange-300">Load</button>
            )}
          </div>

          {boloSourceMsg && (
            <div className="text-xs px-3 py-2 rounded-lg bg-white/5 text-white/60">{boloSourceMsg}</div>
          )}

          {boloSourcesLoaded && (
            <div className="space-y-1.5">
              {boloSources.length === 0 && (
                <p className="text-xs text-white/30 italic">No sources configured.</p>
              )}
              {boloSources.map(src => (
                <div key={src.id}
                  className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${src.active ? "bg-emerald-400" : "bg-white/20"}`} />
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-white/80">{src.name}</span>
                    {src.state && <span className="ml-1.5 text-white/30">[{src.state}]</span>}
                    <span className="ml-1.5 text-white/25 uppercase text-[10px]">{src.source_type}</span>
                    <div className="text-white/25 truncate">{src.url}</div>
                    {src.last_crawled_at && (
                      <div className="text-white/20">Last crawled: {new Date(src.last_crawled_at).toLocaleString()}</div>
                    )}
                  </div>
                  <button onClick={() => toggleBoloSource(src.id, !src.active)}
                    className={`px-2 py-1 rounded text-[10px] font-semibold border transition-colors ${
                      src.active
                        ? "border-orange-500/30 text-orange-400 hover:bg-orange-500/10"
                        : "border-white/10 text-white/30 hover:bg-white/5"
                    }`}>
                    {src.active ? "Disable" : "Enable"}
                  </button>
                  <button onClick={() => deleteBoloSource(src.id)}
                    className="px-2 py-1 rounded text-[10px] font-semibold border border-red-500/20 text-red-400/60 hover:bg-red-500/10 transition-colors">
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2 pt-1 border-t border-white/5">
            <p className="text-xs font-semibold text-white/40">Add source</p>
            <div className="flex gap-2">
              <input
                value={newSourceName} onChange={e => setNewSourceName(e.target.value)}
                placeholder="Name (e.g. Carroll County SO)"
                className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder-white/20 focus:outline-none focus:border-orange-500/40" />
              <select value={newSourceType} onChange={e => setNewSourceType(e.target.value as "rss" | "html")}
                className="rounded-lg border border-white/10 bg-neutral-900 px-2 py-2 text-xs text-white focus:outline-none">
                <option value="rss">RSS</option>
                <option value="html">HTML</option>
              </select>
              <input
                value={newSourceState} onChange={e => setNewSourceState(e.target.value)}
                placeholder="ST"
                maxLength={2}
                className="w-12 rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-xs text-white text-center placeholder-white/20 focus:outline-none focus:border-orange-500/40" />
            </div>
            <div className="flex gap-2">
              <input
                value={newSourceUrl} onChange={e => setNewSourceUrl(e.target.value)}
                placeholder="https://…"
                className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder-white/20 focus:outline-none focus:border-orange-500/40" />
              <button onClick={addBoloSource} disabled={!newSourceName.trim() || !newSourceUrl.trim()}
                className="rounded-lg px-4 py-2 text-xs font-semibold bg-orange-500 text-black hover:bg-orange-400 disabled:opacity-40 transition-colors">
                Add
              </button>
            </div>
          </div>
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
          <div className="flex gap-2">
            <button
              onClick={() => clearTestData(false)}
              disabled={clearing}
              className="rounded-lg border border-red-500/40 px-4 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/10 disabled:opacity-50 transition-colors"
            >
              {clearing ? "Clearing…" : "Clear test data"}
            </button>
            <button
              onClick={() => clearTestData(true)}
              disabled={clearing}
              className="rounded-lg border border-red-700/60 bg-red-900/20 px-4 py-2 text-xs font-semibold text-red-300 hover:bg-red-700/20 disabled:opacity-50 transition-colors"
            >
              Full Demo Reset
            </button>
          </div>
          <p className="text-xs text-red-400/50">Full Demo Reset also wipes alerted detections — use before CPD/RTCC presentations.</p>
        </section>

        {/* ── Audit Log ── */}
        <section>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-white">Audit Log</h2>
              <p className="text-sm text-white/40 mt-1">Last 100 actions across all users</p>
            </div>
            <button
              onClick={loadAuditLog}
              disabled={auditLoading}
              className="rounded-lg border border-white/10 px-4 py-2 text-xs font-semibold text-white/50 hover:text-white/80 hover:border-white/20 disabled:opacity-50 transition-colors"
            >
              {auditLoading ? "Loading…" : auditLoaded ? "Refresh" : "Load"}
            </button>
          </div>

          {auditError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400 mb-4">
              {auditError}
            </div>
          )}

          {!auditLoaded && !auditLoading && !auditError && (
            <div className="rounded-xl border border-white/10 bg-white/5 px-6 py-8 text-center text-sm text-white/40">
              Click &ldquo;Load&rdquo; to fetch the audit log.
            </div>
          )}

          {auditLoaded && auditLog.length === 0 && (
            <div className="rounded-xl border border-white/10 bg-white/5 px-6 py-8 text-center text-sm text-white/40">
              No audit log entries found.
            </div>
          )}

          {auditLoaded && auditLog.length > 0 && (
            <div className="rounded-xl border border-white/10 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-white/5 border-b border-white/10">
                    <th className="text-left px-4 py-2.5 font-semibold text-white/50 w-40">Timestamp</th>
                    <th className="text-left px-4 py-2.5 font-semibold text-white/50 w-32">User</th>
                    <th className="text-left px-4 py-2.5 font-semibold text-white/50 w-40">Action</th>
                    <th className="text-left px-4 py-2.5 font-semibold text-white/50">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {auditLog.map((entry) => (
                    <tr key={entry.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-2.5 text-white/35 font-mono whitespace-nowrap">
                        {new Date(entry.createdAt).toLocaleString([], {
                          month: "2-digit",
                          day:   "2-digit",
                          hour:  "2-digit",
                          minute:"2-digit",
                          second:"2-digit",
                        })}
                      </td>
                      <td className="px-4 py-2.5 text-sky-400 font-medium whitespace-nowrap">
                        @{entry.username}
                      </td>
                      <td className="px-4 py-2.5 text-amber-400/80 whitespace-nowrap">
                        {entry.action}
                      </td>
                      <td className="px-4 py-2.5 text-white/40 font-mono break-all">
                        {entry.details ? JSON.stringify(entry.details) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
