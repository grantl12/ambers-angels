import { apiGet } from "./client"

export type PriorityZone = {
  polygon:  string           // space-separated "lat,lng" pairs
  priority: "high" | "medium"
  label:    string           // e.g. "Northwest sector"
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
