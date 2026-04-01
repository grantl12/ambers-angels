import React, { useEffect } from "react"
import { StatusBar } from "expo-status-bar"
import { NavigationContainer } from "@react-navigation/native"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { TabNavigator } from "./src/navigation/TabNavigator"
import { loadSettings } from "./src/lib/settings"
import { setApiBaseUrl } from "./src/api/client"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5000, retry: 1 },
  },
})

export default function App() {
  // Apply persisted API base URL before first render
  useEffect(() => {
    loadSettings().then((s) => setApiBaseUrl(s.apiBaseUrl))
  }, [])

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <NavigationContainer>
          <StatusBar style="light" />
          <TabNavigator />
        </NavigationContainer>
      </QueryClientProvider>
    </SafeAreaProvider>
  )
}
