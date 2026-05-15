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
import { useSwarmDrones, isDroneOnline, dispatchMission, type SwarmDrone } from "@/features/autonomous/api"
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

  // Swarm dispatch state
  const [selectedSwarmDrone, setSelectedSwarmDrone] = useState<SwarmDrone | null>(null)
  const [dispatchAlertId, setDispatchAlertId]       = useState("")
  const [dispatchLat, setDispatchLat]               = useState("")
  const [dispatchLng, setDispatchLng]               = useState("")
  const [dispatchAlt, setDispatchAlt]               = useState(60)
  const [dispatchSpeed, setDispatchSpeed]           = useState(8)
  const [dispatching, setDispatching]               = useState(false)
  const [dispatchError, setDispatchError]           = useState<string | null>(null)
  const [dispatchSuccess, setDispatchSuccess]       = useState(false)

  const { data: drones = [] }        = useLatestTelemetry()
  const { data: trail }              = useTelemetryTrail("drone1", 30)
  const { data: detections = [] }    = useDetectionsFeed(100)
  const { data: watchlist = [] }     = useWatchlist()
  const { data: flockCameras = [] }  = useFlockCameras(flockBbox)
  const { data: alertZones = [] }    = useFemaAlerts()
  const { data: coverageCells = [] } = useFlockCoverageMap(flockBbox)
  const { data: priorityZones = [] } = usePriorityZones(flockBbox)
  const { data: swarmDrones = [] }   = useSwarmDrones()

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
      .filter((f): f is NonNullable<typeof f> => f !== null),
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

  function closeDispatchModal() {
    setSelectedSwarmDrone(null)
    setDispatchAlertId("")
    setDispatchLat("")
    setDispatchLng("")
    setDispatchError(null)
  }

  async function handleDispatch() {
    if (!selectedSwarmDrone || !dispatchAlertId) return
    const lat = parseFloat(dispatchLat)
    const lng = parseFloat(dispatchLng)
    if (isNaN(lat) || isNaN(lng)) {
      setDispatchError("Enter a valid latitude and longitude.")
      return
    }
    setDispatching(true)
    setDispatchError(null)
    try {
      await dispatchMission({
        alert_id: dispatchAlertId,
        drone_id: selectedSwarmDrone.id,
        obs_lat: lat,
        obs_lng: lng,
        altitude_m: dispatchAlt,
        speed_mps: dispatchSpeed,
        operation_mode: "vlos",
      })
      closeDispatchModal()
      setDispatchSuccess(true)
      setTimeout(() => setDispatchSuccess(false), 4000)
    } catch (e: unknown) {
      setDispatchError(e instanceof Error ? e.message : "Dispatch failed.")
    } finally {
      setDispatching(false)
    }
  }

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

        {/* Pilot telemetry drone markers */}
        {layers.drones && drones.map((drone) => (
          <Marker key={drone.droneId} longitude={drone.lng} latitude={drone.lat} anchor="center">
            <div className="relative flex items-center justify-center">
              <div className="h-4 w-4 rounded-full border-2 border-white bg-violet-400 shadow-lg" />
              <div className="absolute h-8 w-8 rounded-full bg-violet-400/20 animate-ping" />
            </div>
          </Marker>
        ))}

        {/* Swarm drone markers (autonomous-capable, parked at home position) */}
        {layers.swarm && swarmDrones
          .filter((d) => d.home_lat != null && d.home_lng != null)
          .map((drone) => {
            const online = isDroneOnline(drone)
            return (
              <Marker
                key={`swarm-${drone.id}`}
                longitude={drone.home_lng!}
                latitude={drone.home_lat!}
                anchor="center"
                onClick={(e) => {
                  e.originalEvent.stopPropagation()
                  setSelectedSwarmDrone(drone)
                  setSelectedDetection(null)
                  setSelectedFlock(null)
                  // Pre-fill obs point from first available alert centroid
                  const firstAlert = alertZones.find((a) => a.centroidLat != null && a.centroidLng != null)
                  if (firstAlert?.centroidLat != null && firstAlert?.centroidLng != null) {
                    setDispatchLat(firstAlert.centroidLat.toFixed(5))
                    setDispatchLng(firstAlert.centroidLng.toFixed(5))
                    setDispatchAlertId(String(firstAlert.id))
                  }
                }}
              >
                <div
                  title={`${drone.drone_model} · ${drone.pilot_username}${online ? " · Online" : " · Offline"}`}
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 6,
                    background: online ? "rgba(245,158,11,0.15)" : "rgba(107,114,128,0.15)",
                    border: `2px solid ${online ? "#f59e0b" : "#6b7280"}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    fontSize: 15,
                    position: "relative",
                  }}
                >
                  🚁
                  {online && (
                    <div style={{
                      position: "absolute",
                      top: -4,
                      right: -4,
                      width: 9,
                      height: 9,
                      borderRadius: "50%",
                      background: "#22c55e",
                      border: "1.5px solid #050a0f",
                    }} />
                  )}
                </div>
              </Marker>
            )
          })
        }

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

      {/* ── DISPATCH SUCCESS TOAST ── */}
      {dispatchSuccess && (
        <div style={{
          position: "absolute",
          top: 60,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 60,
          background: "rgba(34,197,94,0.12)",
          border: "1px solid rgba(34,197,94,0.4)",
          borderRadius: 8,
          padding: "10px 20px",
          color: "#4ade80",
          fontSize: 13,
          fontWeight: 600,
          backdropFilter: "blur(8px)",
          whiteSpace: "nowrap",
        }}>
          Mission dispatched — drone will receive waypoint on next sync.
        </div>
      )}

      {/* ── SWARM DISPATCH MODAL ── */}
      {selectedSwarmDrone && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.55)",
            backdropFilter: "blur(3px)",
          }}
          onClick={closeDispatchModal}
        >
          <div
            style={{
              background: "#0a0f16",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 10,
              padding: "20px 24px",
              width: 380,
              maxWidth: "calc(100vw - 32px)",
              boxShadow: "0 24px 64px rgba(0,0,0,0.7)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 }}>
                  Swarm Dispatch
                </div>
                <div style={{ fontSize: 16, fontWeight: 600, color: "#fff" }}>
                  {selectedSwarmDrone.drone_model}
                </div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>
                  {selectedSwarmDrone.pilot_username} · Drone #{selectedSwarmDrone.id}
                </div>
              </div>
              <button
                onClick={closeDispatchModal}
                style={{ fontSize: 18, color: "rgba(255,255,255,0.3)", background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 1 }}
              >
                ✕
              </button>
            </div>

            {/* Online status */}
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 14, fontSize: 12 }}>
              <div style={{
                width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                background: isDroneOnline(selectedSwarmDrone) ? "#22c55e" : "#6b7280",
              }} />
              <span style={{ color: isDroneOnline(selectedSwarmDrone) ? "#4ade80" : "#9ca3af" }}>
                {isDroneOnline(selectedSwarmDrone)
                  ? "Online — ready to receive mission"
                  : "Offline — heartbeat > 5 min ago. Mission will queue until drone reconnects."}
              </span>
            </div>

            <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", marginBottom: 16 }} />

            {/* Alert picker */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", letterSpacing: 1.5, textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                Alert
              </label>
              {alertZones.length === 0 ? (
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", fontStyle: "italic" }}>
                  No active alerts. Inject a test alert or wait for a FEMA feed.
                </div>
              ) : (
                <select
                  value={dispatchAlertId}
                  onChange={(e) => {
                    const id = e.target.value
                    setDispatchAlertId(id)
                    const alert = alertZones.find((a) => String(a.id) === id)
                    if (alert?.centroidLat != null && alert?.centroidLng != null) {
                      setDispatchLat(alert.centroidLat.toFixed(5))
                      setDispatchLng(alert.centroidLng.toFixed(5))
                    }
                  }}
                  style={{
                    width: "100%",
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 6,
                    padding: "7px 10px",
                    fontSize: 13,
                    color: "#fff",
                    outline: "none",
                  }}
                >
                  <option value="">Select alert…</option>
                  {alertZones.map((a) => (
                    <option key={a.id} value={String(a.id)}>
                      {a.headline || a.alertType.toUpperCase()}
                      {a.area ? ` — ${a.area}` : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Observation point */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", letterSpacing: 1.5, textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                Observation Point
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginBottom: 3 }}>Latitude</div>
                  <input
                    type="number"
                    step="0.00001"
                    value={dispatchLat}
                    onChange={(e) => setDispatchLat(e.target.value)}
                    placeholder="33.5801"
                    style={{
                      width: "100%",
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 6,
                      padding: "6px 8px",
                      fontSize: 12,
                      color: "#fff",
                      boxSizing: "border-box" as const,
                      outline: "none",
                    }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginBottom: 3 }}>Longitude</div>
                  <input
                    type="number"
                    step="0.00001"
                    value={dispatchLng}
                    onChange={(e) => setDispatchLng(e.target.value)}
                    placeholder="-85.0766"
                    style={{
                      width: "100%",
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 6,
                      padding: "6px 8px",
                      fontSize: 12,
                      color: "#fff",
                      boxSizing: "border-box" as const,
                      outline: "none",
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Altitude + speed */}
            <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", letterSpacing: 1.5, textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                  Altitude (m)
                </label>
                <input
                  type="number"
                  min={10}
                  max={120}
                  value={dispatchAlt}
                  onChange={(e) => setDispatchAlt(Number(e.target.value))}
                  style={{
                    width: "100%",
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 6,
                    padding: "6px 8px",
                    fontSize: 12,
                    color: "#fff",
                    boxSizing: "border-box" as const,
                    outline: "none",
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", letterSpacing: 1.5, textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                  Speed (m/s)
                </label>
                <input
                  type="number"
                  min={2}
                  max={15}
                  step={0.5}
                  value={dispatchSpeed}
                  onChange={(e) => setDispatchSpeed(Number(e.target.value))}
                  style={{
                    width: "100%",
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 6,
                    padding: "6px 8px",
                    fontSize: 12,
                    color: "#fff",
                    boxSizing: "border-box" as const,
                    outline: "none",
                  }}
                />
              </div>
            </div>

            {/* Error */}
            {dispatchError && (
              <div style={{
                marginBottom: 12,
                padding: "8px 12px",
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: 6,
                fontSize: 12,
                color: "#fca5a5",
              }}>
                {dispatchError}
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={closeDispatchModal}
                style={{
                  flex: 1,
                  padding: "9px 16px",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 6,
                  color: "rgba(255,255,255,0.55)",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleDispatch}
                disabled={dispatching || !dispatchAlertId || !dispatchLat || !dispatchLng}
                style={{
                  flex: 2,
                  padding: "9px 16px",
                  background: "rgba(245,158,11,0.12)",
                  border: "1px solid rgba(245,158,11,0.35)",
                  borderRadius: 6,
                  color: "#f59e0b",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: dispatching ? "wait" : "pointer",
                  opacity: (!dispatchAlertId || !dispatchLat || !dispatchLng) ? 0.4 : 1,
                  transition: "opacity 0.15s",
                }}
              >
                {dispatching ? "Dispatching…" : "Dispatch Mission"}
              </button>
            </div>
          </div>
        </div>
      )}

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
          { color: "#f59e0b", label: "Swarm Drone (home pos)", square: true },
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
