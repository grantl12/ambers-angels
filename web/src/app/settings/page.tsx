"use client"

import { useEffect, useState } from "react"
import Link from "next/link"

type Settings = {
  username: string
  notifBrowser: boolean
  notifSoundWatchlist: boolean
  notifSoundFema: boolean
  notifSoundAmber: boolean
  notifOutsidePolygon: boolean
  alertRangeMiles: number
}

const DEFAULTS: Settings = {
  username: "Pilot",
  notifBrowser: false,
  notifSoundWatchlist: true,
  notifSoundFema: true,
  notifSoundAmber: true,
  notifOutsidePolygon: true,
  alertRangeMiles: 25,
}

const RANGE_OPTIONS = [5, 10, 15, 25, 50, 100]

function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULTS
  try {
    return {
      username:            localStorage.getItem("aa_username")               ?? DEFAULTS.username,
      notifBrowser:        localStorage.getItem("aa_notif_browser") === "1",
      notifSoundWatchlist: localStorage.getItem("aa_notif_sound_watchlist") !== "0",
      notifSoundFema:      localStorage.getItem("aa_notif_sound_fema")      !== "0",
      notifSoundAmber:     localStorage.getItem("aa_notif_sound_amber")     !== "0",
      notifOutsidePolygon: localStorage.getItem("aa_notif_outside_polygon") !== "0",
      alertRangeMiles:     parseInt(localStorage.getItem("aa_alert_range_miles") ?? "25", 10),
    }
  } catch {
    return DEFAULTS
  }
}

function saveSettings(s: Settings) {
  localStorage.setItem("aa_username",               s.username)
  localStorage.setItem("aa_notif_browser",          s.notifBrowser        ? "1" : "0")
  localStorage.setItem("aa_notif_sound_watchlist",  s.notifSoundWatchlist ? "1" : "0")
  localStorage.setItem("aa_notif_sound_fema",       s.notifSoundFema      ? "1" : "0")
  localStorage.setItem("aa_notif_sound_amber",      s.notifSoundAmber     ? "1" : "0")
  localStorage.setItem("aa_notif_outside_polygon",  s.notifOutsidePolygon ? "1" : "0")
  localStorage.setItem("aa_alert_range_miles",      String(s.alertRangeMiles))
}

function Toggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${enabled ? "bg-sky-500" : "bg-white/10"}`}
    >
      <div
        className={`absolute top-1 w-3.5 h-3.5 rounded-full bg-white shadow transition-all ${
          enabled ? "left-[22px]" : "left-1"
        }`}
      />
    </button>
  )
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setSettings(loadSettings())
  }, [])

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  function handleSave() {
    saveSettings(settings)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function requestBrowserNotifs() {
    if (!("Notification" in window)) return
    const permission = await Notification.requestPermission()
    if (permission === "granted") {
      update("notifBrowser", true)
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-white px-4 py-8">
      <div className="mx-auto max-w-xl">

        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Link
            href="/map"
            className="text-white/40 hover:text-white/80 transition-colors text-sm"
          >
            ← Map
          </Link>
          <h1 className="text-xl font-semibold">Settings</h1>
        </div>

        {/* Profile */}
        <section className="rounded-xl border border-white/10 bg-white/5 p-5 mb-4">
          <h2 className="text-xs uppercase tracking-widest text-white/40 mb-4">Profile</h2>
          <label className="block text-sm text-white/70 mb-1">Display Name</label>
          <input
            type="text"
            value={settings.username}
            onChange={(e) => update("username", e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-sky-500/60 focus:outline-none"
            placeholder="Your name or callsign"
            maxLength={32}
          />
          <p className="mt-1.5 text-xs text-white/30">Shown in the top bar. No account required.</p>
        </section>

        {/* Notifications */}
        <section className="rounded-xl border border-white/10 bg-white/5 p-5 mb-4">
          <h2 className="text-xs uppercase tracking-widest text-white/40 mb-4">Notifications</h2>

          <div className="space-y-4">
            <NotifRow
              label="Browser push notifications"
              description="Show OS-level alerts for new watchlist hits"
              enabled={settings.notifBrowser}
              onToggle={() => {
                if (!settings.notifBrowser) {
                  requestBrowserNotifs()
                } else {
                  update("notifBrowser", false)
                }
              }}
            />
            <NotifRow
              label="Sound — watchlist plate hit"
              description="Audio alert when a plate on the watchlist is detected"
              enabled={settings.notifSoundWatchlist}
              onToggle={() => update("notifSoundWatchlist", !settings.notifSoundWatchlist)}
            />
            <NotifRow
              label="Sound — FEMA / AMBER alert"
              description="Audio alert when a new FEMA or AMBER alert comes in"
              enabled={settings.notifSoundFema}
              onToggle={() => update("notifSoundFema", !settings.notifSoundFema)}
            />
            <NotifRow
              label="Sound — AMBER alert ingested"
              description="Separate alert tone for AMBER-specific alerts"
              enabled={settings.notifSoundAmber}
              onToggle={() => update("notifSoundAmber", !settings.notifSoundAmber)}
            />
            <NotifRow
              label="Outside search area warning"
              description="Show a banner when your drone is beyond your alert range from the active FEMA search polygon"
              enabled={settings.notifOutsidePolygon}
              onToggle={() => update("notifOutsidePolygon", !settings.notifOutsidePolygon)}
            />
          </div>
        </section>

        {/* Alert range */}
        <section className="rounded-xl border border-white/10 bg-white/5 p-5 mb-4">
          <h2 className="text-xs uppercase tracking-widest text-white/40 mb-4">Alert Range</h2>
          <label className="block text-sm text-white/70 mb-3">
            Notify pilots within this distance of an active alert
          </label>
          <div className="flex gap-2 flex-wrap">
            {RANGE_OPTIONS.map((miles) => (
              <button
                key={miles}
                onClick={() => update("alertRangeMiles", miles)}
                className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                  settings.alertRangeMiles === miles
                    ? "border-sky-500 bg-sky-500/20 text-sky-300"
                    : "border-white/10 bg-white/5 text-white/50 hover:text-white hover:border-white/30"
                }`}
              >
                {miles} mi
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-white/30">
            Location services required for range-based filtering. Setting is saved now and applied when location is available.
          </p>
        </section>

        {/* Save */}
        <button
          onClick={handleSave}
          className={`w-full rounded-lg py-2.5 text-sm font-semibold transition-colors ${
            saved
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
              : "bg-sky-500 hover:bg-sky-400 text-white"
          }`}
        >
          {saved ? "Saved!" : "Save Settings"}
        </button>
      </div>
    </main>
  )
}

function NotifRow({
  label,
  description,
  enabled,
  onToggle,
}: {
  label: string
  description: string
  enabled: boolean
  onToggle: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-sm text-white/80">{label}</div>
        <div className="text-xs text-white/40 mt-0.5">{description}</div>
      </div>
      <Toggle enabled={enabled} onToggle={onToggle} />
    </div>
  )
}
