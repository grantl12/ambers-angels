import { useQuery } from "@tanstack/react-query"
import { apiGet } from "@/lib/api-client"

export type FlockCamera = {
  id: string
  lat: number
  lng: number
  heading: number | null
  road: string | null
  agency: string | null
  scrapedAt: string | null
}

export type FlockBbox = {
  south: number
  north: number
  west: number
  east: number
}

export function useFlockCameras(bbox?: FlockBbox) {
  const params = bbox
    ? `?south=${bbox.south}&north=${bbox.north}&west=${bbox.west}&east=${bbox.east}`
    : ""
  return useQuery<FlockCamera[]>({
    queryKey: ["flock", "cameras", bbox ?? null],
    queryFn:  () => apiGet<FlockCamera[]>(`/flock/cameras${params}`),
    enabled:  !!bbox,
    refetchInterval: 5 * 60_000,
    staleTime:       4 * 60_000,
  })
}

// Convert a US zip code to a rough bounding box via Nominatim.
export async function zipToBbox(zip: string, radiusMiles: number): Promise<FlockBbox | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?postalcode=${zip}&country=US&format=json&limit=1`,
      { headers: { "User-Agent": "AmberAngels/1.0" } }
    )
    const data = await res.json()
    if (!data.length) return null
    const lat = parseFloat(data[0].lat)
    const lng = parseFloat(data[0].lon)
    const degLat = radiusMiles / 69.0
    const degLng = radiusMiles / (69.0 * Math.cos((lat * Math.PI) / 180))
    return { south: lat - degLat, north: lat + degLat, west: lng - degLng, east: lng + degLng }
  } catch {
    return null
  }
}
