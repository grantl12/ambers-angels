/**
 * FeedScreen — live detection event feed with relative timestamps and per-device filter.
 */
import React, { useCallback, useEffect, useState } from "react"
import AsyncStorage from "@react-native-async-storage/async-storage"
import {
  FlatList,
  Image,
  Linking,
  Modal,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native"
import { fetchDetectionsFeed, type Detection } from "../api/detections"
import { fetchAlertHistory, type AlertHistory } from "../api/alerts"
import { fetchNcmecRecent, type NcmecCase } from "../api/ncmec"
import { getApiBaseUrl } from "../api/client"

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

function DetectionCard({ item, onPress }: { item: Detection; onPress: () => void }) {
  const isAlert   = item.status === "alerted"
  const alertBadge = item.alertType ? ALERT_BADGE[item.alertType.toLowerCase()] : null

  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress} style={[styles.card, isAlert && styles.cardAlert]}>
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
    </TouchableOpacity>
  )
}

// ---------------------------------------------------------------------------
// Alert history card
// ---------------------------------------------------------------------------

function HistoryCard({ item, onPress }: { item: AlertHistory; onPress: () => void }) {
  const alertBadge = item.alertType ? ALERT_BADGE[item.alertType.toLowerCase()] : null

  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress} style={[styles.card, styles.cardAlert]}>
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

      {(item.vehicleColor || item.vehicleMake || item.vehicleModel || item.vehicleType) && (
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
        {item.sentAt && (
          <Text style={styles.metaTime}>{relativeTime(item.sentAt)}</Text>
        )}
        {item.channel && (
          <Text style={styles.metaText}>{item.channel}</Text>
        )}
      </View>
    </TouchableOpacity>
  )
}

// ---------------------------------------------------------------------------
// NCMEC missing persons card
// ---------------------------------------------------------------------------

function NcmecCard({ item, onPress }: { item: NcmecCase; onPress: () => void }) {
  const resolved = !!item.resolvedAt
  const age = item.missingSince
    ? (() => {
        const days = Math.floor((Date.now() - new Date(item.missingSince).getTime()) / 86_400_000)
        if (days < 1) return "today"
        if (days === 1) return "1 day ago"
        if (days < 30) return `${days}d ago`
        const months = Math.floor(days / 30)
        if (months < 12) return `${months}mo ago`
        return `${Math.floor(months / 12)}y ago`
      })()
    : null

  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress} style={[styles.card, resolved ? styles.cardResolved : styles.cardMissing]}>
      <View style={styles.cardRow}>
        <Text style={styles.missingName} numberOfLines={1}>
          {item.name || "Unknown"}
        </Text>
        <View style={styles.badgeRow}>
          {resolved ? (
            <View style={[styles.badge, { backgroundColor: "#16a34a" }]}>
              <Text style={styles.badgeText}>RESOLVED</Text>
            </View>
          ) : (
            <View style={[styles.badge, { backgroundColor: "#dc2626" }]}>
              <Text style={styles.badgeText}>MISSING</Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.meta}>
        {item.ageNow != null && (
          <Text style={styles.metaText}>Age {item.ageNow}</Text>
        )}
        {item.city && item.state && (
          <Text style={styles.metaText}>{item.city}, {item.state}</Text>
        )}
        {!item.city && item.state && (
          <Text style={styles.metaText}>{item.state}</Text>
        )}
        {age && (
          <Text style={styles.metaTime}>Missing {age}</Text>
        )}
      </View>
    </TouchableOpacity>
  )
}

// ---------------------------------------------------------------------------
// Detail modal — shared across detection / dispatched-alert / NCMEC cards
// ---------------------------------------------------------------------------

type Selected =
  | { kind: "detection"; item: Detection }
  | { kind: "history"; item: AlertHistory }
  | { kind: "missing"; item: NcmecCase }

function frameSrc(frameUrl: string | null | undefined): string | null {
  return frameUrl ? `${getApiBaseUrl()}${frameUrl}` : null
}

function openInMaps(lat: number, lng: number) {
  Linking.openURL(`https://maps.google.com/?q=${lat},${lng}`)
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === "") return null
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  )
}

