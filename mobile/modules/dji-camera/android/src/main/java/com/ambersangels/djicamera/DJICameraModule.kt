package com.ambersangels.djicamera

import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * DJI Camera native module — Phase 2 stub.
 *
 * Full DJI MSDK V5 integration is planned for Phase 2 once hardware is available
 * for API validation. All methods return a NOT_AVAILABLE rejection so the JS side
 * can degrade gracefully. The package is still registered so the build graph is
 * stable and no JS changes are needed when the real implementation lands.
 *
 * TODO (Phase 2): Replace stubs with real DJI MSDK V5 (5.17.x) API calls.
 *   Key API changes vs 5.10.0 that need research with hardware:
 *     - StreamQuality / IYuvDataListener package paths changed
 *     - DJISDKInitEvent package moved
 *     - addYuvDataListener / removeYuvDataListener renamed on VideoStreamManager
 *     - LocationCoordinate3D field names changed
 */
class DJICameraModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "DJICamera"
        private const val EVENT_CONNECTION_CHANGED = "DJIConnectionChanged"
        private const val ERR = "NOT_AVAILABLE"
        private const val MSG = "DJI SDK integration is Phase 2 — hardware not connected"
    }

    override fun getName(): String = NAME

    @ReactMethod
    fun initialize(appKey: String, promise: Promise) {
        promise.reject(ERR, MSG)
    }

    @ReactMethod
    fun isConnected(promise: Promise) {
        promise.resolve(false)
    }

    @ReactMethod
    fun captureFrame(quality: Int, promise: Promise) {
        promise.reject(ERR, MSG)
    }

    @ReactMethod
    fun getDroneLocation(promise: Promise) {
        promise.reject(ERR, MSG)
    }

    @ReactMethod
    fun getDroneHeading(promise: Promise) {
        promise.reject(ERR, MSG)
    }

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}
}
