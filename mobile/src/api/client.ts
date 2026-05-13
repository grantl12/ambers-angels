/**
 * Base API client. All requests go through here so the base URL can be
 * changed from the Settings screen without restarting the app.
 */
import { getToken } from "../lib/auth"

let _baseUrl = "https://amberangels.org/api"

export function setApiBaseUrl(url: string) {
  _baseUrl = url.replace(/\/$/, "")
}

export function getApiBaseUrl(): string {
  return _baseUrl
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${_baseUrl}${path}`, {
    headers: await authHeaders(),
  })
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`)
  return res.json()
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${_baseUrl}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? `PATCH ${path} → ${res.status}`)
  }
  return res.json()
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${_baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? `POST ${path} → ${res.status}`)
  }
  return res.json()
}
