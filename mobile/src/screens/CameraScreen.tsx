/**
 * CameraScreen — live camera view with periodic frame capture.
 *
 * Every `captureIntervalSec` seconds:
 *   1. Takes a JPEG snapshot
 *   2. Posts it to POST /ingest/frame along with current GPS
 *
 * GPS is also posted to POST /telemetry at ~1 Hz independently.
 */
import React, { useCallback, useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  AppState,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native"
import { CameraView, useCameraPermissions } from "expo-camera"
import * as Location from "expo-location"
import * as Notifications from "expo-notifications"
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake"
import { postFrame } from "../api/ingest"
import { postTelemetry } from "../api/telemetry"
import { setApiBaseUrl } from "../api/client"
import { fetchFemaAlerts, type FemaAlert } from "../api/fema"
import { loadSettings, type AppSettings } from "../lib/settings"
import { getAuthState } from "../lib/auth"
import { nearestAlert } from "../lib/polygon"
import {
  initializeDJI,
  isDJIConnected,
  captureDJIFrame,
  getDroneLocation,
  getDroneHeading,
  onDJIConnectionChanged,
} from "../../modules/dji-camera"
import {
  startBackgroundScan,
  stopBackgroundScan,
  getScanFrameCount,
} from "../../modules/phone-camera"

// Show notifications even when the app is foregrounded
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

// Minimum milliseconds between out-of-range notifications (5 min)
const NOTIF_COOLDOWN_MS = 5 * 60 * 1000

export default function CameraScreen() {
  const [camPermission, requestCamPermission] = useCameraPermissions()
  const [locPermission, setLocPermission] = useState<boolean | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [active, setActive] = useState(false)
  const [frameCount, setFrameCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [rangeWarning, setRangeWarning] = useState<{ miles: number; area: string } | null>(null)
  const [djiConnected, setDjiConnected] = useState(false)

  const cameraRef = useRef<CameraView>(null)
  const locationRef = useRef<Location.LocationObject | null>(null)
  const captureTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const djiCaptureTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const telemetryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const bgFrameTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const locationSubRef = useRef<Location.LocationSubscription | null>(null)
  const femaAlertsRef = useRef<FemaAlert[]>([])
  const wasOutsideRef = useRef(false)
  const lastNotifRef = useRef(0)
  const lastHitNotifRef = useRef(0)

  // Load settings once — also sync the in-memory API base URL so postFrame
  // hits the address the user configured in Settings, not the hardcoded default.
  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s)
      setApiBaseUrl(s.apiBaseUrl)
    })
  }, [])

  // Initialize DJI SDK and watch connection state
  useEffect(() => {
    const appKey = process.env.EXPO_PUBLIC_DJI_APP_KEY ?? ""
    if (appKey) initializeDJI(appKey).catch(() => {})
    isDJIConnected().then(setDjiConnected).catch(() => {})
    const unsub = onDJIConnectionChanged(({ connected }) => setDjiConnected(connected))
    return unsub
  }, [])

  // Request permissions
  useEffect(() => {
    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      setLocPermission(status === "granted")
    })
    Notifications.requestPermissionsAsync()
  }, [])

  // Watch GPS position — updates locationRef continuously
  useEffect(() => {
    if (!locPermission) return
    let sub: Location.LocationSubscription
    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 500 },
      (loc) => { locationRef.current = loc }
    ).then((s) => { sub = s })
    return () => sub?.remove()
  }, [locPermission])

  const stopMission = useCallback(() => {
    if (captureTimerRef.current)    clearInterval(captureTimerRef.current)
    if (djiCaptureTimerRef.current) clearInterval(djiCaptureTimerRef.current)
    if (telemetryTimerRef.current)  clearInterval(telemetryTimerRef.current)
    if (bgFrameTimerRef.current)    clearInterval(bgFrameTimerRef.current)
    locationSubRef.current?.remove()
    captureTimerRef.current    = null
    djiCaptureTimerRef.current = null
    telemetryTimerRef.current  = null
    bgFrameTimerRef.current    = null
    wasOutsideRef.current = false
    deactivateKeepAwake()
    // Stop the native background service on Android
    if (Platform.OS === 'android') stopBackgroundScan().catch(() => {})
    setActive(false)
    setFrameCount(0)
    setRangeWarning(null)
  }, [])

  const startMission = useCallback(async () => {
    if (!settings) return
    setError(null)

    const auth = await getAuthState()
    const scanAuthToken: string | undefined = auth?.token ?? undefined

    // Block scanning until there is a confirmed active FEMA/AMBER alert.
    // On network error, warn but allow — can't verify doesn't mean there isn't one.
    try {
      const alerts = await fetchFemaAlerts()
      if (alerts.length === 0) {
        setError("No active FEMA/AMBER alerts. Scanning is only available during an active search mission.")
        return
      }
      femaAlertsRef.current = alerts
    } catch {
      setError("Could not reach server to confirm active alerts — proceeding offline.")
      // Fall through — don't hard-block on a network failure
    }

    setError(null)  // clear any transient warning now that mission is starting
    activateKeepAwakeAsync()
    setActive(true)
    wasOutsideRef.current = false
    setRangeWarning(null)

    // Telemetry loop — ~1 Hz
    telemetryTimerRef.current = setInterval(async () => {
      const loc = locationRef.current
      if (!loc) return

      try {
        await postTelemetry({
          drone_id:      settings.droneId,
          pilot_id:      settings.pilotId || undefined,
          lat:           loc.coords.latitude,
          lng:           loc.coords.longitude,
          altitude:      loc.coords.altitude ?? undefined,
          heading:       loc.coords.heading ?? undefined,
          speed:         loc.coords.speed ?? undefined,
          accuracy:      loc.coords.accuracy ?? undefined,
          volunteerMode: settings.volunteerMode,
        })
      } catch {
        // Non-fatal — don't stop the mission
      }

      // Out-of-range check
      if (settings.notifOutsidePolygon && femaAlertsRef.current.length > 0) {
        const { latitude: lat, longitude: lon } = loc.coords
        const best = nearestAlert(lat, lon, femaAlertsRef.current)
        const isOutside = best !== null && best.miles > settings.alertRangeMiles

        if (isOutside) {
          setRangeWarning({
            miles: best.miles,
            area: best.alert.area ?? best.alert.alertType.toUpperCase(),
          })
          // Edge-triggered notification: only fire on the inside→outside transition
          // and no more often than once per NOTIF_COOLDOWN_MS
          const now = Date.now()
          if (!wasOutsideRef.current && now - lastNotifRef.current > NOTIF_COOLDOWN_MS) {
            lastNotifRef.current = now
            Notifications.scheduleNotificationAsync({
              content: {
                title: `⚠️ Outside search area — ${best.miles.toFixed(1)} mi`,
                body: best.alert.area
                  ? `You are ${best.miles.toFixed(1)} mi from the ${best.alert.area} search area.`
                  : `You are ${best.miles.toFixed(1)} mi outside the active search polygon.`,
                sound: true,
              },
              trigger: null,
            })
          }
        } else {
          setRangeWarning(null)
        }
        wasOutsideRef.current = isOutside
      }
    }, 1000)

    // Phone camera frame capture
    if (settings.volunteerMode === "phone" || settings.volunteerMode === "both") {
      if (Platform.OS === "android") {
        // Android: start a native Foreground Service so scanning survives backgrounding.
        // The user can switch to Uber/Maps and frames keep uploading.
        startBackgroundScan({
          apiBase:    settings.apiBaseUrl,
          droneId:    settings.droneId,
          pilotId:    settings.pilotId || undefined,
          intervalMs: settings.captureIntervalSec * 1000,
          authToken:  scanAuthToken,
        }).catch(() => setError("Could not start background scan"))

        // Poll the native side for frame count to keep the HUD updated
        bgFrameTimerRef.current = setInterval(async () => {
          const n = await getScanFrameCount().catch(() => 0)
          setFrameCount(n)
        }, 2000)
      } else {
        // iOS: app must stay foregrounded — use expo-camera JS loop
        captureTimerRef.current = setInterval(async () => {
          if (!cameraRef.current) return
          try {
            const photo = await cameraRef.current.takePictureAsync({ quality: 0.9, skipProcessing: true })
            if (!photo) return
            const loc = locationRef.current
            const result = await postFrame({
              uri:      photo.uri,
              droneId:  settings.droneId,
              pilotId:  settings.pilotId || undefined,
              source:   "phone_gps",
              lat:      loc?.coords.latitude,
              lng:      loc?.coords.longitude,
              altitude: loc?.coords.altitude ?? undefined,
              heading:  loc?.coords.heading ?? undefined,
              speed:    loc?.coords.speed ?? undefined,
              accuracy: loc?.coords.accuracy ?? undefined,
            })
            setFrameCount((n) => n + 1)
            setError(null)
            if (result.watchlist_hit) {
              const now = Date.now()
              if (now - lastHitNotifRef.current > 60_000) {
                lastHitNotifRef.current = now
                const plate = result.outcomes?.[0]?.plate ?? "unknown"
                // Admins/coordinators already receive a server push — skip local
                // notification so they don't get the same alert twice.
                const auth2 = await getAuthState()
                const isCoordOrAdmin = auth2?.role === "admin" || auth2?.role === "coordinator"
                if (!isCoordOrAdmin) {
                  Notifications.scheduleNotificationAsync({
                    content: {
                      title: "🚨 WATCHLIST MATCH",
                      body: `Plate ${plate} matches an active alert`,
                      sound: true,
                      priority: Notifications.AndroidNotificationPriority.MAX,
                    },
                    trigger: null,
                  })
                }
              }
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : "unknown"
            setError(msg.includes("expired") || msg.includes("authorized")
              ? msg
              : `Frame upload failed — ${msg}`)
          }
        }, settings.captureIntervalSec * 1000)
      }
    }

    // DJI drone frame capture loop (volunteerMode: "drone" or "both")
    if (settings.volunteerMode === "drone" || settings.volunteerMode === "both") {
      djiCaptureTimerRef.current = setInterval(async () => {
        try {
          const b64 = await captureDJIFrame(90)
          if (!b64) return  // no frame yet / not connected

          // Prefer drone GPS over phone GPS for DJI frames
          const [djiLoc, djiHeading] = await Promise.all([getDroneLocation(), getDroneHeading()])
          const phoneLoc = locationRef.current

          await postFrame({
            // Encode base64 as a data URI so the same multipart upload path works
            uri:      `data:image/jpeg;base64,${b64}`,
            droneId:  settings.droneId,
            pilotId:  settings.pilotId || undefined,
            source:   "dji_sdk",
            lat:      djiLoc?.lat      ?? phoneLoc?.coords.latitude,
            lng:      djiLoc?.lng      ?? phoneLoc?.coords.longitude,
            altitude: djiLoc?.altitude ?? phoneLoc?.coords.altitude ?? undefined,
            heading:  djiHeading       ?? phoneLoc?.coords.heading  ?? undefined,
          })
          setFrameCount((n) => n + 1)
          setError(null)
        } catch {
          // Non-fatal — DJI frames are best-effort
        }
      }, settings.captureIntervalSec * 1000)
    }
  }, [settings])

  // Clean up on unmount
  useEffect(() => () => stopMission(), [stopMission])

  if (!camPermission) {
    return <LoadingView />
  }

  if (!camPermission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permText}>Camera access is required.</Text>
        <TouchableOpacity style={styles.btn} onPress={requestCamPermission}>
          <Text style={styles.btnText}>Continue</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <View style={styles.root}>
      <CameraView ref={cameraRef} style={styles.camera} facing="back">
        {/* HUD overlay */}
        <View style={styles.hud}>
          <View style={styles.hudRow}>
            <View style={[styles.dot, { backgroundColor: active ? "#22c55e" : "#ef4444" }]} />
            <Text style={styles.hudText}>
              {active ? "LIVE" : "STANDBY"}
            </Text>
          </View>
          {settings && (
            <Text style={styles.hudSub}>
              {settings.droneId} · every {settings.captureIntervalSec}s
              {"  "}{settings.volunteerMode === "phone" ? "📱" : settings.volunteerMode === "drone" ? "🚁" : "📱+🚁"}
            </Text>
          )}
          {(settings?.volunteerMode === "drone" || settings?.volunteerMode === "both") && (
            <Text style={[styles.hudSub, { color: djiConnected ? "#22c55e" : "#f87171" }]}>
              DJI {djiConnected ? "connected" : "not connected"}
            </Text>
          )}
          {active && Platform.OS === "android" && (
            <Text style={[styles.hudSub, { color: "#34d399" }]}>running in background</Text>
          )}
          {active && Platform.OS === "ios" && (settings?.volunteerMode === "phone" || settings?.volunteerMode === "both") && (
            <Text style={[styles.hudSub, { color: "#fbbf24" }]}>Keep this screen open — scanning stops if you switch away</Text>
          )}
          {error && (
            <Text style={[styles.hudSub, { color: "#f87171" }]}>{error}</Text>
          )}
        </View>

        {/* Out-of-range warning */}
        {rangeWarning && (
          <View style={styles.rangeWarning}>
            <Text style={styles.rangeWarningTitle}>
              ⚠  {rangeWarning.miles.toFixed(1)} mi outside search area
            </Text>
            <Text style={styles.rangeWarningBody} numberOfLines={1}>
              {rangeWarning.area}
            </Text>
          </View>
        )}

        {/* Start / Stop button */}
        <View style={styles.controls}>
          {settings?.volunteerMode === "drone" && (
            <View style={styles.rtmpNote}>
              <Text style={styles.rtmpNoteText}>
                🚁 RTMP feed is processed automatically — no need to tap Start Mission. Go live in DJI Fly and the system will start scanning when an alert is active.
              </Text>
            </View>
          )}
          <TouchableOpacity
            style={[styles.captureBtn, active && styles.captureBtnActive]}
            onPress={active ? stopMission : startMission}
          >
            <Text style={styles.captureBtnText}>
              {active ? "STOP MISSION" : settings?.volunteerMode === "drone" ? "START DJI SDK SCAN" : "START MISSION"}
            </Text>
          </TouchableOpacity>
        </View>
      </CameraView>
    </View>
  )
}

