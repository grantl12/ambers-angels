import type { Mission } from "@/features/missions/types"
import type { DronePosition } from "@/features/telemetry/types"
import type { Detection } from "@/features/detections/types"

export const mockMission: Mission = {
  id: "mission-1",
  title: "Active Search Mission",
  status: "active",
  startedAt: new Date().toISOString(),
}

export const mockDronePositions: DronePosition[] = [
  {
    droneId: "drone-1",
    pilotId: "pilot-1",
    timestamp: new Date().toISOString(),
    lat: 30.2672,
    lng: -97.7431,
    altitude: 220,
    heading: 45,
  },
  {
    droneId: "drone-2",
    pilotId: "pilot-2",
    timestamp: new Date().toISOString(),
    lat: 30.271,
    lng: -97.75,
    altitude: 180,
    heading: 120,
  },
]

export const mockDetections: Detection[] = [
  {
    id: "det-1",
    timestamp: new Date().toISOString(),
    lat: 30.2695,
    lng: -97.746,
    plateText: "ABC1234",
    confidence: 0.82,
    status: "candidate",
  },
]

export const mockTrail = [
  [-97.748, 30.265],
  [-97.746, 30.266],
  [-97.744, 30.267],
  [-97.742, 30.268],
] as [number, number][]
