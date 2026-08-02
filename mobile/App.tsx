import React, { useEffect, useRef, useState } from "react"
import { Platform, View, ActivityIndicator, Linking } from "react-native"
import { StatusBar } from "expo-status-bar"
import * as Updates from "expo-updates"
import { NavigationContainer, useNavigationContainerRef } from "@react-navigation/native"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import * as Notifications from "expo-notifications"
import { TabNavigator } from "./src/navigation/TabNavigator"
import NcmecReviewModal from "./src/screens/NcmecReviewModal"
import LoginScreen from "./src/screens/LoginScreen"
import SSOCompleteScreen from "./src/screens/SSOCompleteScreen"
import TosGateScreen from "./src/screens/TosGateScreen"
import { loadSettings, saveSettings } from "./src/lib/settings"
import { setApiBaseUrl, apiPost, registerSessionExpiredHandler, resetSessionExpiredState } from "./src/api/client"
import { getAuthState } from "./src/lib/auth"
import { setPendingAlertTarget } from "./src/lib/alertTarget"
import { fetchTosStatus, acceptTos } from "./src/api/tos"

// Expo project ID — must match app.json
const EXPO_PROJECT_ID = "4f470b02-19e3-47a7-9f48-663dc49603bd"

async function registerPushToken(): Promise<void> {
  try {
    const { status: existing } = await Notifications.getPermissionsAsync()
    let finalStatus = existing
    if (existing !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync()
      finalStatus = status
    }
    if (finalStatus !== "granted") return

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#f59e0b",
      })
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({
      projectId: EXPO_PROJECT_ID,
    })
    await apiPost("/auth/push-token", { token })
    console.log("[push] Token registered:", token)
  } catch (e) {
    console.warn("[push] Token registration failed:", e)
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5000, retry: 1 },
  },
})

export default function App() {
  const [ready,        setReady]        = useState(false)
  const [authed,       setAuthed]       = useState(false)
  const [tosAccepted,  setTosAccepted]  = useState(true)  // default true avoids flash before check
  const [username,     setUsername]     = useState<string | null>(null)
  const [role,         setRole]         = useState<string>("pilot")
  const [ssoNewUser,   setSSONewUser]   = useState<{
    registrationToken: string
    email:             string | null
    provider:          "apple" | "google"
  } | null>(null)
  const [ncmecReviewId, setNcmecReviewId] = useState<number | null>(null)
  const navRef = useNavigationContainerRef()

  // Wire up session-expiry handler — fires whenever any API call gets a 401
  // or the stored JWT is found to be expired before a request goes out.
  useEffect(() => {
    registerSessionExpiredHandler(() => {
      setAuthed(false)
    })
  }, [])

  // Notification tap → route based on notification type
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown>

      if (data?.type === "coverage_gap") {
        // Volunteer coverage ping — open Camera so they can start recording
        if (navRef.isReady()) navRef.navigate("Camera" as never)
        return
      }

      if (data?.type === "ncmec_review") {
        // Coordinator review prompt — quick approve/dismiss in-app; resizing the
        // search zone still deep-links to the web admin panel from the modal.
        if (typeof data.pendingId === "number") {
          setNcmecReviewId(data.pendingId)
        } else if (typeof data.reviewUrl === "string") {
          Linking.openURL(data.reviewUrl)
        }
        return
      }

      // Default: alert notification — pan Map to centroid
      const lat = typeof data?.centroidLat === "number" ? data.centroidLat : null
      const lng = typeof data?.centroidLng === "number" ? data.centroidLng : null
      const label = typeof data?.label === "string" ? data.label : "Alert area"
      if (lat !== null && lng !== null) {
        setPendingAlertTarget({ lat, lng, label })
      }
      if (navRef.isReady()) navRef.navigate("Map" as never)
    })
    return () => sub.remove()
  }, [navRef])

  useEffect(() => {
    async function init() {
      // Check for an OTA update. In production builds this downloads and
      // reboots into the new JS bundle before the user sees the main UI.
      // Skipped in dev (Updates.isEmbeddedLaunch is always true in dev client).
      if (!__DEV__) {
        try {
          const update = await Updates.checkForUpdateAsync()
          if (update.isAvailable) {
            await Updates.fetchUpdateAsync()
            await Updates.reloadAsync()
            return  // reloadAsync restarts the app — nothing below executes
          }
        } catch {
          // Network error or update server down — continue with cached bundle
        }
      }

      const settings = await loadSettings()
      setApiBaseUrl(settings.apiBaseUrl)

      const auth = await getAuthState()
      if (auth) {
        setUsername(auth.username)
        setRole(auth.role)
        setAuthed(true)

        // Sync pilotId from auth so telemetry is tagged correctly
        if (auth.username && auth.username !== settings.pilotId) {
          await saveSettings({ ...settings, pilotId: auth.username })
        }

        // Register/refresh push token so watch-area alerts reach this device
        registerPushToken()

        // Check whether the user has accepted the current ToS
        fetchTosStatus().then((status) => {
          if (!status.accepted) setTosAccepted(false)
        }).catch(() => {}) // network error → don't block app
      }
      setReady(true)
    }
    init()
  }, [])

  function handleLogin() {
    resetSessionExpiredState()  // re-arm 401 handler for the new session
    getAuthState().then((auth) => {
      if (auth) {
        setUsername(auth.username)
        setRole(auth.role)

        // Check ToS on fresh login
        fetchTosStatus().then((status) => {
          if (!status.accepted) setTosAccepted(false)
        }).catch(() => {})
      }
      setAuthed(true)
      // Register push token on fresh login too
      registerPushToken()
    })
  }

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: "#050a0f", alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color="#f59e0b" />
      </View>
    )
  }

  if (!authed) {
    if (ssoNewUser) {
      return (
        <SafeAreaProvider>
          <StatusBar style="light" />
          <SSOCompleteScreen
            registrationToken={ssoNewUser.registrationToken}
            email={ssoNewUser.email}
            provider={ssoNewUser.provider}
            onComplete={handleLogin}
            onBack={() => setSSONewUser(null)}
          />
        </SafeAreaProvider>
      )
    }
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <LoginScreen
          onLogin={handleLogin}
          onSSONewUser={(token, email, provider) => setSSONewUser({ registrationToken: token, email, provider })}
        />
      </SafeAreaProvider>
    )
  }

  if (!tosAccepted) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <TosGateScreen
          onAccept={async () => {
            await acceptTos()
            setTosAccepted(true)
          }}
        />
      </SafeAreaProvider>
    )
  }

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <NavigationContainer ref={navRef}>
          <StatusBar style="light" />
          <TabNavigator
            username={username}
            onSignOut={() => setAuthed(false)}
            role={role}
            onOpenNcmecReview={(id) => setNcmecReviewId(id)}
          />
        </NavigationContainer>
        <NcmecReviewModal pendingId={ncmecReviewId} onClose={() => setNcmecReviewId(null)} />
      </QueryClientProvider>
    </SafeAreaProvider>
  )
}
