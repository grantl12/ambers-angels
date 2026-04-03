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
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native"
import { loadSettings, saveSettings, type AppSettings, type VolunteerMode } from "../lib/settings"
import { setApiBaseUrl, apiGet, apiPatch } from "../api/client"
import { clearAuth } from "../lib/auth"

type Props = { username: string | null; onSignOut: () => void }

export default function SettingsScreen({ username, onSignOut }: Props) {
  const [settings, setSettings] = useState<AppSettings>({
    apiBaseUrl: "http://192.168.1.100:8000",
    droneId: "phone-1",
    pilotId: "",
    captureIntervalSec: 5,
  })
  const [saved, setSaved] = useState(false)
  const [watchAreas, setWatchAreas] = useState<string[]>([])
  const [watchInput, setWatchInput] = useState("")
  const [watchSaving, setWatchSaving] = useState(false)
  const [notifPrefs, setNotifPrefs] = useState<string[]>(["push", "email"])
  const [notifSaving, setNotifSaving] = useState(false)

  useEffect(() => {
    loadSettings().then(setSettings)
    apiGet<{ watchAreas?: string[]; notificationPrefs?: string[] }>("/auth/me")
      .then((data) => {
        setWatchAreas(data.watchAreas ?? [])
        setNotifPrefs(data.notificationPrefs ?? ["push", "email"])
      })
      .catch(() => {})
  }, [])

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

  async function handleSignOut() {
    Alert.alert("Sign out", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out", style: "destructive",
        onPress: async () => { await clearAuth(); onSignOut() },
      },
    ])
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
          <Field label="Volunteer mode" hint="How you're participating in this mission">
            <View style={styles.modeRow}>
              {(["phone", "drone", "both"] as VolunteerMode[]).map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[styles.modeBtn, settings.volunteerMode === m && styles.modeBtnActive]}
                  onPress={() => update("volunteerMode", m)}
                >
                  <Text style={[styles.modeBtnText, settings.volunteerMode === m && styles.modeBtnTextActive]}>
                    {m === "phone" ? "📱 Phone" : m === "drone" ? "🚁 Drone" : "📱+🚁 Both"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </Field>
          <Field label="Device ID" hint="Shown on the mission map">
            <TextInput
              style={styles.input}
              value={settings.droneId}
              onChangeText={(v) => update("droneId", v)}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="phone-1"
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

        <TouchableOpacity
          style={[styles.saveBtn, saved && styles.saveBtnSaved]}
          onPress={handleSave}
        >
          <Text style={[styles.saveBtnText, saved && styles.saveBtnTextSaved]}>
            {saved ? "Saved!" : "Save Settings"}
          </Text>
        </TouchableOpacity>

        {username && (
          <View style={styles.accountRow}>
            <Text style={styles.accountLabel}>Signed in as <Text style={styles.accountName}>{username}</Text></Text>
            <TouchableOpacity onPress={handleSignOut}>
              <Text style={styles.signOutText}>Sign out</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

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
  accountRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 16, paddingVertical: 12, marginTop: 4,
  },
  accountLabel:  { fontSize: 13, color: "rgba(255,255,255,0.4)" },
  accountName:   { color: "rgba(255,255,255,0.7)", fontWeight: "600" },
  signOutText:   { fontSize: 13, color: "#f87171", fontWeight: "600" },
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
})
