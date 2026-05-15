import { apiGet } from "./client"

export type AlertHistory = {
  id:           number
  plate:        string | null
  droneId:      string | null
  channel:      string | null
  sentAt:       string | null
  vehicleColor: string | null
  vehicleType:  string | null
  vehicleMake:  string | null
  confidence:   number | null
  alertType:    string | null
  description:  string | null
}

export async function fetchAlertHistory(limit = 100): Promise<AlertHistory[]> {
  return apiGet<AlertHistory[]>(`/alerts/history?limit=${limit}`)
}
