import { useQuery } from "@tanstack/react-query"
import { apiGet } from "@/lib/api-client"
import type { Detection } from "./types"

export function useDetectionsFeed(limit = 50) {
  return useQuery<Detection[]>({
    queryKey: ["detections", "feed", limit],
    queryFn: () => apiGet<Detection[]>(`/detections/feed?limit=${limit}`),
    refetchInterval: 5_000,
    staleTime: 3_000,
  })
}

export type WatchlistEntry = {
  plateText:     string
  description:   string
  addedAt:       string
  alertType:     string   // amber | matties | silver | blue | purple | mipa | ema
  sourceProgram: string | null
}

export function useWatchlist() {
  return useQuery<WatchlistEntry[]>({
    queryKey: ["watchlist"],
    queryFn: () => apiGet("/watchlist"),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
}

export type FemaAlert = {
  id: number
  femaIdentifier: string
  alertType: string
  sourceProgram: string | null
  headline: string
  area: string | null
  polygon: string | null
  centroidLat: number | null
  centroidLng: number | null
  addedAt: string
  expiresAt: string | null
}

export function useFemaAlerts() {
  return useQuery<FemaAlert[]>({
    queryKey: ["fema", "alerts"],
    queryFn: () => apiGet("/fema/alerts"),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
}
