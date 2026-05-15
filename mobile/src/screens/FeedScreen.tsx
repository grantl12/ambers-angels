/**
 * FeedScreen — live detection event feed with relative timestamps and per-device filter.
 */
import React, { useCallback, useEffect, useState } from "react"
import AsyncStorage from "@react-native-async-storage/async-storage"
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native"
import { fetchDetectionsFeed, type Detection } from "../api/detections"
import { fetchAlertHistory, type AlertHistory } from "../api/alerts"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(isoStr: string | null | undefined): string {
  if (!isoStr) return ""
  const diffSec = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000)
  if (diffSec < 10)    return "just now"
  if (diffSec < 3600)  return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  return `${Math.floor(diffSec / 86400)}d ago`
}

const ALERT_BADGE: Record<string, { label: string; bg: string; fg: string }> = {
  amber:   { label: "AMBER",    bg: "#f59e0b", fg: "#000" },
  matties: { label: "MATTIE'S", bg: "#dc2626", fg: "#fff" },
  silver:  { label: "SILVER",   bg: "#94a3b8", fg: "#000" },
  blue:    { label: "BLUE",     bg: "#2563eb", fg: "#fff" },
  purple:  { label: "PURPLE",   bg: "#7c3aed", fg: "#fff" },
  mipa:    { label: "MIPA",     bg: "#ca8a04", fg: "#000" },
  ema:     { label: "EMA",      bg: "#d97706", fg: "#000" },
}

// ---------------------------------------------------------------------------
// Detection card
// ---------------------------------------------------------------------------

