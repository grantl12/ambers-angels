package com.ambersangels.phonecamera

import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.*

class PhoneCameraModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "PhoneCamera"

    /** Start the background scan foreground service. */
    @ReactMethod
    fun startScan(options: ReadableMap, promise: Promise) {
        try {
            val intent = Intent(reactContext, ScanService::class.java).apply {
                action = ScanService.ACTION_START
                putExtra(ScanService.EXTRA_API_BASE,    options.getString("apiBase")    ?: "http://192.168.1.100:8000")
                putExtra(ScanService.EXTRA_DRONE_ID,    options.getString("droneId")    ?: "phone-1")
                putExtra(ScanService.EXTRA_PILOT_ID,    options.getString("pilotId")    ?: "")
                putExtra(ScanService.EXTRA_AUTH_TOKEN,  options.getString("authToken")  ?: "")
                putExtra(ScanService.EXTRA_INTERVAL_MS, options.getDouble("intervalMs").toLong())
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                reactContext.startForegroundService(intent)
            } else {
                reactContext.startService(intent)
            }
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("START_FAILED", e.message ?: "Failed to start scan service")
        }
    }

    /** Stop the background scan service. */
    @ReactMethod
    fun stopScan(promise: Promise) {
        try {
            reactContext.stopService(Intent(reactContext, ScanService::class.java))
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("STOP_FAILED", e.message ?: "Failed to stop scan service")
        }
    }

    /** Whether the service is currently running. */
    @ReactMethod
    fun isRunning(promise: Promise) {
        promise.resolve(ScanService.isRunning)
    }

    /** Frames uploaded so far this mission. */
    @ReactMethod
    fun getFrameCount(promise: Promise) {
        promise.resolve(ScanService.framesUploaded.get())
    }

    // Required stubs for NativeEventEmitter compatibility
    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}
}
