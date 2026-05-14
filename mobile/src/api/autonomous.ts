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

export type Mission = {
  id: number
  alert_id: string
  drone_id: number
  status: string
  operation_mode: OperationMode
  waypoints: WaypointMissionPoint[]
  altitude_m: number
  speed_mps: number
  coverage_area_sqkm: number | null
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
