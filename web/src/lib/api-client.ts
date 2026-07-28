import { env } from "@/lib/env"
import { getToken, handleSessionExpired } from "@/lib/auth"

function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function handle401(status: number) {
  if (status === 401) handleSessionExpired()
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${env.apiBaseUrl}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    cache: "no-store",
  })

  if (!response.ok) {
    handle401(response.status)
    throw new Error(`API request failed: ${response.status}`)
  }

  return response.json() as Promise<T>
}

export async function apiDelete<T>(path: string): Promise<T> {
  const response = await fetch(`${env.apiBaseUrl}${path}`, {
    method: "DELETE",
    headers: { ...authHeaders() },
  })
  if (!response.ok) {
    handle401(response.status)
    const err = await response.json().catch(() => ({ detail: response.statusText }))
    throw new Error(err.detail ?? `API request failed: ${response.status}`)
  }
  return response.json() as Promise<T>
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${env.apiBaseUrl}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    handle401(response.status)
    const err = await response.json().catch(() => ({ detail: response.statusText }))
    throw new Error(err.detail ?? `API request failed: ${response.status}`)
  }
  return response.json() as Promise<T>
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${env.apiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    handle401(response.status)
    const err = await response.json().catch(() => ({ detail: response.statusText }))
    throw new Error(err.detail ?? `API request failed: ${response.status}`)
  }

  return response.json() as Promise<T>
}
