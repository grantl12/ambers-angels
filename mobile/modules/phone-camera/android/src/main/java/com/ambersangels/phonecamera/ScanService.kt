package com.ambersangels.phonecamera

import android.app.*
import android.content.Context
import android.content.Intent
import android.graphics.ImageFormat
import android.hardware.camera2.*
import android.media.ImageReader
import android.os.*
import androidx.core.app.NotificationCompat
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * Foreground service that captures JPEG frames from the back camera using Camera2
 * and uploads them to POST /ingest/frame. Runs independently of the React Native UI —
 * the user can switch to another app (Uber, Maps) and scanning continues.
 *
 * Persistent notification shows live frame count and a "Stop" action.
 */
class ScanService : Service() {

    companion object {
        const val CHANNEL_ID   = "aa_scan"
        const val NOTIF_ID     = 1001
        const val ACTION_START = "com.ambersangels.phonecamera.START"
        const val ACTION_STOP  = "com.ambersangels.phonecamera.STOP"

        const val EXTRA_API_BASE    = "api_base"
        const val EXTRA_DRONE_ID    = "drone_id"
        const val EXTRA_PILOT_ID    = "pilot_id"
        const val EXTRA_INTERVAL_MS = "interval_ms"

        // Readable from PhoneCameraModule without binding
        @Volatile var isRunning    = false
        val framesUploaded = AtomicInteger(0)
    }

    // ── Config ───────────────────────────────────────────────────────────────
    private var apiBase    = "http://192.168.1.100:8000"
    private var droneId    = "phone-1"
    private var pilotId    = ""
    private var intervalMs = 1500L

    // ── Camera2 ──────────────────────────────────────────────────────────────
    private var cameraDevice:    CameraDevice?            = null
    private var captureSession:  CameraCaptureSession?    = null
    private var imageReader:     ImageReader?             = null
    private val cameraHandler    = Handler(Looper.getMainLooper())
    private val uploadExecutor   = Executors.newSingleThreadExecutor()
    private val inFlight         = AtomicBoolean(false)

    // ── HTTP ─────────────────────────────────────────────────────────────────
    private val http = OkHttpClient.Builder()
        .connectTimeout(8,  TimeUnit.SECONDS)
        .writeTimeout(20,   TimeUnit.SECONDS)
        .readTimeout(10,    TimeUnit.SECONDS)
        .build()

    // ── Location (passive — best-effort, no active requests) ─────────────────
    private var lastLat: Double? = null
    private var lastLng: Double? = null
    private var lastAlt: Double? = null
    private var lastHeading: Float? = null
    private var lastSpeed:   Float? = null
    private var lastAccuracy: Float? = null

    private val locationListener = object : android.location.LocationListener {
        override fun onLocationChanged(loc: android.location.Location) {
            lastLat     = loc.latitude
            lastLng     = loc.longitude
            lastAlt     = if (loc.hasAltitude())  loc.altitude  else null
            lastHeading = if (loc.hasBearing())   loc.bearing   else null
            lastSpeed   = if (loc.hasSpeed())     loc.speed     else null
            lastAccuracy = if (loc.hasAccuracy()) loc.accuracy  else null
        }
        @Deprecated("Deprecated in Java")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    }

    // ── Capture scheduling ────────────────────────────────────────────────────
    private val captureRunnable = object : Runnable {
        override fun run() {
            if (!isRunning) return
            triggerCapture()
            cameraHandler.postDelayed(this, intervalMs)
        }
    }

