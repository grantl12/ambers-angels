"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import Map, { Marker, Layer, NavigationControl, Source } from "react-map-gl/mapbox"
import type { MarkerDragEvent } from "@vis.gl/react-mapbox"
import "mapbox-gl/dist/mapbox-gl.css"
import { getAuthState } from "@/lib/auth"
import { apiGet, apiPatch, apiPost } from "@/lib/api-client"
import { env } from "@/lib/env"

type MatchedTarget = { color: string | null; bodyType: string | null; make: string | null }

type PendingDetail = {
  id:                 number
  caseGuid:           string
  state:              string | null
  area:               string | null
  headline:           string | null
  vehicleDescription: string | null
  vehiclePlate:       string | null
  photoUrl:           string | null
  posterUrl:          string | null
  centroidLat:        number | null
  centroidLng:        number | null
  polygon:            string | null
  status:             string
  createdAt:          string | null
  matchedTarget:      MatchedTarget | null
}

type Corner = { lat: number; lng: number }

// Carrollton, GA pilot-area center — fallback when a case has no geocoded centroid
const FALLBACK_CENTER = { lat: 33.5801, lng: -85.0766 }

function parsePolygon(poly: string): Corner[] {
  const pts = poly.trim().split(/\s+/).map((pair) => {
    const [lat, lng] = pair.split(",").map(Number)
    return { lat, lng }
  })
  // bbox_polygon closes the ring (first point repeated last) — drop it for editing
  if (pts.length > 1 &&
      pts[0].lat === pts[pts.length - 1].lat &&
      pts[0].lng === pts[pts.length - 1].lng) {
    return pts.slice(0, -1)
  }
  return pts
}

function defaultCorners(lat: number, lng: number, half = 0.05): Corner[] {
  return [
    { lat: lat - half, lng: lng - half },
    { lat: lat - half, lng: lng + half },
    { lat: lat + half, lng: lng + half },
    { lat: lat + half, lng: lng - half },
  ]
}

function serializePolygon(corners: Corner[]): string {
  const closed = [...corners, corners[0]]
  return closed.map((c) => `${c.lat},${c.lng}`).join(" ")
}

