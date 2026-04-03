import React, { useEffect, useRef, useState } from "react"
import { Platform, View, ActivityIndicator } from "react-native"
import { StatusBar } from "expo-status-bar"
import { NavigationContainer, useNavigationContainerRef } from "@react-navigation/native"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import * as Notifications from "expo-notifications"
import { TabNavigator } from "./src/navigation/TabNavigator"
import LoginScreen from "./src/screens/LoginScreen"
import { loadSettings, saveSettings } from "./src/lib/settings"
import { setApiBaseUrl, apiPost } from "./src/api/client"
import { getAuthState } from "./src/lib/auth"
import { setPendingAlertTarget } from "./src/lib/alertTarget"

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
  const [ready,    setReady]    = useState(false)
  const [authed,   setAuthed]   = useState(false)
  const [username, setUsername] = useState<string | null>(null)
  const navRef = useNavigationContainerRef()

  // Notification tap → navigate to Map tab and queue a pan to the alert centroid
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown>
      const lat = typeof data?.centroidLat === "number" ? data.centroidLat : null
      const lng = typeof data?.centroidLng === "number" ? data.centroidLng : null
      const label = typeof data?.label === "string" ? data.label : "Alert area"
      if (lat !== null && lng !== null) {
        setPendingAlertTarget({ lat, lng, label })
      }
      // Navigate to the Map tab — works once the nav container is ready
      if (navRef.isReady()) {
        navRef.navigate("Map" as never)
      }
    })
    return () => sub.remove()
  }, [navRef])

  useEffect(() => {
    async function init() {
      const settings = await loadSettings()
      setApiBaseUrl(settings.apiBaseUrl)

      const auth = await getAuthState()
      if (auth) {
        setUsername(auth.username)
        setAuthed(true)

        // Sync pilotId from auth so telemetry is tagged correctly
        if (auth.username && auth.username !== settings.pilotId) {
          await saveSettings({ ...settings, pilotId: auth.username })
        }

        // Register/refresh push token so watch-area alerts reach this device
        registerPushToken()
      }
      setReady(true)
    }
    init()
  }, [])

  function handleLogin() {
    getAuthState().then((auth) => {
      if (auth) setUsername(auth.username)
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
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <LoginScreen onLogin={handleLogin} />
      </SafeAreaProvider>
    )
  }

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <NavigationContainer ref={navRef}>
          <StatusBar style="light" />
          <TabNavigator username={username} onSignOut={() => setAuthed(false)} />
        </NavigationContainer>
      </QueryClientProvider>
    </SafeAreaProvider>
  )
}
