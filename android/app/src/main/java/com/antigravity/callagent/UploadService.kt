package com.antigravity.callagent

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.provider.CallLog
import android.provider.ContactsContract
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File

object UploadService {

    private const val TAG = "UploadService"

    fun uploadFile(context: Context, file: File, phoneNumber: String) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                // Wi-Fi only check
                if (UserPreferences.isWifiOnly(context) && !isOnWifi(context)) {
                    Log.d(TAG, "Skipping upload (Wi-Fi only mode) - ${file.name}")
                    return@launch
                }

                Log.d(TAG, "Starting upload: ${file.name}")

                // Extract call metadata from CallLog
                val callInfo = queryCallLogInfo(context, phoneNumber)
                val contactName = queryContactName(context, phoneNumber)

                Log.d(TAG, "Call metadata: type=${callInfo.first}, duration=${callInfo.second}s, contact=${contactName ?: "N/A"}")

                val requestFile = file.asRequestBody("audio/*".toMediaTypeOrNull())
                val filePart = MultipartBody.Part.createFormData("file", file.name, requestFile)

                val textType = "text/plain".toMediaTypeOrNull()
                val phoneNumberPart = phoneNumber.toRequestBody(textType)
                val userNamePart = UserPreferences.getUserName(context).toRequestBody(textType)
                val userPhonePart = UserPreferences.getPhone(context).toRequestBody(textType)
                val callTypePart = callInfo.first.toRequestBody(textType)
                val durationPart = callInfo.second.toString().toRequestBody(textType)
                val contactNamePart = (contactName ?: "").toRequestBody(textType)

                val response = NetworkModule.api.uploadFile(
                    filePart, phoneNumberPart, userNamePart, userPhonePart,
                    callTypePart, durationPart, contactNamePart
                )

                if (response.isSuccessful) {
                    Log.d(TAG, "Upload successful: ${response.body()?.filename}")
                } else {
                    Log.e(TAG, "Upload failed: ${response.code()} - ${response.message()}")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Upload error: ${e.message}", e)
            }
        }
    }

    /**
     * Query CallLog for the most recent call matching phoneNumber.
     * Returns Pair(callType, duration) where callType is INCOMING/OUTGOING/MISSED.
     */
    private fun queryCallLogInfo(context: Context, phoneNumber: String): Pair<String, Int> {
        try {
            // Use last 8 digits for matching (handles country codes, dashes)
            val normalizedSuffix = phoneNumber.replace(Regex("[^0-9]"), "").takeLast(8)
            if (normalizedSuffix.length < 4) return Pair("INCOMING", 0)

            val cursor = context.contentResolver.query(
                CallLog.Calls.CONTENT_URI,
                arrayOf(CallLog.Calls.TYPE, CallLog.Calls.DURATION),
                "${CallLog.Calls.NUMBER} LIKE ?",
                arrayOf("%$normalizedSuffix"),
                "${CallLog.Calls.DATE} DESC"
            )

            cursor?.use {
                if (it.moveToFirst()) {
                    val type = it.getInt(it.getColumnIndexOrThrow(CallLog.Calls.TYPE))
                    val duration = it.getInt(it.getColumnIndexOrThrow(CallLog.Calls.DURATION))

                    val callType = when (type) {
                        CallLog.Calls.INCOMING_TYPE -> "INCOMING"
                        CallLog.Calls.OUTGOING_TYPE -> "OUTGOING"
                        CallLog.Calls.MISSED_TYPE -> "MISSED"
                        CallLog.Calls.REJECTED_TYPE -> "MISSED"
                        else -> "INCOMING"
                    }

                    return Pair(callType, duration)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to query CallLog: ${e.message}")
        }

        return Pair("INCOMING", 0)
    }

    /**
     * Query Contacts for a display name matching phoneNumber.
     * Returns the contact name or null if not found.
     */
    private fun queryContactName(context: Context, phoneNumber: String): String? {
        try {
            val uri = Uri.withAppendedPath(
                ContactsContract.PhoneLookup.CONTENT_FILTER_URI,
                Uri.encode(phoneNumber)
            )

            val cursor = context.contentResolver.query(
                uri,
                arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME),
                null, null, null
            )

            cursor?.use {
                if (it.moveToFirst()) {
                    return it.getString(
                        it.getColumnIndexOrThrow(ContactsContract.PhoneLookup.DISPLAY_NAME)
                    )
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to query Contacts: ${e.message}")
        }

        return null
    }

    private fun isOnWifi(context: Context): Boolean {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(network) ?: return false
        return caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
    }

    suspend fun testUpload(context: Context): Boolean {
        return try {
            val testFile = File(context.cacheDir, "test_upload.txt")
            testFile.writeText("AI Call Agent Test Upload - ${System.currentTimeMillis()}")

            val requestFile = testFile.asRequestBody("text/plain".toMediaTypeOrNull())
            val filePart = MultipartBody.Part.createFormData("file", "test_upload.txt", requestFile)

            val textType = "text/plain".toMediaTypeOrNull()
            val response = NetworkModule.api.uploadFile(
                filePart,
                "TEST-000-0000".toRequestBody(textType),
                UserPreferences.getUserName(context).toRequestBody(textType),
                UserPreferences.getPhone(context).toRequestBody(textType),
                "INCOMING".toRequestBody(textType),
                "0".toRequestBody(textType),
                "".toRequestBody(textType)
            )

            testFile.delete()
            response.isSuccessful
        } catch (e: Exception) {
            Log.e(TAG, "Test upload error: ${e.message}", e)
            false
        }
    }
}