export default function NcmecReviewDetailPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const pendingId = params.id

  const [detail,  setDetail]  = useState<PendingDetail | null>(null)
  const [corners, setCorners] = useState<Corner[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [saving,    setSaving]    = useState(false)
  const [approving, setApproving] = useState(false)
  const [dismissing, setDismissing] = useState(false)
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await apiGet<PendingDetail>(`/admin/ncmec-pending/${pendingId}`)
      setDetail(data)
      if (data.polygon) {
        setCorners(parsePolygon(data.polygon))
      } else {
        const lat = data.centroidLat ?? FALLBACK_CENTER.lat
        const lng = data.centroidLng ?? FALLBACK_CENTER.lng
        setCorners(defaultCorners(lat, lng))
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [pendingId])

  useEffect(() => {
    const auth = getAuthState()
    if (!auth || !["admin", "coordinator"].includes(auth.role)) { router.replace("/map"); return }
    load()
  }, [router, load])

  const centerLat = detail?.centroidLat ?? (corners[0]?.lat ?? FALLBACK_CENTER.lat)
  const centerLng = detail?.centroidLng ?? (corners[0]?.lng ?? FALLBACK_CENTER.lng)

  const polygonGeoJson = useMemo(() => ({
    type: "Feature" as const,
    geometry: {
      type: "Polygon" as const,
      coordinates: corners.length
        ? [[...corners, corners[0]].map((c) => [c.lng, c.lat])]
        : [],
    },
    properties: {},
  }), [corners])

  function moveCorner(index: number, e: MarkerDragEvent) {
    setCorners((prev) => {
      const next = [...prev]
      next[index] = { lat: e.lngLat.lat, lng: e.lngLat.lng }
      return next
    })
  }

  async function savePolygon() {
    if (!detail) return
    setSaving(true)
    setActionMsg(null)
    try {
      await apiPatch(`/admin/ncmec-pending/${detail.id}`, { polygon: serializePolygon(corners) })
      setActionMsg("Search zone saved.")
    } catch (e: unknown) {
      setActionMsg(e instanceof Error ? e.message : "Save failed.")
    } finally {
      setSaving(false)
    }
  }

  async function approve() {
    if (!detail) return
    const area = detail.area || detail.state || "this area"
    if (!confirm(
      `The national system did not create this alert — approving will notify volunteers in ${area}. Continue?`
    )) return
    setApproving(true)
    setActionMsg(null)
    try {
      await apiPost(`/admin/ncmec-pending/${detail.id}/approve`, { polygon: serializePolygon(corners) })
      setActionMsg("Approved — volunteers in the area are being notified.")
      setDetail((d) => d ? { ...d, status: "approved" } : d)
    } catch (e: unknown) {
      setActionMsg(e instanceof Error ? e.message : "Approve failed.")
    } finally {
      setApproving(false)
    }
  }

  async function dismiss() {
    if (!detail) return
    if (!confirm("Dismiss this match? No alert will be created.")) return
    setDismissing(true)
    setActionMsg(null)
    try {
      await apiPost(`/admin/ncmec-pending/${detail.id}/dismiss`, {})
      setActionMsg("Dismissed.")
      setDetail((d) => d ? { ...d, status: "dismissed" } : d)
    } catch (e: unknown) {
      setActionMsg(e instanceof Error ? e.message : "Dismiss failed.")
    } finally {
      setDismissing(false)
    }
  }

  if (loading) {
    return <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white/40 text-sm">Loading…</main>
  }
  if (error || !detail) {
    return <main className="min-h-screen bg-neutral-950 px-6 py-10 text-red-400 text-sm">{error || "Not found"}</main>
  }

  const decided = detail.status !== "pending"

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-lg font-bold text-white">
            {detail.headline || detail.vehicleDescription || "NCMEC vehicle match"}
          </h1>
          <p className="text-sm text-white/40 mt-1">
            {detail.area || detail.state || "Unknown area"} · Status:{" "}
            <span className={decided ? "text-white/60" : "text-amber-400"}>{detail.status}</span>
          </p>
        </div>

        <section className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-2 text-sm text-white/70">
          {detail.vehicleDescription && <div><span className="text-white/40">Vehicle:</span> {detail.vehicleDescription}</div>}
          {detail.vehiclePlate && <div><span className="text-white/40">Plate:</span> {detail.vehiclePlate}</div>}
          {detail.matchedTarget && (
            <div>
              <span className="text-white/40">Matched active target:</span>{" "}
              {[detail.matchedTarget.color, detail.matchedTarget.bodyType, detail.matchedTarget.make]
                .filter(Boolean).join(" ") || "—"}
            </div>
          )}
          {detail.posterUrl && (
            <div>
              <a href={detail.posterUrl} target="_blank" rel="noreferrer" className="text-amber-400 hover:underline">
                View NCMEC poster
              </a>
            </div>
          )}
        </section>

        <section>
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-white">Search zone</h2>
            <p className="text-xs text-white/40 mt-0.5">
              Drag a corner to widen or narrow the proposed search area before approving.
            </p>
          </div>
          <div className="rounded-xl overflow-hidden border border-white/10" style={{ height: 420 }}>
            <Map
              mapboxAccessToken={env.mapboxToken}
              initialViewState={{ longitude: centerLng, latitude: centerLat, zoom: 11 }}
              style={{ width: "100%", height: "100%" }}
              mapStyle="mapbox://styles/mapbox/dark-v11"
            >
              <NavigationControl position="top-right" />
              <Source id="ncmec-review-zone" type="geojson" data={polygonGeoJson}>
                <Layer
                  id="ncmec-review-zone-fill"
                  type="fill"
                  paint={{ "fill-color": "#f59e0b", "fill-opacity": 0.15 }}
                />
                <Layer
                  id="ncmec-review-zone-outline"
                  type="line"
                  paint={{ "line-color": "#f59e0b", "line-width": 2, "line-dasharray": [6, 3] }}
                />
              </Source>
              {corners.map((c, i) => (
                <Marker
                  key={i}
                  longitude={c.lng}
                  latitude={c.lat}
                  draggable={!decided}
                  onDragEnd={(e) => moveCorner(i, e)}
                >
                  <div
                    className="w-4 h-4 rounded-full border-2 border-white bg-amber-500"
                    style={{ cursor: decided ? "default" : "grab" }}
                  />
                </Marker>
              ))}
            </Map>
          </div>
        </section>

        {actionMsg && (
          <div className={`text-xs px-3 py-2 rounded-lg ${
            actionMsg.toLowerCase().includes("fail") ? "bg-red-500/10 text-red-400" : "bg-emerald-500/10 text-emerald-400"
          }`}>
            {actionMsg}
          </div>
        )}

        {!decided && (
          <div className="flex flex-wrap gap-3">
            <button
              onClick={savePolygon}
              disabled={saving}
              className="rounded-lg px-4 py-2.5 text-sm font-semibold bg-white/10 text-white hover:bg-white/15 disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving…" : "Save zone"}
            </button>
            <button
              onClick={approve}
              disabled={approving}
              className="rounded-lg px-4 py-2.5 text-sm font-semibold bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-50 transition-colors"
            >
              {approving ? "Approving…" : "Approve & Push to Volunteers"}
            </button>
            <button
              onClick={dismiss}
              disabled={dismissing}
              className="rounded-lg px-4 py-2.5 text-sm font-semibold bg-white/5 text-white/60 hover:bg-white/10 disabled:opacity-50 transition-colors"
            >
              {dismissing ? "Dismissing…" : "Dismiss"}
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
