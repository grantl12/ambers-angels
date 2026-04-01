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
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native"
import { loadSettings, saveSettings, type AppSettings } from "../lib/settings"
import { setApiBaseUrl } from "../api/client"

export default function SettingsScreen() {
  const [settings, setSettings] = useState<AppSettings>({
    apiBaseUrl: "http://192.168.1.100:8000",
    droneId: "phone-1",
    pilotId: "",
    captureIntervalSec: 5,
  })
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    loadSettings().then(setSettings)
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
          <Field label="Drone / Device ID" hint="Shown on the mission map">
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
          <Field label="Pilot ID" hint="Optional — your callsign or name">
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

        <TouchableOpacity
          style={[styles.saveBtn, saved && styles.saveBtnSaved]}
          onPress={handleSave}
        >
          <Text style={[styles.saveBtnText, saved && styles.saveBtnTextSaved]}>
            {saved ? "Saved!" : "Save Settings"}
          </Text>
        </TouchableOpacity>
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
})
