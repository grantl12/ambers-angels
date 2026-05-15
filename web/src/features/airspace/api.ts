import { useQuery } from "@tanstack/react-query"
import { apiGet } from "@/lib/api-client"
import type { FlockBbox } from "@/features/flock/api"

export type Aircraft = {
  icao24: string
  callsign: string | null
  lng: number
  lat: number
  altitudeM: number | null
  velocityMs: number | null
  heading: number | null
}

function bboxParams(bbox?: FlockBbox): string {
  if (!bbox) return ""
  return `?south=${bbox.south}&north=${bbox.north}&west=${bbox.west}&east=${bbox.east}`
}

export function useAirTraffic(bbox?: FlockBbox) {
  return useQuery<Aircraft[]>({
    queryKey: ["airspace", "traffic", bbox ?? null],
    queryFn: () => apiGet<Aircraft[]>(`/airspace/traffic${bboxParams(bbox)}`),
    refetchInterval: 60_000,
    staleTime:       55_000,
  })
}