function LoadingView() {
  return (
    <View style={styles.center}>
      <ActivityIndicator color="#38bdf8" />
    </View>
  )
}

const styles = StyleSheet.create({
  root:              { flex: 1, backgroundColor: "#000" },
  camera:            { flex: 1 },
  center:            { flex: 1, backgroundColor: "#050a0f", alignItems: "center", justifyContent: "center" },
  permText:          { color: "#fff", marginBottom: 16, fontSize: 16 },
  hud: {
    position: "absolute",
    top: 56,
    left: 16,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 8,
    padding: 10,
    gap: 4,
  },
  hudRow:            { flexDirection: "row", alignItems: "center", gap: 8 },
  dot:               { width: 10, height: 10, borderRadius: 5 },
  hudText:           { color: "#fff", fontWeight: "700", fontSize: 13, letterSpacing: 2 },
  hudSub:            { color: "rgba(255,255,255,0.55)", fontSize: 11 },
  controls: {
    position: "absolute",
    bottom: 48,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  btn: {
    backgroundColor: "#38bdf8",
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  btnText:           { color: "#060a0f", fontWeight: "700", fontSize: 14 },
  captureBtn: {
    backgroundColor: "#22c55e",
    borderRadius: 12,
    paddingHorizontal: 36,
    paddingVertical: 16,
  },
  captureBtnActive:  { backgroundColor: "#ef4444" },
  captureBtnText:    { color: "#fff", fontWeight: "800", fontSize: 15, letterSpacing: 1 },
  rangeWarning: {
    position: "absolute",
    top: 56,
    right: 16,
    backgroundColor: "rgba(234,88,12,0.92)",
    borderRadius: 8,
    padding: 10,
    maxWidth: 180,
    borderWidth: 1,
    borderColor: "rgba(251,146,60,0.6)",
  },
  rangeWarningTitle: { color: "#fff", fontWeight: "700", fontSize: 12 },
  rangeWarningBody:  { color: "rgba(255,255,255,0.75)", fontSize: 10, marginTop: 2 },
  rtmpNote: {
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "rgba(56,189,248,0.3)",
  },
  rtmpNoteText: {
    color: "#38bdf8",
    fontSize: 13,
    textAlign: "center" as const,
    lineHeight: 20,
  },
})
