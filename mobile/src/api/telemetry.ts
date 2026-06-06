import { apiGet, apiPost, getApiBaseUrl } from "./client"
import { getToken } from "../lib/auth"

export type TelemetryPayload = {
  drone_id: string
  lat: number
  lng: number
  altitude?: number
  heading?: number
  speed?: number
  accuracy?: number
  pilot_id?: string
  source?: string
  volunteerMode?: string
}

export type DronePosition = {
  droneId: string
  lat: number
  lng: number
  altitude?: number
  heading?: number
  speed?: number
  volunteerMode?: string
}

export async function postTelemetry(payload: TelemetryPayload): Promise<void> {
  const token = await getToken()
  if (!token) return  // no point posting if not authenticated
  await fetch(`${getApiBaseUrl()}/telemetry`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ ...payload, source: payload.source ?? "phone_gps", volunteer_mode: payload.volunteerMode }),
  })
}

export async function fetchLatestTelemetry(): Promise<DronePosition[]> {
  try {
    return await apiGet<DronePosition[]>("/telemetry/latest")
  } catch {
    return []
  }
}