function DetectionDetails({ item }: { item: Detection }) {
  return (
    <>
      <DetailRow label="Plate"       value={item.plateText} />
      <DetailRow label="Status"      value={item.status} />
      <DetailRow label="Alert type"  value={item.alertType} />
      <DetailRow label="Confidence"  value={item.confidence != null ? `${item.confidence.toFixed(0)}%` : null} />
      <DetailRow label="Vehicle"     value={[item.vehicleColor, item.vehicleMake, item.vehicleModel, item.vehicleType].filter(Boolean).join(" ") || null} />
      <DetailRow label="Device"      value={item.droneId} />
      <DetailRow label="Source"      value={item.source} />
      <DetailRow label="Detected"    value={item.timestamp ? new Date(item.timestamp).toLocaleString() : null} />
    </>
  )
}

function HistoryDetails({ item }: { item: AlertHistory }) {
  return (
    <>
      <DetailRow label="Plate"       value={item.plate} />
      <DetailRow label="Alert type"  value={item.alertType} />
      <DetailRow label="Description" value={item.description} />
      <DetailRow label="Confidence"  value={item.confidence != null ? `${item.confidence.toFixed(0)}%` : null} />
      <DetailRow label="Vehicle"     value={[item.vehicleColor, item.vehicleMake, item.vehicleModel, item.vehicleType].filter(Boolean).join(" ") || null} />
      <DetailRow label="Device"      value={item.droneId} />
      <DetailRow label="Channel"     value={item.channel} />
      <DetailRow label="Sent"        value={item.sentAt ? new Date(item.sentAt).toLocaleString() : null} />
    </>
  )
}

function MissingDetails({ item }: { item: NcmecCase }) {
  return (
    <>
      <DetailRow label="Name"           value={item.name} />
      <DetailRow label="Age now"        value={item.ageNow} />
      <DetailRow label="Location"       value={[item.city, item.state].filter(Boolean).join(", ") || null} />
      <DetailRow label="Missing since"  value={item.missingSince ? new Date(item.missingSince).toLocaleDateString() : null} />
      <DetailRow label="Status"         value={item.resolvedAt ? `Resolved ${new Date(item.resolvedAt).toLocaleDateString()}` : "Missing"} />
      {item.posterUrl && (
        <TouchableOpacity onPress={() => Linking.openURL(item.posterUrl!)}>
          <Text style={styles.sourceLink}>View NCMEC poster</Text>
        </TouchableOpacity>
      )}
    </>
  )
}

