import { useQuery } from "@tanstack/react-query"
import { apiGet } from "@/lib/api-client"
import type { DronePosition, TelemetryTrail } from "./types"

export function useLatestTelemetry() {
  return useQuery<DronePosition[]>({
    queryKey: ["telemetry", "latest"],
    queryFn: () => apiGet<DronePosition[]>("/telemetry/latest"),
    refetchInterval: 5_000,
    staleTime: 3_000,
  })
}

export function useTelemetryTrail(droneId: string, minutes = 30) {
  return useQuery<TelemetryTrail>({
    queryKey: ["telemetry", "trail", droneId, minutes],
    queryFn: () => apiGet<TelemetryTrail>(`/telemetry/trail?drone_id=${droneId}&minutes=${minutes}`),
    refetchInterval: 10_000,
    staleTime: 5_000,
  })
}
