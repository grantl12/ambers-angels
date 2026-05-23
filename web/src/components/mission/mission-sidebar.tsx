"use client"

import { useActiveMissions } from "@/features/missions/api"
import { useLatestTelemetry } from "@/features/telemetry/api"
import { useDetectionsFeed, useFemaAlerts, useWatchlist, type FemaAlert } from "@/features/detections/api"
import { useSwarmMissions, useSwarmDrones, type SwarmMission, type SwarmDrone } from "@/features/autonomous/api"
import { useEffect, useMemo, useRef, useState } from "react"
import type { LayerState } from "@/app/map/page"
import { zipToBbox, type FlockBbox } from "@/features/flock/api"

function useAlertRange() {
  const [miles, setMiles] = useState(25)
  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("aa_alert_range_miles") : null
    if (stored) setMiles(parseInt(stored, 10))
  }, [])
  return miles
}

function useOutsidePolygonNotif() {
  const [enabled, setEnabled] = useState(true)
  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("aa_notif_outside_polygon") : null
    if (stored !== null) setEnabled(stored !== "0")
  }, [])
  return enabled
}

// ---------------------------------------------------------------------------
// Polygon distance helpers
// ---------------------------------------------------------------------------

const _DEG_TO_RAD = Math.PI / 180
const _EARTH_MILES = 3958.8

function _haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * _DEG_TO_RAD
  const dLon = (lon2 - lon1) * _DEG_TO_RAD
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * _DEG_TO_RAD) * Math.cos(lat2 * _DEG_TO_RAD) * Math.sin(dLon / 2) ** 2
  return _EARTH_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function _parsePolygon(polyStr: string): [number, number][] {
  return polyStr
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [lat, lon] = pair.split(",").map(Number)
      return [lat, lon] as [number, number]
    })
}

function _pointInPolygon(lat: number, lon: number, poly: [number, number][]): boolean {
  let inside = false
  const n = poly.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [yi, xi] = poly[i]
    const [yj, xj] = poly[j]
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function _ptToSegMiles(
  lat: number,
  lon: number,
  a: [number, number],
  b: [number, number],
): number {
  const cosLat = Math.cos(lat * _DEG_TO_RAD)
  const px = lon * cosLat,  py = lat
  const ax = a[1] * cosLat, ay = a[0]
  const bx = b[1] * cosLat, by = b[0]
  const dx = bx - ax,       dy = by - ay
  const lenSq = dx * dx + dy * dy
  const t = lenSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq)) : 0
  return _haversineMiles(lat, lon, a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))
}

/** Returns miles from point to polygon boundary; 0 if inside; null if no valid polygon. */
function distToPolygonMiles(lat: number, lon: number, polyStr: string | null): number | null {
  if (!polyStr) return null
  const poly = _parsePolygon(polyStr)
  if (poly.length < 3) return null
  if (_pointInPolygon(lat, lon, poly)) return 0
  let minDist = Infinity
  const n = poly.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const d = _ptToSegMiles(lat, lon, poly[j], poly[i])
    if (d < minDist) minDist = d
  }
  return minDist
}

/** For a drone position, find the closest active FEMA alert and return miles outside (0 = inside). */
function closestAlertDistance(
  lat: number,
  lon: number,
  alerts: FemaAlert[],
): { miles: number; alert: FemaAlert } | null {
  let best: { miles: number; alert: FemaAlert } | null = null
  for (const alert of alerts) {
    const d = distToPolygonMiles(lat, lon, alert.polygon)
    if (d === null) continue
    if (best === null || d < best.miles) best = { miles: d, alert }
  }
  return best
}

// ---------------------------------------------------------------------------

type Props = {
  layers: LayerState
  onToggleLayer: (key: keyof LayerState) => void
  onFlyTo?: (lat: number, lng: number) => void
  flockBbox?: FlockBbox
  onFlockSearch?: (bbox: FlockBbox) => void
}

const LAYER_LABELS: { key: keyof LayerState; label: string; color: string }[] = [
  { key: "flock",    label: "Coverage Planner",     color: "bg-orange-400" },
  { key: "coverage", label: "Road Coverage",        color: "bg-orange-400/40" },
  { key: "zones",    label: "Dark Roads (Pilot)",   color: "bg-red-500" },
  { key: "drones",   label: "Active Drones",        color: "bg-violet-400" },
  { key: "swarm",    label: "Swarm Drones",         color: "bg-amber-400" },
  { key: "hits",     label: "Watchlist Hits",       color: "bg-red-400" },
  { key: "airspace", label: "Air Traffic",           color: "bg-sky-300" },
]

