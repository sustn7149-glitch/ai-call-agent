package com.antigravity.callagent

import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.RequestBody
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.*
import java.util.concurrent.TimeUnit

// API Response models
data class HealthResponse(
    val status: String,
    val timestamp: String
)

data class CallEventRequest(
    val number: String,
    val status: String,
    val direction: String,
    val duration: Long = 0
)

data class CallEventResponse(
    val success: Boolean
)

data class UploadResponse(
    val success: Boolean,
    val filename: String?
)

// API Interface
interface ApiService {

    @GET("health")
    suspend fun healthCheck(): Response<HealthResponse>

    @POST("api/webhook/call")
    suspend fun sendCallEvent(@Body request: CallEventRequest): Response<CallEventResponse>

    @Multipart
    @POST("api/upload")
    suspend fun uploadFile(
        @Part file: MultipartBody.Part,
        @Part("phoneNumber") phoneNumber: RequestBody
    ): Response<UploadResponse>
}

object NetworkModule {

    // 서버 주소 (Cloudflare Tunnel → N100 Ubuntu)
    const val DEFAULT_URL = "https://api.wiselymobile.net/"
    var BASE_URL = DEFAULT_URL

    private var retrofit: Retrofit? = null
    private var apiService: ApiService? = null

    private val loggingInterceptor = HttpLoggingInterceptor().apply {
        level = HttpLoggingInterceptor.Level.BODY
    }

    private val okHttpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .addInterceptor(loggingInterceptor)
        .build()

    val api: ApiService
        get() {
            if (apiService == null || retrofit == null) {
                createApi()
            }
            return apiService!!
        }

    private fun createApi() {
        retrofit = Retrofit.Builder()
            .baseUrl(BASE_URL)
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()

        apiService = retrofit!!.create(ApiService::class.java)
    }

    fun updateBaseUrl(newUrl: String) {
        BASE_URL = if (newUrl.endsWith("/")) newUrl else "$newUrl/"
        retrofit = null
        apiService = null
    }
}
