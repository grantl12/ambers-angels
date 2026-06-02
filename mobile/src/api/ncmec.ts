import { apiGet } from "./client"

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
