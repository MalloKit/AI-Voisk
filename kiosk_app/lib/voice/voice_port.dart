import 'dart:async';

import 'package:voice_engine/voice_engine.dart';

export 'package:voice_engine/voice_engine.dart' show VoiceEvent, VoiceEventType;

/// 대화 도메인이 쓰는 음성 입출력 경계(Adapter). 테스트에서는 가짜 구현으로 바꿉니다.
abstract class VoicePort {
  Stream<VoiceEvent> get events;

  /// 마이크 권한·음성 인식 서비스·음성 안내를 준비합니다. 쓸 수 없으면 이유를 돌려줍니다.
  Future<String?> prepare();
  Future<void> listen({required int silenceMs});
  Future<void> cancelListening();

  /// 안내를 끝까지 말한 뒤에 완료됩니다.
  Future<void> speak(String text, {required double rate});
  Future<void> stopSpeaking();
}

class PluginVoicePort implements VoicePort {
  PluginVoicePort([VoiceEngine? engine]) : _engine = engine ?? VoiceEngine();
  final VoiceEngine _engine;
  bool _ttsReady = false;

  @override
  Stream<VoiceEvent> get events => _engine.events;

  @override
  Future<String?> prepare() async {
    if (!await _engine.isRecognitionAvailable()) return 'unavailable';
    if (!await _engine.hasPermission() && !await _engine.requestPermission()) {
      return 'permission';
    }
    _ttsReady = _ttsReady || await _engine.initializeTts();
    return null;
  }

  @override
  Future<void> listen({required int silenceMs}) =>
      _engine.startListening(completeSilenceMs: silenceMs);

  @override
  Future<void> cancelListening() => _engine.cancelListening();

  @override
  Future<void> speak(String text, {required double rate}) async {
    if (!_ttsReady) return;
    final done = Completer<void>();
    String? id;
    late final StreamSubscription<VoiceEvent> subscription;
    subscription = _engine.events.listen((event) {
      if (event.type == VoiceEventType.speechDone &&
          (id == null || event.utteranceId == id)) {
        if (!done.isCompleted) done.complete();
      }
    });
    try {
      id = await _engine.speak(text, rate: rate);
      // 안내가 끝나지 않는 경우에도 대화가 멈추지 않도록 글자 수 기준으로 상한을 둡니다.
      await done.future.timeout(
        Duration(milliseconds: 4000 + text.length * 250),
        onTimeout: () {},
      );
    } finally {
      await subscription.cancel();
    }
  }

  @override
  Future<void> stopSpeaking() => _engine.stopSpeaking();
}
