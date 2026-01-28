package com.antigravity.callagent

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.telephony.TelephonyManager
import android.util.Log
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.antigravity.callagent.databinding.ActivityRegisterBinding

class RegisterActivity : AppCompatActivity() {

    private lateinit var binding: ActivityRegisterBinding
    private val TAG = "RegisterActivity"
    private val PHONE_PERMISSION_CODE = 200

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityRegisterBinding.inflate(layoutInflater)
        setContentView(binding.root)

        tryDetectPhoneNumber()

        binding.btnRegister.setOnClickListener {
            val name = binding.etName.text.toString().trim()
            val phone = binding.etPhone.text.toString().trim()

            if (name.isEmpty()) {
                binding.etName.error = "이름을 입력해주세요"
                return@setOnClickListener
            }

            val wifiOnly = binding.cbWifiOnly.isChecked
            UserPreferences.register(this, name, phone, wifiOnly)
            Log.d(TAG, "User registered: name=$name, phone=$phone, wifiOnly=$wifiOnly")

            startActivity(Intent(this, MainActivity::class.java))
            finish()
        }
    }

    private fun tryDetectPhoneNumber() {
        val hasPhoneState = ContextCompat.checkSelfPermission(
            this, Manifest.permission.READ_PHONE_STATE
        ) == PackageManager.PERMISSION_GRANTED

        val hasPhoneNumbers = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            ContextCompat.checkSelfPermission(
                this, Manifest.permission.READ_PHONE_NUMBERS
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }

        if (hasPhoneState && hasPhoneNumbers) {
            detectPhoneNumber()
        } else {
            val perms = mutableListOf(Manifest.permission.READ_PHONE_STATE)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                perms.add(Manifest.permission.READ_PHONE_NUMBERS)
            }
            ActivityCompat.requestPermissions(this, perms.toTypedArray(), PHONE_PERMISSION_CODE)
        }
    }

    @Suppress("DEPRECATION")
    private fun detectPhoneNumber() {
        try {
            val tm = getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
            val number = tm.line1Number
            if (!number.isNullOrBlank()) {
                binding.etPhone.setText(number)
                Log.d(TAG, "Phone number auto-detected")
            } else {
                Log.d(TAG, "Phone number not available from TelephonyManager")
            }
        } catch (e: SecurityException) {
            Log.w(TAG, "Phone number detection: permission denied")
        } catch (e: Exception) {
            Log.w(TAG, "Phone number detection failed: ${e.message}")
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == PHONE_PERMISSION_CODE) {
            if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                detectPhoneNumber()
            }
        }
    }
}
