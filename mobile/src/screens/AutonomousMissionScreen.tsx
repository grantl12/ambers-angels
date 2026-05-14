/**
 * mobile/src/screens/AutonomousMissionScreen.tsx
 *
 * Screen for accepting and monitoring autonomous waypoint missions
 * dispatched from the coordinator dashboard.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Geolocation from '@react-native-community/geolocation'

import {
  startWaypointMission,
  stopWaypointMission,
  onMissionStateChanged,
  getDroneLocation,
  type MissionState,
} from '../../modules/dji-camera/waypoint-mission'
import {
  fetchPendingMissions,
  fetchMyDrones,
  sendHeartbeat,
  updateMissionStatus,
  OPERATION_MODE_LABELS,
  type Drone,
  type Mission,
  type OperationMode,
} from '../api/autonomous'

const HEARTBEAT_INTERVAL_MS = 30_000

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActiveMission = {
  id: number
  state: MissionState
  progressPct: number
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function AutonomousMissionScreen() {
  const [token, setToken] = useState<string | null>(null)
  const [missions, setMissions] = useState<Mission[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState<ActiveMission | null>(null)
  const [actionPending, setActionPending] = useState(false)
  const [myDrone, setMyDrone] = useState<Drone | null>(null)
  const [swarmOnline, setSwarmOnline] = useState(false)

  const unsubRef = useRef<(() => void) | null>(null)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // -------------------------------------------------------------------------
  // Bootstrap
  // -------------------------------------------------------------------------

  useEffect(() => {
    AsyncStorage.getItem('aa_token').then((t) => {
      setToken(t)
    })
  }, [])

  const loadMissions = useCallback(async (jwt: string) => {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchPendingMissions(jwt)
      setMissions(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load missions.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (token) {
      loadMissions(token)
    }
  }, [token, loadMissions])

  // -------------------------------------------------------------------------
  // Drone lookup + swarm heartbeat
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!token) return

    fetchMyDrones(token)
      .then((drones) => { if (drones.length > 0) setMyDrone(drones[0]) })
      .catch(() => { /* no drone registered — swarm unavailable */ })
  }, [token])

  const sendSwarmHeartbeat = useCallback(async (jwt: string, droneId: number) => {
    try {
      // Prefer DJI GPS when drone is connected; fall back to device GPS
      let lat: number | null = null
      let lng: number | null = null

      if (Platform.OS === 'android') {
        try {
          const djPos = await getDroneLocation()
          lat = djPos.lat
          lng = djPos.lng
        } catch {
          // DJI not connected — use device GPS
        }
      }

      if (lat === null || lng === null) {
        await new Promise<void>((resolve, reject) => {
          Geolocation.getCurrentPosition(
            (pos) => { lat = pos.coords.latitude; lng = pos.coords.longitude; resolve() },
            (err) => reject(err),
            { enableHighAccuracy: false, timeout: 8000 },
          )
        })
      }

      if (lat !== null && lng !== null) {
        await sendHeartbeat(jwt, droneId, lat, lng)
        setSwarmOnline(true)
      }
    } catch {
      // Non-fatal — coordinator will see the drone go gray after 5 min
    }
  }, [])

  useEffect(() => {
    if (!token || !myDrone) return

    // Fire immediately, then every 30 s
    sendSwarmHeartbeat(token, myDrone.id)

    heartbeatRef.current = setInterval(
      () => sendSwarmHeartbeat(token, myDrone.id),
      HEARTBEAT_INTERVAL_MS,
    )

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current)
      heartbeatRef.current = null
      setSwarmOnline(false)
    }
  }, [token, myDrone, sendSwarmHeartbeat])

  // -------------------------------------------------------------------------
  // Mission state events
  // -------------------------------------------------------------------------

  const subscribeToMission = useCallback(
    (missionId: number, jwt: string) => {
      // Tear down any previous subscription.
      unsubRef.current?.()

      unsubRef.current = onMissionStateChanged(async ({ state, progressPct }) => {
        setActive((prev) =>
          prev ? { ...prev, state, progressPct: progressPct ?? prev.progressPct } : prev,
        )

        if (state === 'finished') {
          try {
            await updateMissionStatus(jwt, missionId, 'completed', 100)
          } catch {
            // best-effort
          }
          setActive(null)
          unsubRef.current?.()
          unsubRef.current = null
          // Refresh pending list.
          loadMissions(jwt)
        }
      })
    },
    [loadMissions],
  )

  useEffect(() => {
    return () => {
      unsubRef.current?.()
    }
  }, [])

  // -------------------------------------------------------------------------
  // Accept & Launch
  // -------------------------------------------------------------------------

  const handleAccept = useCallback(
    async (mission: Mission) => {
      if (!token) return
      setActionPending(true)
      try {
        await updateMissionStatus(token, mission.id, 'uploading')
        setActive({ id: mission.id, state: 'uploading', progressPct: 0 })

        await startWaypointMission(mission.waypoints, {
          altitudeM: mission.altitude_m,
          speedMps: mission.speed_mps,
        })

        setActive({ id: mission.id, state: 'executing', progressPct: 0 })
        await updateMissionStatus(token, mission.id, 'executing')
        subscribeToMission(mission.id, token)

        // Remove from pending list immediately.
        setMissions((prev) => prev.filter((m) => m.id !== mission.id))
      } catch (e: unknown) {
        setActive(null)
        setError(e instanceof Error ? e.message : 'Failed to start mission.')
        // Attempt to roll status back.
        try {
          await updateMissionStatus(token, mission.id, 'pending')
        } catch {
          // ignore
        }
      } finally {
        setActionPending(false)
      }
    },
    [token, subscribeToMission],
  )

  // -------------------------------------------------------------------------
  // Abort
  // -------------------------------------------------------------------------

  const handleAbort = useCallback(async () => {
    if (!token || !active) return
    setActionPending(true)
    try {
      await stopWaypointMission()
      await updateMissionStatus(token, active.id, 'aborted')
      setActive(null)
      unsubRef.current?.()
      unsubRef.current = null
      loadMissions(token)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Abort failed.')
    } finally {
      setActionPending(false)
    }
  }, [token, active, loadMissions])

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  const renderMissionCard = ({ item }: { item: Mission }) => {
    const isActive = active?.id === item.id

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.alertId}>Alert {item.alert_id}</Text>
          <Text style={styles.statusBadge}>{item.status.toUpperCase()}</Text>
        </View>

        <View style={styles.modeBadgeRow}>
          <Text style={[
            styles.modeBadge,
            item.operation_mode === 'vlos'             ? styles.modeVlos :
            item.operation_mode === 'bvlos_tactical'   ? styles.modeBvlosTactical :
                                                         styles.modeBvlosAutonomous,
          ]}>
            {OPERATION_MODE_LABELS[item.operation_mode] ?? item.operation_mode}
          </Text>
        </View>

        <View style={styles.cardMeta}>
          <MetaItem label="Altitude" value={`${item.altitude_m} m AGL`} />
          <MetaItem label="Speed" value={`${item.speed_mps} m/s`} />
          {item.observation_lat != null && item.observation_lng != null && (
            <MetaItem
              label="Post"
              value={`${item.observation_lat.toFixed(5)}, ${item.observation_lng.toFixed(5)}`}
            />
          )}
        </View>

        {isActive && active ? (
          <View style={styles.progressContainer}>
            <View style={styles.progressTrack}>
              <View
                style={[styles.progressFill, { width: `${active.progressPct}%` }]}
              />
            </View>
            <Text style={styles.progressLabel}>
              {active.state === 'uploading'
                ? 'Uploading…'
                : `${active.progressPct}% — ${active.state}`}
            </Text>
            <TouchableOpacity
              style={[styles.abortBtn, actionPending && styles.btnDisabled]}
              onPress={handleAbort}
              disabled={actionPending}
            >
              {actionPending ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.abortBtnText}>Abort Mission</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={[
              styles.acceptBtn,
              (actionPending || active !== null) && styles.btnDisabled,
            ]}
            onPress={() => handleAccept(item)}
            disabled={actionPending || active !== null}
          >
            {actionPending ? (
              <ActivityIndicator color="#050a0f" size="small" />
            ) : (
              <Text style={styles.acceptBtnText}>Accept &amp; Launch</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    )
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (!token) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.errorText}>Not authenticated.</Text>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Autonomous Missions</Text>
          {myDrone && (
            <Text style={[styles.swarmStatus, swarmOnline ? styles.swarmOnline : styles.swarmOffline]}>
              {swarmOnline
                ? `● Swarm online — ${myDrone.drone_model}`
                : `○ ${myDrone.drone_model} · connecting…`}
            </Text>
          )}
        </View>
        <TouchableOpacity
          onPress={() => loadMissions(token)}
          disabled={loading}
          style={styles.refreshBtn}
        >
          <Text style={styles.refreshText}>{loading ? '…' : 'Refresh'}</Text>
        </TouchableOpacity>
      </View>

      {error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : null}

      {loading && missions.length === 0 ? (
        <ActivityIndicator color="#f59e0b" size="large" style={{ marginTop: 40 }} />
      ) : missions.length === 0 && !active ? (
        <Text style={styles.emptyText}>No pending missions.</Text>
      ) : (
        <FlatList
          data={missions}
          keyExtractor={(m) => String(m.id)}
          renderItem={renderMissionCard}
          contentContainerStyle={styles.list}
        />
      )}
    </SafeAreaView>
  )
}

