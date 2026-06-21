package com.ambersangels.djicamera

import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * DJI MSDK V5 React Native bridge — zero DJI imports.
 *
 * DJI classes live entirely in DJICameraImpl. This module loads that class via
 * reflection so that the TurboModule system's getDeclaredMethods() / getParameterTypes()
 * reflection never touches DJI types. Without this separation the emulator (and any
 * non-DJI device) crashes with NoClassDefFoundError before the app renders.
 *
 * On real DJI hardware: DJICameraImpl loads fine, all methods work normally.
 * On emulator / non-DJI hardware: impl is null, every method returns DJI_UNAVAILABLE.
 */
class DJICameraModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "DJICamera"
        private const val TAG = "DJICameraModule"
    }

    private val impl: IDJICamera? = try {
        val cls = Class.forName("com.ambersangels.djicamera.DJICameraImpl")
        val ctor = cls.getConstructor(ReactApplicationContext::class.java)
        ctor.newInstance(reactContext) as IDJICamera
    } catch (t: Throwable) {
        android.util.Log.w(TAG, "DJI SDK unavailable — phone-only mode: ${t.message}")
        null
    }

    override fun getName(): String = NAME

    @ReactMethod
    fun initialize(appKey: String, promise: Promise) {
        impl?.initialize(appKey, promise)
            ?: promise.reject("DJI_UNAVAILABLE", "DJI hardware not detected — running in phone-only mode")
    }

    @ReactMethod
    fun isConnected(promise: Promise) {
        impl?.isConnected(promise) ?: promise.resolve(false)
    }

    @ReactMethod
    fun captureFrame(quality: Int, promise: Promise) {
        impl?.captureFrame(quality, promise)
            ?: promise.reject("DJI_UNAVAILABLE", "DJI hardware not detected")
    }

    @ReactMethod
    fun getDroneLocation(promise: Promise) {
        impl?.getDroneLocation(promise)
            ?: promise.reject("DJI_UNAVAILABLE", "DJI hardware not detected")
    }

    @ReactMethod
    fun getBatteryLevel(promise: Promise) {
        impl?.getBatteryLevel(promise)
            ?: promise.reject("DJI_UNAVAILABLE", "DJI hardware not detected")
    }

    @ReactMethod
    fun getDroneHeading(promise: Promise) {
        impl?.getDroneHeading(promise)
            ?: promise.reject("DJI_UNAVAILABLE", "DJI hardware not detected")
    }

    @ReactMethod
    fun returnToHome(promise: Promise) {
        impl?.returnToHome(promise)
            ?: promise.reject("DJI_UNAVAILABLE", "DJI hardware not detected")
    }

    @ReactMethod
    fun startWaypointMission(waypointsJson: String, optionsJson: String, promise: Promise) {
        impl?.startWaypointMission(waypointsJson, optionsJson, promise)
            ?: promise.reject("DJI_UNAVAILABLE", "DJI hardware not detected")
    }

    @ReactMethod
    fun stopWaypointMission(promise: Promise) {
        impl?.stopWaypointMission(promise) ?: promise.resolve(null)
    }

    @ReactMethod
    fun pauseMission(promise: Promise) {
        impl?.pauseMission(promise)
            ?: promise.reject("DJI_UNAVAILABLE", "DJI hardware not detected")
    }

    @ReactMethod
    fun resumeMission(promise: Promise) {
        impl?.resumeMission(promise)
            ?: promise.reject("DJI_UNAVAILABLE", "DJI hardware not detected")
    }

    @ReactMethod
    fun getMissionStatus(promise: Promise) {
        impl?.getMissionStatus(promise) ?: promise.resolve(
            Arguments.createMap().apply { putString("state", "idle"); putInt("progressPct", 0) }
        )
    }

    override fun invalidate() {
        try { impl?.destroy() } catch (_: Throwable) {}
        super.invalidate()
    }

    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}
}
