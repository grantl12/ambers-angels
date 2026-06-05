/**
 * MapScreen — live mission map showing all active drone positions and FEMA
 * alert polygons. Updates every 5 seconds (telemetry) / 60 seconds (alerts).
 *
 * Note: Android requires a Google Maps API key in app.json under
 * expo.android.config.googleMaps.apiKey before the map will render.
 * iOS uses Apple Maps and requires no key.
 */
import React, { useCallback, useEffect, useRef, useState } from "react"
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native"
import MapView, { Callout, Marker, Polygon, PROVIDER_DEFAULT } from "react-native-maps"
import * as Location from "expo-location"
import * as Notifications from "expo-notifications"
import { useFocusEffect } from "@react-navigation/native"
import { fetchLatestTelemetry, type DronePosition } from "../api/telemetry"
import { fetchFemaAlerts, type FemaAlert } from "../api/fema"
import { fetchPriorityZones, type PriorityZone } from "../api/coverage"
import { loadSettings } from "../lib/settings"
import { nearestAlert, parsePoly } from "../lib/polygon"
import { consumePendingAlertTarget } from "../lib/alertTarget"

// Alert type → fill/stroke colour for polygon overlays
const ALERT_COLORS: Record<string, { fill: string; stroke: string }> = {
  amber:   { fill: "rgba(245,158,11,0.18)",  stroke: "#f59e0b" },
  silver:  { fill: "rgba(148,163,184,0.18)", stroke: "#94a3b8" },
  matties: { fill: "rgba(239,68,68,0.18)",   stroke: "#ef4444" },
  blue:    { fill: "rgba(59,130,246,0.18)",  stroke: "#3b82f6" },
  purple:  { fill: "rgba(168,85,247,0.18)",  stroke: "#a855f7" },
  mipa:    { fill: "rgba(234,179,8,0.18)",   stroke: "#eab308" },
  ema:     { fill: "rgba(234,179,8,0.18)",   stroke: "#eab308" },
}
const DEFAULT_COLOR = { fill: "rgba(245,158,11,0.18)", stroke: "#f59e0b" }

function alertColor(type: string) {
  return ALERT_COLORS[type] ?? DEFAULT_COLOR
}

function volunteerEmoji(mode?: string): string {
  if (mode === "phone") return "🚗"
  if (mode === "both")  return "📱"
  return "🚁"
}

function parsePolygonCoords(polyStr: string): { latitude: number; longitude: number }[] {
  return parsePoly(polyStr).map(([lat, lng]) => ({ latitude: lat, longitude: lng }))
}

const CARROLLTON = { latitude: 33.5801, longitude: -85.0766, latitudeDelta: 0.5, longitudeDelta: 0.5 }

function alertToRegion(alert: FemaAlert) {
  if (alert.polygon) {
    const coords = parsePoly(alert.polygon)
    const lats = coords.map(([lat]) => lat)
    const lngs = coords.map(([, lng]) => lng)
    const minLat = Math.min(...lats), maxLat = Math.max(...lats)
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
    return {
      latitude:       (minLat + maxLat) / 2,
      longitude:      (minLng + maxLng) / 2,
      latitudeDelta:  Math.max(maxLat - minLat, 0.08) * 1.4,
      longitudeDelta: Math.max(maxLng - minLng, 0.08) * 1.4,
    }
  }
  if (alert.centroidLat != null && alert.centroidLng != null) {
    return { latitude: alert.centroidLat, longitude: alert.centroidLng, latitudeDelta: 0.3, longitudeDelta: 0.3 }
  }
  return null
}

