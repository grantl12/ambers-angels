package com.ambersangels.djicamera

import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import dji.sdk.keyvalue.key.BatteryKey
import dji.sdk.keyvalue.key.DJIKey
import dji.sdk.keyvalue.key.FlightControllerKey
import dji.sdk.keyvalue.key.KeyTools
import dji.sdk.keyvalue.value.common.ComponentIndexType
import dji.sdk.keyvalue.value.common.LocationCoordinate3D
import dji.v5.common.callback.CommonCallbacks
import dji.v5.common.error.IDJIError
import dji.v5.common.register.DJISDKInitEvent
import dji.v5.manager.KeyManager
import dji.v5.manager.SDKManager
import dji.v5.manager.aircraft.waypoint3.WaypointMissionExecuteStateListener
import dji.v5.manager.aircraft.waypoint3.WaypointMissionManager
import dji.v5.manager.aircraft.waypoint3.WaylineExecutingInfo
import dji.v5.manager.aircraft.waypoint3.WaylineExecutingInfoListener
import dji.v5.manager.datacenter.MediaDataCenter
import dji.v5.manager.interfaces.ICameraStreamManager
import dji.v5.manager.interfaces.SDKManagerCallback
import java.io.ByteArrayOutputStream
import java.util.concurrent.atomic.AtomicBoolean

/**
 * DJI MSDK V5 native module — uses Waypoint 3.0 API (dji.v5.manager.aircraft.waypoint3).
 *
 * Capabilities:
 *   1. SDK registration
 *   2. Live camera frame capture → base64 JPEG
 *   3. GPS + heading + battery from KeyManager key listeners
 *   4. Return-to-home via KeyManager performAction
 *   5. Mission state reporting via WaypointMissionManager listeners
 *
 * NOTE: startWaypointMission stubs pending KMZ mission generation (DJI V5 requires
 * WPMZ file format — programmatic mission building via JNIWPMZManager is a future sprint).
 */
class DJICameraModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "DJICamera"
        private const val EVENT_CONNECTION_CHANGED = "DJIConnectionChanged"
        private const val EVENT_MISSION_STATE     = "DJIMissionStateChanged"
        private const val TAG = "DJICameraModule"
    }

    private var isInitialized      = false
    private val frameInFlight      = AtomicBoolean(false)
    @Volatile private var currentMissionState = "idle"

    @Volatile private var lastLat:        Double? = null
    @Volatile private var lastLng:        Double? = null
    @Volatile private var lastAlt:        Double? = null
    @Volatile private var lastHeading:    Double? = null
    @Volatile private var lastBatteryPct: Int     = -1

    private val locationKeyListener = { _: LocationCoordinate3D?, new: LocationCoordinate3D? ->
        new?.let { loc ->
            lastLat = loc.latitude
            lastLng = loc.longitude
            lastAlt = loc.altitude
        }
        Unit
    }

    private val headingKeyListener = { _: Double?, new: Double? ->
        new?.let { lastHeading = it }
        Unit
    }

    private val batteryKeyListener = { _: Int?, new: Int? ->
        new?.let { lastBatteryPct = it }
        Unit
    }

    override fun getName(): String = NAME

    // =========================================================================
    // 1. SDK registration
    // =========================================================================

    @ReactMethod
    fun initialize(appKey: String, promise: Promise) {
        if (isInitialized) {
            promise.resolve(null); return
        }

        val activity = reactContext.currentActivity ?: run {
            promise.reject("NO_ACTIVITY", "Activity not available"); return
        }

        SDKManager.getInstance().init(activity, object : SDKManagerCallback {
            override fun onRegisterSuccess() {
                isInitialized = true
                startKeyListeners()
                promise.resolve(null)
            }

            override fun onRegisterFailure(error: IDJIError?) {
                promise.reject("REGISTER_FAILED", error?.description() ?: "DJI SDK registration failed")
            }

            override fun onProductConnect(productId: Int) {
                sendEvent(EVENT_CONNECTION_CHANGED, Arguments.createMap().apply {
                    putBoolean("connected", true)
                    putInt("productId", productId)
                })
            }

            override fun onProductDisconnect(productId: Int) {
                sendEvent(EVENT_CONNECTION_CHANGED, Arguments.createMap().apply {
                    putBoolean("connected", false)
                    putInt("productId", productId)
                })
            }

            override fun onProductChanged(productId: Int) {}
            override fun onInitProcess(event: DJISDKInitEvent, totalProcess: Int) {}
            override fun onDatabaseDownloadProgress(current: Long, total: Long) {}
        })
    }

    // =========================================================================
    // 2. Connection check
    // =========================================================================

    @ReactMethod
    fun isConnected(promise: Promise) {
        promise.resolve(isInitialized && SDKManager.getInstance().isRegistered)
    }

    // =========================================================================
    // 3. Frame capture
    // =========================================================================

    @ReactMethod
    fun captureFrame(quality: Int, promise: Promise) {
        if (!isInitialized) {
            promise.reject("NOT_INITIALIZED", "DJI SDK not initialized"); return
        }
        if (!frameInFlight.compareAndSet(false, true)) {
            promise.reject("FRAME_BUSY", "Previous capture still in progress"); return
        }

        try {
            val streamMgr = MediaDataCenter.getInstance().cameraStreamManager

            streamMgr.addFrameListener(
                ComponentIndexType.LEFT_OR_MAIN,
                ICameraStreamManager.FrameFormat.NV21,
                object : ICameraStreamManager.CameraFrameListener {
                    override fun onFrame(
                        data: ByteArray, offset: Int, length: Int,
                        width: Int, height: Int,
                        format: ICameraStreamManager.FrameFormat
                    ) {
                        streamMgr.removeFrameListener(this)
                        frameInFlight.set(false)
                        try {
                            val yuv = YuvImage(data, ImageFormat.NV21, width, height, null)
                            val out = ByteArrayOutputStream()
                            yuv.compressToJpeg(Rect(0, 0, width, height), quality, out)
                            val b64 = android.util.Base64.encodeToString(
                                out.toByteArray(), android.util.Base64.NO_WRAP
                            )
                            promise.resolve(b64)
                        } catch (e: Exception) {
                            promise.reject("ENCODE_ERROR", e.message ?: "JPEG encode failed")
                        }
                    }
                }
            )
        } catch (e: Exception) {
            frameInFlight.set(false)
            promise.reject("CAPTURE_ERROR", e.message ?: "Frame capture failed")
        }
    }

    // =========================================================================
    // 4. GPS / telemetry
    // =========================================================================

    @ReactMethod
    fun getDroneLocation(promise: Promise) {
        val lat = lastLat; val lng = lastLng; val alt = lastAlt
        if (lat == null || lng == null) {
            promise.reject("NO_GPS", "GPS fix not available"); return
        }
        promise.resolve(Arguments.createMap().apply {
            putDouble("lat", lat)
            putDouble("lng", lng)
            putDouble("altitude", alt ?: 0.0)
        })
    }

    @ReactMethod
    fun getBatteryLevel(promise: Promise) {
        val pct = lastBatteryPct
        if (pct < 0) promise.reject("NO_BATTERY", "Battery level not available")
        else promise.resolve(pct)
    }

    @ReactMethod
    fun getDroneHeading(promise: Promise) {
        val heading = lastHeading
        if (heading == null) {
            promise.reject("NO_HEADING", "Heading not available"); return
        }
        promise.resolve(heading)
    }

    // =========================================================================
    // 5. Return-to-home via KeyManager
    // =========================================================================

    @ReactMethod
    fun returnToHome(promise: Promise) {
        if (!isInitialized) {
            promise.reject("NOT_INITIALIZED", "DJI SDK not initialized"); return
        }
        try {
            @Suppress("UNCHECKED_CAST")
            KeyManager.getInstance().performAction(
                KeyTools.createKey(FlightControllerKey.KeyStartGoHome) as DJIKey<Any>,
                null,
                object : CommonCallbacks.CompletionCallbackWithParam<Any> {
                    override fun onSuccess(t: Any?) { promise.resolve(null) }
                    override fun onFailure(error: IDJIError) {
                        promise.reject("RTH_FAILED", error.description())
                    }
                }
            )
        } catch (e: Exception) {
            promise.reject("RTH_ERROR", e.message ?: "Return to home failed")
        }
    }

    // =========================================================================
    // 6. Waypoint mission (DJI V5 Waypoint 3.0 — file-based KMZ format)
    //
    // DJI MSDK V5 requires missions to be uploaded as KMZ (WPMZ) files via
    // WaypointMissionManager.pushKMZFileToAircraft(). Programmatic generation
    // uses JNIWPMZManager / WaylineMission / WaylineWaypoint.
    // Full implementation is a future sprint; status events work via the
    // persistent listener registered in startKeyListeners().
    // =========================================================================

    @ReactMethod
    fun startWaypointMission(waypointsJson: String, optionsJson: String, promise: Promise) {
        if (!isInitialized) {
            promise.reject("NOT_INITIALIZED", "DJI SDK not initialized"); return
        }
        promise.reject(
            "NOT_IMPLEMENTED",
            "DJI V5 autonomous missions require KMZ file generation (JNIWPMZManager) — not yet implemented in this build"
        )
    }

    @ReactMethod
    fun stopWaypointMission(promise: Promise) {
        if (!isInitialized) { promise.resolve(null); return }
        try {
            WaypointMissionManager.getInstance().stopMission(
                "aa_mission.kmz",
                object : CommonCallbacks.CompletionCallback {
                    override fun onSuccess() { promise.resolve(null) }
                    override fun onFailure(error: IDJIError) {
                        promise.reject("STOP_FAILED", error.description())
                    }
                }
            )
        } catch (e: Exception) {
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun getMissionStatus(promise: Promise) {
        promise.resolve(Arguments.createMap().apply {
            putString("state", currentMissionState)
            putInt("progressPct", 0)
        })
    }

    // =========================================================================
    // Key listeners (GPS, heading, battery, mission state)
    // =========================================================================

    private fun startKeyListeners() {
        try {
            KeyManager.getInstance().listen(
                KeyTools.createKey(FlightControllerKey.KeyAircraftLocation3D),
                this,
                locationKeyListener
            )
            KeyManager.getInstance().listen(
                KeyTools.createKey(FlightControllerKey.KeyCompassHeading),
                this,
                headingKeyListener
            )
            KeyManager.getInstance().listen(
                KeyTools.createKey(BatteryKey.KeyChargeRemainingInPercent),
                this,
                batteryKeyListener
            )

            // Mission execute-state listener (SAM conversion — no method name needed)
            WaypointMissionManager.getInstance()
                .addWaypointMissionExecuteStateListener { state ->
                    currentMissionState = state.name.lowercase()
                    sendEvent(EVENT_MISSION_STATE, Arguments.createMap().apply {
                        putString("state", currentMissionState)
                        putInt("progressPct", 0)
                    })
                }

            // Wayline executing-info listener (two methods — explicit object)
            WaypointMissionManager.getInstance()
                .addWaylineExecutingInfoListener(object : WaylineExecutingInfoListener {
                    override fun onWaylineExecutingInfoUpdate(info: WaylineExecutingInfo) {
                        sendEvent(EVENT_MISSION_STATE, Arguments.createMap().apply {
                            putString("state", "executing")
                            putInt("progressPct", 0)
                            putInt("waypointIndex", info.currentWaypointIndex)
                        })
                    }
                    override fun onWaylineExecutingInterruptReasonUpdate(error: IDJIError?) {}
                })
        } catch (e: Exception) {
            android.util.Log.w(TAG, "Key listener registration failed: ${e.message}")
        }
    }

    private fun stopKeyListeners() {
        try { KeyManager.getInstance().cancelListen(this) } catch (_: Exception) {}
    }

    // =========================================================================
    // Lifecycle
    // =========================================================================

    override fun invalidate() {
        stopKeyListeners()
        try {
            WaypointMissionManager.getInstance().clearAllWaypointMissionExecuteStateListener()
            WaypointMissionManager.getInstance().clearAllWaylineExecutingInfoListener()
        } catch (_: Exception) {}
        try { SDKManager.getInstance().destroy() } catch (_: Exception) {}
        super.invalidate()
    }

    // =========================================================================
    // React Native event emitter boilerplate
    // =========================================================================

    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}

    private fun sendEvent(name: String, params: WritableMap) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(name, params)
    }
}
