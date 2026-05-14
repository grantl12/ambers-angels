/**
 * mobile/src/api/autonomous.ts
 * API client for autonomous mission endpoints.
 */

import type { WaypointMissionPoint } from '../../modules/dji-camera/waypoint-mission'

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://157.245.125.103:8000'

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
    `${API_BASE}/autonomous/missions?status=pending`,
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
    `${API_BASE}/autonomous/missions/${missionId}`,
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
  const res = await fetch(`${API_BASE}/autonomous/drones/mine`, {
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
  const res = await fetch(`${API_BASE}/autonomous/drones/${droneId}/heartbeat`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ lat, lng }),
  })
  await parseResponse<unknown>(res)
}

export async function updateMissionStatus(
  token: string,
  missionId: number,
  status: string,
  progressPct?: number,
): Promise<void> {
  const body: Record<string, unknown> = { status }
  if (typeof progressPct === 'number') {
    body.progress_pct = progressPct
  }

  const res = await fetch(
    `${API_BASE}/autonomous/missions/${missionId}/status`,
    {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify(body),
    },
  )
  await parseResponse<unknown>(res)
}
