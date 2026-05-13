"use client"

import Map, { Marker, NavigationControl, Popup, Source, Layer } from "react-map-gl/mapbox"
import type { MapRef } from "react-map-gl/mapbox"
import "mapbox-gl/dist/mapbox-gl.css"
import { useMemo, useState, useRef, useEffect } from "react"
import { env } from "@/lib/env"
import { useLatestTelemetry, useTelemetryTrail } from "@/features/telemetry/api"
import { useDetectionsFeed, useWatchlist, useFemaAlerts } from "@/features/detections/api"
import { useFlockCameras } from "@/features/flock/api"
import type { FlockCamera, FlockBbox } from "@/features/flock/api"
import { useFlockCoverageMap, usePriorityZones } from "@/features/coverage/api"
import type { Detection } from "@/features/detections/types"
import type { LayerState } from "@/app/map/page"

// Build a pie-slice (cone) polygon for a camera's field of view.
// Centered on the camera, pointing in the heading direction, 60° arc.
// Cameras with null heading fall back to a small circle.
function buildPieSlice(
  cx: number,
  cy: number,
  heading: number | null,
  radiusM = 500,
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

type MapControls = {
  flyTo: (lat: number, lng: number) => void
  fitBounds: (bbox: FlockBbox) => void
}

type Props = {
  layers: LayerState
  flockBbox?: FlockBbox
  onMapReady?: (controls: MapControls) => void
}

export function MissionMap({ layers, flockBbox, onMapReady }: Props) {
  const mapRef = useRef<MapRef>(null)
  const [selectedDetection, setSelectedDetection] = useState<Detection | null>(null)
  const [selectedFlock, setSelectedFlock]         = useState<FlockCamera | null>(null)
  const [timeRange, setTimeRange]                 = useState<TimeRange>("all")

  const { data: drones = [] }        = useLatestTelemetry()
  const { data: trail }              = useTelemetryTrail("drone1", 30)
  const { data: detections = [] }    = useDetectionsFeed(100)
  const { data: watchlist = [] }     = useWatchlist()
  const { data: flockCameras = [] }  = useFlockCameras(flockBbox)
  const { data: alertZones = [] }    = useFemaAlerts()
  const { data: coverageCells = [] } = useFlockCoverageMap(flockBbox)
  const { data: priorityZones = [] } = usePriorityZones(flockBbox)

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

  // Alert zones — vehicle_targets with polygon data (FEMA + manual injections)
  const alertZonesGeoJson = useMemo(() => {
    function parsePolygon(poly: string): [number, number][] {
      // stored as "lat,lng lat,lng ..." — GeoJSON needs [lng, lat]
      return poly.trim().split(/\s+/).map((pair) => {
        const [lat, lng] = pair.split(",").map(Number)
        return [lng, lat] as [number, number]
      })
    }
    return {
      type: "FeatureCollection" as const,
      features: alertZones
        .filter((z) => z.polygon)
        .map((z) => ({
          type: "Feature" as const,
          geometry: {
            type: "Polygon" as const,
            coordinates: [parsePolygon(z.polygon!)],
          },
          properties: {
            headline:  z.headline,
            alertType: z.alertType,
            area:      z.area ?? "",
          },
        })),
    }
  }, [alertZones])

  // Deadspace heatmap — shows coverage GAPS, not detections.
  // 0 cameras = weight 1.0 (red/dangerous), 1-3 = 0.45 (orange), 4+ = 0 (invisible).
  // Feeds from coverage cells so it only shows when the Deadspace Planner is active.
  const heatmapGeoJson = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: coverageCells
      .map((cell) => {
        const weight =
          cell.cameraCountBucket === "0"   ? 1.0 :
          cell.cameraCountBucket === "1-3" ? 0.45 : 0
        if (weight === 0) return null
        return {
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [cell.centroidLng, cell.centroidLat] },
          properties: { weight },
        }
      })
      .filter(Boolean),
  }), [coverageCells])

  // Coverage grid — one polygon per 0.1° cell, colored by camera count bucket.
  // Polygon format from coverage_service: "lat,lng lat,lng ..." (space-separated)
  const coverageGridGeoJson = useMemo(() => {
    function parseCellPolygon(poly: string): [number, number][] {
      return poly.trim().split(/\s+/).map((pair) => {
        const [lat, lng] = pair.split(",").map(Number)
        return [lng, lat] as [number, number]
      })
    }
    return {
      type: "FeatureCollection" as const,
      features: coverageCells.map((cell) => ({
        type: "Feature" as const,
        geometry: {
          type: "Polygon" as const,
          coordinates: [parseCellPolygon(cell.polygon)],
        },
        properties: { bucket: cell.cameraCountBucket },
      })),
    }
  }, [coverageCells])

  // Priority zones — dark areas for pilot routing (high = 0 cameras, medium = 1-3)
  const priorityZonesGeoJson = useMemo(() => {
    function parseCellPolygon(poly: string): [number, number][] {
      return poly.trim().split(/\s+/).map((pair) => {
        const [lat, lng] = pair.split(",").map(Number)
        return [lng, lat] as [number, number]
      })
    }
    return {
      type: "FeatureCollection" as const,
      features: priorityZones.map((zone) => ({
        type: "Feature" as const,
        geometry: {
          type: "Polygon" as const,
          coordinates: [parseCellPolygon(zone.polygon)],
        },
        properties: { priority: zone.priority, label: zone.label },
      })),
    }
  }, [priorityZones])

  // Always open on Carrollton, GA — drones appear as markers wherever they are
  const center = { longitude: -85.0766, latitude: 33.5801 }

  const mappable = detections.filter((d) => d.lat != null && d.lng != null)

  function handleMapLoad() {
    onMapReady?.({
      flyTo: (lat, lng) => {
        mapRef.current?.flyTo({ center: [lng, lat], zoom: 16, duration: 1200 })
      },
      fitBounds: (bbox) => {
        mapRef.current?.fitBounds(
          [[bbox.west, bbox.south], [bbox.east, bbox.north]],
          { padding: 60, duration: 1200 }
        )
      },
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

        {/* Alert search zones (vehicle_targets with polygon — FEMA + manual) */}
        {alertZonesGeoJson.features.length > 0 && (
          <Source id="alert-zones" type="geojson" data={alertZonesGeoJson}>
            <Layer
              id="alert-zones-fill"
              type="fill"
              paint={{
                "fill-color": [
                  "match", ["get", "alertType"],
                  "amber",  "#F59E0B",
                  "silver", "#94A3B8",
                  "blue",   "#3B82F6",
                  "#F59E0B",
                ],
                "fill-opacity": 0.12,
              }}
            />
            <Layer
              id="alert-zones-outline"
              type="line"
              paint={{
                "line-color": [
                  "match", ["get", "alertType"],
                  "amber",  "#F59E0B",
                  "silver", "#94A3B8",
                  "blue",   "#3B82F6",
                  "#F59E0B",
                ],
                "line-width": 2,
                "line-opacity": 0.8,
                "line-dasharray": [6, 3],
              }}
            />
            <Layer
              id="alert-zones-label"
              type="symbol"
              layout={{
                "text-field": ["get", "headline"],
                "text-size": 11,
                "text-anchor": "center",
                "text-max-width": 12,
              }}
              paint={{
                "text-color": "#ffffff",
                "text-opacity": 0.85,
                "text-halo-color": "#000000",
                "text-halo-width": 1.5,
              }}
            />
          </Source>
        )}

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

        {/* Coverage density grid (admin) — 0.1° cells colored by camera count bucket */}
        {layers.coverage && coverageGridGeoJson.features.length > 0 && (
          <Source id="coverage-grid" type="geojson" data={coverageGridGeoJson}>
            <Layer
              id="coverage-grid-fill"
              type="fill"
              paint={{
                "fill-color": [
                  "match", ["get", "bucket"],
                  "0",   "#ef4444",   // red   — no cameras
                  "1-3", "#f59e0b",   // amber — sparse
                  "4+",  "#22c55e",   // green — well covered
                  "transparent",
                ],
                "fill-opacity": 0.18,
              }}
            />
            <Layer
              id="coverage-grid-outline"
              type="line"
              paint={{
                "line-color": [
                  "match", ["get", "bucket"],
                  "0",   "#ef4444",
                  "1-3", "#f59e0b",
                  "4+",  "#22c55e",
                  "transparent",
                ],
                "line-opacity": 0.35,
                "line-width": 0.5,
              }}
            />
          </Source>
        )}

        {/* Priority zones (pilot) — dark zones where pilots should fly first */}
        {layers.zones && priorityZonesGeoJson.features.length > 0 && (
          <Source id="priority-zones" type="geojson" data={priorityZonesGeoJson}>
            <Layer
              id="priority-zones-fill"
              type="fill"
              paint={{
                "fill-color": [
                  "match", ["get", "priority"],
                  "high",   "#ef4444",
                  "medium", "#f97316",
                  "#ef4444",
                ],
                "fill-opacity": [
                  "match", ["get", "priority"],
                  "high",   0.30,
                  "medium", 0.18,
                  0.18,
                ],
              }}
            />
            <Layer
              id="priority-zones-outline"
              type="line"
              paint={{
                "line-color": [
                  "match", ["get", "priority"],
                  "high",   "#ef4444",
                  "medium", "#f97316",
                  "#ef4444",
                ],
                "line-opacity": 0.6,
                "line-width": 1,
                "line-dasharray": [5, 3],
              }}
            />
            <Layer
              id="priority-zones-label"
              type="symbol"
              layout={{
                "text-field": ["get", "label"],
                "text-size": 10,
                "text-anchor": "center",
              }}
              paint={{
                "text-color": "#ffffff",
                "text-opacity": 0.7,
                "text-halo-color": "#000000",
                "text-halo-width": 1,
              }}
            />
          </Source>
        )}

        {/* Deadspace heatmap — coverage gaps from Flock, red = unmonitored */}
        {layers.heat && (
          <Source id="heatmap" type="geojson" data={heatmapGeoJson}>
            <Layer
              id="heatmap-layer"
              type="heatmap"
              paint={{
                "heatmap-weight": ["get", "weight"],
                "heatmap-intensity": 1.4,
                "heatmap-radius": 40,
                "heatmap-opacity": 0.65,
                "heatmap-color": [
                  "interpolate", ["linear"], ["heatmap-density"],
                  0,    "rgba(0,0,0,0)",
                  0.15, "rgba(251,191,36,0.3)",
                  0.4,  "#f59e0b",
                  0.7,  "#ef4444",
                  1,    "#b91c1c",
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
          maxWidth: "calc(100vw - 24px)",
          overflowX: "auto",
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

      {/* ── DECONFLICT BANNER — hidden on mobile to avoid filter bar collision ── */}
      <div
        className="hidden md:flex"
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
          alignItems: "center",
          gap: 7,
          backdropFilter: "blur(8px)",
          maxWidth: 220,
          lineHeight: 1.4,
        }}
      >
        ⚡ Enable Deadspace Planner to surface Flock gaps for coverage planning
      </div>

      {/* ── LEGEND ── */}
      <div
        style={{
          position: "absolute",
          bottom: "max(28px, env(safe-area-inset-bottom, 28px) + 60px)",
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
          { color: "#ff6b35", label: "Flock Camera (Deadspace)" },
          { color: "#ef4444", label: "Dark zone (0 cameras)", square: true },
          { color: "#f59e0b", label: "Sparse (1–3 cameras)", square: true },
          { color: "#22c55e", label: "Covered (4+ cameras)", square: true },
          { color: "#7b61ff", label: "Active Drone" },
          { color: "#ef4444", label: "Deadspace (unmonitored)" },
          { color: "#ff3355", label: "Watchlist Hit" },
          { color: "#38bdf8", label: "Flight Trail" },
        ].map(({ color, label, square }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
            <div style={{ width: 10, height: 10, borderRadius: square ? 2 : "50%", background: color, opacity: square ? 0.7 : 1, flexShrink: 0 }} />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
