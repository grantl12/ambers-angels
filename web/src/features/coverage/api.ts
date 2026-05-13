import { useQuery } from "@tanstack/react-query"
import { apiGet } from "@/lib/api-client"
import type { FlockBbox } from "@/features/flock/api"

export type CoverageCell = {
  polygon: string
  cameraCountBucket: "0" | "1-3" | "4+"
  centroidLat: number
  centroidLng: number
}

export type PriorityZone = {
  polygon: string
  priority: "high" | "medium"
  label: string
}

function bboxParams(bbox?: FlockBbox): string {
  if (!bbox) return ""
  return `?south=${bbox.south}&north=${bbox.north}&west=${bbox.west}&east=${bbox.east}`
}

export function useFlockCoverageMap(bbox?: FlockBbox) {
  return useQuery<CoverageCell[]>({
    queryKey: ["coverage", "map", bbox ?? null],
    queryFn: () => apiGet<CoverageCell[]>(`/coverage/map${bboxParams(bbox)}`),
    refetchInterval: 5 * 60_000,
    staleTime:       4 * 60_000,
  })
}

export function usePriorityZones(bbox?: FlockBbox) {
  return useQuery<PriorityZone[]>({
    queryKey: ["coverage", "priority-zones", bbox ?? null],
    queryFn: () => apiGet<PriorityZone[]>(`/coverage/priority-zones${bboxParams(bbox)}`),
    refetchInterval: 5 * 60_000,
    staleTime:       4 * 60_000,
  })
}
