import { useQuery } from "@tanstack/react-query"
import { apiGet, apiPost } from "@/lib/api-client"

export type SwarmDrone = {
  id: number
  pilot_username: string
  drone_model: string
  serial_number: string | null
  home_lat: number | null
  home_lng: number | null
  max_flight_time_min: number | null
  camera_hfov_deg: number | null
  registered_at: string | null
  last_seen_at: string | null
  bvlos_authorized: boolean
  vlos_radius_m: number
}

export type DispatchMissionRequest = {
  alert_id: string
  drone_id: number
  obs_lat: number
  obs_lng: number
  altitude_m: number
  speed_mps: number
  operation_mode: string
}

export function useSwarmDrones() {
  return useQuery<SwarmDrone[]>({
    queryKey: ["autonomous", "drones"],
    queryFn: () => apiGet<SwarmDrone[]>("/autonomous/drones"),
    refetchInterval: 30_000,
    staleTime: 15_000,
  })
}

export function isDroneOnline(drone: SwarmDrone): boolean {
  if (!drone.last_seen_at) return false
  return Date.now() - new Date(drone.last_seen_at).getTime() < 5 * 60 * 1000
}

export async function dispatchMission(req: DispatchMissionRequest) {
  return apiPost<{ id: number; status: string }>("/autonomous/plan", req)
}

export type SwarmMissionStatus =
  | "pending" | "dispatched" | "uploading" | "executing" | "active"
  | "completed" | "aborted" | "failed"

export type SwarmMission = {
  id: number
  alert_id: string
  drone_id: number
  status: SwarmMissionStatus
  altitude_m: number | null
  speed_mps: number | null
  created_at: string | null
  dispatched_at: string | null
  started_at: string | null
  completed_at: string | null
  progress_pct: number | null
  error_msg: string | null
  operation_mode: string
  observation_lat: number | null
  observation_lng: number | null
}

export function useSwarmMissions(limit = 10) {
  return useQuery<SwarmMission[]>({
    queryKey: ["autonomous", "missions"],
    queryFn: () => apiGet<SwarmMission[]>(`/autonomous/missions?limit=${limit}`),
    refetchInterval: 10_000,
    staleTime: 5_000,
  })
}
