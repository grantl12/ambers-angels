"use client"

import { useDetectionsFeed, useWatchlist } from "@/features/detections/api"
import type { WatchlistEntry } from "@/features/detections/api"
import { useMemo, useState } from "react"
import { env } from "@/lib/env"
import type { Detection } from "@/features/detections/types"

// Badge styling per alert type — matches the ALERT_REGISTRY in fema_connector.py
const ALERT_BADGE: Record<string, { label: string; className: string }> = {
  amber:   { label: "AMBER",   className: "bg-amber-500 text-black" },
  matties: { label: "MATTIE'S", className: "bg-red-600 text-white" },
  silver:  { label: "SILVER",  className: "bg-slate-300 text-black" },
  blue:    { label: "BLUE",    className: "bg-blue-600 text-white" },
  purple:  { label: "PURPLE",  className: "bg-purple-600 text-white" },
  mipa:    { label: "MIPA",    className: "bg-yellow-500 text-black" },
  ema:     { label: "EMA",     className: "bg-yellow-600 text-black" },
}

type Props = {
  onFlyTo?: (lat: number, lng: number) => void
}

export function EventFeed({ onFlyTo }: Props) {
  const { data: detections = [], dataUpdatedAt } = useDetectionsFeed(50)
  const { data: watchlist = [] } = useWatchlist()
  const [lightbox, setLightbox] = useState<Detection | null>(null)

  // Map plate → watchlist entry so we can show the specific alert type
  const watchlistMap = useMemo(
    () => new Map<string, WatchlistEntry>(watchlist.map((w) => [w.plateText.toUpperCase(), w])),
    [watchlist]
  )

  const watchlistPlates = useMemo(() => new Set(watchlistMap.keys()), [watchlistMap])

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null

  return (
    <>
      <aside className="flex h-full w-72 flex-col border-l border-white/10 bg-black/60 text-white backdrop-blur-sm">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-sm font-semibold">Event Feed</span>
            </div>
            {lastUpdated && (
              <div className="text-xs text-white/30 mt-0.5">Updated {lastUpdated}</div>
            )}
          </div>
          <div className="text-xs text-white/40">{detections.length} events</div>
        </div>

        {/* Feed */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
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
                ? new Date(detection.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : null
              const thumbUrl = isAlert && detection.frameUrl
                ? `${env.apiBaseUrl}${detection.frameUrl}`
                : null

              const hasGps = detection.lat != null && detection.lng != null

              return (
                <div
                  key={detection.id}
                  onClick={() => hasGps && onFlyTo?.(detection.lat!, detection.lng!)}
                  className={`rounded-lg border text-sm transition-colors ${
                    isAlert
                      ? "border-red-500/40 bg-red-500/10"
                      : "border-white/10 bg-white/5"
                  } ${hasGps ? "cursor-pointer hover:border-sky-500/50 hover:bg-white/10" : ""}`}
                >
                  {/* Thumbnail — alert vehicles only */}
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
                          <span className={`rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase ${alertBadge.className}`}>
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
                    {/* Vehicle description line */}
                    {(detection.vehicleColor || detection.vehicleType || detection.vehicleMake) && (
                      <div className="mt-1 text-xs text-white/60 capitalize">
                        {[
                          detection.vehicleColor,
                          detection.vehicleMake,
                          detection.vehicleModel,
                          detection.vehicleType,
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      </div>
                    )}
                    <div className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-white/40">
                      {detection.droneId && <span>{detection.droneId}</span>}
                      {detection.confidence != null && detection.confidence > 0 && (
                        <span>{detection.confidence.toFixed(1)}%</span>
                      )}
                      {detection.lat != null && <span>GPS</span>}
                      {time && <span>{time}</span>}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
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
                  {lightbox.timestamp
                    ? new Date(lightbox.timestamp).toLocaleString()
                    : ""}
                </div>
              </div>
              <button
                onClick={() => setLightbox(null)}
                className="text-white/40 hover:text-white text-2xl leading-none"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
