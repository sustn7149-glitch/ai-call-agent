package com.antigravity.callagent

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.util.Log
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.antigravity.callagent.databinding.ActivityMainBinding
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private val PERMISSION_REQUEST_CODE = 100
    private val TAG = "MainActivity"

    private val requiredPermissions = arrayOf(
        Manifest.permission.READ_PHONE_STATE,
        Manifest.permission.READ_CALL_LOG,
        Manifest.permission.READ_EXTERNAL_STORAGE,
        Manifest.permission.POST_NOTIFICATIONS
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupUI()
        checkAndRequestPermissions()
    }

    private fun setupUI() {
        // 상단 상태 표시
        binding.tvStatus.text = "시작 중..."
        binding.tvServiceStatus.text = "서비스: 대기"

        // 수동 제어 버튼 (비상용)
        binding.btnForceRestart.setOnClickListener {
            autoStartSequence()
        }

        binding.btnStopService.setOnClickListener {
            stopFileObserverService()
        }
    }

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
            // 모든 권한 이미 허용됨 -> 자동 시작
            checkStorageAndStart()
        }

        // Android 11+ 파일 접근 권한
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            if (!Environment.isExternalStorageManager()) {
                binding.tvStatus.text = "파일 접근 권한 필요"
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
            autoStartSequence()
        } else {
            binding.tvStatus.text = "파일 권한 허용 후 앱을 다시 열어주세요"
        }
    }

    private fun autoStartSequence() {
        binding.tvStatus.text = "서버 연결 중..."
        Log.d(TAG, "Auto-start sequence initiated")
        Log.d(TAG, "Target server: ${NetworkModule.BASE_URL}")

        lifecycleScope.launch {
            // Step 1: 서버 연결 확인 (최대 3회 재시도)
            var connected = false
            for (attempt in 1..3) {
                try {
                    val url = "${NetworkModule.BASE_URL}health"
                    Log.d(TAG, "Connection attempt $attempt/3 -> $url")
                    val response = NetworkModule.api.healthCheck()

                    if (response.isSuccessful) {
                        connected = true
                        val body = response.body()
                        Log.d(TAG, "Server connected! status=${body?.status}, timestamp=${body?.timestamp}")
                        break
                    } else {
                        val errorBody = response.errorBody()?.string() ?: "no body"
                        Log.e(TAG, "Attempt $attempt failed: HTTP ${response.code()} ${response.message()} | body=$errorBody")
                    }
                } catch (e: java.net.UnknownHostException) {
                    Log.e(TAG, "Attempt $attempt: DNS resolution failed for ${NetworkModule.BASE_URL} - ${e.message}")
                } catch (e: java.net.ConnectException) {
                    Log.e(TAG, "Attempt $attempt: Connection refused - ${e.message}")
                } catch (e: javax.net.ssl.SSLException) {
                    Log.e(TAG, "Attempt $attempt: SSL error - ${e.message}", e)
                } catch (e: java.net.SocketTimeoutException) {
                    Log.e(TAG, "Attempt $attempt: Timeout after 30s - ${e.message}")
                } catch (e: Exception) {
                    Log.e(TAG, "Attempt $attempt: ${e.javaClass.simpleName} - ${e.message}", e)
                }

                if (attempt < 3) {
                    Log.d(TAG, "Retrying in 3 seconds...")
                    delay(3000)
                }
            }

            if (connected) {
                // Step 2: 서버 연결 성공 -> 서비스 자동 시작
                binding.tvStatus.text = "서버 연결됨 (${NetworkModule.BASE_URL})"
                startFileObserverService()
                binding.tvServiceStatus.text = "감시 중"
                binding.tvIndicator.text = "●"
                binding.tvIndicator.setTextColor(getColor(android.R.color.holo_green_dark))
                Log.d(TAG, "Auto-start complete - service running")
            } else {
                // 연결 실패
                binding.tvStatus.text = "서버 연결 실패 - 재시도 버튼을 누르세요"
                binding.tvServiceStatus.text = "중지됨"
                binding.tvIndicator.text = "●"
                binding.tvIndicator.setTextColor(getColor(android.R.color.holo_red_dark))
                Log.e(TAG, "FAILED to connect after 3 attempts to ${NetworkModule.BASE_URL}")
            }
        }
    }

    private fun startFileObserverService() {
        val intent = Intent(this, FileObserverService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }

    private fun stopFileObserverService() {
        val intent = Intent(this, FileObserverService::class.java)
        stopService(intent)
        binding.tvStatus.text = "수동 중지됨"
        binding.tvServiceStatus.text = "중지됨"
        binding.tvIndicator.text = "●"
        binding.tvIndicator.setTextColor(getColor(android.R.color.holo_red_dark))
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
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // 파일 권한 설정에서 돌아올 때 자동 재시도
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && Environment.isExternalStorageManager()) {
            val allGranted = requiredPermissions.all {
                ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
            }
            if (allGranted) {
                autoStartSequence()
            }
        }
    }
}
