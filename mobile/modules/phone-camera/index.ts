/**
 * phone-camera — JS bridge to the Android background scan foreground service.
 *
 * On iOS all functions are no-ops (Apple does not allow background camera access).
 * The CameraScreen falls back to its expo-camera JS capture loop on iOS.
 */
import { NativeModules, Platform } from 'react-native'

const { PhoneCamera } = NativeModules

export interface ScanOptions {
  apiBase:     string
  droneId:     string
  pilotId?:    string
  authToken?:  string   // JWT — required for watchlist hit detection
  intervalMs?: number   // milliseconds between captures (default 1500)
}

/** Start background scanning. On Android this launches a foreground service. */
export async function startBackgroundScan(options: ScanOptions): Promise<void> {
  if (Platform.OS !== 'android' || !PhoneCamera) return
  return PhoneCamera.startScan({
    apiBase:    options.apiBase,
    droneId:    options.droneId,
    pilotId:    options.pilotId   ?? '',
    authToken:  options.authToken ?? '',
    intervalMs: options.intervalMs ?? 1500,
  })
}

/** Stop the background scan service. */
export async function stopBackgroundScan(): Promise<void> {
  if (Platform.OS !== 'android' || !PhoneCamera) return
  return PhoneCamera.stopScan()
}

/** Whether the scan service is currently running. */
export async function isScanRunning(): Promise<boolean> {
  if (Platform.OS !== 'android' || !PhoneCamera) return false
  return PhoneCamera.isRunning()
}

/** Frames uploaded since the service started (live count from native side). */
export async function getScanFrameCount(): Promise<number> {
  if (Platform.OS !== 'android' || !PhoneCamera) return 0
  return PhoneCamera.getFrameCount()
}
