package com.antigravity.callagent

import android.app.*
import android.content.Intent
import android.os.*
import android.util.Log
import androidx.core.app.NotificationCompat
import java.io.File

class FileObserverService : Service() {

    companion object {
        private const val TAG = "FileObserverService"
        private const val CHANNEL_ID = "Call_Agent_Channel_V3_Final"
        private const val OLD_CHANNEL_ID = "FileObserverChannel"
        private const val OLD_CHANNEL_ID_V2 = "FileObserverChannel_V2"
        private const val NOTIFICATION_ID = 1001

        // Samsung default call recording paths
        private val WATCH_PATHS = listOf(
            "/storage/emulated/0/Recordings/Call",
            "/storage/emulated/0/Record/Call",
            "/storage/emulated/0/DCIM/Call",
            "/sdcard/Recordings/Call"
        )
    }

    private var fileObserver: FileObserver? = null
    private val handler = Handler(Looper.getMainLooper())
    private val pendingFiles = mutableSetOf<String>()

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "FileObserverService created")
        deleteOldChannel()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "FileObserverService started")

        startForeground(NOTIFICATION_ID, createNotification())
        startWatching()

        return START_STICKY
    }

    private fun deleteOldChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(NotificationManager::class.java)
            manager.deleteNotificationChannel(OLD_CHANNEL_ID)
            manager.deleteNotificationChannel(OLD_CHANNEL_ID_V2)
            Log.d(TAG, "Deleted old channels: $OLD_CHANNEL_ID, $OLD_CHANNEL_ID_V2")
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "통화 감시 (저소음)",
                NotificationManager.IMPORTANCE_MIN
            ).apply {
                description = "통화 녹음 파일을 감시하고 자동으로 업로드합니다"
                setShowBadge(false)
                lockscreenVisibility = Notification.VISIBILITY_SECRET
                enableLights(false)
                enableVibration(false)
                setSound(null, null)
            }

            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
            Log.d(TAG, "Created notification channel: $CHANNEL_ID (IMPORTANCE_MIN)")
        }
    }

    private fun createNotification(): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("통화 관리 프로그램")
            .setContentText("실시간 감시가 정상 작동 중입니다")
            .setSmallIcon(R.drawable.ic_stat_call_service)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setVisibility(NotificationCompat.VISIBILITY_SECRET)
            .setSilent(true)
            .setShowWhen(false)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    private fun startWatching() {
        // Find existing recording folder
        val watchPath = WATCH_PATHS.firstOrNull { File(it).exists() }

        if (watchPath == null) {
            Log.w(TAG, "No recording folder found. Creating default...")
            val defaultPath = WATCH_PATHS[0]
            File(defaultPath).mkdirs()
            startWatchingPath(defaultPath)
        } else {
            Log.d(TAG, "Watching folder: $watchPath")
            startWatchingPath(watchPath)
        }
    }

    private fun startWatchingPath(path: String) {
        fileObserver?.stopWatching()

        fileObserver = object : FileObserver(File(path), CLOSE_WRITE or CREATE) {
            override fun onEvent(event: Int, path: String?) {
                if (path == null) return

                val fullPath = "${WATCH_PATHS.first { File(it).exists() }}/$path"

                when (event) {
                    CREATE -> {
                        Log.d(TAG, "File created: $path")
                    }
                    CLOSE_WRITE -> {
                        Log.d(TAG, "File write complete: $path")

                        // Debounce: wait a bit before uploading
                        if (!pendingFiles.contains(fullPath)) {
                            pendingFiles.add(fullPath)

                            handler.postDelayed({
                                uploadFile(fullPath)
                                pendingFiles.remove(fullPath)
                            }, 2000) // Wait 2 seconds
                        }
                    }
                }
            }
        }

        fileObserver?.startWatching()
        Log.d(TAG, "FileObserver started for: $path")
    }

    private fun uploadFile(filePath: String) {
        Log.d(TAG, "Uploading file: $filePath")

        val file = File(filePath)
        if (!file.exists()) {
            Log.e(TAG, "File not found: $filePath")
            return
        }

        // Extract phone number from filename if possible
        val phoneNumber = extractPhoneNumber(file.name)

        // Start upload in background
        UploadService.uploadFile(applicationContext, file, phoneNumber)
    }

    private fun extractPhoneNumber(filename: String): String {
        // Try to extract phone number from filename
        // Common patterns: "Call Recording 010-1234-5678.m4a"
        val regex = Regex("\\d{2,4}[-.]?\\d{3,4}[-.]?\\d{4}")
        return regex.find(filename)?.value?.replace("-", "")?.replace(".", "") ?: "UNKNOWN"
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        fileObserver?.stopWatching()
        Log.d(TAG, "FileObserverService destroyed")
    }
}
