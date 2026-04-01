"use client"

import Map, { Marker, NavigationControl, Popup, Source, Layer } from "react-map-gl/mapbox"
import type { MapRef } from "react-map-gl/mapbox"
import "mapbox-gl/dist/mapbox-gl.css"
import { useMemo, useState, useRef, useEffect } from "react"
import { env } from "@/lib/env"
import { useLatestTelemetry, useTelemetryTrail } from "@/features/telemetry/api"
import { useDetectionsFeed, useWatchlist } from "@/features/detections/api"
import { useFlockCameras } from "@/features/flock/api"
import type { FlockCamera } from "@/features/flock/api"
import type { Detection } from "@/features/detections/types"
import type { LayerState } from "@/app/map/page"

// Build a pie-slice (cone) polygon for a camera's field of view.
// Centered on the camera, pointing in the heading direction, 60° arc.
// Cameras with null heading fall back to a small circle.
function buildPieSlice(
  cx: number,
  cy: number,
  heading: number | null,
  radiusM = 120,
  spanDeg = 60,
  steps   = 20,
): [number, number][] {
  const degPerM_lat = 1 / 111_320
  const degPerM_lng = 1 / (111_320 * Math.cos((cy * Math.PI) / 180))

  if (heading == null) {
    // Full circle fallback when no heading is available
    return Array.from({ length: 37 }, (_, i) => {
      const a = (i / 36) * 2 * Math.PI
      return [cx + radiusM * degPerM_lng * Math.cos(a), cy + radiusM * degPerM_lat * Math.sin(a)] as [number, number]
    })
  }

  const halfSpan = spanDeg / 2
  const arc: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const bearing = heading - halfSpan + (i / steps) * spanDeg
    const rad = (bearing * Math.PI) / 180
    // compass bearing: sin → east (lng), cos → north (lat)
    arc.push([
      cx + Math.sin(rad) * radiusM * degPerM_lng,
      cy + Math.cos(rad) * radiusM * degPerM_lat,
    ])
  }

  // pie slice: center → arc → back to center (closed ring)
  return [[cx, cy], ...arc, [cx, cy]]
}

type TimeRange = "all" | "24h" | "7d" | "30d"

type Props = {
  layers: LayerState
  onMapReady?: (flyTo: (lat: number, lng: number) => void) => void
}

