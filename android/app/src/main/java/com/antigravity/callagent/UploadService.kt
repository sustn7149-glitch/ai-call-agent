package com.antigravity.callagent

import android.content.Context
import android.content.SharedPreferences
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
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object UploadService {

    private const val TAG = "UploadService"
    private const val PREFS_NAME = "upload_history"
    private const val KEY_UPLOADED_FILES = "uploaded_files"
    private val dateFormat = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault())

    /** Data class for call metadata extracted from CallLog */
    data class CallMetadata(
        val callType: String,
        val duration: Int,
        val startTime: String  // yyyy-MM-dd HH:mm:ss
    )

    private fun getUploadPrefs(context: Context): SharedPreferences {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    private fun isAlreadyUploaded(context: Context, filePath: String): Boolean {
        val prefs = getUploadPrefs(context)
        val uploaded = prefs.getStringSet(KEY_UPLOADED_FILES, emptySet()) ?: emptySet()
        return uploaded.contains(filePath)
    }

    private fun markAsUploaded(context: Context, filePath: String) {
        val prefs = getUploadPrefs(context)
        val uploaded = prefs.getStringSet(KEY_UPLOADED_FILES, mutableSetOf())?.toMutableSet() ?: mutableSetOf()
        uploaded.add(filePath)
        // Keep only last 500 entries to avoid bloating
        val trimmed = if (uploaded.size > 500) uploaded.toList().takeLast(500).toMutableSet() else uploaded
        prefs.edit().putStringSet(KEY_UPLOADED_FILES, trimmed).apply()
    }

    fun uploadFile(context: Context, file: File, phoneNumber: String) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                // Skip if already uploaded
                if (isAlreadyUploaded(context, file.absolutePath)) {
                    Log.d(TAG, "Skipping already-uploaded file: ${file.name}")
                    return@launch
                }

                // Wi-Fi only check
                if (UserPreferences.isWifiOnly(context) && !isOnWifi(context)) {
                    Log.d(TAG, "Skipping upload (Wi-Fi only mode) - ${file.name}")
                    return@launch
                }

                Log.d(TAG, "Starting upload: ${file.name}")

                // Extract call metadata from CallLog
                val callMeta = queryCallLogInfo(context, phoneNumber)
                val contactName = queryContactName(context, phoneNumber)

                Log.d(TAG, "Call metadata: type=${callMeta.callType}, duration=${callMeta.duration}s, startTime=${callMeta.startTime}, contact=${contactName ?: "N/A"}")

                val requestFile = file.asRequestBody("audio/*".toMediaTypeOrNull())
                val filePart = MultipartBody.Part.createFormData("file", file.name, requestFile)

                val textType = "text/plain".toMediaTypeOrNull()
                val phoneNumberPart = phoneNumber.toRequestBody(textType)
                val userNamePart = UserPreferences.getUserName(context).toRequestBody(textType)
                val userPhonePart = UserPreferences.getPhone(context).toRequestBody(textType)
                val callTypePart = callMeta.callType.toRequestBody(textType)
                val durationPart = callMeta.duration.toString().toRequestBody(textType)
                val contactNamePart = (contactName ?: "").toRequestBody(textType)
                val startTimePart = callMeta.startTime.toRequestBody(textType)

                val response = NetworkModule.api.uploadFile(
                    filePart, phoneNumberPart, userNamePart, userPhonePart,
                    callTypePart, durationPart, contactNamePart, startTimePart
                )

                if (response.isSuccessful) {
                    Log.d(TAG, "Upload successful: ${response.body()?.filename}")
                    markAsUploaded(context, file.absolutePath)
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
     * Returns CallMetadata with callType, duration, and precise startTime.
     */
    private fun queryCallLogInfo(context: Context, phoneNumber: String): CallMetadata {
        try {
            // Use last 8 digits for matching (handles country codes, dashes)
            val normalizedSuffix = phoneNumber.replace(Regex("[^0-9]"), "").takeLast(8)
            if (normalizedSuffix.length < 4) return CallMetadata("INCOMING", 0, dateFormat.format(Date()))

            val cursor = context.contentResolver.query(
                CallLog.Calls.CONTENT_URI,
                arrayOf(CallLog.Calls.TYPE, CallLog.Calls.DURATION, CallLog.Calls.DATE),
                "${CallLog.Calls.NUMBER} LIKE ?",
                arrayOf("%$normalizedSuffix"),
                "${CallLog.Calls.DATE} DESC"
            )

            cursor?.use {
                if (it.moveToFirst()) {
                    val type = it.getInt(it.getColumnIndexOrThrow(CallLog.Calls.TYPE))
                    val duration = it.getInt(it.getColumnIndexOrThrow(CallLog.Calls.DURATION))
                    val dateMillis = it.getLong(it.getColumnIndexOrThrow(CallLog.Calls.DATE))

                    val callType = when (type) {
                        CallLog.Calls.INCOMING_TYPE -> "INCOMING"
                        CallLog.Calls.OUTGOING_TYPE -> "OUTGOING"
                        CallLog.Calls.MISSED_TYPE -> "MISSED"
                        CallLog.Calls.REJECTED_TYPE -> "MISSED"
                        else -> "INCOMING"
                    }

                    val startTime = dateFormat.format(Date(dateMillis))
                    return CallMetadata(callType, duration, startTime)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to query CallLog: ${e.message}")
        }

        return CallMetadata("INCOMING", 0, dateFormat.format(Date()))
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
                "".toRequestBody(textType),
                dateFormat.format(Date()).toRequestBody(textType)
            )

            testFile.delete()
            response.isSuccessful
        } catch (e: Exception) {
            Log.e(TAG, "Test upload error: ${e.message}", e)
            false
        }
    }
}
