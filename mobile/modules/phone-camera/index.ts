/**
 * phone-camera — JS bridge for on-device plate recognition.
 *
 * Android: native Foreground Service with ML Kit OCR (ScanService.kt).
 * iOS: Vision framework text recognition via recognizePlate() — called from
 *      the CameraScreen JS capture loop since iOS has no background camera.
 *
 * Both platforms post only plate text + confidence + GPS to the server.
 * No raw frames leave the device.
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

export interface PlateCandidate {
  plate: string
  confidence: number
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

/**
 * Run on-device plate recognition on a local image (iOS only).
 * Uses Apple Vision framework VNRecognizeTextRequest.
 * Returns plate candidates sorted by confidence descending.
 */
export async function recognizePlate(imageUri: string): Promise<PlateCandidate[]> {
  if (Platform.OS !== 'ios' || !PhoneCamera?.recognizePlate) return []
  return PhoneCamera.recognizePlate(imageUri)
}
