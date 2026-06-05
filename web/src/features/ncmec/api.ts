import { useQuery } from "@tanstack/react-query"
import { apiGet } from "@/lib/api-client"

export type NcmecCase = {
  guid: string
  name: string
  ageNow: number
  state: string
  city: string
  missingSince: string | null
  posterUrl: string
  photoUrl: string
  firstSeenAt: string | null
  resolvedAt: string | null
  vehicleDescription: string | null
  vehiclePlate: string | null
}

export function useNcmecRecent(limit = 40) {
  return useQuery<NcmecCase[]>({
    queryKey: ["ncmec", "recent", limit],
    queryFn: () => apiGet<NcmecCase[]>(`/ncmec/recent?limit=${limit}`),
    refetchInterval: 5 * 60_000,
    staleTime:       4 * 60_000,
  })
}
