import 'package:flutter_test/flutter_test.dart';
import 'package:kiosk_app/domain/catalog.dart';
import 'package:kiosk_app/domain/conversation_controller.dart';
import 'package:kiosk_app/domain/order_commands.dart';
import 'package:kiosk_app/domain/recommendation_engine.dart';
import 'package:kiosk_app/service/controllers/cart_controller.dart';
import 'package:kiosk_app/voice/voice_port.dart';

import 'fakes.dart';

void main() {
  late FakeVoicePort voice;
  late FakeInterpreter interpreter;
  late CartController cart;
  late OrderCommandBus bus;
  late KioskCatalog catalog;
  late DateTime now;
  late int checkouts;
  late List<Set<String>> highlights;

  ConversationController build({int maxFailures = 3}) => ConversationController(
    voice: voice,
    interpreter: interpreter,
    bus: bus,
    catalog: () => catalog,
    onHighlight: highlights.add,
    onCheckout: () async => checkouts++,
    maxFailures: maxFailures,
    clock: () => now,
    newId: () => '00000000-0000-4000-8000-000000000001',
  );

  setUp(() {
    voice = FakeVoicePort();
    interpreter = FakeInterpreter();
    cart = CartController();
    bus = OrderCommandBus(cart);
    catalog = demoCatalog;
    now = DateTime(2026, 11, 11, 12);
    checkouts = 0;
    highlights = [];
  });

  test('시나리오 B: 바로 주문 → 확인 → 담기 → 추가 제안 거절 → 결제 안내', () async {
    final c = build();
    voice
      ..say('제육 두 개랑 콜라 하나')
      ..say('네')
      ..say('아니요')
      ..say('결제');
    interpreter.reply(
      const InterpretResult(
        intent: 'order',
        items: [
          InterpretedItem(menuId: '1', quantity: 2),
          InterpretedItem(menuId: '6', quantity: 1),
        ],
      ),
    );
    await c.start();
    await settle();

    expect(voice.spoken.first, '네, 말씀하세요.');
    expect(voice.spoken, contains('제육덮밥 2개와 콜라 1개 담을까요?'));
    expect(cart.entries.map((e) => '${e.menu.name}×${e.quantity}'), [
      '제육덮밥×2',
      '콜라×1',
    ]);
    // 음료가 이미 있으므로 사이드·디저트 중 추가 제안 후보가 없으면 바로 다음 안내로 갑니다(공깃밥은 추천 제외).
    expect(voice.spoken.any((s) => s.contains('같이 하시겠어요?')), isFalse);
    expect(checkouts, 1);
    expect(c.state, ConversationState.idle);
    expect(bus.usedVoice, isTrue);
    // "네", "아니요", "결제"는 서버 없이 처리합니다.
    expect(interpreter.payloads, hasLength(1));
    expect(interpreter.payloads.single['text'], '제육 두 개랑 콜라 하나');
  });

  test('추가 제안은 주문당 1회, 수락하면 추천 경유로 담깁니다', () async {
    final c = build();
    voice
      ..say('제육 하나')
      ..say('네')
      ..say('응')
      ..say('순두부도 하나')
      ..say('네');
    interpreter
      ..reply(
        const InterpretResult(
          intent: 'order',
          items: [InterpretedItem(menuId: '1', quantity: 1)],
        ),
      )
      ..reply(
        const InterpretResult(
          intent: 'order',
          items: [InterpretedItem(menuId: '3', quantity: 1)],
        ),
      );
    await c.start();
    await settle();
    expect(voice.spoken, contains('담았어요. 식혜도 같이 하시겠어요?'));
    final drink = cart.entries.singleWhere((e) => e.menu.id == '20');
    expect(drink.recommended, isTrue);
    expect(voice.spoken.where((s) => s.contains('같이 하시겠어요?')), hasLength(1));
    expect(cart.entries.map((e) => e.menu.id), containsAll(['1', '20', '3']));
  });

  test('시나리오 A: 상황 추천 → 정책 순위 카드 3개 → 카드 선택 → 추천 기록', () async {
    final c = build();
    voice.say('어제 술 먹었는데 해장에 좋은 거 추천해줘');
    interpreter.reply(
      const InterpretResult(
        intent: 'recommend',
        situation: ['해장'],
        recommendations: [
          RecommendationCandidate(
            menuId: '3',
            fit: 95,
            reason: '국물이 있어 속 풀기 좋아요',
          ),
          RecommendationCandidate(menuId: '4', fit: 90, reason: '시원해요'),
          RecommendationCandidate(menuId: '15', fit: 88, reason: '담백해요'),
          RecommendationCandidate(menuId: '1', fit: 30, reason: '기준선 미달'),
          RecommendationCandidate(menuId: '7', fit: 99, reason: '품절'),
          RecommendationCandidate(menuId: '30', fit: 99, reason: '추천 제외'),
        ],
      ),
    );
    await c.start();
    await settle();
    expect(c.state, ConversationState.recommending);
    expect(c.recommendations.map((r) => r.menu.id), ['3', '15', '4']);
    expect(voice.spoken.last, '국물이 있어 속 풀기 좋아요. 순두부찌개 어떠세요? 북엇국과 콩나물국밥도 있어요.');
    expect(interpreter.logs.single, {
      'client_log_id': '00000000-0000-4000-8000-000000000001',
      'situation': ['해장'],
      'shown_menu_ids': [3, 15, 4],
      'policy_profit': 30,
    });
    await c.selectRecommendation(1);
    await settle();
    final entry = cart.entries.singleWhere((e) => e.menu.id == '15');
    expect(entry.recommended, isTrue);
    expect(interpreter.logs.last['selected_menu_id'], 15);
    expect(
      interpreter.logs.last['client_log_id'],
      interpreter.logs.first['client_log_id'],
    );
  });

  test('이익 우선 정책은 적합한 후보 안에서만 순서를 바꿉니다', () async {
    catalog = const KioskCatalog(
      menus: demoMenus,
      aiReady: true,
      settings: StoreAiSettings(
        policyProfit: 100,
        pickWeight: 0,
        fitThreshold: 80,
      ),
    );
    final c = build();
    voice.say('해장');
    interpreter.reply(
      const InterpretResult(
        intent: 'recommend',
        recommendations: [
          RecommendationCandidate(menuId: '3', fit: 95),
          RecommendationCandidate(menuId: '4', fit: 85),
          RecommendationCandidate(menuId: '6', fit: 79),
        ],
      ),
    );
    await c.start();
    await settle();
    // 원가율이 낮은 콩나물국밥이 1순위가 되고, 기준선 미만인 콜라는 이익과 무관하게 빠집니다.
    expect(c.recommendations.map((r) => r.menu.id), ['4', '3']);
  });

  test('세 번 해석에 실패하면 터치 주문·직원 호출을 안내합니다', () async {
    final c = build();
    voice
      ..say('으음')
      ..say('어어')
      ..say('그거');
    await c.start();
    await settle();
    expect(c.state, ConversationState.error);
    expect(c.offerStaffCall, isTrue);
    expect(await c.callStaff(), isTrue);
    expect(interpreter.staffCalls, ['voice_help']);
    expect(c.state, ConversationState.idle);
  });

  test('8초 동안 말이 없으면 대기로 돌아갑니다', () async {
    final c = build();
    voice.silence();
    await c.start();
    await settle();
    expect(c.state, ConversationState.listening);
    now = now.add(const Duration(seconds: 9));
    voice.emit(const VoiceEvent(VoiceEventType.error, code: 'no_speech'));
    await settle();
    expect(c.state, ConversationState.idle);
    expect(c.message, contains('말씀이 없어'));
  });

  test('서버·LLM 실패는 터치 주문 안내로 끝냅니다', () async {
    final c = build();
    voice.say('제육 하나');
    interpreter.results.add(const VoiceServiceUnavailable('timeout'));
    await c.start();
    await settle();
    expect(c.state, ConversationState.idle);
    expect(c.message, '지금은 음성 주문을 쓸 수 없어요. 화면을 눌러 주문해 주세요.');
    expect(cart.entries, isEmpty);
  });

  test('점주가 음성 주문을 끄면 마이크를 켜지 않습니다', () async {
    catalog = const KioskCatalog(
      menus: demoMenus,
      aiReady: true,
      settings: StoreAiSettings(voiceEnabled: false),
    );
    final c = build();
    await c.start();
    expect(c.state, ConversationState.idle);
    expect(voice.listens, 0);
  });

  test('권한이 없으면 안내만 하고 듣지 않습니다', () async {
    voice.prepareProblem = 'permission';
    final c = build();
    await c.start();
    expect(c.message, contains('마이크 권한'));
    expect(voice.listens, 0);
  });

  test('정정: 장바구니 항목 수량 변경과 빼기, 비우기 확인', () async {
    bus.run(AddItemCommand(demoMenus[0], 1));
    bus.run(AddItemCommand(demoMenus[4], 1));
    final c = build();
    voice
      ..say('제육 세 개로 바꿔줘')
      ..say('콜라 빼줘')
      ..say('다 지워줘')
      ..say('네');
    interpreter
      ..reply(
        const InterpretResult(
          intent: 'modify',
          items: [InterpretedItem(menuId: '1', quantity: 3, entryId: '1')],
        ),
      )
      ..reply(
        const InterpretResult(
          intent: 'remove',
          items: [InterpretedItem(menuId: '6', quantity: 1, entryId: '6')],
        ),
      )
      ..reply(const InterpretResult(intent: 'clear'));
    await c.start();
    await settle();
    expect(voice.spoken, contains(startsWith('제육덮밥 3개로 바꿨어요.')));
    expect(voice.spoken, contains(startsWith('콜라를 뺐어요.')));
    expect(voice.spoken, contains('장바구니에 담긴 메뉴를 모두 뺄까요?'));
    expect(cart.entries, isEmpty);
    // 서버로 보낸 장바구니 맥락에 entry_id가 들어갑니다.
    expect((interpreter.payloads.first['cart'] as List).first, {
      'entry_id': '1',
      'menu_id': 1,
      'quantity': 1,
      'option_ids': <int>[],
    });
  });

  test('시니어 모드: 느린 음성, 추가 제안 없음', () async {
    final c = build();
    voice
      ..say('제육 하나')
      ..say('네');
    interpreter.reply(
      const InterpretResult(
        intent: 'order',
        items: [InterpretedItem(menuId: '1', quantity: 1)],
      ),
    );
    await c.start(seniorMode: true);
    await settle();
    expect(voice.rates.first, closeTo(0.8, 0.001));
    expect(voice.spoken.first, contains('천천히'));
    expect(voice.spoken.any((s) => s.contains('같이 하시겠어요?')), isFalse);
    expect(cart.entries.single.menu.id, '1');
  });

  test('품절 메뉴는 담지 않고 되묻습니다', () async {
    final c = build();
    voice.say('사이다');
    interpreter.reply(
      const InterpretResult(
        intent: 'order',
        items: [InterpretedItem(menuId: '7', quantity: 1)],
      ),
    );
    await c.start();
    await settle();
    expect(cart.entries, isEmpty);
    expect(voice.spoken, contains(startsWith('말씀하신 메뉴를 찾지 못했어요.')));
  });
}
