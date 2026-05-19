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
import { useRoadCoverage, usePriorityRoads, fetchPriorityZones } from "@/features/coverage/api"
import type { RoadSegment } from "@/features/coverage/api"
import { useSwarmDrones, isDroneOnline, dispatchMission, type SwarmDrone } from "@/features/autonomous/api"
import { useAirTraffic, type Aircraft } from "@/features/airspace/api"
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
  const [selectedAircraft, setSelectedAircraft]   = useState<Aircraft | null>(null)
  const [timeRange, setTimeRange]                 = useState<TimeRange>("all")

  // Viewport bbox — updates as the map pans/zooms (Flock + aircraft use this live)
  const [mapViewport, setMapViewport] = useState<FlockBbox | undefined>(undefined)
  // Coverage bbox — only updates on explicit user action; prevents re-fetch on every pan
  const [lockedCoverageBbox, setLockedCoverageBbox] = useState<FlockBbox | undefined>(undefined)
  const [coverageStale, setCoverageStale] = useState(false)

  // Through-roads shown in coverage layer — motorway/trunk/primary/secondary only
  const COVERAGE_ROAD_CLASSES = new Set(["motorway", "trunk", "primary", "secondary"])

  // Live clock for aircraft position-age countdown (ticks every second)
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(id)
  }, [])

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
  const [dispatchSuggested, setDispatchSuggested]   = useState(false)

  const { data: drones = [] }        = useLatestTelemetry()
  const { data: trail }              = useTelemetryTrail("drone1", 30)
  const { data: detections = [] }    = useDetectionsFeed(100)
  const { data: watchlist = [] }     = useWatchlist()
  // Flock cameras: load from explicit zip search bbox, or viewport when layer is on
  const { data: flockCameras = [] }   = useFlockCameras(layers.flock ? (flockBbox ?? mapViewport) : undefined)
  const { data: alertZones = [] }     = useFemaAlerts()
  // Road coverage: locked bbox only — refresh on demand, not on every pan
  const coverageBbox = (layers.coverage || layers.zones) ? lockedCoverageBbox : undefined
  const { data: roadSegments = [] }   = useRoadCoverage(coverageBbox)
  const { data: priorityRoads = [] }  = usePriorityRoads(coverageBbox)
  const { data: swarmDrones = [] }    = useSwarmDrones()
  const { data: aircraft = [] }       = useAirTraffic(flockBbox ?? mapViewport)

  // Rolling position history for aircraft contrails — keeps last 6 fixes (~6 min at 60s poll)
  // Use Record not Map — 'Map' is shadowed by the react-map-gl import above
  type AcTrails = Record<string, [number, number][]>
  const _acTrailBuf = useRef<AcTrails>({})
  const [aircraftTrails, setAircraftTrails] = useState<AcTrails>({})
  useEffect(() => {
    if (!aircraft.length) return
    const next: AcTrails = { ..._acTrailBuf.current }
    for (const ac of aircraft) {
      const prev = next[ac.icao24] ?? []
      const last = prev[prev.length - 1]
      if (!last || last[0] !== ac.lng || last[1] !== ac.lat) {
        next[ac.icao24] = [...prev.slice(-5), [ac.lng, ac.lat]]
      }
    }
    _acTrailBuf.current = next
    setAircraftTrails({ ...next })
  }, [aircraft])

  const aircraftTrailsGeoJson = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: Object.entries(aircraftTrails)
      .filter(([, pts]) => pts.length >= 2)
      .map(([icao24, pts]) => ({
        type: "Feature" as const,
        geometry: { type: "LineString" as const, coordinates: pts },
        properties: { icao24 },
      })),
  }), [aircraftTrails])

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

  // Road coverage map — all through-roads, colored by coverage level.
  // Uncovered roads pop red; covered roads nearly disappear.
  const roadCoverageGeoJson = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: roadSegments
      .filter((seg: RoadSegment) => COVERAGE_ROAD_CLASSES.has(seg.highwayType))
      .map((seg: RoadSegment) => ({
        type: "Feature" as const,
        geometry: seg.geometry,
        properties: {
          // cap at 2 for paint expressions — 2+ all treated as "covered"
          score:       Math.min(seg.coverageScore, 2),
          highwayType: seg.highwayType,
        },
      })),
  }), [roadSegments])

  // Priority roads — uncovered/sparse segments for pilot routing.
  const priorityRoadsGeoJson = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: priorityRoads.map((seg: RoadSegment) => ({
      type: "Feature" as const,
      geometry: seg.geometry,
      properties: {
        priority:      seg.priority ?? "high",
        coverageScore: seg.coverageScore,
        highwayType:   seg.highwayType,
        name:          seg.name ?? "",
      },
    })),
  }), [priorityRoads])

  // Airspace advisory: aircraft within 5 nm (9260 m) of obs point at < 914 m (3000 ft) AGL
  const _NM5_M = 9260
  const _FT3000_M = 914
  function _hvDist(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6_371_000
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLng = (lng2 - lng1) * Math.PI / 180
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  }
  const nearbyAircraft = useMemo(() => {
    const lat = parseFloat(dispatchLat)
    const lng = parseFloat(dispatchLng)
    if (isNaN(lat) || isNaN(lng)) return []
    return aircraft.filter(
      (ac) =>
        ac.altitudeM != null &&
        ac.altitudeM < _FT3000_M &&
        _hvDist(lat, lng, ac.lat, ac.lng) < _NM5_M,
    )
  }, [aircraft, dispatchLat, dispatchLng])

  function closeDispatchModal() {
    setSelectedSwarmDrone(null)
    setDispatchAlertId("")
    setDispatchLat("")
    setDispatchLng("")
    setDispatchError(null)
    setDispatchSuggested(false)
  }

  function alertToBbox(alert: { polygon: string | null; centroidLat: number | null; centroidLng: number | null }): FlockBbox | null {
    if (alert.polygon) {
      const pairs = alert.polygon.trim().split(/\s+/).map((p) => {
        const [lat, lng] = p.split(",").map(Number)
        return { lat, lng }
      })
      return {
        south: Math.min(...pairs.map((p) => p.lat)),
        north: Math.max(...pairs.map((p) => p.lat)),
        west:  Math.min(...pairs.map((p) => p.lng)),
        east:  Math.max(...pairs.map((p) => p.lng)),
      }
    }
    if (alert.centroidLat != null && alert.centroidLng != null) {
      const r = 0.09 // ~6 mile radius fallback
      return { south: alert.centroidLat - r, north: alert.centroidLat + r, west: alert.centroidLng - r, east: alert.centroidLng + r }
    }
    return null
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

  function _updateViewport() {
    const bounds = mapRef.current?.getBounds()
    if (bounds) {
      const next = {
        south: bounds.getSouth(),
        north: bounds.getNorth(),
        west:  bounds.getWest(),
        east:  bounds.getEast(),
      }
      setMapViewport(next)
      // Mark coverage stale when the user pans away from the locked area
      if (lockedCoverageBbox && (layers.coverage || layers.zones)) {
        setCoverageStale(true)
      }
    }
  }

  function refreshCoverage() {
    if (!mapViewport) return
    setLockedCoverageBbox(mapViewport)
    setCoverageStale(false)
  }

  function handleMapLoad() {
    _updateViewport()
    onMapReady?.({
      flyTo: (lat, lng) => {
        mapRef.current?.flyTo({ center: [lng, lat], zoom: 15, duration: 1200 })
      },
      fitBounds: (bbox) => {
        mapRef.current?.fitBounds(
          [[bbox.west, bbox.south], [bbox.east, bbox.north]],
          { padding: 60, duration: 1200, maxZoom: 13 }
        )
      },
    })
  }

  const showCoverageBtn = (layers.coverage || layers.zones) && (!lockedCoverageBbox || coverageStale)

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {/* Coverage load / refresh button — appears when layer is on and data is absent or stale */}
      {showCoverageBtn && (
        <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 10 }}>
          <button
            onClick={refreshCoverage}
            className="flex items-center gap-2 rounded-full border border-orange-500/40 bg-black/80 px-4 py-2 text-xs font-semibold text-orange-400 backdrop-blur-sm hover:bg-orange-500/20 transition-colors shadow-lg"
          >
            <span>↻</span>
            {lockedCoverageBbox ? "Refresh coverage for this area" : "Load coverage for this area"}
          </button>
        </div>
      )}
      <Map
        ref={mapRef}
        initialViewState={{ ...center, zoom: 13 }}
        mapStyle="mapbox://styles/mapbox/dark-v11"
        mapboxAccessToken={env.mapboxToken}
        style={{ width: "100%", height: "100%" }}
        onLoad={handleMapLoad}
        onMoveEnd={_updateViewport}
        onClick={() => { setSelectedDetection(null); setSelectedFlock(null); setSelectedAircraft(null) }}
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

        {/* Flock coverage sectors (pie slices oriented by heading) — Coverage Planner only */}
        {layers.flock && (
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

        {/* Road coverage — full network, color = coverage level.
            Red = no cameras (gap corridor). Amber = sparse. Blue = covered (faint). */}
        {layers.coverage && roadCoverageGeoJson.features.length > 0 && (
          <Source id="road-coverage" type="geojson" data={roadCoverageGeoJson}>
            <Layer
              id="road-coverage-line"
              type="line"
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{
                "line-color": [
                  "interpolate", ["linear"], ["get", "score"],
                  0, "#ef4444",  // red   — no cameras, escape corridor
                  1, "#f59e0b",  // amber — 1 camera, sparse
                  2, "#38bdf8",  // blue  — 2+ cameras, covered
                ],
                "line-width": [
                  "match", ["get", "highwayType"],
                  "motorway", 3,
                  "trunk",    2.5,
                  "primary",  2,
                  1.5,
                ],
                "line-opacity": [
                  "interpolate", ["linear"], ["get", "score"],
                  0, 0.65,  // uncovered stands out
                  1, 0.35,  // sparse, visible but softer
                  2, 0.12,  // covered nearly invisible — base map shows the road
                ],
              }}
            />
          </Source>
        )}

        {/* Priority roads (pilot) — uncovered road segments to fly first */}
        {layers.zones && priorityRoadsGeoJson.features.length > 0 && (
          <Source id="priority-roads" type="geojson" data={priorityRoadsGeoJson}>
            <Layer
              id="priority-roads-line"
              type="line"
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{
                "line-color": "#f97316",
                "line-width": 2,
                "line-opacity": 0.55,
              }}
            />
          </Source>
        )}

        {/* Flock camera markers */}
        {layers.flock && flockCameras.map((cam) => {
          const verified = !!cam.agency
          return (
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
                title={verified ? `${cam.agency} · ${cam.id}` : `DeFlock · ${cam.id}`}
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 3,
                  background: verified ? "#ff6b35" : "transparent",
                  border: verified ? "1.5px solid rgba(255,107,53,0.9)" : "1.5px solid rgba(255,107,53,0.55)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  fontSize: 10,
                  opacity: verified ? 1 : 0.7,
                }}
              >
                {verified ? "📷" : "◉"}
              </div>
            </Marker>
          )
        })}

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

        {/* Aircraft contrails — fading position history behind each aircraft */}
        {layers.airspace && aircraftTrailsGeoJson.features.length > 0 && (
          <Source id="aircraft-trails" type="geojson" data={aircraftTrailsGeoJson}>
            <Layer
              id="aircraft-trails-line"
              type="line"
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{
                "line-color": "#7dd3fc",
                "line-width": 1.5,
                "line-opacity": 0.35,
              }}
            />
          </Source>
        )}

        {/* Aircraft markers — ✈ emoji + rotating direction arrow + age badge */}
        {layers.airspace && aircraft.map((ac) => {
          const altFt = ac.altitudeM != null ? ac.altitudeM * 3.281 : null
          const arrowColor = altFt == null ? "#e2e8f0" : altFt < 500 ? "#ef4444" : altFt < 1500 ? "#f59e0b" : "#7dd3fc"
          const heading = ac.heading ?? 0
          const ageSec = ac.timePosition != null ? nowSec - ac.timePosition : null
          const ageLabel = ageSec == null ? null
            : ageSec < 60 ? `${ageSec}s`
            : `${Math.floor(ageSec / 60)}m${String(ageSec % 60).padStart(2, "0")}s`
          return (
            <Marker
              key={`ac-${ac.icao24}`}
              longitude={ac.lng}
              latitude={ac.lat}
              anchor="center"
              onClick={(e) => {
                e.originalEvent.stopPropagation()
                setSelectedAircraft(ac)
                setSelectedDetection(null)
                setSelectedFlock(null)
              }}
            >
              <div style={{ position: "relative", width: 32, height: 32, cursor: "pointer" }}>
                {/* Directional arrow rotates with heading */}
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 32 32"
                  style={{ position: "absolute", inset: 0, transform: `rotate(${heading}deg)`, pointerEvents: "none" }}
                >
                  <polygon points="16,3 19,14 16,12 13,14" fill={arrowColor} opacity={0.9} />
                </svg>
                {/* ✈ stays upright */}
                <div style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 14,
                  lineHeight: 1,
                  filter: altFt != null && altFt < 1500 ? `drop-shadow(0 0 4px ${arrowColor})` : undefined,
                }}>
                  ✈
                </div>
                {/* Age badge below icon */}
                {ageLabel && (
                  <div style={{
                    position: "absolute",
                    bottom: -11,
                    left: "50%",
                    transform: "translateX(-50%)",
                    fontSize: 9,
                    fontFamily: "monospace",
                    color: ageSec != null && ageSec > 120 ? "#f97316" : "#94a3b8",
                    whiteSpace: "nowrap",
                    background: "rgba(0,0,0,0.65)",
                    borderRadius: 3,
                    padding: "0 3px",
                    pointerEvents: "none",
                  }}>
                    {ageLabel}
                  </div>
                )}
              </div>
            </Marker>
          )
        })}

        {/* Aircraft popup */}
        {selectedAircraft && (
          <Popup
            longitude={selectedAircraft.lng}
            latitude={selectedAircraft.lat}
            anchor="top"
            onClose={() => setSelectedAircraft(null)}
          >
            <div className="min-w-[140px] text-sm text-neutral-900">
              <div className="font-semibold text-base">
                {selectedAircraft.callsign?.trim() || selectedAircraft.icao24.toUpperCase()}
              </div>
              <div className="mt-1 text-neutral-600">
                Alt: {selectedAircraft.altitudeM != null
                  ? `${Math.round(selectedAircraft.altitudeM * 3.281).toLocaleString()} ft`
                  : "unknown"}
              </div>
              {selectedAircraft.velocityMs != null && (
                <div className="text-neutral-600">
                  Speed: {Math.round(selectedAircraft.velocityMs * 1.944)} kts
                </div>
              )}
              {selectedAircraft.heading != null && (
                <div className="text-neutral-600">
                  Heading: {Math.round(selectedAircraft.heading)}°
                </div>
              )}
              {selectedAircraft.timePosition != null && (
                <div className="text-neutral-500 text-xs mt-1">
                  Position: {nowSec - selectedAircraft.timePosition}s ago
                </div>
              )}
              <div className="mt-1 text-neutral-400 text-xs">{selectedAircraft.icao24}</div>
            </div>
          </Popup>
        )}

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
                  onChange={async (e) => {
                    const id = e.target.value
                    setDispatchAlertId(id)
                    setDispatchSuggested(false)
                    const alert = alertZones.find((a) => String(a.id) === id)
                    if (!alert) return

                    // Try to find the nearest uncovered road segment (score=0) within the alert polygon bbox.
                    const bbox = alertToBbox(alert)
                    if (bbox) {
                      try {
                        const segments = await fetchPriorityZones(bbox)
                        const gaps = segments.filter((s) => s.coverageScore === 0)
                        if (gaps.length > 0 && alert.centroidLat != null && alert.centroidLng != null) {
                          const cl = alert.centroidLat, cn = alert.centroidLng
                          const best = gaps.reduce((a, b) =>
                            (a.centroidLat - cl) ** 2 + (a.centroidLng - cn) ** 2 <
                            (b.centroidLat - cl) ** 2 + (b.centroidLng - cn) ** 2 ? a : b
                          )
                          setDispatchLat(best.centroidLat.toFixed(5))
                          setDispatchLng(best.centroidLng.toFixed(5))
                          setDispatchSuggested(true)
                          return
                        }
                      } catch { /* fall through */ }
                    }

                    // Fallback: polygon centroid
                    if (alert.centroidLat != null && alert.centroidLng != null) {
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
              <label style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", letterSpacing: 1.5, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                Observation Point
                {dispatchSuggested && (
                  <span style={{ fontSize: 9, background: "rgba(245,158,11,0.15)", color: "#f59e0b", padding: "2px 6px", borderRadius: 4, letterSpacing: 1, textTransform: "uppercase", fontWeight: 600 }}>
                    Coverage gap
                  </span>
                )}
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

            {/* Airspace advisory */}
            {nearbyAircraft.length > 0 && (
              <div style={{
                marginBottom: 12,
                padding: "8px 12px",
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.35)",
                borderRadius: 6,
                fontSize: 12,
                color: "#fca5a5",
              }}>
                <div style={{ fontWeight: 600, marginBottom: 3 }}>
                  ✈ {nearbyAircraft.length} aircraft within 5 nm below 3,000 ft
                </div>
                {nearbyAircraft.slice(0, 3).map((ac) => (
                  <div key={ac.icao24} style={{ color: "rgba(252,165,165,0.7)", marginTop: 2 }}>
                    {ac.callsign ?? ac.icao24} · {ac.altitudeM != null ? `${Math.round(ac.altitudeM * 3.281)} ft` : "—"}
                    {ac.heading != null ? ` · ${Math.round(ac.heading)}°` : ""}
                  </div>
                ))}
                <div style={{ marginTop: 4, color: "rgba(252,165,165,0.55)", fontSize: 11 }}>
                  Verify airspace deconfliction before launch.
                </div>
              </div>
            )}

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
          { color: "#ff6b35",          label: "Flock (agency-tagged)" },
          { color: "rgba(255,107,53,0.3)", label: "DeFlock (community)" },
          { color: "#ef4444", label: "Road — no coverage" },
          { color: "#f97316", label: "Road — 1 camera" },
          { color: "#f59e0b", label: "Road — 2 cameras" },
          { color: "#22c55e", label: "Road — 3+ cameras" },
          { color: "#7b61ff", label: "Active Drone" },
          { color: "#f59e0b", label: "Swarm Drone (home)", square: true },
          { color: "#ff3355", label: "Watchlist Hit" },
          { color: "#38bdf8", label: "Flight Trail" },
          { color: "#e2e8f0", label: "Aircraft (ADS-B)" },
          { color: "#ef4444", label: "Aircraft <500 ft" },
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
