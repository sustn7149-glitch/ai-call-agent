package com.antigravity.callagent

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
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
                    Log.d(TAG, "Skipping upload (Wi-Fi only mode, current: mobile) - ${file.name}")
                    return@launch
                }

                Log.d(TAG, "Starting upload: ${file.name}")

                val requestFile = file.asRequestBody("audio/*".toMediaTypeOrNull())
                val filePart = MultipartBody.Part.createFormData(
                    "file",
                    file.name,
                    requestFile
                )
                val phoneNumberPart = phoneNumber.toRequestBody("text/plain".toMediaTypeOrNull())

                // Registered user info
                val userName = UserPreferences.getUserName(context)
                val userPhone = UserPreferences.getPhone(context)
                val userNamePart = userName.toRequestBody("text/plain".toMediaTypeOrNull())
                val userPhonePart = userPhone.toRequestBody("text/plain".toMediaTypeOrNull())

                val response = NetworkModule.api.uploadFile(
                    filePart, phoneNumberPart, userNamePart, userPhonePart
                )

                if (response.isSuccessful) {
                    Log.d(TAG, "Upload successful: ${response.body()?.filename} (user=$userName)")
                } else {
                    Log.e(TAG, "Upload failed: ${response.code()} - ${response.message()}")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Upload error: ${e.message}", e)
            }
        }
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
            val filePart = MultipartBody.Part.createFormData(
                "file",
                "test_upload.txt",
                requestFile
            )
            val phoneNumberPart = "TEST-000-0000".toRequestBody("text/plain".toMediaTypeOrNull())
            val userNamePart = UserPreferences.getUserName(context)
                .toRequestBody("text/plain".toMediaTypeOrNull())
            val userPhonePart = UserPreferences.getPhone(context)
                .toRequestBody("text/plain".toMediaTypeOrNull())

            val response = NetworkModule.api.uploadFile(
                filePart, phoneNumberPart, userNamePart, userPhonePart
            )

            testFile.delete()

            response.isSuccessful
        } catch (e: Exception) {
            Log.e(TAG, "Test upload error: ${e.message}", e)
            false
        }
    }
}
