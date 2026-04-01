import { getApiBaseUrl } from "./client"

export type FemaAlert = {
  id: number
  femaIdentifier: string
  alertType: string
  sourceProgram: string | null
  headline: string
  area: string | null
  polygon: string | null
  centroidLat: number | null
  centroidLng: number | null
  addedAt: string
  expiresAt: string | null
}

export async function fetchFemaAlerts(): Promise<FemaAlert[]> {
  const res = await fetch(`${getApiBaseUrl()}/fema/alerts`)
  if (!res.ok) throw new Error(`FEMA alerts fetch failed: ${res.status}`)
  return res.json()
}
