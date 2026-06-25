import { getApiBaseUrl } from "./client"
import { getToken } from "../lib/auth"

export type DetectionPayload = {
  droneId: string
  plateText: string
  plateConfidence: number
  pilotId?: string
  lat?: number
  lng?: number
  altitude?: number
  heading?: number
  speed?: number
  accuracy?: number
}

export type DetectionResult = {
  status: string
  watchlist_hit: boolean
}

export async function postDetection(payload: DetectionPayload): Promise<DetectionResult> {
  const form = new FormData()
  form.append("drone_id", payload.droneId)
  form.append("plate_text", payload.plateText)
  form.append("plate_confidence", String(payload.plateConfidence))
  form.append("source", "phone_mlkit")
  if (payload.pilotId) form.append("pilot_id", payload.pilotId)
  if (payload.lat != null) form.append("lat", String(payload.lat))
  if (payload.lng != null) form.append("lng", String(payload.lng))
  if (payload.altitude != null) form.append("altitude", String(payload.altitude))
  if (payload.heading != null) form.append("heading", String(payload.heading))
  if (payload.speed != null) form.append("speed", String(payload.speed))
  if (payload.accuracy != null) form.append("accuracy", String(payload.accuracy))

  const token = await getToken()
  const headers: Record<string, string> = {}
  if (token) headers["Authorization"] = `Bearer ${token}`

  const res = await fetch(`${getApiBaseUrl()}/ingest/detection`, {
    method: "POST",
    headers,
    body: form,
  })
  if (!res.ok) throw new Error(`Detection post failed (${res.status})`)
  return res.json()
}
