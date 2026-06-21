/**
 * mobile/modules/dji-camera/waypoint-mission.ts
 *
 * Waypoint mission bridge — wraps the DJI MSDK V5 WaypointMissionManager
 * via the existing DJICamera native module.
 *
 * The Kotlin implementation (DJICameraModule.kt) adds:
 *   startWaypointMission(waypointsJson, optionsJson) → Promise<void>
 *   stopWaypointMission()                            → Promise<void>
 *   pauseMission()                                   → Promise<void>
 *   resumeMission()                                  → Promise<void>
 *   getMissionStatus()                               → Promise<MissionStatusResult>
 *   returnToHome()                                   → Promise<void>
 *   getBatteryLevel()                                → Promise<number>
 * And fires event: "DJIMissionStateChanged" with { state, progressPct?, errorCode?,
 *   waypointIndex?, totalWaypoints? }
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native'

const { DJICamera } = NativeModules

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WaypointMissionPoint = {
  lat: number
  lng: number
  altitudeM?: number    // defaults to mission altitude if omitted
  headingDeg?: number   // 0-359, defaults to auto
  speedMps?: number     // defaults to mission speed if omitted
}

export type WaypointMissionOptions = {
  altitudeM: number     // AGL, metres
  speedMps: number      // cruise speed
  finishedAction?: 'go_home' | 'hover' | 'land'
}

export type MissionState =
  | 'idle'
  | 'uploading'
  | 'ready_to_start'
  | 'executing'
  | 'interrupted'
  | 'finished'
  | 'disconnected'

export type MissionStateEvent = {
  state: MissionState
  progressPct?: number
  errorCode?: string
  waypointIndex?: number
  totalWaypoints?: number
}

// ---------------------------------------------------------------------------
// Internal guard
// ---------------------------------------------------------------------------

function assertModule(): void {
  if (!DJICamera) {
    throw new Error(
      'DJICamera native module is not available. ' +
        'Ensure the module is linked and you are running on Android.',
    )
  }
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Upload waypoints and start the mission.
 * Serializes both arguments to JSON strings before crossing the bridge so the
 * Kotlin side can deserialize with Gson / kotlinx.serialization.
 */
export async function startWaypointMission(
  waypoints: WaypointMissionPoint[],
  options: WaypointMissionOptions,
): Promise<void> {
  assertModule()
  if (!waypoints || waypoints.length === 0) {
    throw new Error('startWaypointMission: waypoints array must not be empty.')
  }
  const waypointsJson = JSON.stringify(waypoints)
  const optionsJson = JSON.stringify(options)
  await DJICamera.startWaypointMission(waypointsJson, optionsJson)
}

/**
 * Interrupt and cancel the currently executing waypoint mission.
 * The drone will hover in place; the coordinator can then issue a go-home
 * command separately if required.
 */
export async function stopWaypointMission(): Promise<void> {
  assertModule()
  await DJICamera.stopWaypointMission()
}

/**
 * Pause the executing mission — drone hovers at current position.
 * Use resumeMission() to continue from the pause point.
 */
export async function pauseMission(): Promise<void> {
  assertModule()
  await DJICamera.pauseMission()
}

/**
 * Resume a paused mission from where it stopped.
 */
export async function resumeMission(): Promise<void> {
  assertModule()
  await DJICamera.resumeMission()
}

/**
 * Query the current mission state from the native layer.
 * Returns idle / executing / finished etc. and a 0-100 progress percentage.
 */
export async function getMissionStatus(): Promise<{
  state: MissionState
  progressPct: number
}> {
  assertModule()
  const result = await DJICamera.getMissionStatus()
  return {
    state: (result.state as MissionState) ?? 'idle',
    progressPct: typeof result.progressPct === 'number' ? result.progressPct : 0,
  }
}

/**
 * Subscribe to real-time mission state change events emitted by the Kotlin
 * module as "DJIMissionStateChanged".
 *
 * @returns A cleanup function — call it (e.g. in useEffect return) to
 *          unsubscribe the listener.
 *
 * @example
 *   useEffect(() => {
 *     return onMissionStateChanged(({ state, progressPct }) => {
 *       setProgress(progressPct ?? 0)
 *     })
 *   }, [])
 */
export function onMissionStateChanged(
  callback: (event: MissionStateEvent) => void,
): () => void {
  if (!DJICamera) {
    // Return a no-op cleanup so callers don't need to branch.
    return () => {}
  }

  const emitter = new NativeEventEmitter(DJICamera)
  const subscription = emitter.addListener('DJIMissionStateChanged', callback)
  return () => subscription.remove()
}

/**
 * Read the drone's current GPS position from DJI telemetry.
 * Rejects if the SDK is not initialized or no GPS fix is available.
 */
export async function getDroneLocation(): Promise<{
  lat: number
  lng: number
  altitude: number
}> {
  assertModule()
  return DJICamera.getDroneLocation()
}

/**
 * Command the drone to return to its recorded home point.
 * Rejects if the SDK is not initialized or RTH command fails.
 */
export async function returnToHome(): Promise<void> {
  assertModule()
  await DJICamera.returnToHome()
}

/**
 * Returns the current battery charge level as a 0–100 integer.
 * Rejects with "NO_BATTERY" if the SDK has not yet received a battery update.
 */
export async function getBatteryLevel(): Promise<number> {
  assertModule()
  return DJICamera.getBatteryLevel()
}
