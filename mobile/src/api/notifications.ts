import { apiGet, apiPost } from "./client"

export interface AppNotification {
  id:      number
  title:   string
  body:    string
  type:    string | null
  data:    Record<string, unknown>
  sent_at: string
  read_at: string | null
}

export interface NotificationsResponse {
  notifications: AppNotification[]
  unread_count:  number
}

export function fetchNotifications(limit = 50): Promise<NotificationsResponse> {
  return apiGet<NotificationsResponse>(`/notifications?limit=${limit}`)
}

export function markNotificationsRead(ids?: number[]): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>("/notifications/mark-read", { ids: ids ?? null })
}