    // =========================================================================
    // Service lifecycle
    // =========================================================================

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startLocationUpdates()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }

        apiBase    = intent?.getStringExtra(EXTRA_API_BASE)           ?: apiBase
        droneId    = intent?.getStringExtra(EXTRA_DRONE_ID)           ?: droneId
        pilotId    = intent?.getStringExtra(EXTRA_PILOT_ID)           ?: ""
        intervalMs = intent?.getLongExtra(EXTRA_INTERVAL_MS, 1500L)   ?: 1500L

        framesUploaded.set(0)
        isRunning = true

        startForeground(NOTIF_ID, buildNotification("Starting camera…"))
        openCamera()

        return START_NOT_STICKY
    }

    override fun onDestroy() {
        isRunning = false
        cameraHandler.removeCallbacksAndMessages(null)
        captureSession?.close()
        imageReader?.close()
        cameraDevice?.close()
        uploadExecutor.shutdown()
        stopLocationUpdates()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // =========================================================================
    // Camera2
    // =========================================================================

    private fun openCamera() {
        val manager = getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val cameraId = manager.cameraIdList.firstOrNull { id ->
            manager.getCameraCharacteristics(id)
                .get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK
        } ?: run { stopSelf(); return }

        // 640×480 JPEG — enough resolution for plate recognition, low overhead
        imageReader = ImageReader.newInstance(640, 480, ImageFormat.JPEG, 2)
        imageReader!!.setOnImageAvailableListener({ reader ->
            val image = reader.acquireLatestImage() ?: return@setOnImageAvailableListener
            if (!inFlight.compareAndSet(false, true)) {
                image.close()   // previous upload still running — skip this frame
                return@setOnImageAvailableListener
            }
            val buffer = image.planes[0].buffer
            val bytes  = ByteArray(buffer.remaining()).also { buffer.get(it) }
            image.close()
            val lat = lastLat; val lng = lastLng
            val alt = lastAlt; val hdg = lastHeading
            val spd = lastSpeed; val acc = lastAccuracy
            uploadExecutor.execute { uploadFrame(bytes, lat, lng, alt, hdg, spd, acc) }
        }, cameraHandler)

        try {
            @Suppress("MissingPermission")
            manager.openCamera(cameraId, object : CameraDevice.StateCallback() {
                override fun onOpened(camera: CameraDevice) {
                    cameraDevice = camera
                    createSession(camera)
                }
                override fun onDisconnected(camera: CameraDevice) { camera.close() }
                override fun onError(camera: CameraDevice, error: Int)  { camera.close(); stopSelf() }
            }, cameraHandler)
        } catch (_: SecurityException) { stopSelf() }
    }

    private fun createSession(camera: CameraDevice) {
        camera.createCaptureSession(
            listOf(imageReader!!.surface),
            object : CameraCaptureSession.StateCallback() {
                override fun onConfigured(session: CameraCaptureSession) {
                    captureSession = session
                    updateNotification("Scanning  •  0 frames")
                    // First capture after a short warm-up, then on interval
                    cameraHandler.postDelayed(captureRunnable, 800)
                }
                override fun onConfigureFailed(session: CameraCaptureSession) { stopSelf() }
            },
            cameraHandler
        )
    }

    private fun triggerCapture() {
        val session = captureSession ?: return
        val camera  = cameraDevice  ?: return
        try {
            val req = camera.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE).apply {
                addTarget(imageReader!!.surface)
                set(CaptureRequest.CONTROL_AF_MODE,  CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE)
                set(CaptureRequest.CONTROL_AE_MODE,  CaptureRequest.CONTROL_AE_MODE_ON)
                set(CaptureRequest.JPEG_QUALITY,     70.toByte())
            }.build()
            session.capture(req, null, cameraHandler)
        } catch (_: Exception) {}
    }

    // =========================================================================
    // Upload
    // =========================================================================

    private fun uploadFrame(
        jpeg: ByteArray,
        lat: Double?, lng: Double?, alt: Double?,
        heading: Float?, speed: Float?, accuracy: Float?
    ) {
        try {
            val body = MultipartBody.Builder().setType(MultipartBody.FORM)
                .addFormDataPart("file", "frame.jpg",
                    jpeg.toRequestBody("image/jpeg".toMediaType()))
                .addFormDataPart("drone_id", droneId)
                .addFormDataPart("source",   "phone_gps")
                .apply {
                    if (pilotId.isNotBlank()) addFormDataPart("pilot_id", pilotId)
                    if (lat != null && lng != null) {
                        addFormDataPart("lat", lat.toString())
                        addFormDataPart("lng", lng.toString())
                        alt?.let     { addFormDataPart("altitude", it.toString()) }
                        heading?.let { addFormDataPart("heading",  it.toString()) }
                        speed?.let   { addFormDataPart("speed",    it.toString()) }
                        accuracy?.let{ addFormDataPart("accuracy", it.toString()) }
                    }
                }
                .build()

            val req = Request.Builder()
                .url("$apiBase/ingest/frame")
                .post(body)
                .build()

            http.newCall(req).execute().use { resp ->
                if (resp.isSuccessful) {
                    val n = framesUploaded.incrementAndGet()
                    updateNotification("Scanning  •  $n frames")
                }
            }
        } catch (_: IOException) {
            // Non-fatal — will retry next interval
        } finally {
            inFlight.set(false)
        }
    }

    // =========================================================================
    // Location (passive, best-effort — no extra dep needed)
    // =========================================================================

    private fun startLocationUpdates() {
        try {
            val lm = getSystemService(Context.LOCATION_SERVICE) as android.location.LocationManager
            @Suppress("MissingPermission")
            lm.requestLocationUpdates(
                android.location.LocationManager.GPS_PROVIDER,
                500L, 0f, locationListener, cameraHandler.looper
            )
        } catch (_: Exception) {}
    }

    private fun stopLocationUpdates() {
        try {
            val lm = getSystemService(Context.LOCATION_SERVICE) as android.location.LocationManager
            lm.removeUpdates(locationListener)
        } catch (_: Exception) {}
    }

    // =========================================================================
    // Notification
    // =========================================================================

    private fun createNotificationChannel() {
        val ch = NotificationChannel(CHANNEL_ID, "AA Background Scan",
            NotificationManager.IMPORTANCE_LOW).apply {
            description  = "Amber's Angels plate scanning"
            setShowBadge(false)
        }
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .createNotificationChannel(ch)
    }

    private fun buildNotification(text: String): Notification {
        val stopPi = PendingIntent.getService(
            this, 0,
            Intent(this, ScanService::class.java).apply { action = ACTION_STOP },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Amber's Angels")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setOngoing(true)
            .setShowWhen(false)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .addAction(android.R.drawable.ic_delete, "Stop", stopPi)
            .build()
    }

    private fun updateNotification(text: String) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIF_ID, buildNotification(text))
    }
}