export default function MapScreen() {
  const [drones, setDrones] = useState<DronePosition[]>([])
  const [myLocation, setMyLocation] = useState<{ latitude: number; longitude: number } | null>(null)
  const [femaAlerts, setFemaAlerts] = useState<FemaAlert[]>([])
  const [alertRangeMiles, setAlertRangeMiles] = useState(25)
  const [outsidePolygonNotif, setOutsidePolygonNotif] = useState(true)
  const [priorityZones, setPriorityZones] = useState<PriorityZone[]>([])
  const [showPriorityLayer, setShowPriorityLayer] = useState(true)
  const [showAlertPanel, setShowAlertPanel] = useState(false)

  const mapRef = useRef<MapView>(null)
  const seenAlertIds = useRef<Set<number>>(new Set())

  // Pan to any alert target queued by a notification tap
  useFocusEffect(
    useCallback(() => {
      const target = consumePendingAlertTarget()
      if (!target || !mapRef.current) return
      mapRef.current.animateToRegion({
        latitude:      target.lat,
        longitude:     target.lng,
        latitudeDelta:  0.25,
        longitudeDelta: 0.25,
      }, 600)
    }, [])
  )

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

  // Load settings
  useEffect(() => {
    loadSettings().then((s) => {
      setAlertRangeMiles(s.alertRangeMiles)
      setOutsidePolygonNotif(s.notifOutsidePolygon)
    })
  }, [])

  // Poll FEMA alerts; notify on new ones
  useEffect(() => {
    async function loadAlerts() {
      try {
        const alerts = await fetchFemaAlerts()
        // Detect newly arrived alerts and fire a device notification for each
        for (const a of alerts) {
          if (seenAlertIds.current.has(a.id)) continue
          seenAlertIds.current.add(a.id)
          // Skip on the very first load so we don't flood notifications for
          // alerts that were already active before the app opened
          if (seenAlertIds.current.size <= alerts.length) continue
          Notifications.scheduleNotificationAsync({
            content: {
              title: `🚨 ${(a.sourceProgram ?? a.alertType).toUpperCase()} — ${a.area ?? "Unknown area"}`,
              body: a.headline ?? "A new alert has been issued. Open the map for details.",
              sound: true,
              data: {
                centroidLat: a.centroidLat,
                centroidLng: a.centroidLng,
                label: a.area ?? a.alertType,
              },
            },
            trigger: null,
          })
        }
        setFemaAlerts(alerts)
        // Seed seen IDs on first load
        if (seenAlertIds.current.size === alerts.length) {
          for (const a of alerts) seenAlertIds.current.add(a.id)
        }
      } catch {
        // silently ignore — keep showing last known alerts
      }
    }
    loadAlerts()
    const id = setInterval(loadAlerts, 60_000)
    return () => clearInterval(id)
  }, [])

  // Poll drone telemetry
  const loadDrones = useCallback(async () => {
    try { setDrones(await fetchLatestTelemetry()) } catch {}
  }, [])

  useEffect(() => {
    loadDrones()
    const id = setInterval(loadDrones, 5000)
    return () => clearInterval(id)
  }, [loadDrones])

  // Fetch priority zones once on focus, refresh every 5 minutes
  useFocusEffect(
    useCallback(() => {
      fetchPriorityZones().then(setPriorityZones).catch(() => {})
      const id = setInterval(() => {
        fetchPriorityZones().then(setPriorityZones).catch(() => {})
      }, 5 * 60 * 1000)
      return () => clearInterval(id)
    }, [])
  )

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
        {/* Priority flight zones */}
        {showPriorityLayer && priorityZones.map((zone, i) => {
          const coords = parsePolygonCoords(zone.polygon)
            .filter(c => isFinite(c.latitude) && isFinite(c.longitude))
          if (coords.length < 3) return null
          const isHigh = zone.priority === "high"
          return (
            <Polygon
              key={`pz-${i}`}
              coordinates={coords}
              fillColor={isHigh ? "rgba(239,68,68,0.13)" : "rgba(245,158,11,0.10)"}
              strokeColor={isHigh ? "rgba(239,68,68,0.5)" : "rgba(245,158,11,0.4)"}
              strokeWidth={1}
            />
          )
        })}

        {/* FEMA alert polygons */}
        {femaAlerts.map((alert) => {
          if (!alert.polygon) return null
          const coords = parsePolygonCoords(alert.polygon)
            .filter(c => isFinite(c.latitude) && isFinite(c.longitude))
          if (coords.length < 3) return null
          const { fill, stroke } = alertColor(alert.alertType)
          return (
            <React.Fragment key={`alert-${alert.id}`}>
              <Polygon
                coordinates={coords}
                fillColor={fill}
                strokeColor={stroke}
                strokeWidth={2}
              />
              {alert.centroidLat != null && alert.centroidLng != null && (
                <Marker
                  coordinate={{ latitude: alert.centroidLat, longitude: alert.centroidLng }}
                  anchor={{ x: 0.5, y: 0.5 }}
                >
                  <View style={[styles.alertPin, { borderColor: stroke }]}>
                    <Text style={styles.alertPinText}>🚨</Text>
                  </View>
                  <Callout tooltip>
                    <View style={[styles.callout, { borderColor: stroke }]}>
                      <Text style={[styles.calloutTitle, { color: stroke }]}>
                        {(alert.sourceProgram ?? alert.alertType).toUpperCase()}
                      </Text>
                      {alert.headline ? (
                        <Text style={styles.calloutLine}>{alert.headline}</Text>
                      ) : null}
                      {alert.area ? (
                        <Text style={styles.calloutLine}>{alert.area}</Text>
                      ) : null}
                    </View>
                  </Callout>
                </Marker>
              )}
            </React.Fragment>
          )
        })}

        {/* Volunteer / drone markers */}
        {drones.filter(d =>
          d.lat != null && d.lng != null &&
          isFinite(d.lat) && isFinite(d.lng) &&
          (d.lat !== 0 || d.lng !== 0)
        ).map((drone) => (
          <Marker
            key={drone.droneId}
            coordinate={{ latitude: drone.lat, longitude: drone.lng }}
            pinColor="#a78bfa"
          >
            <View style={styles.droneMarker}>
              <Text style={styles.droneEmoji}>{volunteerEmoji(drone.volunteerMode)}</Text>
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

      {/* Volunteer count badge */}
      <View style={styles.badge}>
        <Text style={styles.badgeText}>
          {drones.length} volunteer{drones.length !== 1 ? "s" : ""} online
        </Text>
      </View>

      {/* Active alert count badge — tappable to open alert list panel */}
      {femaAlerts.length > 0 && (
        <TouchableOpacity
          style={[styles.badge, styles.alertBadge]}
          onPress={() => setShowAlertPanel((v) => !v)}
        >
          <Text style={styles.alertBadgeText}>
            {femaAlerts.length} active alert{femaAlerts.length !== 1 ? "s" : ""}  {showAlertPanel ? "▲" : "▼"}
          </Text>
        </TouchableOpacity>
      )}

      {/* Alert list panel */}
      {showAlertPanel && femaAlerts.length > 0 && (
        <View style={styles.alertPanel}>
          <View style={styles.alertPanelHeader}>
            <Text style={styles.alertPanelTitle}>Active Alerts</Text>
            <TouchableOpacity onPress={() => setShowAlertPanel(false)}>
              <Text style={styles.alertPanelClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.alertPanelScroll} keyboardShouldPersistTaps="handled">
            {femaAlerts.map((alert) => {
              const region = alertToRegion(alert)
              const typeColors: Record<string, string> = {
                amber: "#f59e0b", silver: "#94a3b8", blue: "#3b82f6",
                matties: "#dc2626", purple: "#a855f7", mipa: "#eab308", ema: "#eab308",
              }
              const dotColor = typeColors[alert.alertType] ?? "#f59e0b"
              return (
                <TouchableOpacity
                  key={alert.id}
                  style={styles.alertPanelRow}
                  onPress={() => {
                    if (!region) return
                    setShowAlertPanel(false)
                    mapRef.current?.animateToRegion(region, 600)
                  }}
                  disabled={!region}
                >
                  <View style={[styles.alertDot, { backgroundColor: dotColor }]} />
                  <View style={styles.alertPanelRowText}>
                    <Text style={styles.alertPanelHeadline} numberOfLines={2}>
                      {alert.headline || (alert.sourceProgram ?? alert.alertType).toUpperCase()}
                    </Text>
                    {alert.area ? (
                      <Text style={styles.alertPanelArea} numberOfLines={1}>{alert.area}</Text>
                    ) : null}
                  </View>
                  {region && <Text style={styles.alertPanelFly}>↗</Text>}
                </TouchableOpacity>
              )
            })}
          </ScrollView>
        </View>
      )}

      {/* Priority zones toggle */}
      {priorityZones.length > 0 && (
        <TouchableOpacity
          style={styles.priorityToggle}
          onPress={() => setShowPriorityLayer((v) => !v)}
        >
          <Text style={styles.priorityToggleText}>
            {showPriorityLayer ? "▣" : "□"} Flight priority zones
          </Text>
        </TouchableOpacity>
      )}

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
  root:        { flex: 1, backgroundColor: "#050a0f" },
  map:         { flex: 1 },
  droneMarker: { alignItems: "center", justifyContent: "center" },
  droneEmoji:  { fontSize: 24 },
  alertPin: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.7)",
    borderWidth: 2,
    alignItems: "center", justifyContent: "center",
  },
  alertPinText: { fontSize: 18 },
  callout: {
    backgroundColor: "#0f172a",
    borderRadius: 8,
    padding: 10,
    minWidth: 140,
    maxWidth: 220,
    borderWidth: 1,
    borderColor: "#a78bfa",
  },
  calloutTitle: { color: "#fff", fontWeight: "700", fontSize: 13, marginBottom: 4 },
  calloutLine:  { color: "rgba(255,255,255,0.6)", fontSize: 12 },
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
  badgeText: { color: "#a78bfa", fontSize: 12, fontWeight: "600" },
  alertBadge: {
    top: 52,
    borderColor: "rgba(245,158,11,0.4)",
  },
  alertBadgeText: { color: "#f59e0b", fontSize: 12, fontWeight: "600" },
  priorityToggle: {
    position: "absolute",
    bottom: 80,
    right: 16,
    backgroundColor: "rgba(10,15,22,0.88)",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.35)",
  },
  priorityToggleText: { color: "#f87171", fontSize: 12, fontWeight: "600" },
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
  alertPanel: {
    position: "absolute",
    top: 88,
    left: 16,
    right: 16,
    backgroundColor: "rgba(8,15,24,0.97)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.35)",
    maxHeight: 280,
    overflow: "hidden",
  },
  alertPanelHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.07)",
  },
  alertPanelTitle: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: "700", letterSpacing: 1.5, textTransform: "uppercase" },
  alertPanelClose: { color: "rgba(255,255,255,0.3)", fontSize: 16, lineHeight: 18 },
  alertPanelScroll: { maxHeight: 220 },
  alertPanelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  alertDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  alertPanelRowText: { flex: 1 },
  alertPanelHeadline: { color: "rgba(255,255,255,0.85)", fontSize: 13, fontWeight: "600" },
  alertPanelArea:     { color: "rgba(255,255,255,0.35)", fontSize: 11, marginTop: 2 },
  alertPanelFly:      { color: "rgba(56,189,248,0.5)", fontSize: 14, fontWeight: "700" },
})
