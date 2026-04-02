"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { getAuthState, setAuth } from "@/lib/auth"
import { apiGet, apiPatch } from "@/lib/api-client"

type Pilot = {
  username:  string
  fullName:  string | null
  email:     string
  city:      string | null
  status:    string
  role:      string
  createdAt: string | null
  phone?:    string | null
  drones?:   string[] | null
  part107?:  boolean
  serviceRadiusMiles?: number | null
  certNumber?: string | null
}

type Stats = {
  missions:   number
  detections: number
  flightMins: number
  lastSeen:   string | null
}

const DRONE_OPTIONS = [
  "DJI Mini 4 Pro","DJI Mavic 3","DJI Air 3",
  "Autel EVO II","Skydio 2+","Parrot Anafi","Fixed wing","Other",
]

export default function ProfilePage() {
  const router = useRouter()
  const [pilot,   setPilot]   = useState<Pilot | null>(null)
  const [stats,   setStats]   = useState<Stats | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [form,    setForm]    = useState({
    full_name: "", phone: "", city: "",
    service_radius_miles: "" as string | number,
    drones: [] as string[], part107: false, cert_number: "",
  })

  useEffect(() => {
    const auth = getAuthState()
    if (!auth) { router.replace("/login"); return }
    apiGet<Pilot>("/auth/me").then((p) => {
      setPilot(p)
      setForm({
        full_name:            p.fullName  ?? "",
        phone:                p.phone     ?? "",
        city:                 p.city      ?? "",
        service_radius_miles: p.serviceRadiusMiles ?? "",
        drones:               p.drones    ?? [],
        part107:              p.part107   ?? false,
        cert_number:          p.certNumber ?? "",
      })
    }).catch(() => router.replace("/login"))

    // pull personal stats from leaderboard endpoint
    apiGet<{ username: string; missions: number; detections: number; flightMins: number; lastSeen: string | null }[]>("/pilots/leaderboard")
      .then((board) => {
        const me = board.find((e) => e.username === auth.username)
        if (me) setStats({ missions: me.missions, detections: me.detections, flightMins: me.flightMins, lastSeen: me.lastSeen })
      }).catch(() => {})
  }, [router])

  function toggleDrone(val: string) {
    setForm((f) => ({
      ...f,
      drones: f.drones.includes(val) ? f.drones.filter((d) => d !== val) : [...f.drones, val],
    }))
  }

  async function save() {
    setSaving(true)
    try {
      await apiPatch("/auth/me", {
        full_name:            form.full_name     || null,
        phone:                form.phone         || null,
        city:                 form.city          || null,
        service_radius_miles: form.service_radius_miles ? Number(form.service_radius_miles) : null,
        drones:               form.drones.length ? form.drones : null,
        part107:              form.part107,
        cert_number:          form.cert_number   || null,
      })
      // Update fullName in auth state so top bar refreshes
      const auth = getAuthState()
      if (auth) setAuth({ ...auth, fullName: form.full_name || auth.fullName })
      setPilot((p) => p ? { ...p, fullName: form.full_name || p.fullName } : p)
      setSaved(true)
      setEditing(false)
      setTimeout(() => setSaved(false), 3000)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Save failed.")
    } finally {
      setSaving(false)
    }
  }

  if (!pilot) return (
    <main className="min-h-screen bg-neutral-950 flex items-center justify-center">
      <div className="text-sm text-white/40">Loading…</div>
    </main>
  )

  const radiusLabel: Record<string, string> = {
    "5":"5 mi","10":"10 mi","25":"25 mi","50":"50 mi","100":"100 mi","999":"Anywhere"
  }

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-white">{pilot.fullName ?? pilot.username}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm text-white/40">@{pilot.username}</span>
              {pilot.role === "admin" && (
                <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-400">Admin</span>
              )}
              {pilot.part107 && (
                <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-xs text-sky-400">Part 107</span>
              )}
              <span className={`rounded-full px-2 py-0.5 text-xs ${
                pilot.status === "approved"
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "bg-yellow-500/15 text-yellow-400"
              }`}>{pilot.status}</span>
            </div>
          </div>
          <button
            onClick={() => setEditing((v) => !v)}
            className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/50 hover:text-white hover:border-white/25 transition-colors"
          >
            {editing ? "Cancel" : "Edit profile"}
          </button>
        </div>

        {saved && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-400">
            Profile updated.
          </div>
        )}

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Missions",   value: stats.missions },
              { label: "Detections", value: stats.detections },
              { label: "Flight time", value: `${Math.floor(stats.flightMins / 60)}h ${stats.flightMins % 60}m` },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-white/8 bg-white/4 p-4 text-center">
                <div className="text-2xl font-bold text-white">{s.value}</div>
                <div className="text-xs text-white/40 mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Info / Edit */}
        <div className="rounded-xl border border-white/10 bg-white/4 divide-y divide-white/8">
          {editing ? (
            <div className="p-5 space-y-4">
              <Row label="Full name">
                <input value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                  className="input" placeholder="Jane Smith" />
              </Row>
              <Row label="Phone">
                <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  className="input" placeholder="+1 (555) 000-0000" />
              </Row>
              <Row label="City">
                <input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                  className="input" placeholder="Carrollton, GA" />
              </Row>
              <Row label="Service radius">
                <select value={String(form.service_radius_miles)}
                  onChange={(e) => setForm((f) => ({ ...f, service_radius_miles: e.target.value }))}
                  className="input bg-neutral-800">
                  <option value="">—</option>
                  {[5,10,25,50,100].map((n) => (
                    <option key={n} value={n}>{n} miles</option>
                  ))}
                  <option value="999">Anywhere</option>
                </select>
              </Row>
              <Row label="Drones">
                <div className="flex flex-wrap gap-2 mt-1">
                  {DRONE_OPTIONS.map((d) => (
                    <button key={d} type="button" onClick={() => toggleDrone(d)}
                      className={`rounded-full px-3 py-1 text-xs border transition-colors ${
                        form.drones.includes(d)
                          ? "border-amber-500 bg-amber-500/15 text-amber-400"
                          : "border-white/10 text-white/40 hover:border-white/25"
                      }`}>{d}</button>
                  ))}
                </div>
              </Row>
              <Row label="FAA Part 107">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.part107}
                    onChange={(e) => setForm((f) => ({ ...f, part107: e.target.checked }))}
                    className="accent-amber-500" />
                  <span className="text-sm text-white/60">Certified</span>
                </label>
              </Row>
              {form.part107 && (
                <Row label="Certificate #">
                  <input value={form.cert_number} onChange={(e) => setForm((f) => ({ ...f, cert_number: e.target.value }))}
                    className="input" placeholder="FA3XXXXXXXX" />
                </Row>
              )}
              <button onClick={save} disabled={saving}
                className="w-full rounded-lg bg-amber-500 py-2.5 text-sm font-semibold text-black hover:bg-amber-400 disabled:opacity-50 transition-colors">
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          ) : (
            <>
              <InfoRow label="Email"    value={pilot.email} />
              <InfoRow label="City"     value={pilot.city} />
              <InfoRow label="Phone"    value={(pilot as Pilot & { phone?: string }).phone} />
              <InfoRow label="Radius"   value={radiusLabel[String((pilot as Pilot & { serviceRadiusMiles?: number }).serviceRadiusMiles)] ?? null} />
              <InfoRow label="Drones"   value={pilot.drones?.join(", ")} />
              <InfoRow label="Part 107" value={pilot.part107 ? `Yes${pilot.certNumber ? ` — ${pilot.certNumber}` : ""}` : "No"} />
              <InfoRow label="Member since" value={pilot.createdAt ? new Date(pilot.createdAt).toLocaleDateString() : null} />
            </>
          )}
        </div>

        <button onClick={() => router.push("/map")}
          className="text-xs text-white/30 hover:text-white/60 transition-colors">
          ← Back to map
        </button>
      </div>
    </main>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-white/40">{label}</label>
      {children}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div className="flex items-center justify-between px-5 py-3">
      <span className="text-sm text-white/40">{label}</span>
      <span className="text-sm text-white/80">{value}</span>
    </div>
  )
}
