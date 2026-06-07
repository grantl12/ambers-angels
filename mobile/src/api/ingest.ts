import { getApiBaseUrl } from "./client"
import { getToken } from "../lib/auth"

export type FrameSource = "phone_gps" | "dji_sdk"

export type FramePayload = {
  uri: string
  droneId: string
  pilotId?: string
  lat?: number
  lng?: number
  altitude?: number
  heading?: number
  speed?: number
  accuracy?: number
  source?: FrameSource
}

export type FrameResult = {
  status: string
  watchlist_hit?: boolean
  outcomes?: { plate: string; confidence: number; status: string; alert_sent: boolean }[]
  capture_interval_ms?: number
}

export async function postFrame(payload: FramePayload): Promise<FrameResult> {
  const form = new FormData()
  form.append("file", {
    uri: payload.uri,
    type: "image/jpeg",
    name: "frame.jpg",
  } as unknown as Blob)
  form.append("drone_id", payload.droneId)
  form.append("source", payload.source ?? "phone_gps")
  if (payload.pilotId)  form.append("pilot_id",  payload.pilotId)
  if (payload.lat  != null) form.append("lat",      String(payload.lat))
  if (payload.lng  != null) form.append("lng",      String(payload.lng))
  if (payload.altitude != null) form.append("altitude", String(payload.altitude))
  if (payload.heading  != null) form.append("heading",  String(payload.heading))
  if (payload.speed    != null) form.append("speed",    String(payload.speed))
  if (payload.accuracy != null) form.append("accuracy", String(payload.accuracy))

  const token = await getToken()
  const headers: Record<string, string> = {}
  if (token) headers["Authorization"] = `Bearer ${token}`

  const res = await fetch(`${getApiBaseUrl()}/ingest/frame`, {
    method: "POST",
    headers,
    body: form,
  })
  if (res.status === 401) throw new Error("Session expired — please log out and log back in")
  if (res.status === 403) throw new Error("Account not authorized — contact your coordinator")
  if (!res.ok) throw new Error(`Upload failed (server ${res.status})`)
  return res.json()
}
