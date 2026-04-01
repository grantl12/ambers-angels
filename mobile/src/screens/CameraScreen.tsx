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
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native"
import { CameraView, useCameraPermissions } from "expo-camera"
import * as Location from "expo-location"
import { postFrame } from "../api/ingest"
import { postTelemetry } from "../api/telemetry"
import { loadSettings, type AppSettings } from "../lib/settings"

export default function CameraScreen() {
  const [camPermission, requestCamPermission] = useCameraPermissions()
  const [locPermission, setLocPermission] = useState<boolean | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [active, setActive] = useState(false)
  const [lastCapture, setLastCapture] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cameraRef = useRef<CameraView>(null)
  const locationRef = useRef<Location.LocationObject | null>(null)
  const captureTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const telemetryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const locationSubRef = useRef<Location.LocationSubscription | null>(null)

  // Load settings once
  useEffect(() => {
    loadSettings().then(setSettings)
  }, [])

  // Request location permission
  useEffect(() => {
    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      setLocPermission(status === "granted")
    })
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
    if (captureTimerRef.current)  clearInterval(captureTimerRef.current)
    if (telemetryTimerRef.current) clearInterval(telemetryTimerRef.current)
    locationSubRef.current?.remove()
    captureTimerRef.current  = null
    telemetryTimerRef.current = null
    setActive(false)
  }, [])

  const startMission = useCallback(() => {
    if (!settings) return
    setError(null)
    setActive(true)

    // Telemetry loop — ~1 Hz
    telemetryTimerRef.current = setInterval(async () => {
      const loc = locationRef.current
      if (!loc) return
      try {
        await postTelemetry({
          drone_id: settings.droneId,
          pilot_id: settings.pilotId || undefined,
          lat:      loc.coords.latitude,
          lng:      loc.coords.longitude,
          altitude: loc.coords.altitude ?? undefined,
          heading:  loc.coords.heading ?? undefined,
          speed:    loc.coords.speed ?? undefined,
          accuracy: loc.coords.accuracy ?? undefined,
        })
      } catch {
        // Non-fatal — don't stop the mission
      }
    }, 1000)

    // Frame capture loop
    captureTimerRef.current = setInterval(async () => {
      if (!cameraRef.current) return
      try {
        const photo = await cameraRef.current.takePictureAsync({ quality: 0.5, skipProcessing: true })
        if (!photo) return
        const loc = locationRef.current
        await postFrame({
          uri:      photo.uri,
          droneId:  settings.droneId,
          pilotId:  settings.pilotId || undefined,
          lat:      loc?.coords.latitude,
          lng:      loc?.coords.longitude,
          altitude: loc?.coords.altitude ?? undefined,
          heading:  loc?.coords.heading ?? undefined,
          speed:    loc?.coords.speed ?? undefined,
          accuracy: loc?.coords.accuracy ?? undefined,
        })
        setLastCapture(new Date().toLocaleTimeString())
        setError(null)
      } catch (e) {
        setError("Frame post failed — check API URL in Settings")
      }
    }, settings.captureIntervalSec * 1000)
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
          <Text style={styles.btnText}>Grant Permission</Text>
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
            </Text>
          )}
          {lastCapture && (
            <Text style={styles.hudSub}>Last frame: {lastCapture}</Text>
          )}
          {error && (
            <Text style={[styles.hudSub, { color: "#f87171" }]}>{error}</Text>
          )}
        </View>

        {/* Start / Stop button */}
        <View style={styles.controls}>
          <TouchableOpacity
            style={[styles.captureBtn, active && styles.captureBtnActive]}
            onPress={active ? stopMission : startMission}
          >
            <Text style={styles.captureBtnText}>
              {active ? "STOP MISSION" : "START MISSION"}
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
})
