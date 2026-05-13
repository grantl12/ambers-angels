/**
 * Persistent user settings using AsyncStorage.
 * Keeps API URL, pilot identity, and capture preferences across app restarts.
 */
import AsyncStorage from "@react-native-async-storage/async-storage"

export type VolunteerMode = "phone" | "drone" | "both"

export type AppSettings = {
  apiBaseUrl: string
  droneId: string
  pilotId: string
  captureIntervalSec: number  // seconds between frame captures
  alertRangeMiles: number
  notifOutsidePolygon: boolean
  volunteerMode: VolunteerMode
}

export const DEFAULTS: AppSettings = {
  apiBaseUrl: "https://amberangels.org/api",
  droneId: "phone-1",
  pilotId: "",
  captureIntervalSec: 5,
  alertRangeMiles: 25,
  notifOutsidePolygon: true,
  volunteerMode: "phone",
}

const KEY = "aa_settings"

export async function loadSettings(): Promise<AppSettings> {
  try {
    const json = await AsyncStorage.getItem(KEY)
    if (!json) return DEFAULTS
    return { ...DEFAULTS, ...JSON.parse(json) }
  } catch {
    return DEFAULTS
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(settings))
}
