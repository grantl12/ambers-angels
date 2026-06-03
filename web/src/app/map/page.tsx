"use client"

import { useRef, useState, useEffect } from "react"
import { MapLoader, type MapControls } from "@/components/map/map-loader"
import { MissionSidebar } from "@/components/mission/mission-sidebar"
import { EventFeed } from "@/components/mission/event-feed"
import { TopBar } from "@/components/layout/top-bar"
import type { FlockBbox } from "@/features/flock/api"
import { apiGet } from "@/lib/api-client"

type SystemHealth = {
  status: string
  database: string
  worker: string
  nginx: string
  rtmp_feeds: { active: number; configured: number }
  watchlist_entries: number
  detections_last_1h: number
  last_detection_at: string | null
  last_fema_poll:    string | null
  last_ncmec_poll:   string | null
}

function useHealth() {
  const [health, setHealth] = useState<SystemHealth | null>(null)
  useEffect(() => {
    let live = true
    async function poll() {
      try { const h = await apiGet<SystemHealth>("/health"); if (live) setHealth(h) } catch { /* swallow */ }
    }
    poll()
    const id = setInterval(poll, 30_000)
    return () => { live = false; clearInterval(id) }
  }, [])
  return health
}

function ageSince(iso: string | null): string {
  if (!iso) return "never"
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60)   return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

function HealthBar({ health }: { health: SystemHealth | null }) {
  if (!health) return null
  const services = [
    { label: "DB",     ok: health.database === "connected" },
    { label: "Worker", ok: health.worker   === "running"   },
    { label: "Nginx",  ok: health.nginx    === "running"   },
  ]
  const allGreen = services.every((s) => s.ok)
  return (
    <div style={{
      position: "absolute",
      top: 12,
      left: 12,
      zIndex: 10,
      display: "flex",
      alignItems: "center",
      gap: 10,
      background: "rgba(10,15,22,0.88)",
      border: `1px solid ${allGreen ? "rgba(34,197,94,0.25)" : "rgba(245,158,11,0.4)"}`,
      borderRadius: 6,
      padding: "5px 10px",
      fontSize: 11,
      backdropFilter: "blur(8px)",
      color: "rgba(200,220,232,0.8)",
    }}>
      {/* Service dots */}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {services.map(({ label, ok }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <div style={{
              width: 7, height: 7, borderRadius: "50%",
              background: ok ? "#22c55e" : "#f59e0b",
              boxShadow: ok ? "0 0 4px #22c55e88" : "0 0 4px #f59e0b88",
            }} />
            <span style={{ color: ok ? "rgba(134,239,172,0.8)" : "rgba(252,211,77,0.9)", fontWeight: 600 }}>{label}</span>
          </div>
        ))}
      </div>
      {/* Divider */}
      <div style={{ width: 1, height: 14, background: "rgba(255,255,255,0.1)" }} />
      {/* Poll times */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", color: "rgba(148,163,184,0.7)" }}>
        <span title="Last FEMA/EAS alert processed">FEMA {ageSince(health.last_fema_poll)}</span>
        <span title="Last NCMEC case seen">NCMEC {ageSince(health.last_ncmec_poll)}</span>
      </div>
    </div>
  )
}

export type LayerState = {
  flock: boolean
  coverage: boolean
  zones: boolean
  drones: boolean
  swarm: boolean
  hits: boolean
  airspace: boolean
}

export default function MapPage() {
  const [layers, setLayers] = useState<LayerState>({
    flock: false,
    coverage: false,
    zones: false,
    drones: true,
    swarm: true,
    hits: true,
    airspace: true,
  })

  const [flockBbox, setFlockBbox] = useState<FlockBbox | undefined>(undefined)
  const mapControlsRef = useRef<MapControls | null>(null)
  const health = useHealth()

  const toggleLayer = (key: keyof LayerState) =>
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }))

  function flyTo(lat: number, lng: number) {
    mapControlsRef.current?.flyTo(lat, lng)
  }

  function handleFlockSearch(bbox: FlockBbox) {
    setFlockBbox(bbox)
    mapControlsRef.current?.fitBounds(bbox)
  }

  const [mobileSidebar, setMobileSidebar] = useState(false)
  const [mobileFeed,    setMobileFeed]    = useState(false)

  return (
    <main className="flex h-screen w-screen flex-col bg-neutral-950">
      <TopBar />
      <div className="relative flex flex-1 overflow-hidden">

        {/* Sidebar — always visible on md+, drawer overlay on mobile */}
        <div className="hidden md:flex">
          <MissionSidebar layers={layers} onToggleLayer={toggleLayer} onFlyTo={flyTo} onFitBounds={(bbox) => mapControlsRef.current?.fitBounds(bbox)} flockBbox={flockBbox} onFlockSearch={handleFlockSearch} />
        </div>
        {mobileSidebar && (
          <div className="absolute inset-0 z-30 flex md:hidden">
            <div className="flex h-full">
              <MissionSidebar layers={layers} onToggleLayer={toggleLayer} onFlyTo={(lat, lng) => { flyTo(lat, lng); setMobileSidebar(false) }} onFitBounds={(bbox) => { mapControlsRef.current?.fitBounds(bbox); setMobileSidebar(false) }} flockBbox={flockBbox} onFlockSearch={handleFlockSearch} />
            </div>
            <div className="flex-1 bg-black/50" onClick={() => setMobileSidebar(false)} />
          </div>
        )}

        {/* Map — always full width on mobile */}
        <div className="flex-1 relative">
          <MapLoader layers={layers} flockBbox={flockBbox} onMapReady={(controls) => { mapControlsRef.current = controls }} />
          <HealthBar health={health} />

          {/* Mobile toggle buttons */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex gap-3 md:hidden">
            <button
              onClick={() => { setMobileSidebar(true); setMobileFeed(false) }}
              className="rounded-full bg-black/80 border border-white/20 px-4 py-2 text-xs text-white/70 backdrop-blur-sm"
            >
              ☰ Layers
            </button>
            <button
              onClick={() => { setMobileFeed(true); setMobileSidebar(false) }}
              className="rounded-full bg-black/80 border border-white/20 px-4 py-2 text-xs text-white/70 backdrop-blur-sm"
            >
              ⚡ Feed
            </button>
          </div>
        </div>

        {/* Event feed — always visible on md+, drawer overlay on mobile */}
        <div className="hidden md:flex">
          <EventFeed onFlyTo={flyTo} />
        </div>
        {mobileFeed && (
          <div className="absolute inset-0 z-30 flex flex-row-reverse md:hidden">
            <div className="flex h-full">
              <EventFeed onFlyTo={(lat, lng) => { flyTo(lat, lng); setMobileFeed(false) }} />
            </div>
            <div className="flex-1 bg-black/50" onClick={() => setMobileFeed(false)} />
          </div>
        )}

      </div>
    </main>
  )
}
