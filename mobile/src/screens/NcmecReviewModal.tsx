import React, { useCallback, useEffect, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native"
import {
  approveNcmecPending,
  dismissNcmecPending,
  fetchNcmecPending,
  ncmecReviewWebUrl,
  type NcmecPendingDetail,
} from "../api/ncmec"

type Props = {
  pendingId: number | null
  onClose:   () => void
}

/**
 * Quick in-app approve/dismiss for an NCMEC pending review — no map required.
 * Dragging/resizing the search zone still requires the web admin panel
 * (see .claude/architecture.md); this modal only offers a deep link out to it.
 */
export default function NcmecReviewModal({ pendingId, onClose }: Props) {
  const [detail,  setDetail]  = useState<NcmecPendingDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [busy,    setBusy]    = useState<"approve" | "dismiss" | null>(null)

  const load = useCallback(async (id: number) => {
    setLoading(true)
    setError(null)
    setDetail(null)
    try {
      setDetail(await fetchNcmecPending(id))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (pendingId != null) load(pendingId)
  }, [pendingId, load])

  function handleApprove() {
    if (!detail) return
    const area = detail.area || detail.state || "this area"
    Alert.alert(
      "Approve alert?",
      `The national system did not create this alert — approving will notify volunteers in ${area}.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Approve",
          onPress: async () => {
            setBusy("approve")
            try {
              await approveNcmecPending(detail.id, detail.polygon ?? "")
              Alert.alert("Approved", "Volunteers in the area are being notified.")
              onClose()
            } catch (e) {
              Alert.alert("Approve failed", e instanceof Error ? e.message : "Unknown error")
            } finally {
              setBusy(null)
            }
          },
        },
      ],
    )
  }

  function handleDismiss() {
    if (!detail) return
    Alert.alert(
      "Dismiss this match?",
      "No alert will be created.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Dismiss",
          style: "destructive",
          onPress: async () => {
            setBusy("dismiss")
            try {
              await dismissNcmecPending(detail.id)
              onClose()
            } catch (e) {
              Alert.alert("Dismiss failed", e instanceof Error ? e.message : "Unknown error")
            } finally {
              setBusy(null)
            }
          },
        },
      ],
    )
  }

  const canQuickApprove = !!detail?.polygon
  const decided = !!detail && detail.status !== "pending"

  return (
    <Modal visible={pendingId != null} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.headerBtn}>
            <Text style={styles.cancel}>Close</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Review Match</Text>
          <View style={styles.headerBtn} />
        </View>

        {loading && (
          <View style={styles.center}><ActivityIndicator color="#f59e0b" /></View>
        )}
        {error && !loading && (
          <View style={styles.center}><Text style={styles.error}>{error}</Text></View>
        )}

        {detail && !loading && (
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.headline}>
              {detail.headline || detail.vehicleDescription || "Vehicle match"}
            </Text>
            <Text style={styles.sub}>{detail.area || detail.state || "Unknown area"}</Text>

            <View style={styles.card}>
              {!!detail.vehicleDescription && <Row label="Vehicle" value={detail.vehicleDescription} />}
              {!!detail.vehiclePlate && <Row label="Plate" value={detail.vehiclePlate} />}
              {!!detail.matchedTarget && (
                <Row
                  label="Matched active target"
                  value={
                    [detail.matchedTarget.color, detail.matchedTarget.bodyType, detail.matchedTarget.make]
                      .filter(Boolean).join(" ") || "—"
                  }
                />
              )}
              {!!detail.posterUrl && (
                <TouchableOpacity onPress={() => Linking.openURL(detail.posterUrl as string)}>
                  <Text style={styles.link}>View NCMEC poster</Text>
                </TouchableOpacity>
              )}
            </View>

            {decided ? (
              <Text style={styles.decided}>Status: {detail.status}</Text>
            ) : (
              <>
                {!canQuickApprove && (
                  <Text style={styles.warn}>
                    No search zone geocoded yet — use &ldquo;Adjust Search Zone&rdquo; on web to set one before approving.
                  </Text>
                )}
                <TouchableOpacity
                  style={[styles.btn, styles.btnPrimary, (!canQuickApprove || busy !== null) && styles.btnDisabled]}
                  disabled={!canQuickApprove || busy !== null}
                  onPress={handleApprove}
                >
                  <Text style={styles.btnPrimaryText}>
                    {busy === "approve" ? "Approving…" : "Approve & Push to Volunteers"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.btn, styles.btnSecondary, busy !== null && styles.btnDisabled]}
                  disabled={busy !== null}
                  onPress={() => Linking.openURL(ncmecReviewWebUrl(detail.id))}
                >
                  <Text style={styles.btnSecondaryText}>Adjust Search Zone (web)</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.btn, styles.btnGhost, busy !== null && styles.btnDisabled]}
                  disabled={busy !== null}
                  onPress={handleDismiss}
                >
                  <Text style={styles.btnGhostText}>
                    {busy === "dismiss" ? "Dismissing…" : "Dismiss"}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: "#080f18" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)",
  },
  headerBtn: { minWidth: 60 },
  title:     { fontSize: 15, fontWeight: "700", color: "#fff" },
  cancel:    { fontSize: 15, color: "rgba(255,255,255,0.45)" },
  center:    { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  error:     { color: "#ef4444", fontSize: 14, textAlign: "center" },
  content:   { padding: 20 },
  headline:  { color: "#fff", fontSize: 18, fontWeight: "700", marginBottom: 4 },
  sub:       { color: "rgba(255,255,255,0.45)", fontSize: 13, marginBottom: 16 },
  card: {
    backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 12, padding: 16,
    marginBottom: 20,
  },
  row:      { marginBottom: 10 },
  rowLabel: { color: "rgba(255,255,255,0.4)", fontSize: 11, textTransform: "uppercase", marginBottom: 2 },
  rowValue: { color: "#fff", fontSize: 14 },
  link:     { color: "#f59e0b", fontSize: 14, marginTop: 4 },
  decided:  { color: "rgba(255,255,255,0.5)", fontSize: 14, fontStyle: "italic" },
  warn:     { color: "#fbbf24", fontSize: 12, marginBottom: 12 },
  btn:      { borderRadius: 10, paddingVertical: 14, alignItems: "center", marginBottom: 12 },
  btnDisabled: { opacity: 0.4 },
  btnPrimary:      { backgroundColor: "#f59e0b" },
  btnPrimaryText:  { color: "#000", fontWeight: "700", fontSize: 15 },
  btnSecondary:     { backgroundColor: "rgba(255,255,255,0.1)" },
  btnSecondaryText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  btnGhost:      { backgroundColor: "rgba(255,255,255,0.05)" },
  btnGhostText:  { color: "rgba(255,255,255,0.6)", fontWeight: "600", fontSize: 15 },
})
