package com.antigravity.callagent

import android.content.Context
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
                Log.d(TAG, "📤 Starting upload: ${file.name}")

                val requestFile = file.asRequestBody("audio/*".toMediaTypeOrNull())
                val filePart = MultipartBody.Part.createFormData(
                    "file",
                    file.name,
                    requestFile
                )
                val phoneNumberPart = phoneNumber.toRequestBody("text/plain".toMediaTypeOrNull())

                val response = NetworkModule.api.uploadFile(filePart, phoneNumberPart)

                if (response.isSuccessful) {
                    Log.d(TAG, "✅ Upload successful: ${response.body()?.filename}")
                } else {
                    Log.e(TAG, "❌ Upload failed: ${response.code()} - ${response.message()}")
                }
            } catch (e: Exception) {
                Log.e(TAG, "❌ Upload error: ${e.message}", e)
            }
        }
    }

    suspend fun testUpload(context: Context): Boolean {
        return try {
            // Create a small test file
            val testFile = File(context.cacheDir, "test_upload.txt")
            testFile.writeText("AI Call Agent Test Upload - ${System.currentTimeMillis()}")

            val requestFile = testFile.asRequestBody("text/plain".toMediaTypeOrNull())
            val filePart = MultipartBody.Part.createFormData(
                "file",
                "test_upload.txt",
                requestFile
            )
            val phoneNumberPart = "TEST-000-0000".toRequestBody("text/plain".toMediaTypeOrNull())

            val response = NetworkModule.api.uploadFile(filePart, phoneNumberPart)

            testFile.delete()

            response.isSuccessful
        } catch (e: Exception) {
            Log.e(TAG, "❌ Test upload error: ${e.message}", e)
            false
        }
    }
}
