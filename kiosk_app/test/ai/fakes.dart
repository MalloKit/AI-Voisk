import 'dart:async';

import 'package:kiosk_app/domain/catalog.dart';
import 'package:kiosk_app/domain/conversation_controller.dart';
import 'package:kiosk_app/service/models/menu_item.dart';
import 'package:kiosk_app/service/models/menu_option.dart';
import 'package:kiosk_app/voice/voice_port.dart';

/// 마이크 대신 미리 정한 문장을 "인식"합니다. 문장이 없으면 다음 입력을 기다립니다.
class FakeVoicePort implements VoicePort {
  final _events = StreamController<VoiceEvent>.broadcast();
  final List<String> spoken = [];
  final List<double> rates = [];
  final List<Object> script = [];
  String? prepareProblem;
  int listens = 0;
  int cancels = 0;
  int stops = 0;

  @override
  Stream<VoiceEvent> get events => _events.stream;

  void say(String text) => script.add(text);

  /// 무음(no_speech) 같은 인식 오류를 흉내 냅니다.
  void silence() =>
      script.add(const VoiceEvent(VoiceEventType.error, code: 'no_speech'));

  void emit(VoiceEvent event) => _events.add(event);

  @override
  Future<String?> prepare() async => prepareProblem;

  @override
  Future<void> listen({required int silenceMs}) async {
    listens++;
    if (script.isEmpty) return;
    final next = script.removeAt(0);
    scheduleMicrotask(() {
      _events.add(
        next is VoiceEvent
            ? next
            : VoiceEvent(VoiceEventType.finalResult, text: next as String),
      );
    });
  }

  @override
  Future<void> cancelListening() async => cancels++;

  @override
  Future<void> speak(String text, {required double rate}) async {
    spoken.add(text);
    rates.add(rate);
  }

  @override
  Future<void> stopSpeaking() async => stops++;
}

class FakeInterpreter implements VoiceInterpreter {
  final List<Object> results = [];
  final List<Map<String, Object?>> payloads = [];
  final List<Map<String, Object?>> logs = [];
  final List<String> staffCalls = [];

  void reply(InterpretResult result) => results.add(result);

  @override
  Future<InterpretResult> interpret(Map<String, Object?> payload) async {
    payloads.add(payload);
    if (results.isEmpty) return const InterpretResult(intent: 'unknown');
    final next = results.removeAt(0);
    if (next is Exception) throw next;
    return next as InterpretResult;
  }

  @override
  Future<void> logRecommendation(Map<String, Object?> payload) async =>
      logs.add(payload);

  @override
  Future<void> staffCall(String reason) async => staffCalls.add(reason);
}

const demoMenus = [
  MenuItem(
    id: '1',
    name: '제육덮밥',
    category: '식사',
    price: 9000,
    description: '매콤한 제육과 따뜻한 밥',
    options: [MenuOption(id: '11', name: '밥 추가', price: 1000)],
    costRate: 35,
    tags: ['든든한', '매운'],
  ),
  MenuItem(
    id: '3',
    name: '순두부찌개',
    category: '국물',
    price: 8500,
    description: '얼큰한 국물',
    costRate: 30,
    tags: ['해장'],
  ),
  MenuItem(
    id: '4',
    name: '콩나물국밥',
    category: '국물',
    price: 7500,
    description: '시원한 국물',
    costRate: 25,
    tags: ['해장'],
  ),
  MenuItem(
    id: '15',
    name: '북엇국',
    category: '국물',
    price: 8000,
    description: '담백한 국',
    costRate: 27,
    tags: ['해장'],
    storePick: true,
  ),
  MenuItem(
    id: '6',
    name: '콜라',
    category: '음료',
    price: 2000,
    description: '시원한 콜라',
    costRate: 30,
  ),
  MenuItem(
    id: '7',
    name: '사이다',
    category: '음료',
    price: 2000,
    description: '시원한 사이다',
    isSoldOut: true,
    costRate: 10,
  ),
  MenuItem(
    id: '20',
    name: '식혜',
    category: '음료',
    price: 2500,
    description: '달콤한 식혜',
    costRate: 25,
  ),
  MenuItem(
    id: '30',
    name: '공깃밥',
    category: '사이드',
    price: 1000,
    description: '밥',
    costRate: 15,
    recExcluded: true,
  ),
];

const demoCatalog = KioskCatalog(
  menus: demoMenus,
  menuVersion: 7,
  aiReady: true,
);

/// 비동기 작업(마이크로태스크·이벤트)을 충분히 흘려보냅니다.
Future<void> settle([int rounds = 60]) async {
  for (var i = 0; i < rounds; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}
