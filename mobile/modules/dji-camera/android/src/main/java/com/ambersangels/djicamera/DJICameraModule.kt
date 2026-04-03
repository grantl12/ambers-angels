package com.ambersangels.djicamera

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import dji.sdk.keyvalue.key.CameraKey
import dji.sdk.keyvalue.key.KeyTools
import dji.sdk.keyvalue.value.camera.CameraMode
import dji.sdk.keyvalue.value.camera.ShootPhotoMode
import dji.sdk.keyvalue.value.common.EmptyMsg
import dji.v5.common.callback.CommonCallbacks
import dji.v5.common.error.IDJIError
import dji.v5.manager.SDKManager
import dji.v5.manager.aircraft.payload.PayloadCenter
import dji.v5.manager.interfaces.SDKManagerCallback
import dji.v5.manager.KeyManager
import dji.v5.manager.aircraft.camera.ICameraManager
import dji.v5.manager.datacenter.MediaDataCenter
import dji.v5.manager.datacenter.video.StreamQuality
import dji.v5.manager.datacenter.video.VideoStreamManager
import dji.v5.manager.datacenter.video.interfaces.IYuvDataListener
import java.io.ByteArrayOutputStream
import java.util.Base64
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

class DJICameraModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "DJICamera"
        private const val EVENT_CONNECTION_CHANGED = "DJIConnectionChanged"
    }

    // Holds the most recently decoded YUV frame so captureFrame() can grab it on demand
    private val latestYuvFrame = AtomicReference<Triple<ByteArray, Int, Int>?>()  // (data, width, height)
    private val isListening = AtomicBoolean(false)
    private val isConnected = AtomicBoolean(false)

    private val yuvListener = IYuvDataListener { yuvData, width, height, dataSize ->
        // Store a copy of the latest frame — captureFrame() encodes on demand
        latestYuvFrame.set(Triple(yuvData.copyOf(dataSize), width, height))
    }

    override fun getName(): String = NAME

    // -------------------------------------------------------------------------
    // initialize(appKey) — register app with DJI SDK
    // -------------------------------------------------------------------------
    @ReactMethod
    fun initialize(appKey: String, promise: Promise) {
        try {
            SDKManager.getInstance().init(reactContext, object : SDKManagerCallback {
                override fun onRegisterSuccess() {
                    promise.resolve(null)
                }

                override fun onRegisterFailure(error: IDJIError) {
                    promise.reject("INIT_FAILED", "DJI SDK registration failed: ${error.description()}")
                }

                override fun onProductConnect(productId: Int) {
                    isConnected.set(true)
                    emitConnectionEvent(true, productId)
                    startVideoStream()
                }

                override fun onProductDisconnect(productId: Int) {
                    isConnected.set(false)
                    latestYuvFrame.set(null)
                    stopVideoStream()
                    emitConnectionEvent(false, productId)
                }

                override fun onProductChanged(productId: Int) {}

                override fun onInitProcess(event: dji.v5.manager.interfaces.DJISDKInitEvent, totalProcess: Int) {}

                override fun onDatabaseDownloadProgress(current: Long, total: Long) {}
            })
        } catch (e: Exception) {
            promise.reject("INIT_ERROR", e.message ?: "Unknown error during DJI SDK init")
        }
    }

    // -------------------------------------------------------------------------
    // isConnected() — whether a DJI product is currently connected
    // -------------------------------------------------------------------------
    @ReactMethod
    fun isConnected(promise: Promise) {
        promise.resolve(isConnected.get())
    }

    // -------------------------------------------------------------------------
    // captureFrame() — encode the latest YUV frame to JPEG, return base64
    // -------------------------------------------------------------------------
    @ReactMethod
    fun captureFrame(quality: Int, promise: Promise) {
        val frame = latestYuvFrame.get()
        if (frame == null) {
            promise.reject("NO_FRAME", "No drone video frame available — is a drone connected?")
            return
        }
        try {
            val (data, width, height) = frame
            val jpeg = yuvToJpeg(data, width, height, quality.coerceIn(1, 100))
            val b64 = Base64.getEncoder().encodeToString(jpeg)
            promise.resolve(b64)
        } catch (e: Exception) {
            promise.reject("ENCODE_ERROR", e.message ?: "Frame encoding failed")
        }
    }

    // -------------------------------------------------------------------------
    // getDroneLocation() — pull GPS from flight controller key
    // -------------------------------------------------------------------------
    @ReactMethod
    fun getDroneLocation(promise: Promise) {
        try {
            KeyManager.getInstance().getValue(
                KeyTools.createKey(dji.sdk.keyvalue.key.FlightControllerKey.KeyAircraftLocation3D),
                object : CommonCallbacks.CompletionCallbackWithParam<dji.sdk.keyvalue.value.flightcontroller.LocationCoordinate3D> {
                    override fun onSuccess(location: dji.sdk.keyvalue.value.flightcontroller.LocationCoordinate3D?) {
                        if (location == null) {
                            promise.reject("NO_GPS", "Drone GPS not available")
                            return
                        }
                        val map = WritableNativeMap()
                        map.putDouble("lat", location.latitude)
                        map.putDouble("lng", location.longitude)
                        map.putDouble("altitude", location.altitude.toDouble())
                        promise.resolve(map)
                    }

                    override fun onFailure(error: IDJIError) {
                        promise.reject("GPS_ERROR", error.description())
                    }
                }
            )
        } catch (e: Exception) {
            promise.reject("GPS_ERROR", e.message ?: "Unknown error fetching drone GPS")
        }
    }

    // -------------------------------------------------------------------------
    // getDroneHeading() — compass heading from flight controller
    // -------------------------------------------------------------------------
    @ReactMethod
    fun getDroneHeading(promise: Promise) {
        try {
            KeyManager.getInstance().getValue(
                KeyTools.createKey(dji.sdk.keyvalue.key.FlightControllerKey.KeyCompassHeading),
                object : CommonCallbacks.CompletionCallbackWithParam<Float> {
                    override fun onSuccess(heading: Float?) {
                        promise.resolve(heading?.toDouble() ?: 0.0)
                    }
                    override fun onFailure(error: IDJIError) {
                        promise.reject("HEADING_ERROR", error.description())
                    }
                }
            )
        } catch (e: Exception) {
            promise.reject("HEADING_ERROR", e.message ?: "Unknown error")
        }
    }

    // -------------------------------------------------------------------------
    // addListener / removeListeners — required for RN NativeEventEmitter
    // -------------------------------------------------------------------------
    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------
    private fun startVideoStream() {
        if (isListening.getAndSet(true)) return
        try {
            VideoStreamManager.getInstance()
                .addYuvDataListener(StreamQuality.QUALITY_AUTO, yuvListener)
        } catch (e: Exception) {
            isListening.set(false)
        }
    }

    private fun stopVideoStream() {
        if (!isListening.getAndSet(false)) return
        try {
            VideoStreamManager.getInstance()
                .removeYuvDataListener(StreamQuality.QUALITY_AUTO, yuvListener)
        } catch (_: Exception) {}
    }

    private fun emitConnectionEvent(connected: Boolean, productId: Int) {
        val params = WritableNativeMap()
        params.putBoolean("connected", connected)
        params.putInt("productId", productId)
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(EVENT_CONNECTION_CHANGED, params)
    }

    private fun yuvToJpeg(yuv: ByteArray, width: Int, height: Int, quality: Int): ByteArray {
        val yuvImage = YuvImage(yuv, ImageFormat.NV21, width, height, null)
        val out = ByteArrayOutputStream()
        yuvImage.compressToJpeg(Rect(0, 0, width, height), quality, out)
        return out.toByteArray()
    }

    override fun onCatalystInstanceDestroy() {
        stopVideoStream()
        super.onCatalystInstanceDestroy()
    }
}
