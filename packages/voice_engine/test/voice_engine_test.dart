import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_engine/voice_engine.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const methods = MethodChannel('voice_engine/methods');
  final calls = <MethodCall>[];

  setUp(() {
    calls.clear();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(methods, (call) async {
          calls.add(call);
          return switch (call.method) {
            'isRecognitionAvailable' || 'requestPermission' => true,
            'speak' => 'u1',
            _ => null,
          };
        });
  });

  test('메서드 이름과 인자를 Kotlin 계약대로 보냅니다', () async {
    final engine = VoiceEngine();
    expect(await engine.isRecognitionAvailable(), isTrue);
    expect(await engine.requestPermission(), isTrue);
    await engine.startListening(completeSilenceMs: 2000);
    expect(await engine.speak('네, 말씀하세요', rate: 0.8), 'u1');
    expect(calls.map((c) => c.method), [
      'isRecognitionAvailable',
      'requestPermission',
      'startListening',
      'speak',
    ]);
    expect(calls[2].arguments, {
      'locale': 'ko-KR',
      'completeSilenceMs': 2000,
      'preferOffline': false,
    });
    expect(calls[3].arguments, {
      'text': '네, 말씀하세요',
      'rate': 0.8,
      'pitch': 1.0,
    });
  });

  test('플랫폼 이벤트를 VoiceEvent로 바꿉니다', () {
    final finalEvent = VoiceEvent.fromMap({
      'type': 'final',
      'text': '제육 두 개',
      'alternatives': ['제육 두 개', '제육 두개'],
    });
    expect(finalEvent.type, VoiceEventType.finalResult);
    expect(finalEvent.text, '제육 두 개');
    expect(finalEvent.alternatives, hasLength(2));
    expect(
      VoiceEvent.fromMap({'type': 'error', 'code': 'no_speech'}).code,
      'no_speech',
    );
    expect(
      VoiceEvent.fromMap({'type': 'level', 'level': 3}).level,
      3.0,
    );
    expect(VoiceEvent.fromMap({'type': '?'}).type, VoiceEventType.unknown);
  });
}