function DetectionCard({ item }: { item: Detection }) {
  const isAlert   = item.status === "alerted"
  const alertBadge = item.alertType ? ALERT_BADGE[item.alertType.toLowerCase()] : null

  return (
    <View style={[styles.card, isAlert && styles.cardAlert]}>
      <View style={styles.cardRow}>
        <Text style={[styles.plate, isAlert && styles.plateAlert]}>
          {item.plateText || "—"}
        </Text>
        <View style={styles.badgeRow}>
          {alertBadge && (
            <View style={[styles.badge, { backgroundColor: alertBadge.bg }]}>
              <Text style={[styles.badgeText, { color: alertBadge.fg }]}>{alertBadge.label}</Text>
            </View>
          )}
          {isAlert && !alertBadge && (
            <View style={[styles.badge, { backgroundColor: "#ef4444" }]}>
              <Text style={styles.badgeText}>HIT</Text>
            </View>
          )}
          {item.source === "fema" && (
            <View style={[styles.badge, { backgroundColor: "#f97316" }]}>
              <Text style={styles.badgeText}>FEMA</Text>
            </View>
          )}
          {item.source === "dji_sdk" && (
            <View style={[styles.badge, { backgroundColor: "#38bdf8" }]}>
              <Text style={[styles.badgeText, { color: "#000" }]}>DJI</Text>
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
        {item.timestamp && (
          <Text style={styles.metaTime}>{relativeTime(item.timestamp)}</Text>
        )}
      </View>
    </View>
  )
}

// ---------------------------------------------------------------------------
// Alert history card
// ---------------------------------------------------------------------------

function HistoryCard({ item }: { item: AlertHistory }) {
  const alertBadge = item.alertType ? ALERT_BADGE[item.alertType.toLowerCase()] : null

  return (
    <View style={[styles.card, styles.cardAlert]}>
      <View style={styles.cardRow}>
        <Text style={styles.plateAlert}>
          {item.plate || "—"}
        </Text>
        <View style={styles.badgeRow}>
          {alertBadge && (
            <View style={[styles.badge, { backgroundColor: alertBadge.bg }]}>
              <Text style={[styles.badgeText, { color: alertBadge.fg }]}>{alertBadge.label}</Text>
            </View>
          )}
          <View style={[styles.badge, { backgroundColor: "#22c55e" }]}>
            <Text style={styles.badgeText}>DISPATCHED</Text>
          </View>
        </View>
      </View>

      {(item.vehicleColor || item.vehicleMake || item.vehicleType) && (
        <Text style={styles.vehicle} numberOfLines={1}>
          {[item.vehicleColor, item.vehicleMake, item.vehicleType]
            .filter(Boolean)
            .join(" ")}
        </Text>
      )}

      <View style={styles.meta}>
        {item.droneId && <Text style={styles.metaText}>{item.droneId}</Text>}
        {item.confidence != null && item.confidence > 0 && (
          <Text style={styles.metaText}>{item.confidence.toFixed(0)}%</Text>
        )}
        {item.sentAt && (
          <Text style={styles.metaTime}>{relativeTime(item.sentAt)}</Text>
        )}
        {item.channel && (
          <Text style={styles.metaText}>{item.channel}</Text>
        )}
      </View>
    </View>
  )
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

type Filter = "all" | "hits" | "mine" | "history"

export default function FeedScreen() {
  const [detections,  setDetections]  = useState<Detection[]>([])
  const [history,     setHistory]     = useState<AlertHistory[]>([])
  const [refreshing,  setRefreshing]  = useState(false)
  const [filter,      setFilter]      = useState<Filter>("all")
  const [myDeviceId,  setMyDeviceId]  = useState<string | null>(null)

  useEffect(() => {
    AsyncStorage.getItem("aa_drone_id").then((id) => setMyDeviceId(id ?? null))
  }, [])

  const loadDetections = useCallback(async () => {
    try {
      const data = await fetchDetectionsFeed(100)
      setDetections(data)
    } catch { /* show stale */ }
  }, [])

  const loadHistory = useCallback(async () => {
    try {
      const data = await fetchAlertHistory(100)
      setHistory(data)
    } catch { /* show stale */ }
  }, [])

  // Live feed — auto-refresh every 5s
  useEffect(() => {
    loadDetections()
    const id = setInterval(loadDetections, 5000)
    return () => clearInterval(id)
  }, [loadDetections])

  // History — load once on mount, refresh on pull
  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await Promise.all([loadDetections(), loadHistory()])
    setRefreshing(false)
  }, [loadDetections, loadHistory])

  const visible: Detection[] = filter === "hits"
    ? detections.filter((d) => d.status === "alerted")
    : filter === "mine"
    ? detections.filter((d) => myDeviceId && d.droneId === myDeviceId)
    : detections

  const hitCount  = detections.filter((d) => d.status === "alerted").length
  const mineCount = myDeviceId ? detections.filter((d) => d.droneId === myDeviceId).length : 0

  const filters: Array<{ key: Filter; label: string; count?: number; visible: boolean }> = [
    { key: "all",     label: "All",     count: detections.length,  visible: true },
    { key: "hits",    label: "Hits",    count: hitCount,           visible: true },
    { key: "mine",    label: "Mine",    count: mineCount,          visible: !!myDeviceId },
    { key: "history", label: "Alerts",  count: history.length,     visible: true },
  ]

  return (
    <View style={styles.root}>
      {/* Filter bar */}
      <View style={styles.filterBar}>
        {filters.filter((f) => f.visible).map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterBtn, filter === f.key && styles.filterBtnActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.filterText, filter === f.key && styles.filterTextActive]}>
              {f.label}
              {(f.count != null && f.count > 0) ? (
                <Text style={styles.filterCount}> {f.count}</Text>
              ) : null}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {filter === "history" ? (
        <FlatList
          data={history}
          keyExtractor={(d) => String(d.id)}
          renderItem={({ item }) => <HistoryCard item={item} />}
          contentContainerStyle={[styles.list, history.length === 0 && styles.listEmpty]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#38bdf8" />
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyIcon}>📋</Text>
              <Text style={styles.emptyTitle}>No dispatched alerts</Text>
              <Text style={styles.emptyHint}>
                High-confidence watchlist hits that were sent to coordinators will appear here.
              </Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(d) => d.id}
          renderItem={({ item }) => <DetectionCard item={item} />}
          contentContainerStyle={[styles.list, visible.length === 0 && styles.listEmpty]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#38bdf8" />
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyIcon}>{filter === "hits" ? "🎯" : filter === "mine" ? "📱" : "📡"}</Text>
              <Text style={styles.emptyTitle}>
                {filter === "hits" ? "No hits yet" : filter === "mine" ? "No detections from your device" : "No detections yet"}
              </Text>
              <Text style={styles.emptyHint}>
                {filter === "hits"
                  ? "Detections matching a watchlist plate will appear here."
                  : filter === "mine"
                  ? "Start a mission on the Camera tab to begin scanning."
                  : "Start a mission on the Camera tab to begin scanning plates."}
              </Text>
            </View>
          }
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root:       { flex: 1, backgroundColor: "#050a0f" },
  filterBar: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.07)",
  },
  filterBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  filterBtnActive: {
    backgroundColor: "rgba(56,189,248,0.12)",
    borderColor: "#38bdf8",
  },
  filterText:       { fontSize: 13, fontWeight: "600", color: "rgba(255,255,255,0.4)" },
  filterTextActive: { color: "#38bdf8" },
  filterCount:      { fontWeight: "800" },
  list:             { padding: 12, gap: 8 },
  listEmpty:        { flex: 1 },
  card: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 10,
    padding: 12,
    gap: 4,
    marginBottom: 8,
  },
  cardAlert: {
    borderColor: "rgba(239,68,68,0.4)",
    backgroundColor: "rgba(239,68,68,0.08)",
  },
  cardRow:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  plate:      { fontFamily: "monospace", fontSize: 17, fontWeight: "700", color: "#fbbf24", letterSpacing: 2 },
  plateAlert: { fontFamily: "monospace", fontSize: 17, fontWeight: "700", color: "#fbbf24", letterSpacing: 2 },
  badgeRow:   { flexDirection: "row", gap: 4, flexWrap: "wrap", justifyContent: "flex-end", maxWidth: "55%" },
  badge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText:  { fontSize: 9, fontWeight: "800", letterSpacing: 0.5, color: "#fff" },
  vehicle:    { fontSize: 12, color: "rgba(255,255,255,0.55)", textTransform: "capitalize" },
  meta:       { flexDirection: "row", gap: 10, marginTop: 2, flexWrap: "wrap" },
  metaText:   { fontSize: 11, color: "rgba(255,255,255,0.35)" },
  metaGps:    { fontSize: 11, color: "#34d399", fontWeight: "600" },
  metaTime:   { fontSize: 11, color: "rgba(255,255,255,0.25)", marginLeft: "auto" },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    gap: 10,
  },
  emptyIcon:  { fontSize: 40, marginBottom: 4 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: "rgba(255,255,255,0.4)", textAlign: "center" },
  emptyHint:  { fontSize: 13, color: "rgba(255,255,255,0.22)", textAlign: "center", lineHeight: 20 },
})
