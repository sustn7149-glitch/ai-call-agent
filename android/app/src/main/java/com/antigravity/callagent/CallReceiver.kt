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
        private var isIncoming: Boolean = false
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return

        val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE)
        val phoneNumber = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)

        Log.d(TAG, "Phone State Changed: $state, Number: $phoneNumber")

        when (state) {
            TelephonyManager.EXTRA_STATE_RINGING -> {
                // 수신 전화: RINGING이 먼저 발생하면 수신(IN)
                lastPhoneNumber = phoneNumber
                isIncoming = true
                Log.d(TAG, "RINGING from: $phoneNumber (incoming)")
                sendCallEvent(context, "RINGING", phoneNumber, direction = "IN")
            }

            TelephonyManager.EXTRA_STATE_OFFHOOK -> {
                // 통화 연결됨
                callStartTime = System.currentTimeMillis()

                // IDLE → OFFHOOK = 발신(OUT), RINGING → OFFHOOK = 수신(IN)
                val direction = if (lastState == TelephonyManager.CALL_STATE_RINGING) "IN" else "OUT"
                isIncoming = direction == "IN"

                Log.d(TAG, "OFFHOOK (Connected) direction=$direction")
                sendCallEvent(context, "OFFHOOK", lastPhoneNumber, direction = direction)
            }

            TelephonyManager.EXTRA_STATE_IDLE -> {
                // 통화 종료
                if (lastState == TelephonyManager.CALL_STATE_OFFHOOK) {
                    val duration = (System.currentTimeMillis() - callStartTime) / 1000
                    val direction = if (isIncoming) "IN" else "OUT"
                    Log.d(TAG, "IDLE (Call Ended) - Duration: ${duration}s, direction=$direction")
                    sendCallEvent(context, "IDLE", lastPhoneNumber, duration, direction)
                } else {
                    // RINGING → IDLE = 부재중 전화
                    Log.d(TAG, "IDLE (Missed Call)")
                    sendCallEvent(context, "IDLE", lastPhoneNumber, direction = "IN")
                }
                lastPhoneNumber = null
                isIncoming = false
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
        duration: Long = 0,
        direction: String = "IN"
    ) {
        val userName = UserPreferences.getUserName(context)
        val userPhone = UserPreferences.getPhone(context)

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val request = CallEventRequest(
                    number = phoneNumber ?: "UNKNOWN",
                    status = status,
                    direction = direction,
                    duration = duration,
                    userPhone = userPhone,
                    userName = userName
                )

                val response = NetworkModule.api.sendCallEvent(request)

                if (response.isSuccessful) {
                    Log.d(TAG, "Call event sent: $status dir=$direction user=$userName phone=$userPhone")
                } else {
                    Log.e(TAG, "Failed to send call event: ${response.code()}")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error sending call event: ${e.message}")
            }
        }
    }
}
