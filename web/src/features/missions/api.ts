import { useQuery } from "@tanstack/react-query"
import { apiGet } from "@/lib/api-client"
import type { Mission } from "./types"

export function useActiveMissions() {
  return useQuery<Mission[]>({
    queryKey: ["missions", "active"],
    queryFn: () => apiGet<Mission[]>("/missions/active"),
    refetchInterval: 30_000,
    staleTime: 10_000,
  })
}
