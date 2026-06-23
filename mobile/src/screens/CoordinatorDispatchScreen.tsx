/**
 * CoordinatorDispatchScreen — mobile-native mission dispatch for coordinators.
 *
 * Shows all registered swarm drones with live/stale status. Tap a drone to
 * open an inline dispatch form: alert picker, observation point, operation
 * mode, altitude, speed. Mirrors the web map dispatch modal in a list-based
 * layout optimised for one-handed use on a phone.
 */
import React, { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import MapView, { Marker, Polygon, PROVIDER_DEFAULT } from 'react-native-maps'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  fetchAllDrones,
  dispatchMission,
  dispatchWaterSearchMission,
  fetchNearbyWaterBodies,
  isDroneOnline,
  OPERATION_MODE_LABELS,
  type Drone,
  type OperationMode,
  type WaterBody,
} from '../api/autonomous'
import { fetchFemaAlerts, type FemaAlert } from '../api/fema'
import { fetchAirTraffic, type Aircraft } from '../api/airspace'

const OPERATION_MODES: OperationMode[] = ['vlos', 'bvlos_tactical']

export default function CoordinatorDispatchScreen() {
  const [token,     setToken]     = useState<string | null>(null)
  const [drones,    setDrones]    = useState<Drone[]>([])
  const [alerts,    setAlerts]    = useState<FemaAlert[]>([])
  const [loading,   setLoading]   = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  // Dispatch form state
  const [selected,  setSelected]  = useState<Drone | null>(null)
  const [alertId,   setAlertId]   = useState('')
  const [obsLat,    setObsLat]    = useState('')
  const [obsLng,    setObsLng]    = useState('')
  const [mode,      setMode]      = useState<OperationMode>('vlos')
  const [altitude,  setAltitude]  = useState('60')
  const [speed,     setSpeed]     = useState('8')
  const [dispatching,     setDispatching]     = useState(false)
  const [successId,       setSuccessId]       = useState<number | null>(null)

  // Water search (Purple Alert)
  const [dispatchMode,    setDispatchMode]    = useState<'observation' | 'water_search'>('observation')
  const [waterBodies,     setWaterBodies]     = useState<WaterBody[]>([])
  const [loadingWater,    setLoadingWater]    = useState(false)
  const [selectedWater,   setSelectedWater]   = useState<WaterBody | null>(null)

  // Map picker + airspace advisory
  const [showMapPicker,   setShowMapPicker]   = useState(false)
  const [pickCoord,       setPickCoord]       = useState<{ latitude: number; longitude: number } | null>(null)
  const [mapPickerRegion, setMapPickerRegion] = useState<{ latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number } | null>(null)
  const [aircraftNearby,  setAircraftNearby]  = useState<Aircraft[]>([])
  const [loadingAirspace, setLoadingAirspace] = useState(false)

  useEffect(() => {
    AsyncStorage.getItem('aa_token').then(setToken)
  }, [])

  const load = useCallback(async () => {
    if (!token) return
    setError(null)
    try {
      // Run independently — a FEMA hiccup shouldn't block the drone list
      const [droneResult, alertResult] = await Promise.allSettled([
        fetchAllDrones(token),
        fetchFemaAlerts(),
      ])

      if (droneResult.status === 'fulfilled') {
        setDrones(droneResult.value)
      } else {
        setError('Could not load drones. Pull down to refresh.')
      }

      if (alertResult.status === 'fulfilled') {
        setAlerts(alertResult.value)
      }
      // Alert failures are silent — the picker just shows empty
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (token) load()
  }, [token, load])

  // Re-check airspace whenever obs point changes (debounced 800ms)
  useEffect(() => {
    if (!obsLat || !obsLng) { setAircraftNearby([]); return }
    const lat = parseFloat(obsLat)
    const lng = parseFloat(obsLng)
    if (isNaN(lat) || isNaN(lng)) return
    const buf = 0.09 // ~6 nm buffer
    const timer = setTimeout(async () => {
      setLoadingAirspace(true)
      try {
        const all = await fetchAirTraffic(lat - buf, lat + buf, lng - buf, lng + buf)
        const nowSec = Date.now() / 1000
        const R = 6_371_000
        const nearby = all.filter((ac) => {
          if (ac.altitudeM == null || ac.altitudeM > 914) return false
          if (ac.timePosition != null && nowSec - ac.timePosition > 300) return false
          const dLat = (ac.lat - lat) * Math.PI / 180
          const dLng = (ac.lng - lng) * Math.PI / 180
          const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat * Math.PI / 180) * Math.cos(ac.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
          return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) < 9_260
        })
        setAircraftNearby(nearby)
      } catch { setAircraftNearby([]) }
      finally { setLoadingAirspace(false) }
    }, 800)
    return () => clearTimeout(timer)
  }, [obsLat, obsLng])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  function selectDrone(drone: Drone) {
    setSelected((prev) => prev?.id === drone.id ? null : drone)
    setAlertId('')
    setObsLat('')
    setObsLng('')
    setMode('vlos')
    setSuccessId(null)
    setAircraftNearby([])
    setDispatchMode('observation')
    setWaterBodies([])
    setSelectedWater(null)
  }

  function pickAlert(id: string) {
    setAlertId(id)
    setSelectedWater(null)
    const a = alerts.find((a) => String(a.id) === id)
    if (a?.centroidLat != null && a?.centroidLng != null) {
      setObsLat(a.centroidLat.toFixed(5))
      setObsLng(a.centroidLng.toFixed(5))
    }

    // Fetch water bodies for purple alerts
    if (a?.alertType === 'purple' && a.centroidLat != null && a.centroidLng != null && token) {
      setDispatchMode('water_search')
      setAltitude('15')
      setSpeed('3')
      setLoadingWater(true)
      fetchNearbyWaterBodies(token, a.centroidLat, a.centroidLng)
        .then(setWaterBodies)
        .catch(() => setWaterBodies([]))
        .finally(() => setLoadingWater(false))
    } else {
      setDispatchMode('observation')
      setWaterBodies([])
      setAltitude('60')
      setSpeed('8')
    }
  }

  async function handleDispatch() {
    if (!token || !selected || !alertId) return
    const alt = parseFloat(altitude)
    const spd = parseFloat(speed)

    if (mode === 'bvlos_tactical' && !selected.bvlos_authorized) {
      Alert.alert('Not authorized', 'This drone does not have a BVLOS waiver on file. An admin must set authorization before BVLOS dispatch.')
      return
    }

    setDispatching(true)
    try {
      let res: { id: number }

      if (dispatchMode === 'water_search' && selectedWater) {
        res = await dispatchWaterSearchMission(token, {
          alert_id:        alertId,
          drone_id:        selected.id,
          water_body_id:   selectedWater.id,
          water_body_name: selectedWater.name,
          polygon_geojson: selectedWater.polygon_geojson,
          altitude_m:      isNaN(alt) ? 15 : alt,
          speed_mps:       isNaN(spd) ? 3  : spd,
          operation_mode:  mode,
        })
      } else {
        const lat = parseFloat(obsLat)
        const lng = parseFloat(obsLng)
        if (isNaN(lat) || isNaN(lng)) {
          Alert.alert('Missing location', 'Enter a valid latitude and longitude for the observation post.')
          setDispatching(false)
          return
        }
        res = await dispatchMission(token, {
          alert_id:       alertId,
          drone_id:       selected.id,
          obs_lat:        lat,
          obs_lng:        lng,
          altitude_m:     isNaN(alt) ? 60 : alt,
          speed_mps:      isNaN(spd) ? 8  : spd,
          operation_mode: mode,
        })
      }

      setSuccessId(res.id)
      setSelected(null)
    } catch (e: unknown) {
      Alert.alert('Dispatch failed', e instanceof Error ? e.message : 'Could not create mission.')
    } finally {
      setDispatching(false)
    }
  }

  if (!token) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Not authenticated.</Text>
      </View>
    )
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#f59e0b" size="large" />
      </View>
    )
  }

  const onlineDrones  = drones.filter(isDroneOnline)
  const offlineDrones = drones.filter((d) => !isDroneOnline(d))

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#f59e0b" />}
        keyboardShouldPersistTaps="handled"
      >
        {/* Success toast */}
        {successId != null && (
          <View style={styles.successBanner}>
            <Text style={styles.successText}>
              Mission #{successId} dispatched — drone will receive waypoint on next sync.
            </Text>
          </View>
        )}

        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{error}</Text>
          </View>
        )}

        {/* Drone list */}
        <Text style={styles.sectionLabel}>Swarm Drones</Text>

        {drones.length === 0 && (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No drones registered. Pilots register their drone via the Missions tab.</Text>
          </View>
        )}

        {[...onlineDrones, ...offlineDrones].map((drone) => {
          const online    = isDroneOnline(drone)
          const isSelected = selected?.id === drone.id
          const ageMin    = drone.last_seen_at
            ? Math.floor((Date.now() - new Date(drone.last_seen_at).getTime()) / 60000)
            : null

          return (
            <TouchableOpacity
              key={drone.id}
              style={[styles.droneCard, isSelected && styles.droneCardSelected]}
              onPress={() => selectDrone(drone)}
              activeOpacity={0.75}
            >
              <View style={styles.droneRow}>
                <Text style={styles.droneEmoji}>🚁</Text>
                <View style={styles.droneInfo}>
                  <Text style={styles.droneModel}>{drone.drone_model}</Text>
                  <Text style={styles.dronePilot}>{drone.pilot_username}</Text>
                </View>
                <View style={styles.droneStatus}>
                  <View style={[styles.statusDot, online ? styles.dotOnline : styles.dotOffline]} />
                  <Text style={[styles.statusText, online ? styles.statusOnline : styles.statusOffline]}>
                    {online ? 'Online' : ageMin != null ? `${ageMin}m ago` : 'Never'}
                  </Text>
                </View>
              </View>
              {drone.bvlos_authorized && (
                <View style={styles.bvlosChip}>
                  <Text style={styles.bvlosChipText}>BVLOS</Text>
                </View>
              )}
            </TouchableOpacity>
          )
        })}

        {/* Dispatch form — shown when a drone is selected */}
        {selected && (
          <View style={styles.dispatchBox}>
            <Text style={styles.dispatchTitle}>
              Dispatch — {selected.drone_model}
            </Text>

            {/* Alert picker */}
            <Text style={styles.fieldLabel}>Active Alert</Text>
            {alerts.length === 0 ? (
              <Text style={styles.fieldHint}>No active alerts. Inject a test alert or wait for FEMA feed.</Text>
            ) : (
              <View style={styles.alertList}>
                {alerts.map((a) => (
                  <TouchableOpacity
                    key={a.id}
                    style={[styles.alertChip, String(a.id) === alertId && styles.alertChipSelected]}
                    onPress={() => pickAlert(String(a.id))}
                  >
                    <Text style={[styles.alertChipType, String(a.id) === alertId && styles.alertChipTypeSelected]}>
                      {a.alertType.toUpperCase()}
                    </Text>
                    <Text style={[styles.alertChipText, String(a.id) === alertId && styles.alertChipTextSelected]} numberOfLines={1}>
                      {a.headline || a.area || 'Alert'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Water search mode toggle (purple alerts only) */}
            {waterBodies.length > 0 && (
              <>
                <Text style={styles.fieldLabel}>Dispatch Mode</Text>
                <View style={styles.modeRow}>
                  <TouchableOpacity
                    style={[styles.modeBtn, dispatchMode === 'observation' && styles.modeBtnActive]}
                    onPress={() => { setDispatchMode('observation'); setSelectedWater(null); setAltitude('60'); setSpeed('8') }}
                  >
                    <Text style={[styles.modeBtnText, dispatchMode === 'observation' && styles.modeBtnTextActive]}>
                      Observation
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modeBtn, dispatchMode === 'water_search' && styles.waterModeBtnActive]}
                    onPress={() => { setDispatchMode('water_search'); setAltitude('15'); setSpeed('3') }}
                  >
                    <Text style={[styles.modeBtnText, dispatchMode === 'water_search' && styles.waterModeBtnTextActive]}>
                      Water Search
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {/* Water body list (water search mode) */}
            {dispatchMode === 'water_search' && (
              <>
                <Text style={styles.fieldLabel}>Nearby Water Bodies</Text>
                {loadingWater ? (
                  <ActivityIndicator color="#a78bfa" size="small" style={{ marginVertical: 12 }} />
                ) : waterBodies.length === 0 ? (
                  <Text style={styles.fieldHint}>No water bodies found within 5 km of alert centroid.</Text>
                ) : (
                  <View style={styles.alertList}>
                    {waterBodies.map((wb) => {
                      const isSel = selectedWater?.id === wb.id
                      const distMi = (wb.distance_km * 0.621371).toFixed(1)
                      const areaAcres = wb.area_sqm ? (wb.area_sqm / 4047).toFixed(1) : null
                      return (
                        <TouchableOpacity
                          key={wb.id}
                          style={[styles.waterBodyCard, isSel && styles.waterBodyCardSelected]}
                          onPress={() => setSelectedWater(isSel ? null : wb)}
                        >
                          <View style={styles.waterBodyHeader}>
                            <Text style={[styles.waterBodyName, isSel && styles.waterBodyNameSelected]}>
                              {wb.name || `Unnamed ${wb.water_type}`}
                            </Text>
                            <Text style={styles.waterBodyDist}>{distMi} mi</Text>
                          </View>
                          <Text style={styles.waterBodyMeta}>
                            {wb.water_type}{areaAcres ? ` · ${areaAcres} acres` : ''}
                          </Text>
                        </TouchableOpacity>
                      )
                    })}
                  </View>
                )}
              </>
            )}

            {/* Observation point (observation mode only) */}
            {dispatchMode === 'observation' && (
            <>
            <Text style={styles.fieldLabel}>Observation Post</Text>
            <Text style={styles.fieldHint}>Auto-filled from alert centroid. Override by entering coordinates.</Text>
            <View style={styles.coordRow}>
              <View style={styles.coordField}>
                <Text style={styles.coordLabel}>Latitude</Text>
                <TextInput
                  style={styles.input}
                  value={obsLat}
                  onChangeText={setObsLat}
                  placeholder="33.58010"
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  keyboardType="numeric"
                />
              </View>
              <View style={styles.coordField}>
                <Text style={styles.coordLabel}>Longitude</Text>
                <TextInput
                  style={styles.input}
                  value={obsLng}
                  onChangeText={setObsLng}
                  placeholder="-85.0766"
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  keyboardType="numeric"
                />
              </View>
            </View>

            {/* Place on map */}
            <TouchableOpacity
              style={styles.mapPickBtn}
              onPress={() => {
                const lat = parseFloat(obsLat)
                const lng = parseFloat(obsLng)
                const a = alerts.find((al) => String(al.id) === alertId)
                const region = (!isNaN(lat) && !isNaN(lng))
                  ? { latitude: lat, longitude: lng, latitudeDelta: 0.05, longitudeDelta: 0.05 }
                  : a?.centroidLat != null && a?.centroidLng != null
                  ? { latitude: a.centroidLat, longitude: a.centroidLng, latitudeDelta: 0.1, longitudeDelta: 0.1 }
                  : { latitude: 33.58, longitude: -85.08, latitudeDelta: 0.3, longitudeDelta: 0.3 }
                setPickCoord(!isNaN(lat) && !isNaN(lng) ? { latitude: lat, longitude: lng } : null)
                setMapPickerRegion(region)
                setShowMapPicker(true)
              }}
            >
              <Text style={styles.mapPickBtnText}>📍 Place on Map</Text>
            </TouchableOpacity>
            </>
            )}

            {/* Airspace advisory */}
            {loadingAirspace && (
              <ActivityIndicator color="#38bdf8" size="small" style={{ marginTop: 10 }} />
            )}
            {!loadingAirspace && aircraftNearby.length > 0 && (
              <View style={styles.airspaceWarning}>
                <Text style={styles.airspaceTitle}>
                  ✈ {aircraftNearby.length} aircraft within 5 nm below 3,000 ft
                </Text>
                {aircraftNearby.slice(0, 3).map((ac) => (
                  <Text key={ac.icao24} style={styles.airspaceItem}>
                    {ac.callsign?.trim() || ac.icao24}
                    {ac.altitudeM != null ? ` · ${Math.round(ac.altitudeM * 3.281)} ft` : ''}
                    {ac.heading != null ? ` · ${Math.round(ac.heading)}°` : ''}
                  </Text>
                ))}
                <Text style={styles.airspaceHint}>Verify deconfliction before launch.</Text>
              </View>
            )}

            {/* Operation mode */}
            <Text style={styles.fieldLabel}>Operation Mode</Text>
            <View style={styles.modeRow}>
              {OPERATION_MODES.map((m) => {
                const locked = m === 'bvlos_tactical' && !selected.bvlos_authorized
                return (
                  <TouchableOpacity
                    key={m}
                    style={[
                      styles.modeBtn,
                      mode === m && styles.modeBtnActive,
                      locked && styles.modeBtnLocked,
                    ]}
                    onPress={() => !locked && setMode(m)}
                    disabled={locked}
                  >
                    <Text style={[styles.modeBtnText, mode === m && styles.modeBtnTextActive, locked && styles.modeBtnTextLocked]}>
                      {m === 'vlos' ? 'VLOS' : 'BVLOS Tactical'}
                    </Text>
                    {locked && (
                      <Text style={styles.modeLockHint}>waiver required</Text>
                    )}
                  </TouchableOpacity>
                )
              })}
            </View>

            {/* Altitude + speed */}
            <View style={styles.coordRow}>
              <View style={styles.coordField}>
                <Text style={styles.coordLabel}>Altitude (m AGL)</Text>
                <TextInput
                  style={styles.input}
                  value={altitude}
                  onChangeText={setAltitude}
                  keyboardType="numeric"
                  placeholder="60"
                  placeholderTextColor="rgba(255,255,255,0.2)"
                />
              </View>
              <View style={styles.coordField}>
                <Text style={styles.coordLabel}>Speed (m/s)</Text>
                <TextInput
                  style={styles.input}
                  value={speed}
                  onChangeText={setSpeed}
                  keyboardType="numeric"
                  placeholder="8"
                  placeholderTextColor="rgba(255,255,255,0.2)"
                />
              </View>
            </View>

            {/* Dispatch button */}
            {(() => {
              const canDispatch = dispatchMode === 'water_search'
                ? !!(alertId && selectedWater && !dispatching)
                : !!(alertId && obsLat && obsLng && !dispatching)
              return (
                <TouchableOpacity
                  style={[
                    dispatchMode === 'water_search' ? styles.waterDispatchBtn : styles.dispatchBtn,
                    !canDispatch && styles.dispatchBtnDisabled,
                  ]}
                  onPress={handleDispatch}
                  disabled={!canDispatch}
                >
                  {dispatching
                    ? <ActivityIndicator color="#050a0f" size="small" />
                    : <Text style={styles.dispatchBtnText}>
                        {dispatchMode === 'water_search' ? 'Dispatch Water Search' : 'Dispatch Mission'}
                      </Text>
                  }
                </TouchableOpacity>
              )
            })()}

            <TouchableOpacity style={styles.cancelBtn} onPress={() => setSelected(null)}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── MAP PICKER MODAL ── */}
      <Modal
        visible={showMapPicker}
        animationType="slide"
        onRequestClose={() => setShowMapPicker(false)}
      >
        <SafeAreaView style={styles.mapPickerRoot}>
          {/* Header */}
          <View style={styles.mapPickerHeader}>
            <TouchableOpacity onPress={() => setShowMapPicker(false)} style={styles.mapPickerHeaderBtn}>
              <Text style={styles.mapPickerCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.mapPickerTitle}>Observation Point</Text>
            <TouchableOpacity
              onPress={() => {
                if (pickCoord) {
                  setObsLat(pickCoord.latitude.toFixed(5))
                  setObsLng(pickCoord.longitude.toFixed(5))
                }
                setShowMapPicker(false)
              }}
              style={styles.mapPickerHeaderBtn}
              disabled={!pickCoord}
            >
              <Text style={[styles.mapPickerConfirm, !pickCoord && { opacity: 0.35 }]}>Set</Text>
            </TouchableOpacity>
          </View>

          {/* Map */}
          <MapView
            style={{ flex: 1 }}
            provider={PROVIDER_DEFAULT}
            initialRegion={mapPickerRegion ?? { latitude: 33.58, longitude: -85.08, latitudeDelta: 0.3, longitudeDelta: 0.3 }}
            onPress={(e) => setPickCoord(e.nativeEvent.coordinate)}
          >
            {pickCoord && (
              <Marker coordinate={pickCoord} pinColor="#f59e0b" />
            )}
            {/* Alert polygon overlay */}
            {(() => {
              const a = alerts.find((al) => String(al.id) === alertId)
              if (!a?.polygon) return null
              const coords = a.polygon.trim().split(/\s+/).map((pair) => {
                const [lat, lng] = pair.split(',').map(Number)
                return { latitude: lat, longitude: lng }
              })
              return (
                <Polygon
                  coordinates={coords}
                  fillColor="rgba(245,158,11,0.15)"
                  strokeColor="#f59e0b"
                  strokeWidth={1.5}
                />
              )
            })()}
          </MapView>

          {/* Footer coord display */}
          <View style={styles.mapPickerFooter}>
            <Text style={styles.mapPickerCoordText}>
              {pickCoord
                ? `${pickCoord.latitude.toFixed(5)}, ${pickCoord.longitude.toFixed(5)}`
                : 'Tap map to place observation point'}
            </Text>
          </View>
        </SafeAreaView>
      </Modal>

    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#050a0f' },
  center:  { flex: 1, backgroundColor: '#050a0f', alignItems: 'center', justifyContent: 'center' },
  scroll:  { padding: 16, gap: 10 },

  successBanner: {
    backgroundColor: 'rgba(34,197,94,0.1)',
    borderWidth: 1, borderColor: 'rgba(34,197,94,0.35)',
    borderRadius: 8, padding: 12, marginBottom: 4,
  },
  successText: { color: '#4ade80', fontSize: 13, fontWeight: '600' },

  errorBanner: {
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)',
    borderRadius: 8, padding: 12, marginBottom: 4,
  },
  errorBannerText: { color: '#f87171', fontSize: 13 },
  errorText:       { color: '#f87171', fontSize: 14 },

  sectionLabel: {
    fontSize: 10, fontWeight: '800', letterSpacing: 2,
    color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase',
    marginTop: 4, marginBottom: 8,
  },

  emptyBox: {
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10, padding: 20, alignItems: 'center',
  },
  emptyText: { color: 'rgba(255,255,255,0.3)', fontSize: 13, textAlign: 'center', lineHeight: 20 },

  droneCard: {
    backgroundColor: '#0d1117',
    borderRadius: 10, borderWidth: 1, borderColor: '#1a2332',
    padding: 14, marginBottom: 8,
  },
  droneCardSelected: {
    borderColor: '#f59e0b',
    backgroundColor: 'rgba(245,158,11,0.06)',
  },
  droneRow:   { flexDirection: 'row', alignItems: 'center', gap: 12 },
  droneEmoji: { fontSize: 24 },
  droneInfo:  { flex: 1 },
  droneModel: { fontSize: 15, fontWeight: '700', color: '#e2e8f0' },
  dronePilot: { fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 1 },
  droneStatus: { alignItems: 'flex-end', gap: 3 },
  statusDot:  { width: 8, height: 8, borderRadius: 4 },
  dotOnline:  { backgroundColor: '#22c55e' },
  dotOffline: { backgroundColor: '#6b7280' },
  statusText: { fontSize: 11, fontWeight: '600' },
  statusOnline:  { color: '#4ade80' },
  statusOffline: { color: '#9ca3af' },
  bvlosChip: {
    alignSelf: 'flex-start',
    marginTop: 8,
    backgroundColor: 'rgba(192,132,252,0.12)',
    borderWidth: 1, borderColor: 'rgba(192,132,252,0.35)',
    borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2,
  },
  bvlosChipText: { fontSize: 9, fontWeight: '800', letterSpacing: 1, color: '#c084fc' },

  dispatchBox: {
    marginTop: 8,
    backgroundColor: '#0a0f1a',
    borderWidth: 1, borderColor: 'rgba(245,158,11,0.25)',
    borderRadius: 12, padding: 18, gap: 4,
  },
  dispatchTitle: {
    fontSize: 14, fontWeight: '700', color: '#f59e0b',
    marginBottom: 12, letterSpacing: 0.3,
  },

  fieldLabel: {
    fontSize: 10, fontWeight: '800', letterSpacing: 2,
    color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase',
    marginTop: 12, marginBottom: 4,
  },
  fieldHint: {
    fontSize: 11, color: 'rgba(255,255,255,0.25)', lineHeight: 16, marginBottom: 8,
  },

  alertList: { gap: 6, marginBottom: 4 },
  alertChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  alertChipSelected: {
    borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.08)',
  },
  alertChipType: {
    fontSize: 9, fontWeight: '800', letterSpacing: 1,
    color: 'rgba(255,255,255,0.35)', minWidth: 48,
  },
  alertChipTypeSelected: { color: '#f59e0b' },
  alertChipText:         { flex: 1, fontSize: 12, color: 'rgba(255,255,255,0.55)' },
  alertChipTextSelected: { color: '#e2e8f0' },

  coordRow:  { flexDirection: 'row', gap: 10, marginBottom: 4 },
  coordField: { flex: 1 },
  coordLabel: {
    fontSize: 10, color: 'rgba(255,255,255,0.3)',
    marginBottom: 4, fontWeight: '600',
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 7, padding: 9,
    fontSize: 13, color: '#fff', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },

  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  modeBtn: {
    flex: 1, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 8, padding: 10, alignItems: 'center', gap: 2,
  },
  modeBtnActive:   { borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)' },
  modeBtnLocked:   { opacity: 0.4 },
  modeBtnText:     { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.4)' },
  modeBtnTextActive: { color: '#f59e0b' },
  modeBtnTextLocked: { color: 'rgba(255,255,255,0.25)' },
  modeLockHint:    { fontSize: 9, color: 'rgba(255,255,255,0.25)', marginTop: 1 },

  dispatchBtn: {
    marginTop: 16,
    backgroundColor: '#f59e0b', borderRadius: 10,
    paddingVertical: 13, alignItems: 'center',
  },
  dispatchBtnDisabled: { opacity: 0.4 },
  dispatchBtnText:     { color: '#050a0f', fontWeight: '800', fontSize: 15 },

  cancelBtn: { paddingVertical: 10, alignItems: 'center', marginTop: 4 },
  cancelBtnText: { fontSize: 13, color: 'rgba(255,255,255,0.3)' },

  // Water search
  waterModeBtnActive:     { borderColor: '#a78bfa', backgroundColor: 'rgba(167,139,250,0.1)' },
  waterModeBtnTextActive: { color: '#a78bfa' },
  waterBodyCard: {
    borderWidth: 1, borderColor: 'rgba(167,139,250,0.15)',
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: 'rgba(167,139,250,0.04)',
  },
  waterBodyCardSelected: {
    borderColor: '#a78bfa', backgroundColor: 'rgba(167,139,250,0.12)',
  },
  waterBodyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  waterBodyName:   { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.6)', flex: 1 },
  waterBodyNameSelected: { color: '#e2e8f0' },
  waterBodyDist:   { fontSize: 11, fontWeight: '600', color: '#a78bfa' },
  waterBodyMeta:   { fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 2, textTransform: 'capitalize' },
  waterDispatchBtn: {
    marginTop: 16,
    backgroundColor: '#a78bfa', borderRadius: 10,
    paddingVertical: 13, alignItems: 'center',
  },

  // Map picker button
  mapPickBtn: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.35)',
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
  },
  mapPickBtnText: { fontSize: 13, fontWeight: '600', color: '#f59e0b' },

  // Airspace advisory
  airspaceWarning: {
    marginTop: 10,
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
    borderRadius: 8,
    padding: 10,
    gap: 3,
  },
  airspaceTitle: { fontSize: 12, fontWeight: '700', color: '#fca5a5', marginBottom: 2 },
  airspaceItem:  { fontSize: 11, color: 'rgba(252,165,165,0.7)' },
  airspaceHint:  { fontSize: 10, color: 'rgba(252,165,165,0.5)', marginTop: 3 },

  // Map picker modal
  mapPickerRoot: { flex: 1, backgroundColor: '#050a0f' },
  mapPickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  mapPickerHeaderBtn: { minWidth: 60 },
  mapPickerTitle:    { fontSize: 15, fontWeight: '700', color: '#fff', textAlign: 'center' },
  mapPickerCancel:   { fontSize: 15, color: 'rgba(255,255,255,0.45)' },
  mapPickerConfirm:  { fontSize: 15, fontWeight: '700', color: '#f59e0b', textAlign: 'right' },
  mapPickerFooter: {
    padding: 14,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  mapPickerCoordText: {
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: 'rgba(255,255,255,0.5)',
  },
})
