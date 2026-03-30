"use client"

import Map, { Marker, NavigationControl, Popup, Source, Layer } from "react-map-gl/mapbox"
import "mapbox-gl/dist/mapbox-gl.css"
import { useMemo, useState } from "react"
import { env } from "@/lib/env"
import { useLatestTelemetry, useTelemetryTrail } from "@/features/telemetry/api"
import { useDetectionsFeed, useWatchlist } from "@/features/detections/api"
import type { Detection } from "@/features/detections/types"

export function MissionMap() {
  const [selectedDetection, setSelectedDetection] = useState<Detection | null>(null)

  const { data: drones = [] }     = useLatestTelemetry()
  const { data: trail }           = useTelemetryTrail("drone1", 30)
  const { data: detections = [] } = useDetectionsFeed(100)
  const { data: watchlist = [] }  = useWatchlist()

  const watchlistPlates = useMemo(
    () => new Set(watchlist.map((w) => w.plateText.toUpperCase())),
    [watchlist]
  )

  const trailGeoJson = useMemo(() => ({
    type: "Feature" as const,
    geometry: {
      type: "LineString" as const,
      coordinates: (trail?.points ?? []).map((p) => [p.lng, p.lat]),
    },
    properties: {},
  }), [trail])

  const center = drones[0]
    ? { longitude: drones[0].lng, latitude: drones[0].lat }
    : { longitude: -97.7431, latitude: 30.2672 }

  const mappable = detections.filter((d) => d.lat != null && d.lng != null)

  return (
    <Map
      initialViewState={{ ...center, zoom: 14 }}
      mapStyle="mapbox://styles/mapbox/dark-v11"
      mapboxAccessToken={env.mapboxToken}
      style={{ width: "100%", height: "100%" }}
    >
      <NavigationControl position="top-right" />

      {/* Flight trail */}
      <Source id="trail" type="geojson" data={trailGeoJson}>
        <Layer
          id="trail-line"
          type="line"
          paint={{
            "line-color": "#38bdf8",
            "line-width": 2,
            "line-opacity": 0.6,
          }}
        />
      </Source>

      {/* Drone markers */}
      {drones.map((drone) => (
        <Marker key={drone.droneId} longitude={drone.lng} latitude={drone.lat} anchor="center">
          <div className="relative flex items-center justify-center">
            <div className="h-4 w-4 rounded-full border-2 border-white bg-sky-400 shadow-lg" />
            <div className="absolute h-8 w-8 rounded-full bg-sky-400/20 animate-ping" />
          </div>
        </Marker>
      ))}

      {/* Detection markers */}
      {mappable.map((detection) => {
        const isAlert = watchlistPlates.has((detection.plateText ?? "").toUpperCase())
        return (
          <Marker
            key={detection.id}
            longitude={detection.lng!}
            latitude={detection.lat!}
            anchor="center"
            onClick={(e) => {
              e.originalEvent.stopPropagation()
              setSelectedDetection(detection)
            }}
          >
            <div
              className={`h-3 w-3 cursor-pointer rounded-full border border-white shadow transition-transform hover:scale-125 ${
                isAlert ? "bg-red-500" : "bg-amber-400"
              }`}
            />
          </Marker>
        )
      })}

      {/* Popup */}
      {selectedDetection?.lat != null && selectedDetection?.lng != null && (
        <Popup
          longitude={selectedDetection.lng!}
          latitude={selectedDetection.lat!}
          anchor="top"
          onClose={() => setSelectedDetection(null)}
        >
          <div className="min-w-[140px] text-sm text-neutral-900">
            <div className="font-semibold text-base">
              {selectedDetection.plateText || "Unknown plate"}
            </div>
            {watchlistPlates.has((selectedDetection.plateText ?? "").toUpperCase()) && (
              <div className="mt-1 text-xs font-bold text-red-600">WATCHLIST HIT</div>
            )}
            <div className="mt-1 text-neutral-600">Drone: {selectedDetection.droneId}</div>
            <div className="text-neutral-600">
              Confidence:{" "}
              {selectedDetection.confidence != null
                ? `${selectedDetection.confidence.toFixed(1)}%`
                : "n/a"}
            </div>
            <div className="text-neutral-600">Status: {selectedDetection.status}</div>
          </div>
        </Popup>
      )}
    </Map>
  )
}
