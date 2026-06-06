/**
 * mobile/src/screens/AdminScreen.tsx
 *
 * Admin-only control panel. Accessible only when role === 'admin'.
 * Covers: system health, test alert injection, pilot listing, pending approvals,
 * and coordinator request management.
 */

import React, { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { apiDelete, apiGet, apiPost } from '../api/client'

// ── types ─────────────────────────────────────────────────────────────────────

type SystemHealth = {
  status:              string
  database:            string
  worker:              string
  nginx:               string
  rtmp_feeds:          { active: number; configured: number }
  watchlist_entries:   number
  detections_last_1h:  number
  last_fema_poll:      string | null
  last_ncmec_poll:     string | null
  last_detection_at:   string | null
}

type Pilot = {
  username:          string
  fullName:          string | null
  email:             string
  city:              string | null
  role:              string
  canDispatchDrones: boolean
  approvedAt:        string | null
}

type PendingPilot = {
  username: string
  fullName: string | null
  email:    string
  city:     string | null
  part107:  boolean
}

type CoordRequest = {
  username:    string
  fullName:    string | null
  requestedAt: string | null
  reason:      string | null
}

// ── screen ────────────────────────────────────────────────────────────────────

export default function AdminScreen() {
  const [health,       setHealth]       = useState<SystemHealth | null>(null)
  const [healthErr,    setHealthErr]    = useState<string | null>(null)
  const [pilots,       setPilots]       = useState<Pilot[]>([])
  const [pending,      setPending]      = useState<PendingPilot[]>([])
  const [coordReqs,    setCoordReqs]    = useState<CoordRequest[]>([])
  const [loading,      setLoading]      = useState(true)

  const [testMsg,      setTestMsg]      = useState<string | null>(null)
  const [testing,      setTesting]      = useState(false)
  const [clearing,     setClearing]     = useState(false)
  const [approvingP,   setApprovingP]   = useState<string | null>(null)
  const [approvingC,   setApprovingC]   = useState<string | null>(null)

  // ── data loading ──────────────────────────────────────────────────────────

  const loadHealth = useCallback(async () => {
    try {
      setHealth(await apiGet<SystemHealth>('/health'))
      setHealthErr(null)
    } catch {
      setHealthErr('Health check failed')
    }
  }, [])

  const loadPilots = useCallback(async () => {
    try {
      setPilots(await apiGet<Pilot[]>('/pilots'))
    } catch { /* non-fatal */ }
  }, [])

  const loadPending = useCallback(async () => {
    try {
      const [pendingList, coords] = await Promise.all([
        apiGet<PendingPilot[]>('/auth/pending'),
        apiGet<CoordRequest[]>('/auth/coordinator-requests'),
      ])
      setPending(pendingList)
      setCoordReqs(coords)
    } catch { /* non-fatal */ }
  }, [])

  useFocusEffect(
    useCallback(() => {
      let alive = true
      const run = async () => {
        setLoading(true)
        await Promise.all([loadHealth(), loadPilots(), loadPending()])
        if (alive) setLoading(false)
      }
      run()
      const id = setInterval(loadHealth, 15_000)
      return () => { alive = false; clearInterval(id) }
    }, [loadHealth, loadPilots, loadPending]),
  )

  // ── actions ───────────────────────────────────────────────────────────────

  async function injectTestAlert() {
    setTesting(true)
    setTestMsg(null)
    try {
      const res = await apiPost<{ ok: boolean; plate: string; identifier: string }>(
        '/admin/inject-alert',
        {
          plate:          'YVJ024',
          headline:       'Demo Alert — Test Scan Active — Carrollton GA',
          area:           'Carrollton, GA',
          alert_type:     'amber',
          source_program: 'Demo Inject',
          vehicle_color:  'White',
          vehicle_type:   'car',
        },
      )
      setTestMsg(`Demo alert live — plate ${res.plate} on watchlist. Check Discord.`)
    } catch (e: unknown) {
      setTestMsg(e instanceof Error ? e.message : 'Injection failed.')
    } finally {
      setTesting(false)
    }
  }

  function confirmClearTestData() {
    Alert.alert(
      'Clear Test Data',
      'Delete all demo watchlist entries, vehicle targets, and non-alerted detection events? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear', style: 'destructive',
          onPress: async () => {
            setClearing(true)
            setTestMsg(null)
            try {
              const res = await apiDelete<{ cleared: { watchlist: number; vehicle_targets: number; detection_events: number } }>('/admin/test-data')
              setTestMsg(
                `Cleared — ${res.cleared.watchlist} watchlist, ` +
                `${res.cleared.vehicle_targets} targets, ` +
                `${res.cleared.detection_events} detections`
              )
              loadHealth()
            } catch (e: unknown) {
              setTestMsg(e instanceof Error ? e.message : 'Clear failed.')
            } finally {
              setClearing(false)
            }
          },
        },
      ],
    )
  }

  async function approvePilot(username: string) {
    setApprovingP(username)
    try {
      await apiPost(`/auth/approve/${username}`, {})
      setPending(prev => prev.filter(p => p.username !== username))
      loadPilots()
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Approval failed.')
    } finally {
      setApprovingP(null)
    }
  }

  async function approveCoord(username: string) {
    setApprovingC(username)
    try {
      await apiPost(`/auth/approve-coordinator/${username}`, {})
      setCoordReqs(prev => prev.filter(r => r.username !== username))
      loadPilots()
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Approval failed.')
    } finally {
      setApprovingC(null)
    }
  }

  function confirmDenyCoord(username: string) {
    Alert.alert(
      'Deny Request',
      `Deny coordinator access for @${username}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Deny', style: 'destructive',
          onPress: async () => {
            try {
              await apiPost(`/auth/deny-coordinator/${username}`, {})
              setCoordReqs(prev => prev.filter(r => r.username !== username))
            } catch (e: unknown) {
              Alert.alert('Error', e instanceof Error ? e.message : 'Denial failed.')
            }
          },
        },
      ],
    )
  }

  // ── render ────────────────────────────────────────────────────────────────

  const dot = (s: string) =>
    s === 'ok' || s === 'healthy' || s === 'up' ? '#34d399' : '#f87171'

  const roleColor = (role: string) =>
    role === 'admin' ? '#f59e0b' : role === 'coordinator' ? '#818cf8' : '#34d399'

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color="#f59e0b" size="large" />
      </View>
    )
  }

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <Text style={s.pageTitle}>Admin Panel</Text>

      {/* ── SYSTEM HEALTH ── */}
      <Section title="System Health">
        {healthErr ? (
          <Text style={s.errorText}>{healthErr}</Text>
        ) : health ? (
          <View style={s.healthBox}>
            <HR label="API"            value={health.status}              color={dot(health.status)} />
            <HR label="Database"       value={health.database}            color={dot(health.database)} />
            <HR label="Worker"         value={health.worker}              color={dot(health.worker)} />
            <HR label="Nginx"          value={health.nginx}               color={dot(health.nginx)} />
            <HR label="Watchlist"      value={String(health.watchlist_entries)}  color="#e2e8f0" />
            <HR label="Detections 1h"  value={String(health.detections_last_1h)} color="#e2e8f0" />
            {health.last_fema_poll && (
              <HR
                label="Last FEMA poll"
                value={new Date(health.last_fema_poll).toLocaleTimeString()}
                color="#9ca3af"
                last
              />
            )}
          </View>
        ) : null}
      </Section>

      {/* ── TEST CONTROLS ── */}
      <Section title="Test Controls">
        {testMsg && (
          <Text style={[s.feedbackText, testMsg.toLowerCase().includes('fail') ? s.errorText : null]}>
            {testMsg}
          </Text>
        )}
        <TouchableOpacity
          style={[s.btn, s.btnAmber, testing && s.btnDisabled]}
          onPress={injectTestAlert}
          disabled={testing}
        >
          {testing
            ? <ActivityIndicator color="#050a0f" size="small" />
            : <Text style={s.btnTextDark}>Inject Demo Alert (YVJ024)</Text>}
        </TouchableOpacity>
        <Text style={s.helpText}>
          Activates a demo AMBER alert for plate YVJ024 (your vehicle), fires Discord, and opens the camera gate.
        </Text>
        <TouchableOpacity
          style={[s.btn, s.btnDanger, clearing && s.btnDisabled]}
          onPress={confirmClearTestData}
          disabled={clearing}
        >
          {clearing
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={s.btnText}>Clear Test Data</Text>}
        </TouchableOpacity>
      </Section>

      {/* ── REGISTERED PILOTS ── */}
      <Section title={`Registered Pilots (${pilots.length})`}>
        {pilots.length === 0 ? (
          <Text style={s.emptyText}>No approved pilots yet.</Text>
        ) : pilots.map(p => (
          <View key={p.username} style={s.card}>
            <View style={s.cardRow}>
              <Text style={s.cardName}>{p.fullName ?? p.username}</Text>
              <View style={[s.roleBadge, { borderColor: roleColor(p.role) }]}>
                <Text style={[s.roleText, { color: roleColor(p.role) }]}>{p.role}</Text>
              </View>
            </View>
            <Text style={s.cardMeta}>@{p.username}{p.city ? ` · ${p.city}` : ''}</Text>
            <Text style={s.cardMeta}>{p.email}</Text>
            {p.canDispatchDrones && (
              <Text style={[s.cardMeta, { color: '#818cf8' }]}>✓ Dispatch authorized</Text>
            )}
          </View>
        ))}
      </Section>

      {/* ── PENDING PILOTS ── */}
      <Section title={`Pending Approval${pending.length > 0 ? ` (${pending.length})` : ''}`}>
        {pending.length === 0 ? (
          <Text style={s.emptyText}>No pending registrations.</Text>
        ) : pending.map(p => (
          <View key={p.username} style={s.card}>
            <View style={s.cardRow}>
              <Text style={s.cardName}>{p.fullName ?? p.username}</Text>
              {p.part107 && <Text style={s.badge107}>FAA 107</Text>}
            </View>
            <Text style={s.cardMeta}>@{p.username}{p.city ? ` · ${p.city}` : ''}</Text>
            <Text style={s.cardMeta}>{p.email}</Text>
            <TouchableOpacity
              style={[s.btn, s.btnApprove, s.btnSm, approvingP === p.username && s.btnDisabled]}
              onPress={() => approvePilot(p.username)}
              disabled={approvingP === p.username}
            >
              {approvingP === p.username
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={s.btnText}>Approve</Text>}
            </TouchableOpacity>
          </View>
        ))}
      </Section>

      {/* ── COORDINATOR REQUESTS ── */}
      <Section title={`Coordinator Requests${coordReqs.length > 0 ? ` (${coordReqs.length})` : ''}`}>
        {coordReqs.length === 0 ? (
          <Text style={s.emptyText}>No coordinator requests.</Text>
        ) : coordReqs.map(r => (
          <View key={r.username} style={s.card}>
            <Text style={s.cardName}>{r.fullName ?? r.username}</Text>
            <Text style={s.cardMeta}>@{r.username}</Text>
            {r.reason ? (
              <Text style={s.cardReason}>{r.reason}</Text>
            ) : null}
            <View style={s.actionRow}>
              <TouchableOpacity
                style={[s.btn, s.btnApprove, s.btnFlex, approvingC === r.username && s.btnDisabled]}
                onPress={() => approveCoord(r.username)}
                disabled={approvingC === r.username}
              >
                {approvingC === r.username
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={s.btnText}>Approve</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.btn, s.btnDanger, s.btnFlex]}
                onPress={() => confirmDenyCoord(r.username)}
              >
                <Text style={s.btnText}>Deny</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </Section>
    </ScrollView>
  )
}

// ── sub-components ────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  )
}

function HR({ label, value, color, last }: { label: string; value: string; color: string; last?: boolean }) {
  return (
    <View style={[hrS.row, last && hrS.rowLast]}>
      <Text style={hrS.label}>{label}</Text>
      <Text style={[hrS.value, { color }]}>{value}</Text>
    </View>
  )
}

const hrS = StyleSheet.create({
  row:     { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#1a2332' },
  rowLast: { borderBottomWidth: 0 },
  label:   { color: '#6b7280', fontSize: 13 },
  value:   { fontSize: 13, fontWeight: '600' },
})

// ── styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#050a0f' },
  container: { flex: 1, backgroundColor: '#050a0f' },
  content:   { padding: 16, paddingBottom: 48 },

  pageTitle:    { color: '#f59e0b', fontSize: 20, fontWeight: '700', marginBottom: 20, letterSpacing: 0.3 },
  section:      { marginBottom: 24 },
  sectionTitle: {
    color: '#94a3b8', fontSize: 11, fontWeight: '700', letterSpacing: 1,
    textTransform: 'uppercase', marginBottom: 10,
    paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: '#1a2332',
  },

  healthBox: { backgroundColor: '#0d1117', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#1a2332' },

  card:     { backgroundColor: '#0d1117', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#1a2332', marginBottom: 8 },
  cardRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  cardName: { color: '#e2e8f0', fontSize: 15, fontWeight: '600', flex: 1, marginRight: 8 },
  cardMeta: { color: '#6b7280', fontSize: 12, marginBottom: 2 },
  cardReason: {
    color: '#9ca3af', fontSize: 12, fontStyle: 'italic',
    marginVertical: 6, paddingHorizontal: 8, paddingVertical: 4,
    borderLeftWidth: 2, borderLeftColor: '#374151',
    backgroundColor: '#0a0f16', borderRadius: 4,
  },

  roleBadge: {
    borderWidth: 1, borderRadius: 4,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  roleText: { fontSize: 10, fontWeight: '700' },

  badge107: {
    backgroundColor: '#052e16', color: '#34d399',
    fontSize: 10, fontWeight: '700',
    paddingHorizontal: 7, paddingVertical: 2,
    borderRadius: 4, overflow: 'hidden',
  },

  btn:        { borderRadius: 8, paddingVertical: 10, alignItems: 'center', marginTop: 8 },
  btnSm:      { marginTop: 10 },
  btnFlex:    { flex: 1 },
  btnAmber:   { backgroundColor: '#f59e0b' },
  btnApprove: { backgroundColor: '#065f46', borderWidth: 1, borderColor: '#059669' },
  btnDanger:  { backgroundColor: '#7f1d1d', borderWidth: 1, borderColor: '#991b1b' },
  btnDisabled:{ opacity: 0.45 },
  btnText:    { color: '#fff', fontWeight: '700', fontSize: 14 },
  btnTextDark:{ color: '#050a0f', fontWeight: '700', fontSize: 14 },

  helpText:    { color: '#4b5563', fontSize: 11, marginTop: 4, lineHeight: 16 },
  actionRow:   { flexDirection: 'row', gap: 8 },
  feedbackText:{ color: '#34d399', fontSize: 13, marginBottom: 6, textAlign: 'center' },
  errorText:   { color: '#f87171', fontSize: 13, marginBottom: 6 },
  emptyText:   { color: '#4b5563', fontSize: 14, textAlign: 'center', paddingVertical: 10 },
})
