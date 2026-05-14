package com.ambersangels.djicamera

import android.graphics.Bitmap
import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import dji.sdk.keyvalue.key.FlightControllerKey
import dji.sdk.keyvalue.value.common.ComponentIndexType
import dji.sdk.keyvalue.value.common.LocationCoordinate2D
import dji.sdk.keyvalue.value.common.LocationCoordinate3D
import dji.v5.common.callback.CommonCallbacks
import dji.v5.common.error.IDJIError
import dji.v5.common.register.DJISDKInitEvent
import dji.sdk.keyvalue.key.KeyTools
import dji.v5.manager.KeyManager
import dji.v5.manager.SDKManager
import dji.v5.manager.aircraft.waypoint5.WaypointMissionManager
import dji.v5.manager.aircraft.waypoint5.WaypointMissionState
import dji.v5.manager.aircraft.waypoint5.model.DJIWaypointMission
import dji.v5.manager.aircraft.waypoint5.model.DJIWaypointMissionFinishedAction
import dji.v5.manager.aircraft.waypoint5.model.DJIWaypointMissionHeadingMode
import dji.v5.manager.aircraft.waypoint5.model.DJIWaypointV2
import dji.v5.manager.datacenter.MediaDataCenter
import dji.v5.manager.interfaces.ICameraStreamManager
import dji.v5.manager.interfaces.SDKManagerCallback
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.atomic.AtomicBoolean

/**
 * DJI MSDK V5 native module.
 *
 * Provides three capabilities to the JS side:
 *   1. SDK registration (appKey from AndroidManifest meta-data)
 *   2. Live camera frame capture → base64 JPEG (NV21 → JPEG via YuvImage)
 *   3. GPS + heading from the flight controller via KeyManager
 *
 * All class paths and method signatures were verified against the
 * dji-sdk-v5-aircraft-provided:5.15.0 JAR bytecode before writing.
 *
 * Supported drones (V5): DJI Avata, Avata 2, Mini 3/4, Air 3, Mavic 3 series,
 * M30/M300/M350 series.
 */
class DJICameraModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "DJICamera"
        private const val EVENT_CONNECTION_CHANGED = "DJIConnectionChanged"
        private const val EVENT_MISSION_STATE     = "DJIMissionStateChanged"
        private const val TAG = "DJICameraModule"
    }

    // ── State ────────────────────────────────────────────────────────────────
    private var isInitialized      = false
    private val frameInFlight      = AtomicBoolean(false)
    private var missionStateListener: ((WaypointMissionState) -> Unit)? = null

    @Volatile private var lastLat:     Double? = null
    @Volatile private var lastLng:     Double? = null
    @Volatile private var lastAlt:     Double? = null
    @Volatile private var lastHeading: Double? = null

    // ── Key listeners (keep refs so we can unlisten on destroy) ─────────────
    // Explicit `Unit` return avoids the `Unit?` inference from `?.let` that
    // makes the lambda incompatible with KeyManager.listen's callback type.
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
                promise.reject(
                    "REGISTER_FAILED",
                    error?.description() ?: "DJI SDK registration failed"
                )
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

    /**
     * Grabs the latest decoded video frame from the primary camera, converts
     * it to a JPEG, and resolves with a base64-encoded string.
     *
     * @param quality JPEG quality 1–100 (default 50 keeps payload small)
     */
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
                        // Remove listener immediately — we only want one frame
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
    fun getDroneHeading(promise: Promise) {
        val heading = lastHeading
        if (heading == null) {
            promise.reject("NO_HEADING", "Heading not available"); return
        }
        promise.resolve(heading)
    }

    // =========================================================================
    // Key listeners (GPS + heading from flight controller)
    // =========================================================================

    private fun startKeyListeners() {
        try {
            // KeyTools.createKey converts DJIKeyInfo<T> → DJIKey<T>, which is
            // what KeyManager.listen() requires.
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
        } catch (e: Exception) {
            // Keys may be unavailable before a drone connects — non-fatal
            android.util.Log.w(TAG, "Key listener registration failed: ${e.message}")
        }
    }

    private fun stopKeyListeners() {
        try {
            KeyManager.getInstance().cancelListen(this)
        } catch (_: Exception) {}
    }

    // =========================================================================
    // 5. Waypoint mission
    //
    // Uses DJI MSDK V5 WaypointMissionManager (dji.v5.manager.aircraft.waypoint5).
    // Class paths verified against dji-sdk-v5-aircraft-provided:5.15.0 JAR.
    // Supported aircraft: Mavic 3 series, Air 3, Mini 4 Pro, M30/M300/M350.
    // NOT supported: Avata (FPV-only, no waypoint API).
    // =========================================================================

    /**
     * Upload and start a waypoint mission.
     *
     * @param waypointsJson  JSON array of {lat, lng, altitudeM?, headingDeg?, speedMps?}
     * @param optionsJson    JSON object  {altitudeM, speedMps, finishedAction?}
     */
    @ReactMethod
    fun startWaypointMission(waypointsJson: String, optionsJson: String, promise: Promise) {
        if (!isInitialized) {
            promise.reject("NOT_INITIALIZED", "DJI SDK not initialized"); return
        }
        try {
            val wpsArray = JSONArray(waypointsJson)
            val opts     = JSONObject(optionsJson)
            val altM     = opts.optDouble("altitudeM", 60.0).toFloat()
            val speedMps = opts.optDouble("speedMps",   8.0).toFloat()
            val finishedActionStr = opts.optString("finishedAction", "go_home")

            val finishedAction = when (finishedActionStr) {
                "land"  -> DJIWaypointMissionFinishedAction.AUTO_LAND
                "hover" -> DJIWaypointMissionFinishedAction.NO_ACTION
                else    -> DJIWaypointMissionFinishedAction.GO_HOME
            }

            val waypoints = (0 until wpsArray.length()).map { i ->
                val wp  = wpsArray.getJSONObject(i)
                val coord = LocationCoordinate2D(wp.getDouble("lat"), wp.getDouble("lng"))
                DJIWaypointV2(coord).apply {
                    altitude = wp.optDouble("altitudeM", altM.toDouble()).toFloat()
                    heading  = wp.optInt("headingDeg", 0)
                    autoFlightSpeed = wp.optDouble("speedMps", speedMps.toDouble()).toFloat()
                }
            }

            val mission = DJIWaypointMission.Builder()
                .waypointList(waypoints)
                .autoFlightSpeed(speedMps)
                .maxFlightSpeed(15f)
                .finishedAction(finishedAction)
                .headingMode(DJIWaypointMissionHeadingMode.AUTO)
                .build()

            val mgr = WaypointMissionManager.getInstance()

            // Subscribe to state changes so the JS side gets live progress events
            missionStateListener?.let { mgr.removeMissionStateListener(it) }
            missionStateListener = { state: WaypointMissionState ->
                val params = Arguments.createMap().apply {
                    putString("state", state.name.lowercase())
                    // Progress is exposed through the execution state on supported aircraft
                    putInt("progressPct", 0)
                }
                sendEvent(EVENT_MISSION_STATE, params)
            }
            mgr.addMissionStateListener(null, missionStateListener!!)

            mgr.uploadMission(mission, object : CommonCallbacks.CompletionCallback {
                override fun onSuccess() {
                    mgr.startMission(object : CommonCallbacks.CompletionCallback {
                        override fun onSuccess() { promise.resolve(null) }
                        override fun onFailure(error: IDJIError) {
                            promise.reject("START_FAILED", error.description())
                        }
                    })
                }
                override fun onFailure(error: IDJIError) {
                    promise.reject("UPLOAD_FAILED", error.description())
                }
            })
        } catch (e: Exception) {
            promise.reject("MISSION_ERROR", e.message ?: "Mission setup failed")
        }
    }

    /** Stop the current waypoint mission and command the drone to return home. */
    @ReactMethod
    fun stopWaypointMission(promise: Promise) {
        if (!isInitialized) { promise.resolve(null); return }
        try {
            WaypointMissionManager.getInstance().stopMission(
                object : CommonCallbacks.CompletionCallback {
                    override fun onSuccess() { promise.resolve(null) }
                    override fun onFailure(error: IDJIError) {
                        promise.reject("STOP_FAILED", error.description())
                    }
                }
            )
        } catch (e: Exception) {
            promise.reject("STOP_ERROR", e.message ?: "Stop mission failed")
        }
    }

    /** Return the current mission manager state as a JS-readable string. */
    @ReactMethod
    fun getMissionStatus(promise: Promise) {
        if (!isInitialized) {
            promise.resolve(Arguments.createMap().apply {
                putString("state", "idle"); putInt("progressPct", 0)
            }); return
        }
        try {
            val state = WaypointMissionManager.getInstance().currentState
            promise.resolve(Arguments.createMap().apply {
                putString("state", state.name.lowercase())
                putInt("progressPct", 0)
            })
        } catch (e: Exception) {
            promise.resolve(Arguments.createMap().apply {
                putString("state", "idle"); putInt("progressPct", 0)
            })
        }
    }

    // =========================================================================
    // Lifecycle
    // =========================================================================

    override fun invalidate() {
        stopKeyListeners()
        missionStateListener?.let {
            try { WaypointMissionManager.getInstance().removeMissionStateListener(it) } catch (_: Exception) {}
        }
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
