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

export function useWatchlist() {
  return useQuery<{ plateText: string; description: string; addedAt: string }[]>({
    queryKey: ["watchlist"],
    queryFn: () => apiGet("/watchlist"),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
}
