import React, { useEffect, useRef, useState } from "react"
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView,
  Platform, ScrollView, Linking,
} from "react-native"
import * as AppleAuthentication from "expo-apple-authentication"
import * as Google from "expo-auth-session/providers/google"
import * as WebBrowser from "expo-web-browser"
import Constants from "expo-constants"
import { setAuth } from "../lib/auth"
import { getApiBaseUrl } from "../api/client"
import { loadSettings } from "../lib/settings"

WebBrowser.maybeCompleteAuthSession()

type LoginView = "login" | "pending" | "forgot_email" | "forgot_code"
type Props = {
  onLogin:      () => void
  onSSONewUser: (registrationToken: string, email: string | null, provider: "apple" | "google") => void
}

export default function LoginScreen({ onLogin, onSSONewUser }: Props) {
  const [view,        setView]        = useState<LoginView>("login")
  const [username,    setUsername]    = useState("")
  const [password,    setPassword]    = useState("")
  const [resetEmail,  setResetEmail]  = useState("")
  const [resetCode,   setResetCode]   = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [success,     setSuccess]     = useState<string | null>(null)
  const [registerUrl, setRegisterUrl] = useState<string | null>(null)
  const [showServer,  setShowServer]  = useState(false)
  const [apiUrl,      setApiUrl]      = useState("")
  const [urlSaved,    setUrlSaved]    = useState(false)
  const codeInputRef = useRef<TextInput>(null)

  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>
  const [, googleResponse, promptGoogleAsync] = Google.useAuthRequest({
    iosClientId:     extra.googleIosClientId     ?? "",
    androidClientId: extra.googleAndroidClientId ?? "",
    webClientId:     extra.googleWebClientId     ?? "",
  })

  useEffect(() => {
    if (googleResponse?.type === "success") {
      const idToken = googleResponse.authentication?.idToken
      if (idToken) sendSSOToken("google", idToken)
    }
  }, [googleResponse])

  useEffect(() => {
    loadSettings().then((s) => {
      setResetEmail("")
      setApiUrl(s.apiBaseUrl)
      setRegisterUrl(`${s.apiBaseUrl.replace(/\/$/, "")}/pilot/register.html`)
    })
  }, [])

  async function saveApiUrl() {
    const trimmed = apiUrl.trim().replace(/\/$/, "")
    if (!trimmed) return
    const { saveSettings, loadSettings: load } = await import("../lib/settings")
    const { setApiBaseUrl } = await import("../api/client")
    const current = await load()
    await saveSettings({ ...current, apiBaseUrl: trimmed })
    setApiBaseUrl(trimmed)
    setRegisterUrl(`${trimmed}/pilot/register.html`)
    setUrlSaved(true)
    setTimeout(() => { setUrlSaved(false); setShowServer(false) }, 1200)
  }

  function goBack() {
    setView("login")
    setError(null)
    setSuccess(null)
    setResetCode("")
    setNewPassword("")
  }

  // ── SSO ───────────────────────────────────────────────────────────────────
  async function sendSSOToken(provider: "apple" | "google", token: string) {
    setLoading(true)
    setError(null)
    try {
      const endpoint = provider === "apple" ? "/auth/apple" : "/auth/google"
      const body     = provider === "apple" ? { identity_token: token } : { id_token: token }
      const res = await fetch(`${getApiBaseUrl()}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.detail ?? "Sign in failed."); return }

      if (data.registration_token) {
        onSSONewUser(data.registration_token, data.email ?? null, provider)
        return
      }
      if (data.status === "pending") { setView("pending"); return }

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

  async function handleAppleSignIn() {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      })
      if (credential.identityToken) {
        await sendSSOToken("apple", credential.identityToken)
      }
    } catch (e: unknown) {
      if ((e as { code?: string }).code !== "ERR_REQUEST_CANCELED") {
        setError("Apple Sign In failed. Please try again.")
      }
    }
  }

  // ── Sign in ───────────────────────────────────────────────────────────────
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
      if (!res.ok) { setError(data.detail ?? "Login failed."); return }
      if (data.status === "pending") { setView("pending"); return }
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

  // ── Step 1: request reset code ────────────────────────────────────────────
  async function requestCode() {
    if (!resetEmail.trim()) { setError("Enter your email address."); return }
    setLoading(true)
    setError(null)
    try {
      await fetch(`${getApiBaseUrl()}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resetEmail.trim().toLowerCase() }),
      })
      // Always advance — backend returns 200 regardless so we don't leak emails
      setSuccess("If that email is registered, a 6-digit code is on its way.")
      setView("forgot_code")
      setTimeout(() => codeInputRef.current?.focus(), 300)
    } catch {
      setError("Cannot reach server. Check your connection.")
    } finally {
      setLoading(false)
    }
  }

  // ── Step 2: verify code + set new password ────────────────────────────────
  async function submitReset() {
    if (resetCode.length !== 6) { setError("Enter the 6-digit code from your email."); return }
    if (newPassword.length < 8) { setError("New password must be at least 8 characters."); return }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${getApiBaseUrl()}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email:        resetEmail.trim().toLowerCase(),
          code:         resetCode.trim(),
          new_password: newPassword,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.detail ?? "Reset failed. Check the code and try again."); return }
      setSuccess("Password updated! You can now sign in.")
      setView("login")
      setPassword("")
    } catch {
      setError("Cannot reach server. Check your connection.")
    } finally {
      setLoading(false)
    }
  }

  // ── Pending approval ──────────────────────────────────────────────────────
  if (view === "pending") {
    return (
      <View style={styles.centered}>
        <Logo />
        <View style={styles.pendingBox}>
          <Text style={styles.pendingTitle}>Account Pending</Text>
          <Text style={styles.pendingText}>
            Your registration is awaiting admin approval.{"\n"}
            You'll be notified once approved.
          </Text>
          <TouchableOpacity onPress={goBack} style={styles.linkBtn}>
            <Text style={styles.linkText}>← Back to sign in</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  // ── Step 1: enter email ───────────────────────────────────────────────────
  if (view === "forgot_email") {
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Logo />
          <View style={styles.card}>
            <Text style={styles.heading}>Reset password</Text>
            <Text style={styles.subheading}>
              Enter your account email and we'll send you a 6-digit code.
            </Text>

            {error   && <ErrorBox msg={error} />}

            <Text style={styles.label}>Email address</Text>
            <TextInput
              style={styles.input}
              value={resetEmail}
              onChangeText={setResetEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="you@example.com"
              placeholderTextColor="rgba(255,255,255,0.25)"
              onSubmitEditing={requestCode}
              autoFocus
            />

            <TouchableOpacity
              style={[styles.btn, loading && styles.btnDisabled]}
              onPress={requestCode}
              disabled={loading}
            >
              {loading ? <ActivityIndicator color="#000" /> : <Text style={styles.btnText}>Send code</Text>}
            </TouchableOpacity>

            <TouchableOpacity onPress={goBack} style={styles.linkBtn}>
              <Text style={styles.linkText}>← Back to sign in</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    )
  }

  // ── Step 2: enter code + new password ─────────────────────────────────────
  if (view === "forgot_code") {
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Logo />
          <View style={styles.card}>
            <Text style={styles.heading}>Enter reset code</Text>
            {success && <SuccessBox msg={success} />}
            {error   && <ErrorBox   msg={error}   />}

            <Text style={styles.label}>6-digit code</Text>
            <TextInput
              ref={codeInputRef}
              style={[styles.input, styles.codeInput]}
              value={resetCode}
              onChangeText={(v) => setResetCode(v.replace(/\D/g, "").slice(0, 6))}
              keyboardType="number-pad"
              placeholder="000000"
              placeholderTextColor="rgba(255,255,255,0.25)"
              maxLength={6}
            />

            <Text style={styles.label}>New password</Text>
            <TextInput
              style={styles.input}
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              placeholder="8+ characters"
              placeholderTextColor="rgba(255,255,255,0.25)"
              onSubmitEditing={submitReset}
            />

            <TouchableOpacity
              style={[styles.btn, loading && styles.btnDisabled]}
              onPress={submitReset}
              disabled={loading}
            >
              {loading ? <ActivityIndicator color="#000" /> : <Text style={styles.btnText}>Set new password</Text>}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setView("forgot_email")} style={styles.linkBtn}>
              <Text style={styles.linkText}>← Re-send code</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    )
  }

  // ── Sign in ───────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Logo />

        <View style={styles.card}>
          <Text style={styles.heading}>Sign in</Text>

          {success && <SuccessBox msg={success} />}
          {error   && <ErrorBox   msg={error}   />}

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
            {loading ? <ActivityIndicator color="#000" /> : <Text style={styles.btnText}>Sign in</Text>}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.linkBtn}
            onPress={() => { setError(null); setSuccess(null); setView("forgot_email") }}
          >
            <Text style={[styles.linkText, { textAlign: "center" }]}>Forgot password?</Text>
          </TouchableOpacity>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          {Platform.OS === "ios" && (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              cornerRadius={10}
              style={styles.appleBtn}
              onPress={handleAppleSignIn}
            />
          )}

          <TouchableOpacity
            style={[styles.googleBtn, loading && styles.btnDisabled]}
            onPress={() => promptGoogleAsync()}
            disabled={loading}
          >
            <Text style={styles.googleBtnText}>Continue with Google</Text>
          </TouchableOpacity>

          {registerUrl && (
            <TouchableOpacity
              style={styles.registerBtn}
              onPress={() => Linking.openURL(registerUrl)}
            >
              <Text style={styles.registerBtnText}>No account? Register here</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.serverToggle}
            onPress={() => setShowServer((v) => !v)}
          >
            <Text style={styles.serverToggleText}>
              {showServer ? "▲" : "▼"} Configure server
            </Text>
          </TouchableOpacity>

          {showServer && (
            <View style={styles.serverBox}>
              <Text style={styles.label}>API Base URL</Text>
              <TextInput
                style={styles.input}
                value={apiUrl}
                onChangeText={setApiUrl}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="http://..."
                placeholderTextColor="rgba(255,255,255,0.25)"
                onSubmitEditing={saveApiUrl}
              />
              <TouchableOpacity
                style={[styles.btn, urlSaved && styles.btnSaved]}
                onPress={saveApiUrl}
              >
                <Text style={styles.btnText}>{urlSaved ? "Saved!" : "Save URL"}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

// ── Shared sub-components ──────────────────────────────────────────────────

function Logo() {
  return (
    <>
      <Text style={styles.logo}>Amber's <Text style={styles.amber}>Angels</Text></Text>
      <Text style={styles.tagline}>Volunteer Drone ALPR Network</Text>
    </>
  )
}

function ErrorBox({ msg }: { msg: string }) {
  return <Text style={styles.errorText}>{msg}</Text>
}

function SuccessBox({ msg }: { msg: string }) {
  return <Text style={styles.successText}>{msg}</Text>
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
  heading:    { fontSize: 20, fontWeight: "700", color: "#fff", marginBottom: 8 },
  subheading: { fontSize: 13, color: "rgba(255,255,255,0.4)", marginBottom: 20, lineHeight: 20 },
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
  codeInput: {
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: 8,
    textAlign: "center",
  },
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
  successText: {
    fontSize: 13,
    color: "#34d399",
    marginBottom: 14,
    backgroundColor: "rgba(52,211,153,0.08)",
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
  linkBtn:  { paddingVertical: 12, alignItems: "center" },
  linkText: { fontSize: 13, color: "rgba(255,255,255,0.4)" },
  serverToggle: { paddingVertical: 10, alignItems: "center", marginTop: 4 },
  serverToggleText: { fontSize: 12, color: "rgba(255,255,255,0.25)" },
  serverBox: { marginTop: 4, gap: 4 },
  btnSaved: { backgroundColor: "#22c55e" },
  registerBtn: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.35)",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  registerBtnText: { fontSize: 13, fontWeight: "600", color: "#f59e0b" },
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
  dividerRow:   { flexDirection: "row", alignItems: "center", marginVertical: 16, gap: 8 },
  dividerLine:  { flex: 1, height: 1, backgroundColor: "rgba(255,255,255,0.08)" },
  dividerText:  { fontSize: 12, color: "rgba(255,255,255,0.3)" },
  appleBtn:     { width: "100%", height: 48, marginBottom: 10 },
  googleBtn: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
    marginBottom: 10,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  googleBtnText: { fontSize: 15, fontWeight: "600", color: "#fff" },
})
