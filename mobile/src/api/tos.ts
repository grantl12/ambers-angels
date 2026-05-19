import { apiGet, apiPost } from "./client"

export const CURRENT_TOS_VERSION = "2025-05-19"

export type TosStatus = {
  current_version: string
  accepted: boolean
  accepted_version: string | null
}

export async function fetchTosStatus(): Promise<TosStatus> {
  return apiGet<TosStatus>("/auth/tos-status")
}

export async function acceptTos(): Promise<void> {
  await apiPost("/auth/tos/accept", {})
}
