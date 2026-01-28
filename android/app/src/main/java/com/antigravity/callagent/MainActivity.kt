package com.antigravity.callagent

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.antigravity.callagent.databinding.ActivityMainBinding
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.concurrent.TimeUnit

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private val PERMISSION_REQUEST_CODE = 100
    private val TAG = "MainActivity"
    private var isMonitoring = false

    private val requiredPermissions = mutableListOf(
        Manifest.permission.READ_PHONE_STATE,
        Manifest.permission.READ_CALL_LOG,
        Manifest.permission.READ_CONTACTS,
        Manifest.permission.POST_NOTIFICATIONS
    ).apply {
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.S_V2) {
            add(Manifest.permission.READ_EXTERNAL_STORAGE)
        }
    }.toTypedArray()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Registration check - redirect if not registered
        if (!UserPreferences.isRegistered(this)) {
            startActivity(Intent(this, RegisterActivity::class.java))
            finish()
            return
        }

        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // Initial UI
        setIndicatorColor(COLOR_GRAY)
        binding.tvStatus.text = "연결 확인 중..."
        binding.tvSubStatus.text = ""

        checkAndRequestPermissions()
        requestBatteryOptimizationExemption()
        scheduleHeartbeat()
    }

    private fun setIndicatorColor(color: Int) {
        val drawable = GradientDrawable()
        drawable.shape = GradientDrawable.OVAL
        drawable.setColor(color)
        binding.viewIndicator.background = drawable
    }

    // ===== Battery Optimization Exemption =====
    private fun requestBatteryOptimizationExemption() {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        if (!pm.isIgnoringBatteryOptimizations(packageName)) {
            Log.d(TAG, "Requesting battery optimization exemption")
            try {
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                intent.data = Uri.parse("package:$packageName")
                startActivity(intent)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to request battery exemption: ${e.message}")
            }
        } else {
            Log.d(TAG, "Battery optimization already exempted")
        }
    }

    // ===== Heartbeat (WorkManager) =====
    private fun scheduleHeartbeat() {
        val heartbeatWork = PeriodicWorkRequestBuilder<HeartbeatWorker>(
            1, TimeUnit.HOURS
        ).build()

        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            HeartbeatWorker.WORK_NAME,
            ExistingPeriodicWorkPolicy.KEEP,
            heartbeatWork
        )
        Log.d(TAG, "Heartbeat scheduled (1 hour interval)")
    }

    // ===== Permissions =====
    private fun checkAndRequestPermissions() {
        val permissionsToRequest = requiredPermissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (permissionsToRequest.isNotEmpty()) {
            ActivityCompat.requestPermissions(
                this,
                permissionsToRequest.toTypedArray(),
                PERMISSION_REQUEST_CODE
            )
        } else {
            checkStorageAndStart()
        }

        // Android 11+ all-files access
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            if (!Environment.isExternalStorageManager()) {
                try {
                    val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION)
                    intent.data = Uri.parse("package:$packageName")
                    startActivity(intent)
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to open storage settings", e)
                }
            }
        }
    }

    private fun checkStorageAndStart() {
        val storageOk = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Environment.isExternalStorageManager()
        } else {
            true
        }

        if (storageOk) {
            startMonitoring()
        } else {
            binding.tvStatus.text = "파일 권한 허용 후 앱을 다시 열어주세요"
            setIndicatorColor(COLOR_RED)
        }
    }

    // ===== Monitoring =====
    private fun startMonitoring() {
        if (isMonitoring) return
        isMonitoring = true

        Log.d(TAG, "Starting monitoring - server: ${NetworkModule.BASE_URL}")

        // Start FileObserver service immediately
        startFileObserverService()

        // Periodic health check loop
        lifecycleScope.launch {
            while (isActive) {
                val connected = checkServerHealth()
                updateUI(connected)
                delay(30_000)
            }
        }
    }

    private suspend fun checkServerHealth(): Boolean {
        return try {
            val response = NetworkModule.api.healthCheck()
            if (response.isSuccessful) {
                Log.d(TAG, "Health OK: ${response.body()?.status}")
                true
            } else {
                Log.e(TAG, "Health failed: HTTP ${response.code()}")
                false
            }
        } catch (e: Exception) {
            Log.e(TAG, "Health error: ${e.javaClass.simpleName} - ${e.message}")
            false
        }
    }

    private fun updateUI(connected: Boolean) {
        val userName = UserPreferences.getUserName(this)
        if (connected) {
            setIndicatorColor(COLOR_GREEN)
            binding.tvStatus.text = "정상 작동 중"
            binding.tvSubStatus.text = "${userName}님, 정상 작동 중"
        } else {
            setIndicatorColor(COLOR_RED)
            binding.tvStatus.text = "연결이 안 되어 있습니다"
            binding.tvSubStatus.text = "관리자에게 문의하세요"
        }
    }

    private fun startFileObserverService() {
        val intent = Intent(this, FileObserverService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
        Log.d(TAG, "FileObserverService started")
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == PERMISSION_REQUEST_CODE) {
            val allGranted = grantResults.all { it == PackageManager.PERMISSION_GRANTED }
            if (allGranted) {
                checkStorageAndStart()
            } else {
                binding.tvStatus.text = "권한을 허용해주세요"
                setIndicatorColor(COLOR_RED)
                binding.tvSubStatus.text = "설정에서 권한을 허용한 후 다시 열어주세요"
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Retry after returning from storage/battery permission settings
        if (!isMonitoring &&
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.R &&
            Environment.isExternalStorageManager()
        ) {
            val allGranted = requiredPermissions.all {
                ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
            }
            if (allGranted) {
                startMonitoring()
            }
        }
    }

    companion object {
        private val COLOR_GREEN = Color.parseColor("#4CAF50")
        private val COLOR_RED = Color.parseColor("#F44336")
        private val COLOR_GRAY = Color.parseColor("#CCCCCC")
    }
}
