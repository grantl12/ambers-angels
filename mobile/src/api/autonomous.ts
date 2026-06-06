/**
 * mobile/src/api/autonomous.ts
 * API client for autonomous mission endpoints.
 */

import type { WaypointMissionPoint } from '../../modules/dji-camera/waypoint-mission'
import { getApiBaseUrl } from './client'

// Resolved at call-time so Settings changes take effect without restarting.
const apiBase = () => getApiBaseUrl()

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OperationMode = 'vlos' | 'bvlos_tactical' | 'bvlos_autonomous'

export const OPERATION_MODE_LABELS: Record<OperationMode, string> = {
  vlos:             'VLOS · Part 107',
  bvlos_tactical:   'Tactical BVLOS · Part 107 Waiver',
  bvlos_autonomous: 'Autonomous BVLOS · Part 108',
}

export type Drone = {
  id: number
  pilot_username: string
  drone_model: string
  serial_number: string | null
  home_lat: number | null
  home_lng: number | null
  bvlos_authorized: boolean
  vlos_radius_m: number
  last_seen_at: string | null
}

export type Mission = {
  id: number
  alert_id: string
  drone_id: number
  status: string
  operation_mode: OperationMode
  observation_lat: number | null
  observation_lng: number | null
  waypoints: WaypointMissionPoint[]
  altitude_m: number
  speed_mps: number
  created_at: string
  progress_pct: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authHeaders(token: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }
}

async function parseResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body = await res.json()
      message = body?.detail ?? body?.message ?? message
    } catch {
      // ignore parse error, use status text
    }
    throw new Error(message)
  }
  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Fetch all missions with status=pending assigned to this device / pilot.
 */
export async function fetchPendingMissions(token: string): Promise<Mission[]> {
  const res = await fetch(
    `${apiBase()}/autonomous/missions?status=pending`,
    {
      method: 'GET',
      headers: authHeaders(token),
    },
  )
  return parseResponse<Mission[]>(res)
}

/**
 * Fetch a single mission by ID (used to refresh state after status changes).
 */
export async function fetchMissionById(
  token: string,
  missionId: number,
): Promise<Mission> {
  const res = await fetch(
    `${apiBase()}/autonomous/missions/${missionId}`,
    {
      method: 'GET',
      headers: authHeaders(token),
    },
  )
  return parseResponse<Mission>(res)
}

/**
 * Update the status (and optionally the progress percentage) of a mission.
 *
 * @param status - One of: "uploading" | "executing" | "interrupted" |
 *                          "aborted" | "completed"
 * @param progressPct - Optional 0-100 value persisted server-side.
 */
export async function fetchMyDrones(token: string): Promise<Drone[]> {
  const res = await fetch(`${apiBase()}/autonomous/drones/mine`, {
    headers: authHeaders(token),
  })
  return parseResponse<Drone[]>(res)
}

export async function sendHeartbeat(
  token: string,
  droneId: number,
  lat: number,
  lng: number,
): Promise<void> {
  const res = await fetch(`${apiBase()}/autonomous/drones/${droneId}/heartbeat`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ lat, lng }),
  })
  await parseResponse<unknown>(res)
}

/** Coordinator: fetch all registered swarm drones. */
export async function fetchAllDrones(token: string): Promise<Drone[]> {
  const res = await fetch(`${apiBase()}/autonomous/drones`, {
    headers: authHeaders(token),
  })
  return parseResponse<Drone[]>(res)
}

export type DispatchRequest = {
  alert_id:       string
  drone_id:       number
  obs_lat:        number
  obs_lng:        number
  altitude_m:     number
  speed_mps:      number
  operation_mode: OperationMode
}

/** Coordinator: create and dispatch a waypoint mission. */
export async function dispatchMission(
  token: string,
  req:   DispatchRequest,
): Promise<{ id: number }> {
  const res = await fetch(`${apiBase()}/autonomous/plan`, {
    method:  'POST',
    headers: authHeaders(token),
    body:    JSON.stringify(req),
  })
  return parseResponse<{ id: number }>(res)
}

/** Returns true if the drone sent a heartbeat within the last 5 minutes. */
export function isDroneOnline(drone: Drone): boolean {
  if (!drone.last_seen_at) return false
  return Date.now() - new Date(drone.last_seen_at).getTime() < 5 * 60 * 1000
}

export type MissionStatusExtras = {
  obs_acknowledged?: boolean
  bvlos_certificate?: string
}

export async function updateMissionStatus(
  token: string,
  missionId: number,
  status: string,
  progressPct?: number,
  extras?: MissionStatusExtras,
): Promise<void> {
  const body: Record<string, unknown> = { status }
  if (typeof progressPct === 'number') {
    body.progress_pct = progressPct
  }
  if (extras?.obs_acknowledged !== undefined) {
    body.obs_acknowledged = extras.obs_acknowledged
  }
  if (extras?.bvlos_certificate !== undefined) {
    body.bvlos_certificate = extras.bvlos_certificate
  }

  const res = await fetch(
    `${apiBase()}/autonomous/missions/${missionId}/status`,
    {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify(body),
    },
  )
  await parseResponse<unknown>(res)
}
