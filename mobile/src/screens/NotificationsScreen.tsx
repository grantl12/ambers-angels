import React, { useCallback, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  Linking,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native"
import { useFocusEffect } from "@react-navigation/native"
import {
  AppNotification,
  fetchNotifications,
  markNotificationsRead,
} from "../api/notifications"

const TYPE_ICON: Record<string, string> = {
  alert_new:       "🚨",
  alert_cancelled: "✅",
  ncmec_resolved:  "✅",
  ncmec_review:    "🟠",
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  if (mins < 1)   return "just now"
  if (mins < 60)  return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

interface Props {
  onRead?: () => void
  onOpenNcmecReview?: (id: number) => void
}

export default function NotificationsScreen({ onRead, onOpenNcmecReview }: Props) {
  const [items, setItems]       = useState<AppNotification[]>([])
  const [loading, setLoading]   = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    try {
      const { notifications } = await fetchNotifications()
      setItems(notifications)
    } catch {
      // silently ignore — stale list stays visible
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      load()
      markNotificationsRead().catch(() => {})
      onRead?.()
    }, [load, onRead]),
  )

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#f59e0b" />
      </View>
    )
  }

  if (items.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>No notifications yet</Text>
        <Text style={styles.emptySub}>
          Alert notifications will appear here when you receive them.
        </Text>
      </View>
    )
  }

  return (
    <FlatList
      style={styles.list}
      data={items}
      keyExtractor={(n) => String(n.id)}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => load(true)}
          tintColor="#f59e0b"
        />
      }
      renderItem={({ item }) => {
        const pendingId = typeof item.data?.pendingId === "number" ? item.data.pendingId : null
        const reviewUrl = typeof item.data?.reviewUrl === "string" ? item.data.reviewUrl : null
        const onPress =
          pendingId != null && onOpenNcmecReview ? () => onOpenNcmecReview(pendingId)
          : reviewUrl ? () => Linking.openURL(reviewUrl)
          : null
        const Wrapper = onPress ? TouchableOpacity : View
        return (
          <Wrapper
            style={[styles.item, item.read_at ? styles.itemRead : styles.itemUnread]}
            {...(onPress ? { onPress } : {})}
          >
            <Text style={styles.icon}>
              {TYPE_ICON[item.type ?? ""] ?? "🔔"}
            </Text>
            <View style={styles.content}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.body}>{item.body}</Text>
              <Text style={styles.time}>{timeAgo(item.sent_at)}</Text>
            </View>
            {!item.read_at && <View style={styles.dot} />}
          </Wrapper>
        )
      }}
      ItemSeparatorComponent={() => <View style={styles.sep} />}
    />
  )
}

const styles = StyleSheet.create({
  list:       { flex: 1, backgroundColor: "#080f18" },
  center:     { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#080f18", padding: 32 },
  empty:      { color: "#fff", fontSize: 16, fontWeight: "600", marginBottom: 8 },
  emptySub:   { color: "rgba(255,255,255,0.45)", fontSize: 13, textAlign: "center" },
  item:       { flexDirection: "row", alignItems: "flex-start", padding: 16 },
  itemUnread: { backgroundColor: "rgba(245,158,11,0.07)" },
  itemRead:   { backgroundColor: "transparent" },
  icon:       { fontSize: 22, marginRight: 12, marginTop: 2 },
  content:    { flex: 1 },
  title:      { color: "#fff", fontSize: 14, fontWeight: "600", marginBottom: 3 },
  body:       { color: "rgba(255,255,255,0.7)", fontSize: 13, lineHeight: 18, marginBottom: 6 },
  time:       { color: "rgba(255,255,255,0.35)", fontSize: 11 },
  dot:        { width: 8, height: 8, borderRadius: 4, backgroundColor: "#f59e0b", marginTop: 6, marginLeft: 8 },
  sep:        { height: 1, backgroundColor: "rgba(255,255,255,0.06)", marginLeft: 16 },
})
