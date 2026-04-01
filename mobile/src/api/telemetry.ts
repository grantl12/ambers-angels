import { getApiBaseUrl } from "./client"

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
}

export type DronePosition = {
  droneId: string
  lat: number
  lng: number
  altitude?: number
  heading?: number
  speed?: number
}

export async function postTelemetry(payload: TelemetryPayload): Promise<void> {
  await fetch(`${getApiBaseUrl()}/telemetry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, source: payload.source ?? "phone_gps" }),
  })
}

export async function fetchLatestTelemetry(): Promise<DronePosition[]> {
  const res = await fetch(`${getApiBaseUrl()}/telemetry/latest`)
  if (!res.ok) return []
  return res.json()
}
