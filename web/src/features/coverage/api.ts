import { useQuery } from "@tanstack/react-query"
import { apiGet } from "@/lib/api-client"

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

export function useFlockCoverageMap() {
  return useQuery<CoverageCell[]>({
    queryKey: ["coverage", "map"],
    queryFn: () => apiGet<CoverageCell[]>("/coverage/map"),
    refetchInterval: 5 * 60_000,
    staleTime:       4 * 60_000,
  })
}

export function usePriorityZones() {
  return useQuery<PriorityZone[]>({
    queryKey: ["coverage", "priority-zones"],
    queryFn: () => apiGet<PriorityZone[]>("/coverage/priority-zones"),
    refetchInterval: 5 * 60_000,
    staleTime:       4 * 60_000,
  })
}
