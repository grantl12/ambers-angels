import { useQuery } from "@tanstack/react-query"
import { apiGet } from "@/lib/api-client"

export type FlockCamera = {
  id: string
  lat: number
  lng: number
  heading: number | null
  road: string | null
  agency: string | null
  scrapedAt: string | null
}

export function useFlockCameras() {
  return useQuery<FlockCamera[]>({
    queryKey: ["flock", "cameras"],
    queryFn: () => apiGet<FlockCamera[]>("/flock/cameras"),
    refetchInterval: 5 * 60_000, // re-sync every 5 min — scraper runs infrequently
    staleTime:       4 * 60_000,
  })
}
