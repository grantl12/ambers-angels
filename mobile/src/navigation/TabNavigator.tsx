import React, { useCallback, useEffect, useRef, useState } from "react"
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs"
import { Text } from "react-native"
import CameraScreen from "../screens/CameraScreen"
import FeedScreen from "../screens/FeedScreen"
import MapScreen from "../screens/MapScreen"
import AutonomousMissionScreen from "../screens/AutonomousMissionScreen"
import CoordinatorDispatchScreen from "../screens/CoordinatorDispatchScreen"
import NotificationsScreen from "../screens/NotificationsScreen"
import SettingsScreen from "../screens/SettingsScreen"
import AdminScreen from "../screens/AdminScreen"
import { fetchNotifications } from "../api/notifications"

type Props = {
  username:          string | null
  onSignOut:         () => void
  role:              string
  onOpenNcmecReview: (id: number) => void
}

const Tab = createBottomTabNavigator()

const ICON: Record<string, string> = {
  Camera:        "📷",
  Feed:          "📋",
  Map:           "🗺",
  Notifications: "🔔",
  Missions:      "🚁",
  Settings:      "⚙️",
  Admin:         "🔐",
}

const POLL_INTERVAL_MS = 30_000

export function TabNavigator({ username, onSignOut, role, onOpenNcmecReview }: Props) {
  const isCoordinator = role === "coordinator" || role === "admin"
  const isAdmin       = role === "admin"
  const [unreadCount, setUnreadCount] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refreshUnread = useCallback(async () => {
    try {
      const { unread_count } = await fetchNotifications(1)
      setUnreadCount(unread_count)
    } catch {
      // best-effort — keep existing count
    }
  }, [])

  useEffect(() => {
    refreshUnread()
    intervalRef.current = setInterval(refreshUnread, POLL_INTERVAL_MS)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [refreshUnread])

  const badgeValue = unreadCount > 99 ? "99+" : unreadCount > 0 ? unreadCount : undefined

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: () => <Text style={{ fontSize: 20 }}>{ICON[route.name]}</Text>,
        tabBarActiveTintColor:   "#f59e0b",
        tabBarInactiveTintColor: "rgba(255,255,255,0.35)",
        tabBarStyle: {
          backgroundColor: "#080f18",
          borderTopColor:  "rgba(255,255,255,0.08)",
        },
        headerStyle:      { backgroundColor: "#050a0f" },
        headerTintColor:  "#fff",
        headerTitleStyle: { fontWeight: "700" },
      })}
    >
      <Tab.Screen name="Camera"   component={CameraScreen}             options={{ title: "Camera" }} />
      <Tab.Screen name="Feed"     component={FeedScreen}               options={{ title: "Event Feed" }} />
      <Tab.Screen name="Map"      component={MapScreen}                options={{ title: "Mission Map" }} />
      <Tab.Screen
        name="Notifications"
        options={{
          title: "Alerts",
          tabBarBadge: badgeValue,
          tabBarBadgeStyle: { backgroundColor: "#ef4444", color: "#fff", fontSize: 10 },
        }}
        listeners={{ tabPress: () => setUnreadCount(0) }}
      >
        {() => <NotificationsScreen onRead={() => setUnreadCount(0)} onOpenNcmecReview={onOpenNcmecReview} />}
      </Tab.Screen>
      <Tab.Screen name="Missions" options={{ title: isCoordinator ? "Dispatch" : "Missions" }}>
        {() => isCoordinator ? <CoordinatorDispatchScreen /> : <AutonomousMissionScreen />}
      </Tab.Screen>
      <Tab.Screen name="Settings">
        {() => <SettingsScreen username={username} onSignOut={onSignOut} />}
      </Tab.Screen>
      {isAdmin && (
        <Tab.Screen name="Admin" component={AdminScreen} options={{ title: "Admin" }} />
      )}
    </Tab.Navigator>
  )
}
