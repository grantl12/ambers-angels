import React, { useState } from "react"
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView,
  Platform, ScrollView,
} from "react-native"
import { setAuth } from "../lib/auth"
import { getApiBaseUrl } from "../api/client"

type Props = {
  registrationToken: string
  email:             string | null
  provider:          "apple" | "google"
  onComplete:        () => void
  onBack:            () => void
}

export default function SSOCompleteScreen({ registrationToken, email, provider, onComplete, onBack }: Props) {
  const [username,  setUsername]  = useState("")
  const [fullName,  setFullName]  = useState("")
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [pending,   setPending]   = useState(false)

  const providerLabel = provider === "apple" ? "Apple" : "Google"

  async function submit() {
    const trimmed = username.trim().toLowerCase()
    if (trimmed.length < 3) {
      setError("Username must be at least 3 characters.")
      return
    }
    if (!/^[a-z0-9_]+$/.test(trimmed)) {
      setError("Username can only contain letters, numbers, and underscores.")
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${getApiBaseUrl()}/auth/sso-complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registration_token: registrationToken,
          username:           trimmed,
          full_name:          fullName.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.detail ?? "Could not complete sign-up."); return }
      await setAuth({
        token:    data.access_token,
        username: data.username,
        fullName: data.full_name ?? null,
        role:     data.role,
        status:   data.status,
      })
      if (data.status === "pending") { setPending(true); return }
      onComplete()
    } catch {
      setError("Cannot reach server. Check your connection.")
    } finally {
      setLoading(false)
    }
  }

  if (pending) {
    return (
      <View style={styles.centered}>
        <Text style={styles.logo}>Amber's <Text style={styles.amber}>Angels</Text></Text>
        <Text style={styles.tagline}>Volunteer Drone ALPR Network</Text>
        <View style={styles.pendingBox}>
          <Text style={styles.pendingTitle}>Account Pending</Text>
          <Text style={styles.pendingText}>
            Your registration is awaiting admin approval.{"\n"}
            You'll be notified once approved.
          </Text>
          <TouchableOpacity onPress={onBack} style={styles.linkBtn}>
            <Text style={styles.linkText}>← Back to sign in</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.logo}>Amber's <Text style={styles.amber}>Angels</Text></Text>
        <Text style={styles.tagline}>Volunteer Drone ALPR Network</Text>

        <View style={styles.card}>
          <Text style={styles.heading}>One last step</Text>
          <Text style={styles.sub}>
            Signed in with {providerLabel}. Choose a username to complete your profile.
          </Text>

          {error && <Text style={styles.errorText}>{error}</Text>}

          {email && (
            <>
              <Text style={styles.label}>Email</Text>
              <View style={styles.readOnly}>
                <Text style={styles.readOnlyText}>{email}</Text>
              </View>
            </>
          )}

          <Text style={styles.label}>Username</Text>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="e.g. dronerescue42"
            placeholderTextColor="rgba(255,255,255,0.25)"
            autoFocus
          />

          <Text style={styles.label}>Full name (optional)</Text>
          <TextInput
            style={styles.input}
            value={fullName}
            onChangeText={setFullName}
            placeholder="Jane Smith"
            placeholderTextColor="rgba(255,255,255,0.25)"
            onSubmitEditing={submit}
          />

          <TouchableOpacity
            style={[styles.btn, loading && styles.btnDisabled]}
            onPress={submit}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#000" />
              : <Text style={styles.btnText}>Create account</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity onPress={onBack} style={styles.linkBtn}>
            <Text style={styles.linkText}>← Use a different sign-in method</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: "#050a0f",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  logo:    { fontSize: 28, fontWeight: "800", color: "#fff", marginBottom: 6 },
  amber:   { color: "#f59e0b" },
  tagline: { fontSize: 13, color: "rgba(255,255,255,0.4)", marginBottom: 32 },
  card: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    padding: 24,
  },
  heading: { fontSize: 20, fontWeight: "700", color: "#fff", marginBottom: 8 },
  sub:     { fontSize: 13, color: "rgba(255,255,255,0.4)", marginBottom: 20, lineHeight: 20 },
  label:   { fontSize: 13, fontWeight: "500", color: "rgba(255,255,255,0.6)", marginBottom: 6 },
  input: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#fff",
    marginBottom: 16,
  },
  readOnly: {
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  readOnlyText: { fontSize: 15, color: "rgba(255,255,255,0.4)" },
  btn:        { backgroundColor: "#f59e0b", borderRadius: 10, paddingVertical: 14, alignItems: "center", marginTop: 4 },
  btnDisabled:{ opacity: 0.6 },
  btnText:    { fontSize: 15, fontWeight: "700", color: "#000" },
  errorText: {
    fontSize: 13,
    color: "#f87171",
    marginBottom: 14,
    backgroundColor: "rgba(239,68,68,0.1)",
    padding: 10,
    borderRadius: 8,
  },
  linkBtn:  { paddingVertical: 12, alignItems: "center" },
  linkText: { fontSize: 13, color: "rgba(255,255,255,0.4)" },
  centered: {
    flex: 1,
    backgroundColor: "#050a0f",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  pendingBox: {
    backgroundColor: "rgba(245,158,11,0.08)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.25)",
    borderRadius: 16,
    padding: 24,
    width: "100%",
    maxWidth: 400,
    alignItems: "center",
    marginTop: 24,
  },
  pendingTitle: { fontSize: 18, fontWeight: "700", color: "#f59e0b", marginBottom: 10 },
  pendingText:  { fontSize: 14, color: "rgba(255,255,255,0.55)", textAlign: "center", lineHeight: 22, marginBottom: 20 },
})
