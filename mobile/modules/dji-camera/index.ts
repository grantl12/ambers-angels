/**
 * DJI Camera JS bridge.
 *
 * On Android this talks to DJICameraModule (Kotlin).
 * On iOS it's a no-op — DJI SDK Android only for now (no Mac to build iOS).
 */

import { NativeModules, NativeEventEmitter, Platform } from "react-native"

const { DJICamera: _NativeDJICamera } = NativeModules

// Stub so iOS builds don't crash
const NativeDJICamera = _NativeDJICamera ?? null

export type DJIConnectionEvent = {
  connected: boolean
  productId: number
}

export type DroneLocation = {
  lat: number
  lng: number
  altitude: number
}

const emitter = NativeDJICamera
  ? new NativeEventEmitter(NativeDJICamera)
  : null

/**
 * Register with DJI SDK.
 * Call once on app start (before any capture).
 * @param appKey - Your DJI developer app key (from developer.dji.com)
 */
export async function initializeDJI(appKey: string): Promise<void> {
  if (!NativeDJICamera || Platform.OS !== "android") return
  return NativeDJICamera.initialize(appKey)
}

/**
 * Returns true if a DJI drone/RC is currently connected.
 */
export async function isDJIConnected(): Promise<boolean> {
  if (!NativeDJICamera || Platform.OS !== "android") return false
  return NativeDJICamera.isConnected()
}

/**
 * Capture the latest video frame from the drone camera.
 * Returns a base64-encoded JPEG string, or null if not connected / no frame yet.
 * @param quality - JPEG quality 1-100 (default 50)
 */
export async function captureDJIFrame(quality = 50): Promise<string | null> {
  if (!NativeDJICamera || Platform.OS !== "android") return null
  try {
    return await NativeDJICamera.captureFrame(quality)
  } catch {
    return null
  }
}

/**
 * Get the drone's current GPS position from the flight controller.
 * Returns null if GPS is unavailable or no drone is connected.
 */
export async function getDroneLocation(): Promise<DroneLocation | null> {
  if (!NativeDJICamera || Platform.OS !== "android") return null
  try {
    return await NativeDJICamera.getDroneLocation()
  } catch {
    return null
  }
}

/**
 * Get the drone's current compass heading (degrees 0-360).
 */
export async function getDroneHeading(): Promise<number | null> {
  if (!NativeDJICamera || Platform.OS !== "android") return null
  try {
    return await NativeDJICamera.getDroneHeading()
  } catch {
    return null
  }
}

/**
 * Subscribe to drone connection/disconnection events.
 * Returns an unsubscribe function.
 */
export function onDJIConnectionChanged(
  callback: (event: DJIConnectionEvent) => void,
): () => void {
  if (!emitter) return () => {}
  const sub = emitter.addListener("DJIConnectionChanged", callback)
  return () => sub.remove()
}
