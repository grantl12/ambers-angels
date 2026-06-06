/**
 * Base API client. All requests go through here so the base URL can be
 * changed from the Settings screen without restarting the app.
 */
import { getToken, clearAuth, isTokenExpired } from "../lib/auth"

let _baseUrl = "https://amberangels.org/api"

export function setApiBaseUrl(url: string) {
  _baseUrl = url.replace(/\/$/, "")
}

export function getApiBaseUrl(): string {
  return _baseUrl
}

// ── Session-expiry handling ──────────────────────────────────────────────────

let _onSessionExpired: (() => void) | null = null
let _sessionExpiredFired = false

/** App.tsx registers this once to navigate back to the login screen. */
export function registerSessionExpiredHandler(cb: () => void) {
  _onSessionExpired = cb
  _sessionExpiredFired = false
}

/** Called on login to re-arm the handler for the new session. */
export function resetSessionExpiredState() {
  _sessionExpiredFired = false
}

function fireSessionExpired() {
  if (_sessionExpiredFired) return
  _sessionExpiredFired = true
  clearAuth().catch(() => {})
  _onSessionExpired?.()
}

// ── Auth headers with expiry pre-check ──────────────────────────────────────

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken()
  if (!token) return {}
  if (isTokenExpired(token)) {
    fireSessionExpired()
    return {}
  }
  return { Authorization: `Bearer ${token}` }
}

// ── Request helpers ──────────────────────────────────────────────────────────

function handle401(path: string) {
  // Only fire session-expired when we had a token (unexpected 401, not public endpoint)
  getToken().then((token) => {
    if (token) fireSessionExpired()
  }).catch(() => {})
  throw new Error(`Unauthorized — session expired (${path})`)
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${_baseUrl}${path}`, {
    headers: await authHeaders(),
  })
  if (res.status === 401) return handle401(path) as never
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`)
  return res.json()
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${_baseUrl}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(body),
  })
  if (res.status === 401) return handle401(path) as never
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
  if (res.status === 401) return handle401(path) as never
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? `POST ${path} → ${res.status}`)
  }
  return res.json()
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${_baseUrl}${path}`, {
    method: "DELETE",
    headers: await authHeaders(),
  })
  if (res.status === 401) return handle401(path) as never
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? `DELETE ${path} → ${res.status}`)
  }
  return res.json()
}
