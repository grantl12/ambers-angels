/**
 * Client-side auth helpers.
 * Token is stored in localStorage (for API requests) and a JS-readable
 * cookie (for Next.js middleware route protection).
 */

const TOKEN_KEY    = "aa_token"
const USERNAME_KEY = "aa_username"
const ROLE_KEY     = "aa_role"
const STATUS_KEY   = "aa_pilot_status"
const FULLNAME_KEY = "aa_fullname"

const COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 days

export type AuthState = {
  token:    string
  username: string
  fullName: string | null
  role:     string
  status:   string
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem(TOKEN_KEY)
}

export function getAuthState(): AuthState | null {
  if (typeof window === "undefined") return null
  const token = localStorage.getItem(TOKEN_KEY)
  if (!token) return null
  return {
    token,
    username: localStorage.getItem(USERNAME_KEY) ?? "",
    fullName: localStorage.getItem(FULLNAME_KEY),
    role:     localStorage.getItem(ROLE_KEY)     ?? "pilot",
    status:   localStorage.getItem(STATUS_KEY)   ?? "pending",
  }
}

export function setAuth(state: AuthState) {
  localStorage.setItem(TOKEN_KEY,    state.token)
  localStorage.setItem(USERNAME_KEY, state.username)
  localStorage.setItem(ROLE_KEY,     state.role)
  localStorage.setItem(STATUS_KEY,   state.status)
  if (state.fullName) localStorage.setItem(FULLNAME_KEY, state.fullName)
  // Cookie for middleware (not httpOnly so middleware can read it)
  document.cookie = `${TOKEN_KEY}=${state.token}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USERNAME_KEY)
  localStorage.removeItem(ROLE_KEY)
  localStorage.removeItem(STATUS_KEY)
  localStorage.removeItem(FULLNAME_KEY)
  document.cookie = `${TOKEN_KEY}=; path=/; max-age=0`
}

/**
 * Called by api-client on any 401 response. Clears the stale/expired token
 * and bounces to login with a message, instead of leaving pages showing
 * silently-empty data (the same shape of bug mobile's registerSessionExpiredHandler
 * was added to fix).
 */
export function handleSessionExpired() {
  if (typeof window === "undefined") return
  const hadToken = !!getToken()
  clearAuth()
  if (hadToken && window.location.pathname !== "/login") {
    window.location.href = "/login?expired=1"
  }
}
