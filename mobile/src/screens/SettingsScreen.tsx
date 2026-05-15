/**
 * SettingsScreen — configure API connection, pilot identity, and capture settings.
 * All values persist via AsyncStorage across app restarts.
 */
import React, { useEffect, useState } from "react"
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native"
import { loadSettings, saveSettings, type AppSettings, type VolunteerMode, DEFAULTS } from "../lib/settings"
import { setApiBaseUrl, apiGet, apiPatch, apiPost, apiDelete } from "../api/client"
import { clearAuth } from "../lib/auth"
import { fetchMyBadges, type Badge } from "../api/badges"

type Props = { username: string | null; onSignOut: () => void }

export default function SettingsScreen({ username, onSignOut }: Props) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULTS)
  const [saved, setSaved] = useState(false)
  const [rtmpCopied, setRtmpCopied] = useState(false)
  const [watchAreas, setWatchAreas] = useState<string[]>([])
  const [watchInput, setWatchInput] = useState("")
  const [watchSaving, setWatchSaving] = useState(false)
  const [notifPrefs, setNotifPrefs] = useState<string[]>(["push", "email"])
  const [notifSaving, setNotifSaving] = useState(false)
  const [pilotRole, setPilotRole] = useState<string>("pilot")
  const [coordRequestedAt, setCoordRequestedAt] = useState<string | null>(null)
  const [coordReason, setCoordReason] = useState("")
  const [coordSubmitting, setCoordSubmitting] = useState(false)
  const [coordDone, setCoordDone] = useState(false)
  const [badges, setBadges] = useState<Badge[]>([])
  const [badgesEarned, setBadgesEarned] = useState(0)
  const [badgesTotal, setBadgesTotal] = useState(0)
  const [deletingAccount, setDeletingAccount] = useState(false)

  useEffect(() => {
    loadSettings().then(setSettings)
    apiGet<{ watchAreas?: string[]; notificationPrefs?: string[]; role?: string; coordinatorRequestedAt?: string | null }>("/auth/me")
      .then((data) => {
        setWatchAreas(data.watchAreas ?? [])
        setNotifPrefs(data.notificationPrefs ?? ["push", "email"])
        setPilotRole(data.role ?? "pilot")
        setCoordRequestedAt(data.coordinatorRequestedAt ?? null)
      })
      .catch(() => {})
    fetchMyBadges()
      .then((data) => {
        setBadges(data.badges)
        setBadgesEarned(data.earned)
        setBadgesTotal(data.total)
      })
      .catch(() => {})
  }, [])

  function getRtmpUrl(): string {
    try {
      const raw = settings.apiBaseUrl.trim().replace(/\/$/, "")
      const withProto = raw.startsWith("http") ? raw : `https://${raw}`
      const host = new URL(withProto).hostname
      return `rtmp://${host}/live/${settings.droneId || "drone-1"}`
    } catch {
      return `rtmp://api.amberangels.org/live/${settings.droneId || "drone-1"}`
    }
  }

  async function shareRtmpUrl() {
    try {
      await Share.share({ message: getRtmpUrl() })
      setRtmpCopied(true)
      setTimeout(() => setRtmpCopied(false), 2000)
    } catch {}
  }

  function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  async function handleSave() {
    const trimmed = { ...settings, apiBaseUrl: settings.apiBaseUrl.trim() }
    await saveSettings(trimmed)
    setApiBaseUrl(trimmed.apiBaseUrl)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function addWatchArea() {
    const area = watchInput.trim()
    if (!area || watchAreas.includes(area)) { setWatchInput(""); return }
    const next = [...watchAreas, area]
    setWatchAreas(next)
    setWatchInput("")
    await syncWatchAreas(next)
  }

  async function removeWatchArea(area: string) {
    const next = watchAreas.filter((a) => a !== area)
    setWatchAreas(next)
    await syncWatchAreas(next)
  }

  async function syncWatchAreas(areas: string[]) {
    setWatchSaving(true)
    try {
      await apiPatch("/auth/me", { watch_areas: areas })
    } catch {
      Alert.alert("Error", "Could not save watch areas. Check connection.")
    } finally {
      setWatchSaving(false)
    }
  }

  async function toggleNotifPref(pref: "push" | "email") {
    const next = notifPrefs.includes(pref)
      ? notifPrefs.filter((p) => p !== pref)
      : [...notifPrefs, pref]
    if (next.length === 0) return  // must keep at least one
    setNotifPrefs(next)
    setNotifSaving(true)
    try {
      await apiPatch("/auth/me", { notification_prefs: next })
    } catch {
      Alert.alert("Error", "Could not save notification preferences.")
      setNotifPrefs(notifPrefs) // revert
    } finally {
      setNotifSaving(false)
    }
  }

  async function requestCoordinatorAccess() {
    setCoordSubmitting(true)
    try {
      await apiPost("/auth/request-coordinator", { reason: coordReason || null })
      setCoordRequestedAt(new Date().toISOString())
      setCoordDone(true)
    } catch {
      Alert.alert("Error", "Could not submit request. Check your connection and try again.")
    } finally {
      setCoordSubmitting(false)
    }
  }

  async function handleSignOut() {
    Alert.alert("Sign out", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out", style: "destructive",
        onPress: async () => { await clearAuth(); onSignOut() },
      },
    ])
  }

  function handleDeleteAccount() {
    Alert.alert(
      "Delete Account",
      "This will permanently delete your account and all associated data. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete My Account",
          style: "destructive",
          onPress: confirmDeleteAccount,
        },
      ],
    )
  }

  async function confirmDeleteAccount() {
    setDeletingAccount(true)
    try {
      await apiDelete<{ ok: boolean }>("/auth/delete-account")
      await clearAuth()
      onSignOut()
    } catch (e: unknown) {
      Alert.alert(
        "Deletion Failed",
        e instanceof Error ? e.message : "Could not delete account. Please try again or contact info@amberangels.org.",
      )
    } finally {
      setDeletingAccount(false)
    }
  }

  async function handleTest() {
    try {
      const res = await fetch(`${settings.apiBaseUrl.trim()}/health`)
      if (res.ok) {
        Alert.alert("Connected", "Backend is reachable.")
      } else {
        Alert.alert("Error", `Backend returned ${res.status}`)
      }
    } catch (e: unknown) {
      Alert.alert("Failed", "Could not reach backend. Check URL and network.")
    }
  }

  const interval = String(settings.captureIntervalSec)

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Section title="Connection">
          <Field label="API Base URL" hint="e.g. http://192.168.1.100:8000">
            <TextInput
              style={styles.input}
              value={settings.apiBaseUrl}
              onChangeText={(v) => update("apiBaseUrl", v)}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="http://..."
              placeholderTextColor="rgba(255,255,255,0.2)"
            />
          </Field>
          <TouchableOpacity style={styles.testBtn} onPress={handleTest}>
            <Text style={styles.testBtnText}>Test Connection</Text>
          </TouchableOpacity>
        </Section>

        <Section title="Identity">
          <Field label="Volunteer mode" hint="">
            <View style={styles.modeRow}>
              <TouchableOpacity
                style={[styles.modeBtn, settings.volunteerMode === "phone" && styles.modeBtnActive]}
                onPress={() => update("volunteerMode", "phone")}
              >
                <Text style={[styles.modeBtnText, settings.volunteerMode === "phone" && styles.modeBtnTextActive]}>
                  📱 Phone
                </Text>
                <Text style={styles.modeSubText}>Ground / driving</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modeBtn, settings.volunteerMode === "drone" && styles.modeBtnActive]}
                onPress={() => update("volunteerMode", "drone")}
              >
                <Text style={[styles.modeBtnText, settings.volunteerMode === "drone" && styles.modeBtnTextActive]}>
                  🚁 Drone
                </Text>
                <Text style={styles.modeSubText}>RTMP stream</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modeBtn, settings.volunteerMode === "both" && styles.modeBtnActive]}
                onPress={() => update("volunteerMode", "both")}
              >
                <Text style={[styles.modeBtnText, settings.volunteerMode === "both" && styles.modeBtnTextActive]}>
                  📱+🚁 Both
                </Text>
                <Text style={styles.modeSubText}>DJI RC only</Text>
              </TouchableOpacity>
            </View>

            {settings.volunteerMode === "both" && (
              <Text style={styles.modeNote}>
                ⚠ Both modes require a DJI RC controller with a built-in screen. If your phone is the remote, use Drone mode only.
              </Text>
            )}
          </Field>

          {(settings.volunteerMode === "drone" || settings.volunteerMode === "both") && (
            <View style={styles.rtmpBox}>
              <Text style={styles.rtmpLabel}>RTMP STREAM URL</Text>
              <View style={styles.rtmpRow}>
                <Text style={styles.rtmpUrl} numberOfLines={1} ellipsizeMode="middle">
                  {getRtmpUrl()}
                </Text>
                <TouchableOpacity style={styles.rtmpCopyBtn} onPress={shareRtmpUrl}>
                  <Text style={styles.rtmpCopyIcon}>⧉</Text>
                  <Text style={styles.rtmpCopyText}>{rtmpCopied ? "Shared!" : "Copy"}</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.rtmpInstructions}>
                In DJI Fly: tap ••• → Transmission → RTMP Live → paste this URL → Go Live
              </Text>
              <Text style={[styles.rtmpInstructions, { marginTop: 4 }]}>
                In DJI Go 4: Camera → General Settings → Live Broadcast Platform → Custom RTMP
              </Text>
            </View>
          )}

          <Field label="Device / Drone ID" hint="Shown on the mission map and included in the RTMP stream URL above">
            <TextInput
              style={styles.input}
              value={settings.droneId}
              onChangeText={(v) => update("droneId", v)}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="drone-1"
              placeholderTextColor="rgba(255,255,255,0.2)"
            />
          </Field>
          <Field label="Callsign / name" hint="Optional — displayed to coordinators">
            <TextInput
              style={styles.input}
              value={settings.pilotId}
              onChangeText={(v) => update("pilotId", v)}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="optional"
              placeholderTextColor="rgba(255,255,255,0.2)"
            />
          </Field>
        </Section>

        <Section title="Capture">
          <Field label="Frame capture interval (seconds)" hint="Frames are posted to /ingest/frame at this rate">
            <TextInput
              style={styles.input}
              value={interval}
              onChangeText={(v) => {
                const n = parseInt(v, 10)
                if (!isNaN(n) && n >= 1) update("captureIntervalSec", n)
                else if (v === "") update("captureIntervalSec", 1)
              }}
              keyboardType="number-pad"
              placeholder="5"
              placeholderTextColor="rgba(255,255,255,0.2)"
            />
          </Field>
          <Text style={styles.hint}>
            Lower values = more detections + more battery + more data.{"\n"}
            Recommended: 3–10 seconds.
          </Text>
        </Section>

        <Section title="Alert Range">
          <Text style={styles.label}>Miles outside FEMA search polygon</Text>
          <View style={styles.rangeRow}>
            {[5, 10, 15, 25, 50, 100].map((mi) => (
              <TouchableOpacity
                key={mi}
                style={[styles.rangeBtn, settings.alertRangeMiles === mi && styles.rangeBtnActive]}
                onPress={() => update("alertRangeMiles", mi)}
              >
                <Text style={[styles.rangeBtnText, settings.alertRangeMiles === mi && styles.rangeBtnTextActive]}>
                  {mi} mi
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Show out-of-range warning</Text>
              <Text style={styles.hint}>Banner on map when you exceed the alert range from the active search area</Text>
            </View>
            <Switch
              value={settings.notifOutsidePolygon}
              onValueChange={(v) => update("notifOutsidePolygon", v)}
              trackColor={{ false: "rgba(255,255,255,0.1)", true: "#38bdf8" }}
              thumbColor="#fff"
            />
          </View>
        </Section>

        <Section title={`Watch Areas${watchSaving ? " — saving…" : ""}`}>
          <Text style={styles.hint}>
            Get notified when an alert fires in these areas even if you're not nearby.
            Add cities, counties, or region names.
          </Text>
          <View style={styles.watchChips}>
            {watchAreas.map((area) => (
              <TouchableOpacity key={area} style={styles.watchChip} onPress={() => removeWatchArea(area)}>
                <Text style={styles.watchChipText}>{area}  ✕</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.watchInputRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={watchInput}
              onChangeText={setWatchInput}
              placeholder="e.g. Birmingham"
              placeholderTextColor="rgba(255,255,255,0.2)"
              onSubmitEditing={addWatchArea}
              returnKeyType="done"
            />
            <TouchableOpacity style={styles.watchAddBtn} onPress={addWatchArea}>
              <Text style={styles.watchAddBtnText}>Add</Text>
            </TouchableOpacity>
          </View>
        </Section>

        <Section title={`Notifications${notifSaving ? " — saving…" : ""}`}>
          <Text style={styles.hint}>
            How you want to be reached when an alert fires in your watch areas.
            At least one method must stay on.
          </Text>
          <View style={styles.modeRow}>
            {(["push", "email"] as const).map((pref) => {
              const active = notifPrefs.includes(pref)
              const label = pref === "push" ? "📲 Push" : "✉️ Email"
              return (
                <TouchableOpacity
                  key={pref}
                  style={[styles.modeBtn, active && styles.modeBtnActive]}
                  onPress={() => toggleNotifPref(pref)}
                >
                  <Text style={[styles.modeBtnText, active && styles.modeBtnTextActive]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </Section>

        <Section title={`Badges  ${badgesEarned}/${badgesTotal}`}>
          {badges.length === 0 ? (
            <Text style={styles.hint}>Complete missions to earn badges.</Text>
          ) : (
            <View style={badgeStyles.grid}>
              {badges.map((b) => (
                <BadgeChip key={b.id} badge={b} />
              ))}
            </View>
          )}
        </Section>

        {/* Coordinator access — only visible to pilot-tier accounts */}
        {pilotRole === "pilot" && (
          <View style={styles.coordBox}>
            <Text style={styles.coordTitle}>COORDINATOR ACCESS</Text>
            <Text style={styles.coordBody}>
              Coordinators are law-enforcement-adjacent personnel with access to mission coordination tools. Requests are reviewed by an admin.
            </Text>
            {coordRequestedAt || coordDone ? (
              <View style={styles.coordSent}>
                <Text style={styles.coordSentText}>Request submitted — an admin will review it shortly.</Text>
              </View>
            ) : (
              <>
                <TextInput
                  style={[styles.input, styles.coordInput]}
                  value={coordReason}
                  onChangeText={setCoordReason}
                  placeholder="Briefly describe your role (e.g. deputy sheriff, SAR coordinator)…"
                  placeholderTextColor="rgba(56,189,248,0.3)"
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />
                <TouchableOpacity
                  style={[styles.coordBtn, coordSubmitting && { opacity: 0.5 }]}
                  onPress={requestCoordinatorAccess}
                  disabled={coordSubmitting}
                >
                  <Text style={styles.coordBtnText}>
                    {coordSubmitting ? "Submitting…" : "Submit Request"}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        <TouchableOpacity
          style={[styles.saveBtn, saved && styles.saveBtnSaved]}
          onPress={handleSave}
        >
          <Text style={[styles.saveBtnText, saved && styles.saveBtnTextSaved]}>
            {saved ? "Saved!" : "Save Settings"}
          </Text>
        </TouchableOpacity>

        {username && (
          <View style={styles.accountSection}>
            <View style={styles.accountRow}>
              <Text style={styles.accountLabel}>Signed in as <Text style={styles.accountName}>{username}</Text></Text>
              <TouchableOpacity onPress={handleSignOut}>
                <Text style={styles.signOutText}>Sign out</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.deleteAccountBtn, deletingAccount && { opacity: 0.5 }]}
              onPress={handleDeleteAccount}
              disabled={deletingAccount}
            >
              <Text style={styles.deleteAccountText}>
                {deletingAccount ? "Deleting account…" : "Delete Account"}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const TIER_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  bronze:   { bg: "rgba(180,83,9,0.15)",   border: "rgba(180,83,9,0.5)",   text: "#f97316" },
  silver:   { bg: "rgba(148,163,184,0.12)", border: "rgba(148,163,184,0.4)", text: "#94a3b8" },
  gold:     { bg: "rgba(245,158,11,0.15)", border: "rgba(245,158,11,0.5)", text: "#f59e0b" },
  platinum: { bg: "rgba(139,92,246,0.15)", border: "rgba(139,92,246,0.5)", text: "#a78bfa" },
  special:  { bg: "rgba(251,191,36,0.12)", border: "rgba(251,191,36,0.5)", text: "#fbbf24" },
}

function BadgeChip({ badge }: { badge: Badge }) {
  const colors = TIER_COLORS[badge.tier] ?? TIER_COLORS.bronze
  const dim = !badge.earned
  return (
    <View style={[
      badgeStyles.chip,
      { backgroundColor: dim ? "rgba(255,255,255,0.03)" : colors.bg,
        borderColor: dim ? "rgba(255,255,255,0.07)" : colors.border },
    ]}>
      <Text style={[badgeStyles.chipEmoji, dim && { opacity: 0.25 }]}>{badge.emoji}</Text>
      <Text style={[badgeStyles.chipName, { color: dim ? "rgba(255,255,255,0.2)" : colors.text }]}
        numberOfLines={2}>
        {badge.name}
      </Text>
    </View>
  )
}

const badgeStyles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    width: "30%",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: "center",
    gap: 4,
  },
  chipEmoji: { fontSize: 24 },
  chipName:  { fontSize: 10, fontWeight: "700", textAlign: "center", lineHeight: 13 },
})

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
      {hint && <Text style={styles.hint}>{hint}</Text>}
    </View>
  )
}

const styles = StyleSheet.create({
  root:     { flex: 1, backgroundColor: "#050a0f" },
  scroll:   { padding: 16, gap: 16 },
  section: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    padding: 16,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2,
    textTransform: "uppercase",
    color: "rgba(255,255,255,0.35)",
    marginBottom: 4,
  },
  field:    { gap: 4 },
  label:    { fontSize: 13, color: "rgba(255,255,255,0.7)" },
  hint:     { fontSize: 11, color: "rgba(255,255,255,0.3)", lineHeight: 16 },
  input: {
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: "#fff",
  },
  modeRow:           { flexDirection: "row", gap: 8 },
  modeBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  modeBtnActive:     { borderColor: "#f59e0b", backgroundColor: "rgba(245,158,11,0.15)" },
  modeBtnText:       { color: "rgba(255,255,255,0.5)", fontSize: 12, fontWeight: "600" },
  modeBtnTextActive: { color: "#f59e0b" },
  modeSubText:       { color: "rgba(255,255,255,0.3)", fontSize: 10, marginTop: 3 },
  modeNote: {
    marginTop: 10,
    fontSize: 11, color: "rgba(251,146,60,0.85)", lineHeight: 16,
    backgroundColor: "rgba(251,146,60,0.08)",
    borderRadius: 6, padding: 8,
    borderWidth: 1, borderColor: "rgba(251,146,60,0.2)",
  },
  rtmpBox: {
    backgroundColor: "rgba(56,189,248,0.06)",
    borderWidth: 1, borderColor: "rgba(56,189,248,0.2)",
    borderRadius: 10, padding: 14, gap: 8,
  },
  rtmpLabel: {
    fontSize: 10, fontWeight: "800", letterSpacing: 2,
    color: "rgba(56,189,248,0.6)", textTransform: "uppercase",
  },
  rtmpRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(0,0,0,0.3)", borderRadius: 8,
    borderWidth: 1, borderColor: "rgba(56,189,248,0.15)",
    paddingLeft: 12, overflow: "hidden",
  },
  rtmpUrl: {
    flex: 1, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 12, color: "#38bdf8", paddingVertical: 10,
  },
  rtmpCopyBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(56,189,248,0.15)",
    paddingHorizontal: 12, paddingVertical: 10,
    borderLeftWidth: 1, borderLeftColor: "rgba(56,189,248,0.15)",
  },
  rtmpCopyIcon: { fontSize: 14, color: "#38bdf8" },
  rtmpCopyText: { fontSize: 11, fontWeight: "700", color: "#38bdf8" },
  rtmpInstructions: {
    fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 17,
  },
  rangeRow:          { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  rangeBtn: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  rangeBtnActive:     { borderColor: "#38bdf8", backgroundColor: "rgba(56,189,248,0.15)" },
  rangeBtnText:       { color: "rgba(255,255,255,0.5)", fontSize: 13, fontWeight: "600" },
  rangeBtnTextActive: { color: "#38bdf8" },
  toggleRow:          { flexDirection: "row", alignItems: "center", gap: 12 },
  testBtn: {
    borderWidth: 1,
    borderColor: "rgba(56,189,248,0.4)",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 4,
  },
  testBtnText:    { color: "#38bdf8", fontSize: 13, fontWeight: "600" },
  saveBtn: {
    backgroundColor: "#38bdf8",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  saveBtnSaved:     { backgroundColor: "rgba(34,197,94,0.15)", borderWidth: 1, borderColor: "rgba(34,197,94,0.4)" },
  saveBtnText:      { color: "#060a0f", fontWeight: "800", fontSize: 15 },
  saveBtnTextSaved: { color: "#22c55e" },
  accountSection: {
    gap: 8,
    marginTop: 4,
  },
  accountRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 16, paddingVertical: 12,
  },
  accountLabel:  { fontSize: 13, color: "rgba(255,255,255,0.4)" },
  accountName:   { color: "rgba(255,255,255,0.7)", fontWeight: "600" },
  signOutText:   { fontSize: 13, color: "#f87171", fontWeight: "600" },
  deleteAccountBtn: {
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.3)",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  deleteAccountText: {
    fontSize: 13,
    fontWeight: "600",
    color: "rgba(248,113,113,0.7)",
  },
  watchChips:    { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  watchChip: {
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.5)",
    backgroundColor: "rgba(245,158,11,0.1)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  watchChipText: { color: "#f59e0b", fontSize: 12, fontWeight: "600" },
  watchInputRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  watchAddBtn: {
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.5)",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  watchAddBtnText: { color: "#f59e0b", fontWeight: "700", fontSize: 13 },
  coordBox: {
    backgroundColor: "rgba(56,189,248,0.05)",
    borderWidth: 1,
    borderColor: "rgba(56,189,248,0.2)",
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  coordTitle: {
    fontSize: 10, fontWeight: "800", letterSpacing: 2,
    color: "rgba(56,189,248,0.7)", textTransform: "uppercase",
  },
  coordBody: {
    fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 18,
  },
  coordInput: {
    minHeight: 72,
    borderColor: "rgba(56,189,248,0.2)",
    color: "rgba(255,255,255,0.85)",
  },
  coordBtn: {
    borderWidth: 1,
    borderColor: "rgba(56,189,248,0.4)",
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: "center",
  },
  coordBtnText: { color: "#38bdf8", fontSize: 13, fontWeight: "700" },
  coordSent: {
    backgroundColor: "rgba(56,189,248,0.08)",
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: "rgba(56,189,248,0.2)",
  },
  coordSentText: { color: "#7dd3fc", fontSize: 13, lineHeight: 18 },
})
