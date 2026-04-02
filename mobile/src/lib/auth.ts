/**
 * JWT auth helpers — persisted in AsyncStorage.
 */
import AsyncStorage from "@react-native-async-storage/async-storage"

const KEY_TOKEN    = "aa_token"
const KEY_USERNAME = "aa_username"
const KEY_FULLNAME = "aa_fullname"
const KEY_ROLE     = "aa_role"
const KEY_STATUS   = "aa_status"

export type AuthState = {
  token:    string
  username: string
  fullName: string | null
  role:     string
  status:   string
}

export async function getAuthState(): Promise<AuthState | null> {
  const token = await AsyncStorage.getItem(KEY_TOKEN)
  if (!token) return null
  return {
    token,
    username: (await AsyncStorage.getItem(KEY_USERNAME)) ?? "",
    fullName: await AsyncStorage.getItem(KEY_FULLNAME),
    role:     (await AsyncStorage.getItem(KEY_ROLE))   ?? "pilot",
    status:   (await AsyncStorage.getItem(KEY_STATUS)) ?? "pending",
  }
}

export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(KEY_TOKEN)
}

export async function setAuth(state: AuthState): Promise<void> {
  await AsyncStorage.multiSet([
    [KEY_TOKEN,    state.token],
    [KEY_USERNAME, state.username],
    [KEY_ROLE,     state.role],
    [KEY_STATUS,   state.status],
    ...(state.fullName ? [[KEY_FULLNAME, state.fullName] as [string, string]] : []),
  ])
}

export async function clearAuth(): Promise<void> {
  await AsyncStorage.multiRemove([KEY_TOKEN, KEY_USERNAME, KEY_FULLNAME, KEY_ROLE, KEY_STATUS])
}
