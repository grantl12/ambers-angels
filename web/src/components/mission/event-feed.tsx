"use client"

import { useDetectionsFeed, useWatchlist } from "@/features/detections/api"
import type { WatchlistEntry } from "@/features/detections/api"
import { useNcmecRecent, type NcmecCase } from "@/features/ncmec/api"
import { useMemo, useState } from "react"
import { env } from "@/lib/env"
import type { Detection } from "@/features/detections/types"

const ALERT_BADGE: Record<string, { label: string; bg: string; color: string }> = {
  amber:   { label: "AMBER",    bg: "#f59e0b", color: "#050a0f" },
  matties: { label: "MATTIE'S", bg: "#7c3aed", color: "#fff"    },
  silver:  { label: "SILVER",   bg: "#64748b", color: "#fff"    },
  blue:    { label: "BLUE",     bg: "#0284c7", color: "#fff"    },
  purple:  { label: "PURPLE",   bg: "#8b5cf6", color: "#fff"    },
  mipa:    { label: "MIPA",     bg: "#eab308", color: "#050a0f" },
  ema:     { label: "EMA",      bg: "#ca8a04", color: "#050a0f" },
}

type Tab = "detections" | "ncmec"

type Props = {
  onFlyTo?: (lat: number, lng: number) => void
}

