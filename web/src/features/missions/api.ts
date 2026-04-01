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

export type LeaderboardEntry = {
  pilotId: string
  droneId: string
  totalDetections: number
  watchlistHits: number
  flightMinutes: number
  lastSeen: string | null
}

export function useLeaderboard() {
  return useQuery<LeaderboardEntry[]>({
    queryKey: ["pilots", "leaderboard"],
    queryFn: () => apiGet<LeaderboardEntry[]>("/pilots/leaderboard"),
    refetchInterval: 30_000,
    staleTime: 10_000,
  })
}

export function useAllMissions() {
  return useQuery<Mission[]>({
    queryKey: ["missions", "all"],
    queryFn: () => apiGet<Mission[]>("/missions/all"),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
}

export type MissionDebrief = {
  missionId: string
  title: string
  startedAt: string | null
  endedAt: string | null
  durationMinutes: number
  totalDetections: number
  watchlistHits: number
  dronesActive: string[]
  pilotsActive: string[]
  platesScanned: number
  topPlates: { plate: string; count: number }[]
  alertsByType: Record<string, number>
}

export function useMissionDebrief(missionId: string | null) {
  return useQuery<MissionDebrief>({
    queryKey: ["missions", missionId, "debrief"],
    queryFn: () => apiGet<MissionDebrief>(`/missions/${missionId}/debrief`),
    enabled: missionId !== null,
    staleTime: 30_000,
  })
}
