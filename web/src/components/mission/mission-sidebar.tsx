"use client"

import { useActiveMissions } from "@/features/missions/api"
import { useLatestTelemetry } from "@/features/telemetry/api"
import { useDetectionsFeed, useWatchlist } from "@/features/detections/api"
import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import type { LayerState } from "@/app/map/page"

function useUsername() {
  const [name, setName] = useState("Pilot")
  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("aa_username") : null
    if (stored) setName(stored)
  }, [])
  return name
}

type Props = {
  layers: LayerState
  onToggleLayer: (key: keyof LayerState) => void
  onFlyTo?: (lat: number, lng: number) => void
}

const LAYER_LABELS: { key: keyof LayerState; label: string; color: string }[] = [
  { key: "flock",    label: "Flock ALPR Cameras", color: "bg-orange-400" },
  { key: "coverage", label: "Coverage Ellipses",   color: "bg-orange-400/40" },
  { key: "drones",   label: "Active Drones",       color: "bg-violet-400" },
  { key: "heat",     label: "Detection Heatmap",   color: "bg-amber-400" },
  { key: "hits",     label: "Watchlist Hits",      color: "bg-red-400" },
]

export function MissionSidebar({ layers, onToggleLayer, onFlyTo }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const { data: missions = [] }    = useActiveMissions()
  const { data: drones = [] }      = useLatestTelemetry()
  const { data: detections = [] }  = useDetectionsFeed(50)
  const { data: watchlist = [] }   = useWatchlist()
  const username = useUsername()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [menuOpen])

  const mission = missions[0]
  const alertCount = detections.filter((d) => d.status === "alerted").length

  const watchlistPlates = useMemo(
    () => new Set(watchlist.map((w) => w.plateText.toUpperCase())),
    [watchlist]
  )

  const hits = useMemo(
    () =>
      detections.filter(
        (d) => d.plateText && watchlistPlates.has(d.plateText.toUpperCase())
      ),
    [detections, watchlistPlates]
  )

  if (collapsed) {
    return (
      <aside className="flex h-full w-8 shrink-0 flex-col items-center border-r border-white/10 bg-black/60 text-white backdrop-blur-sm">
        <button
          onClick={() => setCollapsed(false)}
          title="Expand sidebar"
          className="mt-3 text-white/40 hover:text-white transition-colors text-lg leading-none"
        >
          ›
        </button>
      </aside>
    )
  }

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-white/10 bg-black/60 text-white backdrop-blur-sm overflow-hidden">

      {/* Mission header */}
      <div className="px-4 pt-4 pb-3 border-b border-white/10 shrink-0">
        <button
          onClick={() => setCollapsed(true)}
          title="Collapse sidebar"
          className="float-right text-white/30 hover:text-white transition-colors text-base leading-none mt-0.5"
        >
          ‹
        </button>
        <div className="flex items-center gap-2 mb-1">
          <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs uppercase tracking-widest text-white/50">Live Mission</span>
        </div>
        <h2 className="text-lg font-semibold leading-tight">
          {mission?.title ?? "No active mission"}
        </h2>
        {mission && (
          <div className="mt-1 text-xs text-white/40">
            Started {new Date(mission.startedAt).toLocaleDateString(undefined, {
              month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
            })}
          </div>
        )}

        {/* Stats */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <StatCard label="Drones"     value={drones.length}     color="text-sky-400" />
          <StatCard label="Detections" value={detections.length} color="text-amber-400" />
          <StatCard label="Alerts"     value={alertCount}        color="text-red-400" />
          <StatCard
            label="With GPS"
            value={detections.filter((d) => d.lat != null).length}
            color="text-emerald-400"
          />
        </div>
      </div>

      {/* Map layer toggles */}
      <div className="px-4 py-3 border-b border-white/10 shrink-0">
        <div className="text-xs uppercase tracking-widest text-white/40 mb-3">Map Layers</div>
        <div className="space-y-2">
          {LAYER_LABELS.map(({ key, label, color }) => (
            <div
              key={key}
              className="flex items-center justify-between cursor-pointer group"
              onClick={() => onToggleLayer(key)}
            >
              <div className="flex items-center gap-2 text-sm text-white/70 group-hover:text-white transition-colors">
                <div className={`w-2.5 h-2.5 rounded-sm shrink-0 ${color}`} />
                {label}
              </div>
              {/* Toggle pill */}
              <div
                className={`relative w-8 h-4 rounded-full transition-colors shrink-0 ${
                  layers[key] ? "bg-sky-500" : "bg-white/10"
                }`}
              >
                <div
                  className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all ${
                    layers[key] ? "left-4" : "left-0.5"
                  }`}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Drone status */}
      <div className="px-4 py-3 border-b border-white/10 shrink-0">
        <div className="text-xs uppercase tracking-widest text-white/40 mb-2">Drone Status</div>
        {drones.length === 0 ? (
          <div className="text-sm text-white/30">No drones online</div>
        ) : (
          <div className="space-y-2">
            {drones.map((drone) => (
              <div
                key={drone.droneId}
                onClick={() => onFlyTo?.(drone.lat, drone.lng)}
                className="rounded-lg border border-white/10 bg-white/5 p-2 text-sm cursor-pointer hover:border-violet-400/50 hover:bg-violet-400/10 transition-colors"
                title="Click to center map on drone"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{drone.droneId}</span>
                  <span className="text-xs text-emerald-400">online</span>
                </div>
                <div className="mt-1 text-xs text-white/40">
                  {drone.altitude != null ? `${drone.altitude}m` : "—"}
                  {drone.heading != null ? ` · ${Math.round(drone.heading)}°` : ""}
                  {drone.speed != null ? ` · ${drone.speed.toFixed(1)}m/s` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Watchlist hits */}
      <div className="flex flex-col flex-1 overflow-hidden">
        <div className="px-4 pt-3 pb-2 shrink-0 flex items-center justify-between">
          <div className="text-xs uppercase tracking-widest text-white/40">Watchlist Hits</div>
          {hits.length > 0 && (
            <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-semibold text-red-400">
              {hits.length}
            </span>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-3 space-y-2">
          {hits.length === 0 ? (
            <div className="text-sm text-white/30">No hits yet</div>
          ) : (
            hits.map((hit) => {
              const time = hit.timestamp
                ? new Date(hit.timestamp).toLocaleTimeString([], {
                    hour: "2-digit", minute: "2-digit", second: "2-digit",
                  })
                : null
              const isHigh = (hit.confidence ?? 0) > 90
              const hasGps = hit.lat != null && hit.lng != null
              return (
                <div
                  key={hit.id}
                  onClick={() => hasGps && onFlyTo?.(hit.lat!, hit.lng!)}
                  className="rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-sm cursor-pointer hover:border-red-400/60 hover:bg-red-500/20 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold tracking-wider text-amber-400">
                      {hit.plateText}
                    </span>
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                        isHigh
                          ? "bg-red-500/30 text-red-300 border border-red-500/40"
                          : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                      }`}
                    >
                      {hit.confidence != null ? `${hit.confidence.toFixed(0)}%` : "—"}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-white/40 flex gap-2">
                    {hit.droneId && <span>{hit.droneId}</span>}
                    {time && <span>{time}</span>}
                    {hasGps ? <span className="text-sky-400/60">GPS ↗</span> : <span className="text-white/20">no GPS</span>}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Pilot account — anchored to bottom, dropdown opens upward */}
      <div ref={menuRef} className="relative shrink-0 border-t border-white/10 px-4 py-3">
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="flex w-full items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white transition-colors"
        >
          <span className="h-6 w-6 rounded-full bg-sky-500/30 text-sky-300 text-[11px] flex items-center justify-center font-bold select-none shrink-0">
            {username[0]?.toUpperCase() ?? "P"}
          </span>
          <span className="flex-1 text-left truncate">{username}</span>
          <svg className={`h-3 w-3 text-white/40 transition-transform shrink-0 ${menuOpen ? "rotate-180" : ""}`} viewBox="0 0 12 12" fill="none">
            <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {menuOpen && (
          <div className="absolute left-4 right-4 bottom-full mb-1 rounded-lg border border-white/10 bg-neutral-900 shadow-xl z-50 overflow-hidden">
            <div className="px-3 py-2 border-b border-white/10 text-xs text-white/40">
              Signed in as <span className="text-white/70">{username}</span>
            </div>
            <Link
              href="/settings"
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white transition-colors"
            >
              Settings &amp; Notifications
            </Link>
          </div>
        )}
      </div>
    </aside>
  )
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: string
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="text-xs uppercase text-white/40">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${color}`}>{value}</div>
    </div>
  )
}
