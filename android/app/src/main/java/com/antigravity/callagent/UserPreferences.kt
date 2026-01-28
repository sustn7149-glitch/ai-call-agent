package com.antigravity.callagent

import android.content.Context
import android.content.SharedPreferences

object UserPreferences {

    private const val PREF_NAME = "call_agent_user"
    private const val KEY_NAME = "user_name"
    private const val KEY_PHONE = "user_phone"
    private const val KEY_REGISTERED = "is_registered"
    private const val KEY_WIFI_ONLY = "wifi_only_upload"

    private fun prefs(context: Context): SharedPreferences {
        return context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
    }

    fun isRegistered(context: Context): Boolean {
        return prefs(context).getBoolean(KEY_REGISTERED, false)
    }

    fun register(context: Context, name: String, phone: String, wifiOnly: Boolean) {
        prefs(context).edit()
            .putString(KEY_NAME, name)
            .putString(KEY_PHONE, phone)
            .putBoolean(KEY_REGISTERED, true)
            .putBoolean(KEY_WIFI_ONLY, wifiOnly)
            .apply()
    }

    fun getUserName(context: Context): String {
        return prefs(context).getString(KEY_NAME, "") ?: ""
    }

    fun getPhone(context: Context): String {
        return prefs(context).getString(KEY_PHONE, "") ?: ""
    }

    fun isWifiOnly(context: Context): Boolean {
        return prefs(context).getBoolean(KEY_WIFI_ONLY, true)
    }
}
