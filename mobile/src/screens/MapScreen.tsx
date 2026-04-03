/**
 * MapScreen — live mission map showing all active drone positions.
 * Updates every 5 seconds. Tap a drone marker to see its details.
 *
 * Note: Android requires a Google Maps API key in app.json under
 * expo.android.config.googleMaps.apiKey before the map will render.
 * iOS uses Apple Maps and requires no key.
 */
import React, { useCallback, useEffect, useRef, useState } from "react"
import {
  StyleSheet,
  Text,
  View,
} from "react-native"
import MapView, { Callout, Marker, PROVIDER_DEFAULT } from "react-native-maps"
import * as Location from "expo-location"
import { fetchLatestTelemetry, type DronePosition } from "../api/telemetry"
import { fetchFemaAlerts, type FemaAlert } from "../api/fema"
import { loadSettings } from "../lib/settings"
import { nearestAlert } from "../lib/polygon"

const CARROLLTON = { latitude: 33.5801, longitude: -85.0766, latitudeDelta: 0.08, longitudeDelta: 0.08 }

export default function MapScreen() {
  const [drones, setDrones] = useState<DronePosition[]>([])
  const [myLocation, setMyLocation] = useState<{ latitude: number; longitude: number } | null>(null)
  const [femaAlerts, setFemaAlerts] = useState<FemaAlert[]>([])
  const [alertRangeMiles, setAlertRangeMiles] = useState(25)
  const [outsidePolygonNotif, setOutsidePolygonNotif] = useState(true)

  const mapRef = useRef<MapView>(null)

  // Watch own GPS for a "my position" dot
  useEffect(() => {
    let sub: Location.LocationSubscription
    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      if (status !== "granted") return
      Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 2000 },
        (loc) => setMyLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude })
      ).then((s) => { sub = s })
    })
    return () => sub?.remove()
  }, [])

  // Load settings + FEMA alerts
  useEffect(() => {
    loadSettings().then(s => {
      setAlertRangeMiles(s.alertRangeMiles)
      setOutsidePolygonNotif(s.notifOutsidePolygon)
    })
    const loadAlerts = () => fetchFemaAlerts().then(setFemaAlerts).catch(() => {})
    loadAlerts()
    const id = setInterval(loadAlerts, 60_000)
    return () => clearInterval(id)
  }, [])

  // Poll drone telemetry
  const loadDrones = useCallback(async () => {
    try {
      const data = await fetchLatestTelemetry()
      setDrones(data)
    } catch {
      // silently ignore — keep showing last known positions
    }
  }, [])

  useEffect(() => {
    loadDrones()
    const id = setInterval(loadDrones, 5000)
    return () => clearInterval(id)
  }, [loadDrones])

  const polygonWarning = (() => {
    if (!outsidePolygonNotif || !myLocation || femaAlerts.length === 0) return null
    const best = nearestAlert(myLocation.latitude, myLocation.longitude, femaAlerts)
    if (!best || best.miles <= alertRangeMiles) return null
    return best
  })()

  return (
    <View style={styles.root}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        initialRegion={CARROLLTON}
        mapType="hybrid"
        showsUserLocation={true}
        showsMyLocationButton={true}
      >
        {drones.map((drone) => (
          <Marker
            key={drone.droneId}
            coordinate={{ latitude: drone.lat, longitude: drone.lng }}
            pinColor="#a78bfa"
          >
            <View style={styles.droneMarker}>
              <Text style={styles.droneEmoji}>🚁</Text>
            </View>
            <Callout tooltip>
              <View style={styles.callout}>
                <Text style={styles.calloutTitle}>{drone.droneId}</Text>
                {drone.altitude != null && (
                  <Text style={styles.calloutLine}>{drone.altitude.toFixed(0)} m AGL</Text>
                )}
                {drone.heading != null && (
                  <Text style={styles.calloutLine}>{Math.round(drone.heading)}°</Text>
                )}
                {drone.speed != null && (
                  <Text style={styles.calloutLine}>{drone.speed.toFixed(1)} m/s</Text>
                )}
              </View>
            </Callout>
          </Marker>
        ))}
      </MapView>

      {/* Drone count badge */}
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{drones.length} drone{drones.length !== 1 ? "s" : ""} online</Text>
      </View>

      {/* Outside search area warning */}
      {polygonWarning && (
        <View style={styles.polygonWarning}>
          <Text style={styles.polygonWarningTitle}>
            ⚠  {polygonWarning.miles.toFixed(1)} mi outside search area
          </Text>
          <Text style={styles.polygonWarningBody} numberOfLines={1}>
            {polygonWarning.alert.sourceProgram ?? polygonWarning.alert.alertType.toUpperCase()}
            {polygonWarning.alert.area ? ` · ${polygonWarning.alert.area}` : ""}
          </Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root:          { flex: 1, backgroundColor: "#050a0f" },
  map:           { flex: 1 },
  droneMarker:   { alignItems: "center", justifyContent: "center" },
  droneEmoji:    { fontSize: 24 },
  callout: {
    backgroundColor: "#0f172a",
    borderRadius: 8,
    padding: 10,
    minWidth: 120,
    borderWidth: 1,
    borderColor: "#a78bfa",
  },
  calloutTitle:  { color: "#fff", fontWeight: "700", fontSize: 13, marginBottom: 4 },
  calloutLine:   { color: "rgba(255,255,255,0.6)", fontSize: 12 },
  badge: {
    position: "absolute",
    top: 16,
    alignSelf: "center",
    backgroundColor: "rgba(10,15,22,0.85)",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.3)",
  },
  badgeText:     { color: "#a78bfa", fontSize: 12, fontWeight: "600" },
  polygonWarning: {
    position: "absolute",
    bottom: 24,
    left: 16,
    right: 16,
    backgroundColor: "rgba(234,88,12,0.92)",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(251,146,60,0.6)",
  },
  polygonWarningTitle: { color: "#fff", fontWeight: "700", fontSize: 13 },
  polygonWarningBody:  { color: "rgba(255,255,255,0.75)", fontSize: 11, marginTop: 2 },
})
