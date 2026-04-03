import { apiGet } from "./client"

export type Badge = {
  id:     string
  emoji:  string
  tier:   "bronze" | "silver" | "gold" | "platinum" | "special"
  name:   string
  desc:   string
  earned: boolean
}

export type BadgesResponse = {
  earned: number
  total:  number
  badges: Badge[]
}

export async function fetchMyBadges(): Promise<BadgesResponse> {
  return apiGet<BadgesResponse>("/pilots/my-badges")
}
