import { useQuery } from "@tanstack/react-query"
import { apiGet, apiPost } from "@/lib/api-client"
import type { FlockBbox } from "@/features/flock/api"

export type RoadSegment = {
  id: number
  name: string | null
  highwayType: string
  geometry: { type: "LineString"; coordinates: [number, number][] }
  centroidLat: number
  centroidLng: number
  coverageScore: number       // 0 = dark, 1–2 = sparse, 3+ = covered
  priority?: "high" | "medium"  // present in priority-zones response only
}

function bboxParams(bbox?: FlockBbox): string {
  if (!bbox) return ""
  return `?south=${bbox.south}&north=${bbox.north}&west=${bbox.west}&east=${bbox.east}`
}

/** Coordinator: all road segments colored by camera coverage score. */
export function useRoadCoverage(bbox?: FlockBbox) {
  return useQuery<RoadSegment[]>({
    queryKey: ["coverage", "map", bbox ?? null],
    queryFn: () => apiGet<RoadSegment[]>(`/coverage/map${bboxParams(bbox)}`),
    refetchInterval: 5 * 60_000,
    staleTime:       4 * 60_000,
  })
}

/** Pilot: uncovered/sparse road segments within the active search area. */
export function usePriorityRoads(bbox?: FlockBbox) {
  return useQuery<RoadSegment[]>({
    queryKey: ["coverage", "priority-zones", bbox ?? null],
    queryFn: () => apiGet<RoadSegment[]>(`/coverage/priority-zones${bboxParams(bbox)}`),
    refetchInterval: 5 * 60_000,
    staleTime:       4 * 60_000,
  })
}

/** One-shot fetch (not a hook) — used by dispatch modal to suggest obs point. */
export async function fetchPriorityZones(bbox: FlockBbox): Promise<RoadSegment[]> {
  return apiGet<RoadSegment[]>(`/coverage/priority-zones${bboxParams(bbox)}`)
}

export type GapAlertResponse = {
  notified: number
  cooldown: boolean
  cooldown_seconds_remaining?: number
}

/**
 * Coordinator: ping all active pilots with a generic coverage-gap notification.
 * No plate/vehicle/victim details are included in the push — volunteers only
 * learn that support is needed in their area.
 */
export async function pingCoverageGap(
  alertId: string,
  bbox: FlockBbox,
): Promise<GapAlertResponse> {
  return apiPost<GapAlertResponse>("/coverage/gap-alert", {
    alert_id: alertId,
    south: bbox.south,
    north: bbox.north,
    west: bbox.west,
    east: bbox.east,
  })
}

// Legacy aliases for components not yet migrated
export const useFlockCoverageMap = useRoadCoverage
export const usePriorityZones    = usePriorityRoads
