package com.mallo.voisk.kiosk

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.WindowManager
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * 키오스크 화면. 화면이 꺼지지 않게 하고, 관리자 설정에서 켜면 화면 고정(Lock Task)으로 앱을 벗어나지 못하게 합니다.
 * 기기 소유자(Device Owner)로 등록하지 않은 태블릿에서는 안드로이드가 화면 고정 확인 창을 한 번 띄웁니다.
 */
class MainActivity : FlutterActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "kiosk/system").setMethodCallHandler { call, result ->
            when (call.method) {
                "startLockTask" -> try {
                    startLockTask()
                    result.success(true)
                } catch (error: IllegalArgumentException) {
                    result.success(false)
                } catch (error: SecurityException) {
                    result.success(false)
                }
                "stopLockTask" -> {
                    try {
                        stopLockTask()
                    } catch (error: IllegalStateException) {
                        // 화면 고정 중이 아니면 무시합니다.
                    }
                    result.success(null)
                }
                "requestIgnoreBatteryOptimizations" -> result.success(requestBatteryException())
                else -> result.notImplemented()
            }
        }
    }

    /** 절전 예외 요청 화면을 엽니다. 이미 예외면 true, 화면을 열지 못하면 false. */
    private fun requestBatteryException(): Boolean {
        val power = getSystemService(POWER_SERVICE) as PowerManager
        if (power.isIgnoringBatteryOptimizations(packageName)) return true
        return try {
            startActivity(
                Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")),
            )
            true
        } catch (error: ActivityNotFoundException) {
            try {
                startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                true
            } catch (inner: ActivityNotFoundException) {
                false
            }
        }
    }
}
