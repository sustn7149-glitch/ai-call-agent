package com.antigravity.callagent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.TelephonyManager
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class CallReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "CallReceiver"
        private var lastState = TelephonyManager.CALL_STATE_IDLE
        private var lastPhoneNumber: String? = null
        private var callStartTime: Long = 0
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return

        val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE)
        val phoneNumber = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)

        Log.d(TAG, "📞 Phone State Changed: $state, Number: $phoneNumber")

        when (state) {
            TelephonyManager.EXTRA_STATE_RINGING -> {
                // 전화 수신 중
                lastPhoneNumber = phoneNumber
                Log.d(TAG, "📳 RINGING from: $phoneNumber")
                sendCallEvent(context, "RINGING", phoneNumber)
            }

            TelephonyManager.EXTRA_STATE_OFFHOOK -> {
                // 통화 연결됨
                callStartTime = System.currentTimeMillis()
                Log.d(TAG, "📱 OFFHOOK (Connected)")
                sendCallEvent(context, "OFFHOOK", lastPhoneNumber)
            }

            TelephonyManager.EXTRA_STATE_IDLE -> {
                // 통화 종료
                if (lastState == TelephonyManager.CALL_STATE_OFFHOOK) {
                    val duration = (System.currentTimeMillis() - callStartTime) / 1000
                    Log.d(TAG, "📴 IDLE (Call Ended) - Duration: ${duration}s")
                    sendCallEvent(context, "IDLE", lastPhoneNumber, duration)
                }
                lastPhoneNumber = null
            }
        }

        lastState = when (state) {
            TelephonyManager.EXTRA_STATE_RINGING -> TelephonyManager.CALL_STATE_RINGING
            TelephonyManager.EXTRA_STATE_OFFHOOK -> TelephonyManager.CALL_STATE_OFFHOOK
            else -> TelephonyManager.CALL_STATE_IDLE
        }
    }

    private fun sendCallEvent(
        context: Context,
        status: String,
        phoneNumber: String?,
        duration: Long = 0
    ) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val request = CallEventRequest(
                    number = phoneNumber ?: "UNKNOWN",
                    status = status,
                    direction = "IN",
                    duration = duration
                )

                val response = NetworkModule.api.sendCallEvent(request)

                if (response.isSuccessful) {
                    Log.d(TAG, "✅ Call event sent successfully: $status")
                } else {
                    Log.e(TAG, "❌ Failed to send call event: ${response.code()}")
                }
            } catch (e: Exception) {
                Log.e(TAG, "❌ Error sending call event: ${e.message}")
            }
        }
    }
}
