package com.mallo.voisk.voice_engine

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.embedding.engine.plugins.activity.ActivityAware
import io.flutter.embedding.engine.plugins.activity.ActivityPluginBinding
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugin.common.PluginRegistry
import java.util.Locale

/**
 * AI 보이스크 음성 엔진(Facade). 안드로이드 내장 SpeechRecognizer와 TextToSpeech를 하나의 인터페이스로 묶습니다.
 *
 * - 마이크는 Dart가 startListening을 호출한 동안만 씁니다. 상시 청취·호출어 감지는 없습니다.
 * - 오디오는 이 클래스 밖(Dart, 파일, 네트워크)으로 내보내지 않습니다. Dart에는 인식된 텍스트와 상태만 보냅니다.
 */
class VoiceEnginePlugin : FlutterPlugin, ActivityAware, MethodChannel.MethodCallHandler,
    EventChannel.StreamHandler, PluginRegistry.RequestPermissionsResultListener {

    private lateinit var context: Context
    private lateinit var methods: MethodChannel
    private lateinit var events: EventChannel
    private val main = Handler(Looper.getMainLooper())

    private var sink: EventChannel.EventSink? = null
    private var activity: ActivityPluginBinding? = null
    private var recognizer: SpeechRecognizer? = null
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var pendingTtsInit: MutableList<MethodChannel.Result> = mutableListOf()
    private var pendingPermission: MethodChannel.Result? = null
    private var lastLevelAt = 0L
    private var utteranceSeq = 0

    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        context = binding.applicationContext
        methods = MethodChannel(binding.binaryMessenger, "voice_engine/methods")
        methods.setMethodCallHandler(this)
        events = EventChannel(binding.binaryMessenger, "voice_engine/events")
        events.setStreamHandler(this)
    }

    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        methods.setMethodCallHandler(null)
        events.setStreamHandler(null)
        releaseRecognizer()
        tts?.shutdown()
        tts = null
        ttsReady = false
    }

    // ---------- Activity (권한 요청) ----------

    override fun onAttachedToActivity(binding: ActivityPluginBinding) {
        activity = binding
        binding.addRequestPermissionsResultListener(this)
    }

    override fun onDetachedFromActivityForConfigChanges() = onDetachedFromActivity()

    override fun onReattachedToActivityForConfigChanges(binding: ActivityPluginBinding) = onAttachedToActivity(binding)

    override fun onDetachedFromActivity() {
        activity?.removeRequestPermissionsResultListener(this)
        activity = null
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray): Boolean {
        if (requestCode != PERMISSION_REQUEST) return false
        val granted = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
        pendingPermission?.success(granted)
        pendingPermission = null
        return true
    }

    // ---------- EventChannel ----------

    override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
        sink = events
    }

    override fun onCancel(arguments: Any?) {
        sink = null
    }

    private fun emit(type: String, extra: Map<String, Any?> = emptyMap()) {
        val event = HashMap<String, Any?>(extra)
        event["type"] = type
        if (Looper.myLooper() == Looper.getMainLooper()) sink?.success(event) else main.post { sink?.success(event) }
    }

    // ---------- MethodChannel ----------

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "isRecognitionAvailable" -> result.success(SpeechRecognizer.isRecognitionAvailable(context))
            "hasPermission" -> result.success(hasMicPermission())
            "requestPermission" -> requestPermission(result)
            "initializeTts" -> initializeTts(result)
            "startListening" -> startListening(call, result)
            "stopListening" -> {
                recognizer?.stopListening()
                result.success(null)
            }
            "cancelListening" -> {
                releaseRecognizer()
                result.success(null)
            }
            "speak" -> speak(call, result)
            "stopSpeaking" -> {
                tts?.stop()
                result.success(null)
            }
            else -> result.notImplemented()
        }
    }

    private fun hasMicPermission() =
        context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    private fun requestPermission(result: MethodChannel.Result) {
        if (hasMicPermission()) return result.success(true)
        val host: Activity = activity?.activity ?: return result.success(false)
        if (pendingPermission != null) return result.error("busy", "권한 요청이 진행 중입니다.", null)
        pendingPermission = result
        host.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), PERMISSION_REQUEST)
    }

    // ---------- 음성 인식 ----------

    private fun startListening(call: MethodCall, result: MethodChannel.Result) {
        if (!hasMicPermission()) return result.error("permission", "마이크 권한이 필요합니다.", null)
        if (!SpeechRecognizer.isRecognitionAvailable(context)) return result.error("unavailable", "음성 인식 서비스가 없습니다.", null)
        // 안내 음성이 마이크로 다시 들어가지 않도록 말하는 중이면 멈춥니다.
        tts?.stop()
        releaseRecognizer()
        val locale = call.argument<String>("locale") ?: "ko-KR"
        val silenceMs = (call.argument<Int>("completeSilenceMs") ?: 1500).toLong()
        val preferOffline = call.argument<Boolean>("preferOffline") ?: false
        val created = SpeechRecognizer.createSpeechRecognizer(context)
        recognizer = created
        created.setRecognitionListener(listener)
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, locale)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, silenceMs)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, silenceMs)
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, preferOffline)
        }
        created.startListening(intent)
        result.success(null)
    }

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) = emit("listening")
        override fun onBeginningOfSpeech() = emit("speechBegin")
        override fun onRmsChanged(rmsdB: Float) {
            // 화면의 소리 크기 표시용. 초당 10회로 줄여 보냅니다(오디오 자체는 보내지 않습니다).
            val now = SystemClock.elapsedRealtime()
            if (now - lastLevelAt >= 100) {
                lastLevelAt = now
                emit("level", mapOf("level" to rmsdB.toDouble()))
            }
        }
        override fun onBufferReceived(buffer: ByteArray?) = Unit
        override fun onEndOfSpeech() = emit("speechEnd")
        override fun onError(error: Int) {
            emit("error", mapOf("code" to errorName(error)))
            releaseRecognizer()
        }
        override fun onResults(results: Bundle?) {
            val texts = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION).orEmpty()
            val best = texts.firstOrNull()?.trim().orEmpty()
            if (best.isEmpty()) emit("error", mapOf("code" to "no_speech")) else emit("final", mapOf("text" to best, "alternatives" to texts))
            releaseRecognizer()
        }
        override fun onPartialResults(partialResults: Bundle?) {
            val text = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim()
            if (!text.isNullOrEmpty()) emit("partial", mapOf("text" to text))
        }
        override fun onEvent(eventType: Int, params: Bundle?) = Unit
    }

    private fun releaseRecognizer() {
        recognizer?.let {
            it.setRecognitionListener(null)
            it.cancel()
            it.destroy()
        }
        recognizer = null
    }

    private fun errorName(code: Int) = when (code) {
        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "no_speech"
        SpeechRecognizer.ERROR_AUDIO -> "audio"
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "permission"
        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT,
        SpeechRecognizer.ERROR_SERVER, SpeechRecognizer.ERROR_SERVER_DISCONNECTED -> "network"
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "busy"
        SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> "language"
        SpeechRecognizer.ERROR_TOO_MANY_REQUESTS -> "busy"
        else -> "client"
    }

    // ---------- 음성 안내 ----------

    private fun initializeTts(result: MethodChannel.Result) {
        if (ttsReady) return result.success(true)
        pendingTtsInit.add(result)
        if (tts != null) return
        tts = TextToSpeech(context) { status ->
            main.post {
                val engine = tts
                ttsReady = status == TextToSpeech.SUCCESS && engine != null &&
                    engine.setLanguage(Locale.KOREAN) >= TextToSpeech.LANG_AVAILABLE
                engine?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) = emit("speechStart", mapOf("id" to utteranceId))
                    override fun onDone(utteranceId: String?) = emit("speechDone", mapOf("id" to utteranceId))
                    @Deprecated("Deprecated in Java")
                    override fun onError(utteranceId: String?) = emit("speechDone", mapOf("id" to utteranceId, "error" to true))
                    override fun onError(utteranceId: String?, errorCode: Int) =
                        emit("speechDone", mapOf("id" to utteranceId, "error" to true))
                    override fun onStop(utteranceId: String?, interrupted: Boolean) =
                        emit("speechDone", mapOf("id" to utteranceId, "interrupted" to true))
                })
                val waiting = pendingTtsInit
                pendingTtsInit = mutableListOf()
                waiting.forEach { it.success(ttsReady) }
            }
        }
    }

    private fun speak(call: MethodCall, result: MethodChannel.Result) {
        val engine = tts
        val text = call.argument<String>("text").orEmpty()
        if (engine == null || !ttsReady) return result.error("tts", "음성 안내를 준비하지 못했습니다.", null)
        if (text.isBlank()) return result.success(null)
        engine.setSpeechRate((call.argument<Double>("rate") ?: 1.0).toFloat().coerceIn(0.3f, 2.0f))
        engine.setPitch((call.argument<Double>("pitch") ?: 1.0).toFloat().coerceIn(0.5f, 2.0f))
        val id = call.argument<String>("id") ?: "u${++utteranceSeq}"
        val queued = engine.speak(text.take(TextToSpeech.getMaxSpeechInputLength()), TextToSpeech.QUEUE_FLUSH, null, id)
        if (queued == TextToSpeech.SUCCESS) result.success(id) else result.error("tts", "음성 안내를 재생하지 못했습니다.", null)
    }

    companion object {
        private const val PERMISSION_REQUEST = 7301
    }
}
