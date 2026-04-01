import React from "react"
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs"
import { Text } from "react-native"
import CameraScreen from "../screens/CameraScreen"
import FeedScreen from "../screens/FeedScreen"
import MapScreen from "../screens/MapScreen"
import SettingsScreen from "../screens/SettingsScreen"

const Tab = createBottomTabNavigator()

const ICON: Record<string, string> = {
  Camera: "📷",
  Feed:   "📋",
  Map:    "🗺",
  Settings: "⚙️",
}

export function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: () => <Text style={{ fontSize: 20 }}>{ICON[route.name]}</Text>,
        tabBarActiveTintColor:   "#38bdf8",
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
      <Tab.Screen name="Camera"   component={CameraScreen}   options={{ title: "Camera" }} />
      <Tab.Screen name="Feed"     component={FeedScreen}     options={{ title: "Event Feed" }} />
      <Tab.Screen name="Map"      component={MapScreen}      options={{ title: "Mission Map" }} />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: "Settings" }} />
    </Tab.Navigator>
  )
}
