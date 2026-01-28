package com.antigravity.callagent

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

class HeartbeatWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    companion object {
        const val TAG = "HeartbeatWorker"
        const val WORK_NAME = "heartbeat_periodic"
    }

    override suspend fun doWork(): Result {
        val userName = UserPreferences.getUserName(applicationContext)
        val userPhone = UserPreferences.getPhone(applicationContext)

        if (userName.isBlank()) {
            Log.w(TAG, "Skipping heartbeat - user not registered")
            return Result.success()
        }

        return try {
            val request = HeartbeatRequest(userName = userName, userPhone = userPhone)
            val response = NetworkModule.api.sendHeartbeat(request)

            if (response.isSuccessful) {
                Log.d(TAG, "Heartbeat sent: $userName ($userPhone)")
                Result.success()
            } else {
                Log.e(TAG, "Heartbeat failed: HTTP ${response.code()}")
                Result.retry()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Heartbeat error: ${e.message}")
            Result.retry()
        }
    }
}