export function MissionMap({ layers, onMapReady }: Props) {
  const mapRef = useRef<MapRef>(null)
  const [selectedDetection, setSelectedDetection] = useState<Detection | null>(null)
  const [selectedFlock, setSelectedFlock]         = useState<FlockCamera | null>(null)
  const [timeRange, setTimeRange]                 = useState<TimeRange>("all")

  const { data: drones = [] }        = useLatestTelemetry()
  const { data: trail }              = useTelemetryTrail("drone1", 30)
  const { data: detections = [] }    = useDetectionsFeed(100)
  const { data: watchlist = [] }     = useWatchlist()
  const { data: flockCameras = [] }  = useFlockCameras()

  const watchlistPlates = useMemo(
    () => new Set(watchlist.map((w) => w.plateText.toUpperCase())),
    [watchlist]
  )

  // Flight trail GeoJSON
  const trailGeoJson = useMemo(() => ({
    type: "Feature" as const,
    geometry: {
      type: "LineString" as const,
      coordinates: (trail?.points ?? []).map((p) => [p.lng, p.lat]),
    },
    properties: {},
  }), [trail])

  // Flock camera coverage — road strip oriented in camera heading direction.
  // All cameras are always included so pilots can plan around existing coverage.
  const flockCoverageGeoJson = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: flockCameras.map((cam) => ({
      type: "Feature" as const,
      geometry: {
        type: "Polygon" as const,
        coordinates: [buildPieSlice(cam.lng, cam.lat, cam.heading)],
      },
      properties: { id: cam.id },
    })),
  }), [flockCameras])

  // Heatmap GeoJSON from detections with GPS
  const heatmapGeoJson = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: detections
      .filter((d) => d.lat != null && d.lng != null)
      .map((d) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [d.lng!, d.lat!] },
        properties: { weight: (d.confidence ?? 80) / 100 },
      })),
  }), [detections])

  // Always open on Carrollton, GA — drones appear as markers wherever they are
  const center = { longitude: -85.0766, latitude: 33.5801 }

  const mappable = detections.filter((d) => d.lat != null && d.lng != null)

  function handleMapLoad() {
    onMapReady?.((lat, lng) => {
      mapRef.current?.flyTo({ center: [lng, lat], zoom: 16, duration: 1200 })
    })
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <Map
        ref={mapRef}
        initialViewState={{ ...center, zoom: 13 }}
        mapStyle="mapbox://styles/mapbox/dark-v11"
        mapboxAccessToken={env.mapboxToken}
        style={{ width: "100%", height: "100%" }}
        onLoad={handleMapLoad}
        onClick={() => { setSelectedDetection(null); setSelectedFlock(null) }}
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

        {/* Flock coverage sectors (pie slices oriented by heading) */}
        {layers.coverage && (
          <Source id="flock-coverage" type="geojson" data={flockCoverageGeoJson}>
            <Layer
              id="flock-coverage-fill"
              type="fill"
              paint={{
                "fill-color": "#ff6b35",
                "fill-opacity": 0.10,
              }}
            />
            <Layer
              id="flock-coverage-outline"
              type="line"
              paint={{
                "line-color": "#ff6b35",
                "line-opacity": 0.45,
                "line-width": 1,
                "line-dasharray": [4, 3],
              }}
            />
          </Source>
        )}

        {/* Detection heatmap */}
        {layers.heat && heatmapGeoJson.features.length > 0 && (
          <Source id="heatmap" type="geojson" data={heatmapGeoJson}>
            <Layer
              id="heatmap-layer"
              type="heatmap"
              paint={{
                "heatmap-weight": ["get", "weight"],
                "heatmap-intensity": 1,
                "heatmap-radius": 30,
                "heatmap-opacity": 0.7,
                "heatmap-color": [
                  "interpolate", ["linear"], ["heatmap-density"],
                  0,    "rgba(0,255,136,0)",
                  0.2,  "#00ff88",
                  0.5,  "#ffaa00",
                  0.8,  "#ff3355",
                  1,    "#ff0040",
                ],
              }}
            />
          </Source>
        )}

        {/* Flock camera markers */}
        {layers.flock && flockCameras.map((cam) => (
          <Marker
            key={cam.id}
            longitude={cam.lng}
            latitude={cam.lat}
            anchor="center"
            onClick={(e) => {
              e.originalEvent.stopPropagation()
              setSelectedFlock(cam)
              setSelectedDetection(null)
            }}
          >
            <div
              title={cam.id}
              style={{
                width: 22,
                height: 22,
                borderRadius: 3,
                background: "#ff6b35",
                border: "1.5px solid rgba(255,107,53,0.8)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                fontSize: 11,
              }}
            >
              📷
            </div>
          </Marker>
        ))}

        {/* Flock popup */}
        {selectedFlock && (
          <Popup
            longitude={selectedFlock.lng}
            latitude={selectedFlock.lat}
            anchor="top"
            onClose={() => setSelectedFlock(null)}
          >
            <div className="min-w-[160px] text-sm text-neutral-900">
              <div className="font-semibold text-base text-orange-600">{selectedFlock.id}</div>
              <div className="mt-1 text-neutral-600">{selectedFlock.road}</div>
              <div className="text-neutral-500 text-xs">{selectedFlock.agency}</div>
              <div className="text-neutral-500 text-xs">Heading: {selectedFlock.heading}°</div>
            </div>
          </Popup>
        )}

        {/* Drone markers */}
        {layers.drones && drones.map((drone) => (
          <Marker key={drone.droneId} longitude={drone.lng} latitude={drone.lat} anchor="center">
            <div className="relative flex items-center justify-center">
              <div className="h-4 w-4 rounded-full border-2 border-white bg-violet-400 shadow-lg" />
              <div className="absolute h-8 w-8 rounded-full bg-violet-400/20 animate-ping" />
            </div>
          </Marker>
        ))}

        {/* Detection markers */}
        {layers.hits && mappable.map((detection) => {
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
                setSelectedFlock(null)
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

        {/* Detection popup */}
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
              {(selectedDetection.vehicleColor || selectedDetection.vehicleMake || selectedDetection.vehicleType) && (
                <div className="mt-1 text-neutral-700 capitalize text-xs">
                  {[
                    selectedDetection.vehicleColor,
                    selectedDetection.vehicleMake,
                    selectedDetection.vehicleModel,
                    selectedDetection.vehicleType,
                  ].filter(Boolean).join(" ")}
                </div>
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

      {/* ── FILTER BAR ── */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 10,
          display: "flex",
          gap: 4,
          background: "rgba(10,15,22,0.88)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 6,
          padding: 5,
          backdropFilter: "blur(8px)",
        }}
      >
        {(["all", "24h", "7d", "30d"] as TimeRange[]).map((range) => (
          <button
            key={range}
            onClick={() => setTimeRange(range)}
            style={{
              fontFamily: "inherit",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "1.5px",
              textTransform: "uppercase",
              padding: "4px 10px",
              borderRadius: 4,
              border: "1px solid",
              cursor: "pointer",
              transition: "all 0.15s",
              background: timeRange === range ? "#38bdf8" : "transparent",
              borderColor: timeRange === range ? "#38bdf8" : "rgba(255,255,255,0.15)",
              color: timeRange === range ? "#060a0f" : "rgba(255,255,255,0.4)",
            }}
          >
            {range === "all" ? "ALL TIME" : range.toUpperCase()}
          </button>
        ))}
      </div>

      {/* ── DECONFLICT BANNER ── */}
      <div
        style={{
          position: "absolute",
          top: 12,
          right: 52,
          zIndex: 10,
          background: "rgba(255,107,53,0.1)",
          border: "1px solid rgba(255,107,53,0.35)",
          borderRadius: 6,
          padding: "7px 12px",
          fontSize: 11,
          color: "#ff6b35",
          display: "flex",
          alignItems: "center",
          gap: 7,
          backdropFilter: "blur(8px)",
          maxWidth: 220,
          lineHeight: 1.4,
        }}
      >
        ⚡ Flock-dark zones highlighted — prioritize these areas
      </div>

      {/* ── LEGEND ── */}
      <div
        style={{
          position: "absolute",
          bottom: 28,
          left: 12,
          zIndex: 10,
          background: "rgba(10,15,22,0.88)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 6,
          padding: "10px 14px",
          fontSize: 11,
          backdropFilter: "blur(8px)",
          minWidth: 160,
          color: "rgba(200,220,232,0.85)",
        }}
      >
        <div style={{ fontSize: 10, letterSpacing: 2, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", marginBottom: 8 }}>
          Legend
        </div>
        {[
          { color: "#ff6b35", label: "Flock ALPR Camera" },
          { color: "#7b61ff", label: "Active Drone" },
          { color: "#ffaa00", label: "Detection" },
          { color: "#ff3355", label: "Watchlist Hit" },
          { color: "#38bdf8", label: "Flight Trail" },
        ].map(({ color, label }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0 }} />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