export function MissionSidebar({ layers, onToggleLayer, onFlyTo, flockBbox, onFlockSearch }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(288) // 288 = w-72
  const isDragging = useRef(false)

  function startResize(e: React.MouseEvent) {
    isDragging.current = true
    const startX = e.clientX
    const startW = sidebarWidth
    function onMove(ev: MouseEvent) {
      if (!isDragging.current) return
      const next = Math.min(480, Math.max(200, startW + ev.clientX - startX))
      setSidebarWidth(next)
    }
    function onUp() {
      isDragging.current = false
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  const [flockZip, setFlockZip]       = useState("")
  const [flockRadius, setFlockRadius] = useState(10)
  const [flockLoading, setFlockLoading] = useState(false)
  const [flockError, setFlockError]   = useState<string | null>(null)

  async function handleFlockSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!flockZip.trim()) return
    setFlockLoading(true)
    setFlockError(null)
    const bbox = await zipToBbox(flockZip.trim(), flockRadius)
    setFlockLoading(false)
    if (!bbox) { setFlockError("Zip not found — try another."); return }
    onFlockSearch?.(bbox)
  }
  const { data: missions = [] }      = useActiveMissions()
  const { data: drones = [] }        = useLatestTelemetry()
  const { data: detections = [] }    = useDetectionsFeed(50)
  const { data: watchlist = [] }     = useWatchlist()
  const { data: femaAlerts = [] }    = useFemaAlerts()
  const { data: swarmMissions = [] } = useSwarmMissions(8)
  const { data: swarmDrones = [] }   = useSwarmDrones()
  const alertRange          = useAlertRange()
  const outsidePolygonNotif = useOutsidePolygonNotif()

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
    <aside
      className="relative flex h-full shrink-0 flex-col border-r border-white/10 bg-black/60 text-white backdrop-blur-sm overflow-hidden"
      style={{ width: sidebarWidth }}
    >
      {/* Resize handle */}
      <div
        onMouseDown={startResize}
        className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-sky-500/40 transition-colors z-10"
        title="Drag to resize"
      />

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
            <div key={key}>
              <div
                className="flex items-center justify-between cursor-pointer group"
                onClick={() => onToggleLayer(key)}
              >
                <div className="flex items-center gap-2 text-sm text-white/70 group-hover:text-white transition-colors">
                  <div className={`w-2.5 h-2.5 rounded-sm shrink-0 ${color}`} />
                  {label}
                </div>
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

              {/* Flock zip search — expands when layer is toggled on */}
              {key === "flock" && layers.flock && (
                <form onSubmit={handleFlockSearch} className="mt-2 space-y-1.5">
                  <input
                    value={flockZip}
                    onChange={(e) => setFlockZip(e.target.value)}
                    placeholder="ZIP code"
                    maxLength={5}
                    className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white placeholder:text-white/25 focus:outline-none focus:border-orange-400/50"
                  />
                  <div className="flex gap-1.5">
                    <select
                      value={flockRadius}
                      onChange={(e) => setFlockRadius(Number(e.target.value))}
                      className="flex-1 rounded bg-neutral-800 border border-white/10 px-1.5 py-1 text-xs text-white/70 focus:outline-none"
                    >
                      {[5, 10, 15, 25].map((r) => (
                        <option key={r} value={r}>{r} mi radius</option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      disabled={flockLoading}
                      className="rounded bg-orange-500/20 border border-orange-500/30 px-3 py-1 text-xs font-semibold text-orange-400 hover:bg-orange-500/30 disabled:opacity-50 transition-colors shrink-0"
                    >
                      {flockLoading ? "…" : "Search"}
                    </button>
                  </div>
                  {flockError && <div className="text-[10px] text-red-400">{flockError}</div>}
                  {flockBbox && !flockError && (
                    <div className="text-[10px] text-orange-400/70">
                      Showing cameras within {flockRadius} mi of {flockZip}
                    </div>
                  )}
                </form>
              )}
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
            {drones.map((drone) => {
              const nearest =
                outsidePolygonNotif && femaAlerts.length > 0 && drone.lat != null && drone.lng != null
                  ? closestAlertDistance(drone.lat, drone.lng, femaAlerts)
                  : null
              const outsideBy =
                nearest !== null && nearest.miles > alertRange ? nearest.miles : null

              return (
                <div key={drone.droneId}>
                  <div
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
                  {outsideBy !== null && nearest && (
                    <div className="mt-1 rounded-lg border border-orange-500/40 bg-orange-500/10 px-2.5 py-2 text-xs">
                      <div className="flex items-center gap-1.5 font-semibold text-orange-300">
                        <span>⚠</span>
                        <span>{outsideBy.toFixed(1)} mi outside search area</span>
                      </div>
                      <div className="mt-0.5 text-orange-400/70 truncate">
                        {nearest.alert.sourceProgram ?? nearest.alert.alertType.toUpperCase()}
                        {nearest.alert.area ? ` · ${nearest.alert.area}` : ""}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Swarm missions */}
      <SwarmMissionsPanel
        missions={swarmMissions}
        swarmDrones={swarmDrones}
        onFlyTo={onFlyTo}
      />

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

// ---------------------------------------------------------------------------

type SwarmMissionsPanelProps = {
  missions: SwarmMission[]
  swarmDrones: SwarmDrone[]
  onFlyTo?: (lat: number, lng: number) => void
}

const STATUS_META: Record<string, { label: string; dot: string; text: string }> = {
  pending:    { label: "Pending",    dot: "bg-amber-400",   text: "text-amber-300"  },
  dispatched: { label: "Dispatched", dot: "bg-amber-400",   text: "text-amber-300"  },
  uploading:  { label: "Uploading",  dot: "bg-sky-400",     text: "text-sky-300"    },
  executing:  { label: "Executing",  dot: "bg-emerald-400 animate-pulse", text: "text-emerald-300" },
  active:     { label: "Active",     dot: "bg-emerald-400 animate-pulse", text: "text-emerald-300" },
  completed:  { label: "Completed",  dot: "bg-emerald-800", text: "text-emerald-600" },
  aborted:    { label: "Aborted",    dot: "bg-red-500",     text: "text-red-400"    },
  failed:     { label: "Failed",     dot: "bg-red-500",     text: "text-red-400"    },
}

function relativeTime(iso: string | null): string {
  if (!iso) return ""
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ${m % 60}m ago`
}

function SwarmMissionsPanel({ missions, swarmDrones, onFlyTo }: SwarmMissionsPanelProps) {
  const droneById = Object.fromEntries(swarmDrones.map((d) => [d.id, d]))

  const activeMissions  = missions.filter((m) => ["pending","dispatched","uploading","executing","active"].includes(m.status))
  const recentMissions  = missions.filter((m) => ["completed","aborted","failed"].includes(m.status)).slice(0, 3)
  const displayMissions = [...activeMissions, ...recentMissions].slice(0, 6)

  if (displayMissions.length === 0) return (
    <div className="px-4 py-3 border-b border-white/10 shrink-0">
      <div className="text-xs uppercase tracking-widest text-white/40 mb-2">Swarm Missions</div>
      <div className="text-sm text-white/30">No recent missions</div>
    </div>
  )

  return (
    <div className="px-4 py-3 border-b border-white/10 shrink-0">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs uppercase tracking-widest text-white/40">Swarm Missions</div>
        {activeMissions.length > 0 && (
          <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
            {activeMissions.length} active
          </span>
        )}
      </div>
      <div className="space-y-2">
        {displayMissions.map((m) => {
          const meta    = STATUS_META[m.status] ?? { label: m.status, dot: "bg-white/20", text: "text-white/40" }
          const drone   = droneById[m.drone_id]
          const isLive  = ["executing","active"].includes(m.status)
          const hasObs  = m.observation_lat != null && m.observation_lng != null
          const ts      = relativeTime(m.started_at ?? m.created_at)

          return (
            <div
              key={m.id}
              onClick={() => hasObs && onFlyTo?.(m.observation_lat!, m.observation_lng!)}
              className={`rounded-lg border bg-white/5 p-2 text-sm ${
                isLive
                  ? "border-emerald-500/30 hover:border-emerald-400/50 hover:bg-emerald-500/10"
                  : "border-white/10 hover:border-white/20"
              } ${hasObs ? "cursor-pointer" : ""} transition-colors`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${meta.dot}`} />
                  <span className="font-medium truncate text-white/80">
                    {drone ? drone.drone_model : `Drone #${m.drone_id}`}
                  </span>
                </div>
                <span className={`text-[10px] font-semibold shrink-0 ${meta.text}`}>
                  {meta.label}
                </span>
              </div>

              {/* Progress bar for executing missions */}
              {isLive && m.progress_pct != null && (
                <div className="mt-1.5 h-1 w-full rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-400 transition-all"
                    style={{ width: `${m.progress_pct}%` }}
                  />
                </div>
              )}

              <div className="mt-1 text-xs text-white/30 flex items-center gap-2 flex-wrap">
                {drone && <span>{drone.pilot_username}</span>}
                {m.operation_mode !== "vlos" && (
                  <span className="text-amber-500/70 uppercase">{m.operation_mode.replace("_", " ")}</span>
                )}
                {ts && <span>{ts}</span>}
                {hasObs && <span className="text-sky-400/50">↗ fly to</span>}
              </div>

              {m.error_msg && (
                <div className="mt-1 text-[10px] text-red-400/70 truncate">{m.error_msg}</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
