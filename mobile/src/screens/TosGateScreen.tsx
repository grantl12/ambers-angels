/**
 * mobile/src/screens/TosGateScreen.tsx
 *
 * Full-screen blocking gate shown when the user has not yet accepted the
 * current Terms of Service & Volunteer Agreement. The user cannot reach
 * any other part of the app until they tap "I Agree".
 */

import React, { useState } from "react"
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native"

type Props = {
  onAccept: () => Promise<void>
}

const TERMS = [
  "You are an independent volunteer, not an employee or agent of Amber's Angels.",
  "You will observe and report only — never pursue, confront, or approach any person or vehicle.",
  "You will comply with all applicable laws, including all traffic laws, at all times.",
  "Amber's Angels makes no guarantees regarding the accuracy of ALPR data or detections.",
  "You agree to data collection as described in the Privacy Policy (amberangels.org/privacy).",
]

export default function TosGateScreen({ onAccept }: Props) {
  const [accepting, setAccepting] = useState(false)

  async function handleAccept() {
    setAccepting(true)
    try {
      await onAccept()
    } finally {
      setAccepting(false)
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.logoRow}>
          <View style={styles.logoDot} />
          <Text style={styles.logoText}>Amber's Angels</Text>
        </View>

        <Text style={styles.heading}>Terms of Service{"\n"}& Volunteer Agreement</Text>
        <Text style={styles.subheading}>
          Please read and accept the following before continuing.
        </Text>

        <View style={styles.termsList}>
          {TERMS.map((term, i) => (
            <View key={i} style={styles.termRow}>
              <Text style={styles.bullet}>•</Text>
              <Text style={styles.termText}>{term}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.legalNote}>
          By tapping "I Agree" you confirm that you have read, understand, and
          agree to these terms. This agreement is effective as of today and
          remains in effect for all future use of the app.
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.agreeBtn, accepting && styles.btnDisabled]}
          onPress={handleAccept}
          disabled={accepting}
          activeOpacity={0.8}
        >
          {accepting ? (
            <ActivityIndicator color="#050a0f" size="small" />
          ) : (
            <Text style={styles.agreeBtnText}>I Agree</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#050a0f",
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 24,
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 32,
  },
  logoDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#f59e0b",
  },
  logoText: {
    color: "#f59e0b",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  heading: {
    color: "#f1f5f9",
    fontSize: 26,
    fontWeight: "800",
    lineHeight: 32,
    marginBottom: 10,
  },
  subheading: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 28,
  },
  termsList: {
    borderRadius: 12,
    backgroundColor: "#0d1117",
    borderWidth: 1,
    borderColor: "#1a2332",
    padding: 18,
    gap: 14,
    marginBottom: 24,
  },
  termRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
  },
  bullet: {
    color: "#f59e0b",
    fontSize: 16,
    lineHeight: 22,
    marginTop: 0,
  },
  termText: {
    flex: 1,
    color: "#cbd5e1",
    fontSize: 14,
    lineHeight: 22,
  },
  legalNote: {
    color: "rgba(255,255,255,0.3)",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 32,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#1a2332",
    backgroundColor: "#050a0f",
  },
  agreeBtn: {
    backgroundColor: "#f59e0b",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  agreeBtnText: {
    color: "#050a0f",
    fontWeight: "800",
    fontSize: 16,
    letterSpacing: 0.3,
  },
  btnDisabled: {
    opacity: 0.5,
  },
})
