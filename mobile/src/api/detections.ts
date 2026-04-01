import { getApiBaseUrl } from "./client"

export type Detection = {
  id: string
  timestamp: string
  plateText?: string
  droneId?: string
  confidence?: number
  status: string
  lat?: number | null
  lng?: number | null
  vehicleColor?: string | null
  vehicleType?: string | null
  vehicleMake?: string | null
  vehicleModel?: string | null
  source?: string
}

export async function fetchDetectionsFeed(limit = 50): Promise<Detection[]> {
  const res = await fetch(`${getApiBaseUrl()}/detections/feed?limit=${limit}`)
  if (!res.ok) return []
  return res.json()
}
