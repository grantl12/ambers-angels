package com.ambersangels.phonecamera

import android.app.*
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.hardware.camera2.*
import android.media.ImageReader
import android.os.*
import androidx.core.app.NotificationCompat
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
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
        const val CHANNEL_ID      = "aa_scan"
        const val CHANNEL_ID_HIT  = "aa_hit"
        const val NOTIF_ID        = 1001
        const val NOTIF_ID_HIT    = 1002
        const val ACTION_START    = "com.ambersangels.phonecamera.START"
        const val ACTION_STOP     = "com.ambersangels.phonecamera.STOP"

        const val EXTRA_API_BASE    = "api_base"
        const val EXTRA_DRONE_ID    = "drone_id"
        const val EXTRA_PILOT_ID    = "pilot_id"
        const val EXTRA_INTERVAL_MS = "interval_ms"
        const val EXTRA_AUTH_TOKEN  = "auth_token"

        // Readable from PhoneCameraModule without binding
        @Volatile var isRunning    = false
        val framesUploaded = AtomicInteger(0)
    }

    // ── Config ───────────────────────────────────────────────────────────────
    private var apiBase    = "http://192.168.1.100:8000"
    private var droneId    = "phone-1"
    private var pilotId    = ""
    private var authToken  = ""
    @Volatile private var intervalMs = 1500L

    private var lastHitNotifMs = 0L  // cooldown: at most one hit alert per minute

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
        authToken  = intent?.getStringExtra(EXTRA_AUTH_TOKEN)         ?: ""
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
            // On-device OCR — no raw image leaves the phone
            runOcrAndPost(bytes, lat, lng, alt, hdg, spd, acc)
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
    // On-device OCR → result-only POST (no raw frames transmitted)
    // =========================================================================

    // US plate heuristic: 4–8 alphanumeric chars, must have at least one letter
    // and one digit. Rejects pure words, pure numbers, and very short strings.
    private val PLATE_RE = Regex("^[A-Z0-9]{2,4}[A-Z0-9]{2,4}$")
    private val COMMON_WORDS = setOf(
        "STOP", "SLOW", "EXIT", "LANE", "ONLY", "TURN", "KEEP", "RIGHT", "LEFT",
        "FORD", "JEEP", "HONDA", "TOYOTA", "CHEVY", "DODGE", "NULL", "NONE",
    )

    private fun isPlateCandidate(raw: String): Boolean {
        val s = raw.trim().uppercase().replace(Regex("[^A-Z0-9]"), "")
        if (s.length < 4 || s.length > 8) return false
        if (s.all { it.isDigit() }) return false          // all-numeric unlikely
        if (s.all { it.isLetter() } && s.length > 4) return false  // long pure-alpha = word
        if (COMMON_WORDS.contains(s)) return false
        return PLATE_RE.matches(s)
    }

    private fun runOcrAndPost(
        jpeg: ByteArray,
        lat: Double?, lng: Double?, alt: Double?,
        heading: Float?, speed: Float?, accuracy: Float?,
    ) {
        val bitmap = try {
            BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size)
        } catch (_: Exception) { null }

        if (bitmap == null) { inFlight.set(false); return }

        val image = InputImage.fromBitmap(bitmap, 0)
        val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)

        recognizer.process(image)
            .addOnSuccessListener { visionText ->
                // Collect all text blocks, filter for plate candidates
                val candidates = visionText.textBlocks
                    .flatMap { block -> block.lines }
                    .filter { line ->
                        val conf = line.confidence ?: 0f
                        conf >= 0.55f && isPlateCandidate(line.text)
                    }
                    .sortedByDescending { it.confidence ?: 0f }

                if (candidates.isNotEmpty()) {
                    val best    = candidates.first()
                    val plate   = best.text.trim().uppercase().replace(Regex("[^A-Z0-9]"), "")
                    val conf    = (best.confidence ?: 0.70f).toDouble()
                    uploadExecutor.execute {
                        postDetection(plate, conf, lat, lng, alt, heading, speed, accuracy)
                    }
                } else {
                    inFlight.set(false)
                }
            }
            .addOnFailureListener { inFlight.set(false) }
    }

    private fun postDetection(
        plateText: String, confidence: Double,
        lat: Double?, lng: Double?, alt: Double?,
        heading: Float?, speed: Float?, accuracy: Float?,
    ) {
        try {
            val body = FormBody.Builder()
                .add("drone_id",         droneId)
                .add("plate_text",       plateText)
                .add("plate_confidence", confidence.toString())
                .add("source",           "phone_mlkit")
                .apply {
                    if (pilotId.isNotBlank()) add("pilot_id", pilotId)
                    if (lat != null && lng != null) {
                        add("lat", lat.toString())
                        add("lng", lng.toString())
                        alt?.let     { add("altitude", it.toString()) }
                        heading?.let { add("heading",  it.toString()) }
                        speed?.let   { add("speed",    it.toString()) }
                        accuracy?.let{ add("accuracy", it.toString()) }
                    }
                }
                .build()

            val reqBuilder = Request.Builder()
                .url("$apiBase/ingest/detection")
                .post(body)
                .apply { if (authToken.isNotBlank()) header("Authorization", "Bearer $authToken") }
                .build()

            http.newCall(req).execute().use { resp ->
                if (resp.isSuccessful) {
                    val n = framesUploaded.incrementAndGet()
                    val isHit = try {
                        org.json.JSONObject(resp.body?.string() ?: "{}").optBoolean("watchlist_hit", false)
                    } catch (_: Exception) { false }
                    if (isHit) {
                        updateNotification("🚨 WATCHLIST HIT — $plateText")
                        fireHitAlert(plateText)
                    } else {
                        updateNotification("Scanning  •  $n plates read")
                    }
                }
            }
        } catch (_: IOException) {
            // Non-fatal — retry next interval
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
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "AA Background Scan", NotificationManager.IMPORTANCE_LOW).apply {
                description  = "Amber's Angels plate scanning"
                setShowBadge(false)
            }
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ID_HIT, "AA Watchlist Alert", NotificationManager.IMPORTANCE_HIGH).apply {
                description     = "Watchlist plate match — heads-up alert"
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 400, 200, 400)
            }
        )
    }

    private fun fireHitAlert(plateText: String) {
        val now = System.currentTimeMillis()
        if (now - lastHitNotifMs < 60_000L) return  // at most one alert per minute
        lastHitNotifMs = now
        val notif = NotificationCompat.Builder(this, CHANNEL_ID_HIT)
            .setContentTitle("🚨 WATCHLIST MATCH")
            .setContentText("Plate $plateText matches an active alert")
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setAutoCancel(true)
            .setVibrate(longArrayOf(0, 400, 200, 400))
            .build()
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .notify(NOTIF_ID_HIT, notif)
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
