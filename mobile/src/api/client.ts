/**
 * Base API client. All requests go through here so the base URL can be
 * changed from the Settings screen without restarting the app.
 */

let _baseUrl = "http://192.168.1.100:8000"

export function setApiBaseUrl(url: string) {
  _baseUrl = url.replace(/\/$/, "")
}

export function getApiBaseUrl(): string {
  return _baseUrl
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${_baseUrl}${path}`)
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`)
  return res.json()
}