// ---------------------------------------------------------------------------
// Small helper component
// ---------------------------------------------------------------------------

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaItem}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050a0f',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1a2332',
  },
  swarmStatus: {
    fontSize: 11,
    marginTop: 2,
    fontWeight: '500',
  },
  swarmOnline: {
    color: '#34d399',
  },
  swarmOffline: {
    color: 'rgba(255,255,255,0.3)',
  },
  title: {
    color: '#f59e0b',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  refreshBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  refreshText: {
    color: '#f59e0b',
    fontSize: 14,
  },
  list: {
    padding: 16,
    gap: 12,
  },
  card: {
    backgroundColor: '#0d1117',
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1a2332',
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  alertId: {
    color: '#e2e8f0',
    fontSize: 16,
    fontWeight: '600',
  },
  statusBadge: {
    color: '#f59e0b',
    fontSize: 11,
    fontWeight: '700',
    backgroundColor: '#1a1400',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  modeBadgeRow: {
    marginBottom: 10,
  },
  modeBadge: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
  modeVlos: {
    color: '#34d399',
    backgroundColor: '#052e16',
  },
  modeBvlosTactical: {
    color: '#fbbf24',
    backgroundColor: '#1c0f00',
  },
  modeBvlosAutonomous: {
    color: '#c084fc',
    backgroundColor: '#1a0030',
  },
  cardMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  metaItem: {
    backgroundColor: '#111827',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  metaLabel: {
    color: '#6b7280',
    fontSize: 10,
    marginBottom: 1,
  },
  metaValue: {
    color: '#d1d5db',
    fontSize: 13,
    fontWeight: '600',
  },
  acceptBtn: {
    backgroundColor: '#f59e0b',
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
  },
  acceptBtnText: {
    color: '#050a0f',
    fontWeight: '700',
    fontSize: 15,
  },
  progressContainer: {
    gap: 8,
  },
  progressTrack: {
    height: 6,
    backgroundColor: '#1a2332',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#f59e0b',
    borderRadius: 3,
  },
  progressLabel: {
    color: '#9ca3af',
    fontSize: 12,
    textAlign: 'center',
  },
  abortBtn: {
    backgroundColor: '#7f1d1d',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#991b1b',
  },
  abortBtnText: {
    color: '#fca5a5',
    fontWeight: '700',
    fontSize: 14,
  },
  btnDisabled: {
    opacity: 0.45,
  },
  errorText: {
    color: '#f87171',
    textAlign: 'center',
    marginTop: 24,
    marginHorizontal: 20,
    fontSize: 14,
  },
  emptyText: {
    color: '#4b5563',
    textAlign: 'center',
    marginTop: 60,
    fontSize: 15,
  },
})
