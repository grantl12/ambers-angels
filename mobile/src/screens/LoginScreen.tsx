import React, { useState } from "react"
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView,
  Platform, ScrollView,
} from "react-native"
import { setAuth } from "../lib/auth"
import { getApiBaseUrl } from "../api/client"

type Props = { onLogin: () => void }

export default function LoginScreen({ onLogin }: Props) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [pending,  setPending]  = useState(false)

  async function submit() {
    if (!username.trim() || !password) {
      setError("Enter your username or email and password.")
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${getApiBaseUrl()}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim().toLowerCase(), password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.detail ?? "Login failed.")
        return
      }
      if (data.status === "pending") {
        setPending(true)
        return
      }
      await setAuth({
        token:    data.access_token,
        username: data.username,
        fullName: data.full_name ?? null,
        role:     data.role,
        status:   data.status,
      })
      onLogin()
    } catch {
      setError("Cannot reach server. Check your API URL in Settings.")
    } finally {
      setLoading(false)
    }
  }

  if (pending) {
    return (
      <View style={styles.centered}>
        <Text style={styles.logo}>Amber's <Text style={styles.amber}>Angels</Text></Text>
        <View style={styles.pendingBox}>
          <Text style={styles.pendingTitle}>Account Pending</Text>
          <Text style={styles.pendingText}>
            Your registration is awaiting admin approval.{"\n"}
            You'll be notified once approved.
          </Text>
          <TouchableOpacity onPress={() => setPending(false)} style={styles.linkBtn}>
            <Text style={styles.linkText}>← Back to sign in</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.logo}>Amber's <Text style={styles.amber}>Angels</Text></Text>
        <Text style={styles.tagline}>Volunteer Drone ALPR Network</Text>

        <View style={styles.card}>
          <Text style={styles.heading}>Sign in</Text>

          {error && <Text style={styles.errorText}>{error}</Text>}

          <Text style={styles.label}>Username or email</Text>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="you@example.com"
            placeholderTextColor="rgba(255,255,255,0.25)"
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="••••••••"
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
              : <Text style={styles.btnText}>Sign in</Text>
            }
          </TouchableOpacity>

          <Text style={styles.hint}>
            No account? Register at{"\n"}
            <Text style={styles.amber}>your-server/pilot/register.html</Text>
          </Text>
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
  centered: {
    flex: 1,
    backgroundColor: "#050a0f",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  logo: {
    fontSize: 28,
    fontWeight: "800",
    color: "#fff",
    marginBottom: 6,
  },
  amber: { color: "#f59e0b" },
  tagline: {
    fontSize: 13,
    color: "rgba(255,255,255,0.4)",
    marginBottom: 32,
  },
  card: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    padding: 24,
  },
  heading: {
    fontSize: 20,
    fontWeight: "700",
    color: "#fff",
    marginBottom: 20,
  },
  label: {
    fontSize: 13,
    fontWeight: "500",
    color: "rgba(255,255,255,0.6)",
    marginBottom: 6,
  },
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
  btn: {
    backgroundColor: "#f59e0b",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { fontSize: 15, fontWeight: "700", color: "#000" },
  errorText: {
    fontSize: 13,
    color: "#f87171",
    marginBottom: 14,
    backgroundColor: "rgba(239,68,68,0.1)",
    padding: 10,
    borderRadius: 8,
  },
  hint: {
    marginTop: 16,
    fontSize: 12,
    color: "rgba(255,255,255,0.3)",
    textAlign: "center",
    lineHeight: 18,
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
  pendingTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#f59e0b",
    marginBottom: 10,
  },
  pendingText: {
    fontSize: 14,
    color: "rgba(255,255,255,0.55)",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 20,
  },
  linkBtn: { padding: 8 },
  linkText: { fontSize: 13, color: "rgba(255,255,255,0.4)" },
})