export function EventFeed({ onFlyTo }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const [tab, setTab] = useState<Tab>("detections")
  const { data: detections = [], dataUpdatedAt } = useDetectionsFeed(50)
  const { data: watchlist = [] } = useWatchlist()
  const { data: ncmecCases = [] } = useNcmecRecent()
  const [lightbox, setLightbox] = useState<Detection | null>(null)

  async function flyToNcmec(c: NcmecCase) {
    if (!onFlyTo) return
    try {
      const q = encodeURIComponent(`${c.city}, ${c.state}`)
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${q}.json?country=US&types=place&limit=1&access_token=${env.mapboxToken}`
      const res = await fetch(url)
      const json = await res.json()
      const center = json.features?.[0]?.center as [number, number] | undefined
      if (center) onFlyTo(center[1], center[0])
    } catch { /* swallow — non-critical */ }
  }

  const watchlistMap = useMemo(
    () => new Map<string, WatchlistEntry>(watchlist.map((w) => [w.plateText.toUpperCase(), w])),
    [watchlist]
  )
  const watchlistPlates = useMemo(() => new Set(watchlistMap.keys()), [watchlistMap])

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null

  const unresolvedNcmec = ncmecCases.filter((c) => !c.resolvedAt)
  const resolvedNcmec   = ncmecCases.filter((c) => !!c.resolvedAt)

  if (collapsed) {
    return (
      <aside className="flex h-full w-8 shrink-0 flex-col items-center border-l border-white/10 bg-black/60 text-white backdrop-blur-sm">
        <button
          onClick={() => setCollapsed(false)}
          title="Expand feed"
          className="mt-3 text-white/40 hover:text-white transition-colors text-lg leading-none"
        >
          ‹
        </button>
      </aside>
    )
  }

  return (
    <>
      <aside className="flex h-full w-72 shrink-0 flex-col border-l border-white/10 bg-black/60 text-white backdrop-blur-sm">
        {/* Header */}
        <div className="border-b border-white/10 px-4 pt-3 pb-0 shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-sm font-semibold">Live Feed</span>
            </div>
            <button
              onClick={() => setCollapsed(true)}
              title="Collapse feed"
              className="text-white/30 hover:text-white transition-colors text-base leading-none"
            >
              ›
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-0 -mb-px">
            <button
              onClick={() => setTab("detections")}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                tab === "detections"
                  ? "border-amber-400 text-amber-400"
                  : "border-transparent text-white/40 hover:text-white/70"
              }`}
            >
              Detections
              <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-white/50">
                {detections.length}
              </span>
            </button>
            <button
              onClick={() => setTab("ncmec")}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                tab === "ncmec"
                  ? "border-teal-400 text-teal-400"
                  : "border-transparent text-white/40 hover:text-white/70"
              }`}
            >
              Missing Persons
              {unresolvedNcmec.length > 0 && (
                <span className="rounded-full bg-teal-500/20 px-1.5 py-0.5 text-[10px] text-teal-400">
                  {unresolvedNcmec.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Detections tab */}
        {tab === "detections" && (
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            {lastUpdated && (
              <div className="text-[10px] text-white/25 text-right mb-1">Updated {lastUpdated}</div>
            )}
            {detections.length === 0 ? (
              <div className="text-sm text-white/30 text-center mt-8">No detections yet</div>
            ) : (
              detections.map((detection) => {
                const plateKey   = (detection.plateText ?? "").toUpperCase()
                const isAlert    = watchlistPlates.has(plateKey)
                const wlEntry    = watchlistMap.get(plateKey)
                const alertBadge = isAlert ? (ALERT_BADGE[wlEntry?.alertType ?? ""] ?? ALERT_BADGE.amber) : null
                const isFema     = detection.source === "fema"
                const time    = detection.timestamp
                  ? new Date(detection.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                  : null
                const thumbUrl = isAlert && detection.frameUrl
                  ? `${env.apiBaseUrl}${detection.frameUrl}`
                  : null
                const hasGps = detection.lat != null && detection.lng != null

                return (
                  <div
                    key={detection.id}
                    onClick={() => hasGps && onFlyTo?.(detection.lat!, detection.lng!)}
                    className={`rounded-lg border text-sm transition-colors cursor-pointer ${
                      isAlert
                        ? "border-red-500/40 bg-red-500/10 hover:border-red-400/60 hover:bg-red-500/20"
                        : "border-white/10 bg-white/5 hover:border-sky-500/50 hover:bg-white/10"
                    }`}
                  >
                    {thumbUrl && (
                      <button
                        onClick={() => setLightbox(detection)}
                        className="w-full overflow-hidden rounded-t-lg"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={thumbUrl}
                          alt={detection.plateText ?? "alert frame"}
                          className="w-full h-28 object-cover opacity-90 hover:opacity-100 transition-opacity"
                        />
                      </button>
                    )}

                    <div className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-mono font-semibold tracking-wider text-base">
                          {detection.plateText || "—"}
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          {alertBadge && (
                            <span
                              className="rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase"
                              style={{ backgroundColor: alertBadge.bg, color: alertBadge.color }}
                            >
                              {alertBadge.label}
                            </span>
                          )}
                          {isFema && !isAlert && (
                            <span className="rounded-sm bg-orange-500 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                              FEMA
                            </span>
                          )}
                        </div>
                      </div>
                      {(detection.vehicleColor || detection.vehicleType || detection.vehicleMake) && (
                        <div className="mt-1 text-xs text-white/60 capitalize">
                          {[detection.vehicleColor, detection.vehicleMake, detection.vehicleModel, detection.vehicleType]
                            .filter(Boolean).join(" ")}
                        </div>
                      )}
                      <div className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-white/40">
                        {detection.droneId && <span>{detection.droneId}</span>}
                        {detection.confidence != null && detection.confidence > 0 && (
                          <span>{detection.confidence.toFixed(1)}%</span>
                        )}
                        {hasGps ? <span className="text-sky-400/60">GPS ↗</span> : <span className="text-white/20">no GPS</span>}
                        {time && <span>{time}</span>}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}

        {/* NCMEC tab */}
        {tab === "ncmec" && (
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            {ncmecCases.length === 0 ? (
              <div className="text-sm text-white/30 text-center mt-8">No recent cases</div>
            ) : (
              <>
                {unresolvedNcmec.map((c) => <NcmecCard key={c.guid} c={c} onFlyTo={flyToNcmec} />)}
                {resolvedNcmec.length > 0 && (
                  <>
                    <div className="text-[10px] uppercase tracking-widest text-white/25 pt-2 pb-1">
                      Recently Resolved
                    </div>
                    {resolvedNcmec.map((c) => <NcmecCard key={c.guid} c={c} onFlyTo={flyToNcmec} />)}
                  </>
                )}
              </>
            )}
          </div>
        )}
      </aside>

      {/* Lightbox */}
      {lightbox && lightbox.frameUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setLightbox(null)}
        >
          <div
            className="relative max-w-2xl w-full mx-4 rounded-xl overflow-hidden border border-red-500/40 bg-neutral-900"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`${env.apiBaseUrl}${lightbox.frameUrl}`}
              alt={lightbox.plateText ?? "alert frame"}
              className="w-full"
            />
            <div className="p-4 flex items-center justify-between">
              <div>
                <div className="font-mono text-xl font-bold text-white">{lightbox.plateText}</div>
                <div className="text-sm text-white/50 mt-0.5">
                  {lightbox.droneId} ·{" "}
                  {lightbox.confidence != null && lightbox.confidence > 0
                    ? `${lightbox.confidence.toFixed(1)}% confidence · `
                    : ""}
                  {lightbox.timestamp ? new Date(lightbox.timestamp).toLocaleString() : ""}
                </div>
              </div>
              <button onClick={() => setLightbox(null)} className="text-white/40 hover:text-white text-2xl leading-none">
                ✕
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function NcmecCard({ c, onFlyTo }: { c: NcmecCase; onFlyTo?: (c: NcmecCase) => void }) {
  const resolved = !!c.resolvedAt
  const missingSince = c.missingSince
    ? new Date(c.missingSince).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : null
  const daysAgo = c.missingSince
    ? Math.floor((Date.now() - new Date(c.missingSince).getTime()) / 86_400_000)
    : null

  return (
    <div
      onClick={() => onFlyTo?.(c)}
      className={`rounded-lg border text-sm transition-colors ${
        resolved
          ? "border-white/10 bg-white/5 opacity-60 hover:opacity-80"
          : "border-teal-500/30 bg-teal-500/8 hover:border-teal-400/50 hover:bg-teal-500/12"
      } ${onFlyTo ? "cursor-pointer" : ""}`}
    >
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-semibold text-white leading-tight">{c.name}</div>
            <div className="text-xs text-white/50 mt-0.5">Age {c.ageNow}</div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {resolved ? (
              <span className="rounded-sm bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400">
                RESOLVED
              </span>
            ) : (
              <span className="rounded-sm bg-teal-500/20 px-1.5 py-0.5 text-[10px] font-bold text-teal-300">
                NCMEC
              </span>
            )}
            <span className="text-[10px] text-white/30 font-mono">{c.state}</span>
          </div>
        </div>
        <div className="mt-1.5 text-xs text-white/50">
          {c.city}, {c.state}
        </div>
        {missingSince && (
          <div className="mt-0.5 text-xs text-white/35">
            Missing since {missingSince}
            {daysAgo != null && <span className="text-white/25"> · {daysAgo}d ago</span>}
          </div>
        )}
        <a
          href={c.posterUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="mt-2 inline-block text-[10px] text-teal-400/60 hover:text-teal-300 transition-colors"
        >
          View poster ↗
        </a>
      </div>
    </div>
  )
}
