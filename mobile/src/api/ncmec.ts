import { apiGet, apiPost } from "./client"

export type NcmecCase = {
  guid:         string
  name:         string | null
  ageNow:       number | null
  state:        string | null
  city:         string | null
  missingSince: string | null
  posterUrl:    string | null
  photoUrl:     string | null
  firstSeenAt:  string | null
  resolvedAt:   string | null
}

export async function fetchNcmecRecent(limit = 40): Promise<NcmecCase[]> {
  return apiGet<NcmecCase[]>(`/ncmec/recent?limit=${limit}`)
}

// ── Coordinator pending-review flow ─────────────────────────────────────────

export type NcmecMatchedTarget = {
  color:    string | null
  bodyType: string | null
  make:     string | null
}

export type NcmecPendingDetail = {
  id:                 number
  caseGuid:           string
  state:              string | null
  area:               string | null
  headline:           string | null
  vehicleDescription: string | null
  vehiclePlate:       string | null
  photoUrl:           string | null
  posterUrl:          string | null
  centroidLat:        number | null
  centroidLng:        number | null
  polygon:            string | null
  status:             string
  createdAt:          string | null
  matchedTarget:      NcmecMatchedTarget | null
}

export function fetchNcmecPending(id: number): Promise<NcmecPendingDetail> {
  return apiGet<NcmecPendingDetail>(`/admin/ncmec-pending/${id}`)
}

/** Approves with whatever polygon is already saved — the "quick approve" path (no resize). */
export function approveNcmecPending(id: number, polygon: string): Promise<{ id: number; vehicleTargetId: number }> {
  return apiPost(`/admin/ncmec-pending/${id}/approve`, { polygon })
}

export function dismissNcmecPending(id: number): Promise<{ id: number; status: string }> {
  return apiPost(`/admin/ncmec-pending/${id}/dismiss`, {})
}

/** Web admin panel URL for dragging/resizing the search zone before approving. */
export function ncmecReviewWebUrl(id: number): string {
  return `https://amberangels.org/admin/ncmec-review/${id}`
}
