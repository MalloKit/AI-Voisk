/// AI 보이스크 음성 엔진의 Dart 쪽 어댑터.
///
/// Kotlin(VoiceEnginePlugin)이 마이크·음성 인식·음성 안내를 맡고,
/// 이 클래스는 플랫폼 채널 이벤트를 [VoiceEvent]로 바꿔 전달합니다.
/// 오디오 데이터는 이 채널로 오지 않고 인식된 텍스트와 상태만 옵니다.
library;

import 'dart:async';

import 'package:flutter/services.dart';

enum VoiceEventType {
  listening,
  speechBegin,
  speechEnd,
  partial,
  finalResult,
  error,
  level,
  speechStart,
  speechDone,
  unknown,
}

class VoiceEvent {
  const VoiceEvent(
    this.type, {
    this.text,
    this.code,
    this.level,
    this.utteranceId,
    this.alternatives = const [],
  });

  factory VoiceEvent.fromMap(Map<Object?, Object?> map) {
    final type = switch (map['type']) {
      'listening' => VoiceEventType.listening,
      'speechBegin' => VoiceEventType.speechBegin,
      'speechEnd' => VoiceEventType.speechEnd,
      'partial' => VoiceEventType.partial,
      'final' => VoiceEventType.finalResult,
      'error' => VoiceEventType.error,
      'level' => VoiceEventType.level,
      'speechStart' => VoiceEventType.speechStart,
      'speechDone' => VoiceEventType.speechDone,
      _ => VoiceEventType.unknown,
    };
    return VoiceEvent(
      type,
      text: map['text'] as String?,
      code: map['code'] as String?,
      level: (map['level'] as num?)?.toDouble(),
      utteranceId: map['id'] as String?,
      alternatives: ((map['alternatives'] as List?) ?? const [])
          .whereType<String>()
          .toList(),
    );
  }

  final VoiceEventType type;
  final String? text;

  /// 오류 종류: no_speech, audio, permission, network, busy, language, client
  final String? code;
  final double? level;
  final String? utteranceId;
  final List<String> alternatives;
}

class VoiceEngine {
  VoiceEngine({MethodChannel? methods, EventChannel? events})
    : _methods = methods ?? const MethodChannel('voice_engine/methods'),
      _events = events ?? const EventChannel('voice_engine/events');

  final MethodChannel _methods;
  final EventChannel _events;
  Stream<VoiceEvent>? _stream;

  /// 여러 구독자가 같은 이벤트를 받도록 broadcast 스트림 하나를 공유합니다.
  Stream<VoiceEvent> get events => _stream ??= _events
      .receiveBroadcastStream()
      .map((event) => VoiceEvent.fromMap(event as Map<Object?, Object?>))
      .asBroadcastStream();

  Future<bool> isRecognitionAvailable() async =>
      await _methods.invokeMethod<bool>('isRecognitionAvailable') ?? false;

  Future<bool> hasPermission() async =>
      await _methods.invokeMethod<bool>('hasPermission') ?? false;

  Future<bool> requestPermission() async =>
      await _methods.invokeMethod<bool>('requestPermission') ?? false;

  Future<bool> initializeTts() async =>
      await _methods.invokeMethod<bool>('initializeTts') ?? false;

  Future<void> startListening({
    String locale = 'ko-KR',
    int completeSilenceMs = 1500,
    bool preferOffline = false,
  }) => _methods.invokeMethod<void>('startListening', {
    'locale': locale,
    'completeSilenceMs': completeSilenceMs,
    'preferOffline': preferOffline,
  });

  Future<void> stopListening() => _methods.invokeMethod<void>('stopListening');

  Future<void> cancelListening() =>
      _methods.invokeMethod<void>('cancelListening');

  /// 재생 요청 id를 돌려줍니다. 끝나면 같은 id의 speechDone 이벤트가 옵니다.
  Future<String?> speak(String text, {double rate = 1.0, double pitch = 1.0}) =>
      _methods.invokeMethod<String>('speak', {
        'text': text,
        'rate': rate,
        'pitch': pitch,
      });

  Future<void> stopSpeaking() => _methods.invokeMethod<void>('stopSpeaking');
}
