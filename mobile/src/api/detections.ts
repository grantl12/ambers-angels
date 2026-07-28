import { apiGet } from "./client"

export type Detection = {
  id: string
  timestamp: string
  plateText?: string
  droneId?: string
  confidence?: number
  status: string
  alertType?: string | null
  lat?: number | null
  lng?: number | null
  vehicleColor?: string | null
  vehicleType?: string | null
  vehicleMake?: string | null
  vehicleModel?: string | null
  source?: string
  frameUrl?: string | null
}

export async function fetchDetectionsFeed(limit = 50): Promise<Detection[]> {
  return apiGet<Detection[]>(`/detections/feed?limit=${limit}`)
}