function DetailModal({ selected, onClose }: { selected: Selected | null; onClose: () => void }) {
  if (!selected) return null

  const title =
    selected.kind === "detection" ? (selected.item.plateText || "Detection")
    : selected.kind === "history"  ? (selected.item.plate || "Dispatched Alert")
    : (selected.item.name || "Missing Person")

  const image =
    selected.kind === "missing" ? (selected.item.photoUrl || selected.item.posterUrl)
    : frameSrc(selected.item.frameUrl)

  const lat = selected.kind === "missing" ? null : selected.item.lat
  const lng = selected.kind === "missing" ? null : selected.item.lng

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalRoot}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose} style={styles.modalHeaderBtn}>
            <Text style={styles.modalClose}>Close</Text>
          </TouchableOpacity>
          <Text style={styles.modalTitle} numberOfLines={1}>{title}</Text>
          <View style={styles.modalHeaderBtn} />
        </View>

        <ScrollView contentContainerStyle={styles.modalBody}>
          {image && (
            <Image source={{ uri: image }} style={styles.detailImage} resizeMode="cover" />
          )}

          {selected.kind === "detection" && <DetectionDetails item={selected.item} />}
          {selected.kind === "history"   && <HistoryDetails item={selected.item} />}
          {selected.kind === "missing"   && <MissingDetails item={selected.item} />}

          {lat != null && lng != null && (
            <TouchableOpacity onPress={() => openInMaps(lat, lng)} style={styles.mapLinkBtn}>
              <Text style={styles.mapLinkText}>📍 {lat.toFixed(5)}, {lng.toFixed(5)} — Open in Maps</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

type Filter = "all" | "hits" | "mine" | "history" | "missing"

export default function FeedScreen() {
  const [detections,  setDetections]  = useState<Detection[]>([])
  const [history,     setHistory]     = useState<AlertHistory[]>([])
  const [ncmecCases,  setNcmecCases]  = useState<NcmecCase[]>([])
  const [refreshing,  setRefreshing]  = useState(false)
  const [filter,      setFilter]      = useState<Filter>("all")
  const [myDeviceId,  setMyDeviceId]  = useState<string | null>(null)
  const [selected,    setSelected]    = useState<Selected | null>(null)

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

  const loadNcmec = useCallback(async () => {
    try {
      const data = await fetchNcmecRecent(40)
      setNcmecCases(data)
    } catch { /* show stale */ }
  }, [])

  // Live feed — auto-refresh every 5s
  useEffect(() => {
    loadDetections()
    const id = setInterval(loadDetections, 5000)
    return () => clearInterval(id)
  }, [loadDetections])

  // History + NCMEC — auto-refresh every 5s, same as the detection feed
  useEffect(() => {
    loadHistory()
    const id = setInterval(loadHistory, 5000)
    return () => clearInterval(id)
  }, [loadHistory])

  useEffect(() => {
    loadNcmec()
    const id = setInterval(loadNcmec, 5000)
    return () => clearInterval(id)
  }, [loadNcmec])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await Promise.all([loadDetections(), loadHistory(), loadNcmec()])
    setRefreshing(false)
  }, [loadDetections, loadHistory, loadNcmec])

  const visible: Detection[] = filter === "hits"
    ? detections.filter((d) => d.status === "alerted")
    : filter === "mine"
    ? detections.filter((d) => myDeviceId && d.droneId === myDeviceId)
    : detections

  const hitCount     = detections.filter((d) => d.status === "alerted").length
  const mineCount    = myDeviceId ? detections.filter((d) => d.droneId === myDeviceId).length : 0
  const activeMissing = ncmecCases.filter((c) => !c.resolvedAt).length

  const filters: Array<{ key: Filter; label: string; count?: number; visible: boolean }> = [
    { key: "all",     label: "All",     count: detections.length,  visible: true },
    { key: "hits",    label: "Hits",    count: hitCount,           visible: true },
    { key: "mine",    label: "Mine",    count: mineCount,          visible: !!myDeviceId },
    { key: "history", label: "Alerts",  count: history.length,     visible: true },
    { key: "missing", label: "Missing", count: activeMissing,      visible: true },
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
          renderItem={({ item }) => <HistoryCard item={item} onPress={() => setSelected({ kind: "history", item })} />}
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
      ) : filter === "missing" ? (
        <FlatList
          data={ncmecCases}
          keyExtractor={(c) => c.guid}
          renderItem={({ item }) => <NcmecCard item={item} onPress={() => setSelected({ kind: "missing", item })} />}
          contentContainerStyle={[styles.list, ncmecCases.length === 0 && styles.listEmpty]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#38bdf8" />
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyIcon}>🔍</Text>
              <Text style={styles.emptyTitle}>No recent missing persons cases</Text>
              <Text style={styles.emptyHint}>
                NCMEC cases from the last 30 days will appear here.
              </Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(d) => d.id}
          renderItem={({ item }) => <DetectionCard item={item} onPress={() => setSelected({ kind: "detection", item })} />}
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

      <DetailModal selected={selected} onClose={() => setSelected(null)} />
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
  cardMissing:  { borderColor: "rgba(220,38,38,0.35)", backgroundColor: "rgba(220,38,38,0.06)" },
  cardResolved: { borderColor: "rgba(22,163,74,0.25)",  backgroundColor: "rgba(22,163,74,0.05)"  },
  missingName:  { fontWeight: "700", fontSize: 15, color: "rgba(255,255,255,0.85)", flex: 1 },

  // Detail modal
  modalRoot: { flex: 1, backgroundColor: "#050a0f" },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  modalHeaderBtn: { minWidth: 56 },
  modalClose:  { color: "#38bdf8", fontSize: 15, fontWeight: "600" },
  modalTitle:  { flex: 1, textAlign: "center", color: "#fff", fontSize: 16, fontWeight: "700" },
  modalBody:   { padding: 16, gap: 2 },
  detailImage: { width: "100%", aspectRatio: 4 / 3, borderRadius: 10, marginBottom: 12, backgroundColor: "rgba(255,255,255,0.04)" },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  detailLabel: { fontSize: 13, color: "rgba(255,255,255,0.4)" },
  detailValue: { fontSize: 13, color: "rgba(255,255,255,0.9)", fontWeight: "600", flexShrink: 1, textAlign: "right", marginLeft: 12 },
  mapLinkBtn: { marginTop: 16, paddingVertical: 12, alignItems: "center", borderRadius: 8, backgroundColor: "rgba(56,189,248,0.12)" },
  mapLinkText: { color: "#38bdf8", fontSize: 13, fontWeight: "600" },
  sourceLink: { color: "#38bdf8", fontSize: 13, fontWeight: "600", marginTop: 12 },
})
