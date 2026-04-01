/**
 * FeedScreen — live detection event feed, auto-refreshing every 5 seconds.
 */
import React, { useCallback, useEffect, useState } from "react"
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { fetchDetectionsFeed, type Detection } from "../api/detections"

const ALERT_BADGE: Record<string, { label: string; bg: string; fg: string }> = {
  amber:   { label: "AMBER",   bg: "#f59e0b", fg: "#000" },
  matties: { label: "MATTIE'S", bg: "#dc2626", fg: "#fff" },
  silver:  { label: "SILVER",  bg: "#94a3b8", fg: "#000" },
  blue:    { label: "BLUE",    bg: "#2563eb", fg: "#fff" },
  purple:  { label: "PURPLE",  bg: "#7c3aed", fg: "#fff" },
  mipa:    { label: "MIPA",    bg: "#ca8a04", fg: "#000" },
  ema:     { label: "EMA",     bg: "#d97706", fg: "#000" },
}

function DetectionCard({ item }: { item: Detection }) {
  const isAlert = item.status === "alerted"
  const time = item.timestamp
    ? new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null

  return (
    <View style={[styles.card, isAlert && styles.cardAlert]}>
      <View style={styles.cardRow}>
        <Text style={[styles.plate, isAlert && styles.plateAlert]}>
          {item.plateText || "—"}
        </Text>
        <View style={styles.badgeRow}>
          {isAlert && (
            <View style={[styles.badge, { backgroundColor: "#ef4444" }]}>
              <Text style={styles.badgeText}>HIT</Text>
            </View>
          )}
          {item.source === "fema" && (
            <View style={[styles.badge, { backgroundColor: "#f97316" }]}>
              <Text style={styles.badgeText}>FEMA</Text>
            </View>
          )}
        </View>
      </View>

      {(item.vehicleColor || item.vehicleType || item.vehicleMake) && (
        <Text style={styles.vehicle} numberOfLines={1}>
          {[item.vehicleColor, item.vehicleMake, item.vehicleModel, item.vehicleType]
            .filter(Boolean)
            .join(" ")}
        </Text>
      )}

      <View style={styles.meta}>
        {item.droneId && <Text style={styles.metaText}>{item.droneId}</Text>}
        {item.confidence != null && item.confidence > 0 && (
          <Text style={styles.metaText}>{item.confidence.toFixed(0)}%</Text>
        )}
        {item.lat != null && <Text style={styles.metaGps}>GPS</Text>}
        {time && <Text style={styles.metaText}>{time}</Text>}
      </View>
    </View>
  )
}

export default function FeedScreen() {
  const [detections, setDetections] = useState<Detection[]>([])
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await fetchDetectionsFeed(50)
      setDetections(data)
    } catch {
      // silently fail — show stale data
    }
  }, [])

  // Auto-refresh every 5 seconds
  useEffect(() => {
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [load])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  return (
    <View style={styles.root}>
      <FlatList
        data={detections}
        keyExtractor={(d) => d.id}
        renderItem={({ item }) => <DetectionCard item={item} />}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#38bdf8"
          />
        }
        ListEmptyComponent={
          <Text style={styles.empty}>No detections yet</Text>
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  root:       { flex: 1, backgroundColor: "#050a0f" },
  list:       { padding: 12, gap: 8 },
  card: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 10,
    padding: 12,
    gap: 4,
  },
  cardAlert: {
    borderColor: "rgba(239,68,68,0.4)",
    backgroundColor: "rgba(239,68,68,0.08)",
  },
  cardRow:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  plate:      { fontFamily: "monospace", fontSize: 17, fontWeight: "700", color: "#fbbf24", letterSpacing: 2 },
  plateAlert: { color: "#fbbf24" },
  badgeRow:   { flexDirection: "row", gap: 4 },
  badge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText:  { fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  vehicle:    { fontSize: 12, color: "rgba(255,255,255,0.55)", textTransform: "capitalize" },
  meta:       { flexDirection: "row", gap: 10, marginTop: 2 },
  metaText:   { fontSize: 11, color: "rgba(255,255,255,0.35)" },
  metaGps:    { fontSize: 11, color: "#34d399", fontWeight: "600" },
  empty:      { textAlign: "center", color: "rgba(255,255,255,0.25)", marginTop: 80, fontSize: 14 },
})
