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
import dji.v5.manager.aircraft.waypoint3.WaypointMissionManager
import dji.v5.manager.datacenter.MediaDataCenter
import dji.v5.manager.interfaces.ICameraStreamManager
import dji.v5.manager.interfaces.SDKManagerCallback
import dji.sdk.keyvalue.value.product.ProductType
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.atomic.AtomicBoolean
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * DJI MSDK V5 implementation — all DJI imports live here.
 * DJICameraModule has zero DJI references and loads this class via reflection so
 * the TurboModule system's getDeclaredMethods() reflection never touches DJI types.
 */
class DJICameraImpl(private val context: ReactApplicationContext) : IDJICamera {

    companion object {
        private const val EVENT_CONNECTION_CHANGED = "DJIConnectionChanged"
        private const val EVENT_MISSION_STATE     = "DJIMissionStateChanged"
        private const val TAG = "DJICameraImpl"
    }

    private var isInitialized      = false
    private val frameInFlight      = AtomicBoolean(false)
    @Volatile private var currentMissionState = "idle"

    @Volatile private var lastLat:        Double? = null
    @Volatile private var lastLng:        Double? = null
    @Volatile private var lastAlt:        Double? = null
    @Volatile private var lastHeading:    Double? = null
    @Volatile private var lastBatteryPct: Int     = -1

