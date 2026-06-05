import { apiGet } from "./client"

export type Aircraft = {
  icao24: string
  callsign: string | null
  lat: number
  lng: number
  altitudeM: number | null
  velocityMs: number | null
  heading: number | null
  timePosition: number | null
}

export function fetchAirTraffic(
  south: number,
  north: number,
  west: number,
  east: number,
): Promise<Aircraft[]> {
  return apiGet<Aircraft[]>(
    `/airspace/traffic?south=${south}&north=${north}&west=${west}&east=${east}`,
  )
}
