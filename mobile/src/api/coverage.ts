import { apiGet } from "./client"

export type PriorityZone = {
  polygon:  string | null    // space-separated "lat,lng" pairs derived from GeoJSON geometry
  priority: "high" | "medium"
  label:    string
  name?:    string
}

export type CoverageCell = {
  polygon:           string
  cameraCountBucket: "0" | "1-3" | "4+"
  centroidLat:       number
  centroidLng:       number
}

export function fetchPriorityZones(): Promise<PriorityZone[]> {
  return apiGet<PriorityZone[]>("/coverage/priority-zones")
}

export function fetchCoverageMap(): Promise<CoverageCell[]> {
  return apiGet<CoverageCell[]>("/coverage/map")
}