    override fun initialize(appKey: String, promise: Promise) {
        if (isInitialized) { promise.resolve(null); return }

        val activity = context.currentActivity ?: run {
            promise.reject("NO_ACTIVITY", "Activity not available"); return
        }

        try {
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
                    try {
                        detectedProductType = ProductType.find(productId) ?: ProductType.UNKNOWN
                    } catch (_: Throwable) { /* ignore */ }
                    sendEvent(EVENT_CONNECTION_CHANGED, Arguments.createMap().apply {
                        putBoolean("connected", true); putInt("productId", productId)
                    })
                }
                override fun onProductDisconnect(productId: Int) {
                    sendEvent(EVENT_CONNECTION_CHANGED, Arguments.createMap().apply {
                        putBoolean("connected", false); putInt("productId", productId)
                    })
                }
                override fun onProductChanged(productId: Int) {}
                override fun onInitProcess(event: DJISDKInitEvent, totalProcess: Int) {}
                override fun onDatabaseDownloadProgress(current: Long, total: Long) {}
            })
        } catch (t: Throwable) {
            android.util.Log.w(TAG, "DJI SDK unavailable: ${t.message}")
            promise.reject("DJI_UNAVAILABLE", "DJI hardware not detected — running in phone-only mode")
        }
    }

    override fun isConnected(promise: Promise) {
        try {
            promise.resolve(isInitialized && SDKManager.getInstance().isRegistered)
        } catch (_: Throwable) {
            promise.resolve(false)
        }
    }

    override fun captureFrame(quality: Int, promise: Promise) {
        if (!isInitialized) { promise.reject("NOT_INITIALIZED", "DJI SDK not initialized"); return }
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
                        width: Int, height: Int, format: ICameraStreamManager.FrameFormat
                    ) {
                        streamMgr.removeFrameListener(this)
                        frameInFlight.set(false)
                        try {
                            val yuv = YuvImage(data, ImageFormat.NV21, width, height, null)
                            val out = ByteArrayOutputStream()
                            yuv.compressToJpeg(Rect(0, 0, width, height), quality, out)
                            val b64 = android.util.Base64.encodeToString(out.toByteArray(), android.util.Base64.NO_WRAP)
                            promise.resolve(b64)
                        } catch (t: Throwable) {
                            promise.reject("ENCODE_ERROR", t.message ?: "JPEG encode failed")
                        }
                    }
                }
            )
        } catch (t: Throwable) {
            frameInFlight.set(false)
            promise.reject("CAPTURE_ERROR", t.message ?: "Frame capture failed")
        }
    }

    override fun getDroneLocation(promise: Promise) {
        val lat = lastLat; val lng = lastLng; val alt = lastAlt
        if (lat == null || lng == null) { promise.reject("NO_GPS", "GPS fix not available"); return }
        promise.resolve(Arguments.createMap().apply {
            putDouble("lat", lat); putDouble("lng", lng); putDouble("altitude", alt ?: 0.0)
        })
    }

    override fun getBatteryLevel(promise: Promise) {
        val pct = lastBatteryPct
        if (pct < 0) promise.reject("NO_BATTERY", "Battery level not available")
        else promise.resolve(pct)
    }

    override fun getDroneHeading(promise: Promise) {
        val heading = lastHeading
        if (heading == null) { promise.reject("NO_HEADING", "Heading not available"); return }
        promise.resolve(heading)
    }

    override fun returnToHome(promise: Promise) {
        if (!isInitialized) { promise.reject("NOT_INITIALIZED", "DJI SDK not initialized"); return }
        try {
            @Suppress("UNCHECKED_CAST")
            KeyManager.getInstance().performAction(
                KeyTools.createKey(FlightControllerKey.KeyStartGoHome) as DJIKey.ActionKey<Nothing?, Any>,
                null,
                object : CommonCallbacks.CompletionCallbackWithParam<Any> {
                    override fun onSuccess(t: Any?) { promise.resolve(null) }
                    override fun onFailure(error: IDJIError) { promise.reject("RTH_FAILED", error.description()) }
                }
            )
        } catch (t: Throwable) {
            promise.reject("RTH_ERROR", t.message ?: "Return to home failed")
        }
    }

    override fun startWaypointMission(waypointsJson: String, optionsJson: String, promise: Promise) {
        if (!isInitialized) { promise.reject("NOT_INITIALIZED", "DJI SDK not initialized"); return }

        try {
            val waypoints = JSONArray(waypointsJson)
            val options = JSONObject(optionsJson)
            if (waypoints.length() == 0) {
                promise.reject("INVALID_WAYPOINTS", "Waypoints array is empty"); return
            }

            val altitudeM = options.optDouble("altitudeM", 60.0)
            val speedMps = options.optDouble("speedMps", 8.0)
            val finishedAction = options.optString("finishedAction", "go_home")

            val wpmlFinishAction = when (finishedAction) {
                "hover" -> "noAction"
                "land" -> "autoLand"
                else -> "goHome"
            }

            val wpml = buildWpmlXml(waypoints, altitudeM, speedMps, wpmlFinishAction)
            val kmzFile = writeKmzFile(wpml)

            currentMissionState = "uploading"
            sendEvent(EVENT_MISSION_STATE, Arguments.createMap().apply {
                putString("state", "uploading"); putInt("progressPct", 0)
            })

            WaypointMissionManager.getInstance().pushKMZFileToAircraft(
                kmzFile.absolutePath,
                object : CommonCallbacks.CompletionCallbackWithProgress<Double> {
                    override fun onProgressUpdate(progress: Double) {
                        val pct = (progress * 100).toInt()
                        sendEvent(EVENT_MISSION_STATE, Arguments.createMap().apply {
                            putString("state", "uploading"); putInt("progressPct", pct)
                        })
                    }
                    override fun onSuccess() {
                        startUploadedMission(kmzFile.name, promise)
                    }
                    override fun onFailure(error: IDJIError) {
                        currentMissionState = "idle"
                        promise.reject("UPLOAD_FAILED", error.description())
                    }
                }
            )
        } catch (t: Throwable) {
            currentMissionState = "idle"
            promise.reject("MISSION_ERROR", t.message ?: "Failed to prepare waypoint mission")
        }
    }

    private fun startUploadedMission(fileName: String, promise: Promise) {
        WaypointMissionManager.getInstance().startMission(
            fileName,
            object : CommonCallbacks.CompletionCallback {
                override fun onSuccess() {
                    currentMissionState = "executing"
                    sendEvent(EVENT_MISSION_STATE, Arguments.createMap().apply {
                        putString("state", "executing"); putInt("progressPct", 0)
                    })
                    promise.resolve(null)
                }
                override fun onFailure(error: IDJIError) {
                    currentMissionState = "idle"
                    promise.reject("START_FAILED", error.description())
                }
            }
        )
    }

    @Volatile private var detectedProductType: ProductType = ProductType.UNKNOWN

    private fun getDroneEnumValue(): Int {
        return when (detectedProductType) {
            ProductType.DJI_MINI_3_PRO               -> 89
            ProductType.DJI_MINI_3                   -> 89
            ProductType.DJI_MINI_4_PRO               -> 91
            ProductType.DJI_MAVIC_3_ENTERPRISE_SERIES -> 60
            ProductType.DJI_MAVIC_3                  -> 77
            ProductType.M30_SERIES                   -> 67
            ProductType.M300_RTK                     -> 60
            ProductType.M350_RTK                     -> 89
            ProductType.DJI_MATRICE_4_SERIES         -> 91
            else -> 91
        }
    }

    private fun buildWpmlXml(waypoints: JSONArray, altitudeM: Double, speedMps: Double, finishAction: String): String {
        val droneEnum = getDroneEnumValue()
        val sb = StringBuilder()
        sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
        sb.append("<kml xmlns=\"http://www.opengis.net/kml/2.2\" xmlns:wpml=\"http://www.dji.com/wpmz/1.0.2\">\n")
        sb.append("<Document>\n")

        // Mission config
        sb.append("<wpml:missionConfig>\n")
        sb.append("  <wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode>\n")
        sb.append("  <wpml:finishAction>$finishAction</wpml:finishAction>\n")
        sb.append("  <wpml:exitOnRCLost>executeLostAction</wpml:exitOnRCLost>\n")
        sb.append("  <wpml:executeRCLostAction>goBack</wpml:executeRCLostAction>\n")
        sb.append("  <wpml:takeOffSecurityHeight>20</wpml:takeOffSecurityHeight>\n")
        sb.append("  <wpml:globalTransitionalSpeed>${speedMps.coerceIn(1.0, 15.0)}</wpml:globalTransitionalSpeed>\n")
        sb.append("  <wpml:globalRTHHeight>${(altitudeM + 20).coerceIn(30.0, 500.0)}</wpml:globalRTHHeight>\n")
        sb.append("  <wpml:droneInfo>\n")
        sb.append("    <wpml:droneEnumValue>$droneEnum</wpml:droneEnumValue>\n")
        sb.append("    <wpml:droneSubEnumValue>0</wpml:droneSubEnumValue>\n")
        sb.append("  </wpml:droneInfo>\n")
        sb.append("</wpml:missionConfig>\n")

        // Wayline folder
        sb.append("<Folder>\n")
        sb.append("  <wpml:templateId>0</wpml:templateId>\n")
        sb.append("  <wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>\n")
        sb.append("  <wpml:waylineId>0</wpml:waylineId>\n")
        sb.append("  <wpml:autoFlightSpeed>$speedMps</wpml:autoFlightSpeed>\n")

        for (i in 0 until waypoints.length()) {
            val wp = waypoints.getJSONObject(i)
            val lat = wp.getDouble("lat")
            val lng = wp.getDouble("lng")
            val wpAlt = wp.optDouble("altitudeM", altitudeM)
            val wpSpeed = wp.optDouble("speedMps", speedMps)
            val heading = wp.optDouble("headingDeg", 0.0)

            sb.append("  <Placemark>\n")
            sb.append("    <Point><coordinates>$lng,$lat</coordinates></Point>\n")
            sb.append("    <wpml:index>$i</wpml:index>\n")
            sb.append("    <wpml:executeHeight>$wpAlt</wpml:executeHeight>\n")
            sb.append("    <wpml:waypointSpeed>${wpSpeed.coerceIn(1.0, 12.0)}</wpml:waypointSpeed>\n")
            sb.append("    <wpml:waypointHeadingParam>\n")
            sb.append("      <wpml:waypointHeadingMode>smoothTransition</wpml:waypointHeadingMode>\n")
            sb.append("      <wpml:waypointHeadingAngle>${heading.toInt()}</wpml:waypointHeadingAngle>\n")
            sb.append("    </wpml:waypointHeadingParam>\n")
            sb.append("    <wpml:waypointTurnParam>\n")
            sb.append("      <wpml:waypointTurnMode>toPointAndStopWithDiscontinuityCurvature</wpml:waypointTurnMode>\n")
            sb.append("      <wpml:waypointTurnDampingDist>0.2</wpml:waypointTurnDampingDist>\n")
            sb.append("    </wpml:waypointTurnParam>\n")
            sb.append("    <wpml:useStraightLine>1</wpml:useStraightLine>\n")
            sb.append("  </Placemark>\n")
        }

        sb.append("</Folder>\n")
        sb.append("</Document>\n")
        sb.append("</kml>\n")
        return sb.toString()
    }

    private fun writeKmzFile(wpmlContent: String): File {
        val cacheDir = context.cacheDir
        val kmzFile = File(cacheDir, "aa_mission.kmz")
        ZipOutputStream(FileOutputStream(kmzFile)).use { zos ->
            zos.putNextEntry(ZipEntry("wpmz/waylines.wpml"))
            zos.write(wpmlContent.toByteArray(Charsets.UTF_8))
            zos.closeEntry()
        }
        return kmzFile
    }

    override fun stopWaypointMission(promise: Promise) {
        if (!isInitialized) { promise.resolve(null); return }
        try {
            WaypointMissionManager.getInstance().stopMission(
                "aa_mission.kmz",
                object : CommonCallbacks.CompletionCallback {
                    override fun onSuccess() {
                        currentMissionState = "idle"
                        sendEvent(EVENT_MISSION_STATE, Arguments.createMap().apply {
                            putString("state", "idle"); putInt("progressPct", 0)
                        })
                        promise.resolve(null)
                    }
                    override fun onFailure(error: IDJIError) { promise.reject("STOP_FAILED", error.description()) }
                }
            )
        } catch (_: Throwable) { promise.resolve(null) }
    }

    override fun pauseMission(promise: Promise) {
        if (!isInitialized) { promise.reject("NOT_INITIALIZED", "DJI SDK not initialized"); return }
        try {
            WaypointMissionManager.getInstance().pauseMission(
                object : CommonCallbacks.CompletionCallback {
                    override fun onSuccess() {
                        currentMissionState = "interrupted"
                        sendEvent(EVENT_MISSION_STATE, Arguments.createMap().apply {
                            putString("state", "interrupted"); putInt("progressPct", 0)
                        })
                        promise.resolve(null)
                    }
                    override fun onFailure(error: IDJIError) { promise.reject("PAUSE_FAILED", error.description()) }
                }
            )
        } catch (t: Throwable) {
            promise.reject("PAUSE_ERROR", t.message ?: "Pause failed")
        }
    }

    override fun resumeMission(promise: Promise) {
        if (!isInitialized) { promise.reject("NOT_INITIALIZED", "DJI SDK not initialized"); return }
        try {
            WaypointMissionManager.getInstance().resumeMission(
                object : CommonCallbacks.CompletionCallback {
                    override fun onSuccess() {
                        currentMissionState = "executing"
                        sendEvent(EVENT_MISSION_STATE, Arguments.createMap().apply {
                            putString("state", "executing"); putInt("progressPct", 0)
                        })
                        promise.resolve(null)
                    }
                    override fun onFailure(error: IDJIError) { promise.reject("RESUME_FAILED", error.description()) }
                }
            )
        } catch (t: Throwable) {
            promise.reject("RESUME_ERROR", t.message ?: "Resume failed")
        }
    }

    override fun getMissionStatus(promise: Promise) {
        promise.resolve(Arguments.createMap().apply {
            putString("state", currentMissionState); putInt("progressPct", 0)
        })
    }

    override fun destroy() {
        try { KeyManager.getInstance().cancelListen(this) } catch (_: Throwable) {}
        try { WaypointMissionManager.getInstance().clearAllWaypointMissionExecuteStateListener() } catch (_: Throwable) {}
        try { SDKManager.getInstance().destroy() } catch (_: Throwable) {}
    }

    private fun startKeyListeners() {
        try {
            val locationKeyListener = { _: LocationCoordinate3D?, new: LocationCoordinate3D? ->
                new?.let { lastLat = it.latitude; lastLng = it.longitude; lastAlt = it.altitude }
                Unit
            }
            val headingKeyListener = { _: Double?, new: Double? ->
                new?.let { lastHeading = it }
                Unit
            }
            val batteryKeyListener = { _: Int?, new: Int? ->
                new?.let { lastBatteryPct = it }
                Unit
            }
            KeyManager.getInstance().listen(KeyTools.createKey(FlightControllerKey.KeyAircraftLocation3D), this, locationKeyListener)
            KeyManager.getInstance().listen(KeyTools.createKey(FlightControllerKey.KeyCompassHeading), this, headingKeyListener)
            KeyManager.getInstance().listen(KeyTools.createKey(BatteryKey.KeyChargeRemainingInPercent), this, batteryKeyListener)

            WaypointMissionManager.getInstance().addWaypointMissionExecuteStateListener { state ->
                currentMissionState = state.name.lowercase()
                sendEvent(EVENT_MISSION_STATE, Arguments.createMap().apply {
                    putString("state", currentMissionState); putInt("progressPct", 0)
                })
            }
        } catch (t: Throwable) {
            android.util.Log.w(TAG, "Key listener registration failed: ${t.message}")
        }
    }

    private fun sendEvent(name: String, params: WritableMap) {
        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(name, params)
    }
}
