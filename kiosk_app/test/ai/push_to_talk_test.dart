import 'package:flutter_test/flutter_test.dart';
import 'package:kiosk_app/domain/catalog.dart';
import 'package:kiosk_app/domain/conversation_controller.dart';
import 'package:kiosk_app/domain/order_commands.dart';
import 'package:kiosk_app/domain/recommendation_engine.dart';
import 'package:kiosk_app/service/controllers/cart_controller.dart';
import 'package:kiosk_app/service/models/menu_item.dart';
import 'package:kiosk_app/service/models/menu_option.dart';
import 'package:kiosk_app/voice/voice_port.dart';

import 'fakes.dart';

/// 사이즈를 꼭 골라야 하는 음료. 추가 제안 후보가 이것 하나뿐인 매장입니다.
const americano = MenuItem(
  id: '50',
  name: '아이스 아메리카노',
  category: '음료',
  price: 3000,
  description: '',
  options: [
    MenuOption(id: '51', name: '레귤러', price: 0, group: '사이즈'),
    MenuOption(id: '52', name: '라지', price: 500, group: '사이즈'),
  ],
);

final upsellCatalog = KioskCatalog(
  menus: [demoMenus.firstWhere((m) => m.id == '3'), americano],
  aiReady: true,
);

void main() {
  late FakeVoicePort voice;
  late FakeInterpreter interpreter;
  late CartController cart;
  late OrderCommandBus bus;
  late KioskCatalog catalog;

  // 실제 키오스크와 같은 기본값: 안내 뒤에는 마이크 버튼을 눌러야 듣습니다.
  ConversationController build() => ConversationController(
    voice: voice,
    interpreter: interpreter,
    bus: bus,
    catalog: () => catalog,
    newId: () => '00000000-0000-4000-8000-000000000001',
  );

  setUp(() {
    voice = FakeVoicePort();
    interpreter = FakeInterpreter();
    cart = CartController();
    bus = OrderCommandBus(cart);
    catalog = demoCatalog;
  });

  test('첫 발화만 바로 듣고, 추천 뒤에는 마이크 버튼을 누를 때까지 듣지 않습니다', () async {
    final c = build();
    voice.say('해장에 좋은 거');
    interpreter
      ..reply(
        const InterpretResult(
          intent: 'recommend',
          recommendations: [
            RecommendationCandidate(menuId: '3', fit: 95),
            RecommendationCandidate(menuId: '4', fit: 90),
          ],
        ),
      )
      ..reply(const InterpretResult(intent: 'select', selectIndex: 1));
    await c.start();
    await settle();

    expect(c.state, ConversationState.recommending);
    expect(c.recommendations, isNotEmpty);
    expect(voice.listens, 1);
    expect(c.micOpen, isFalse);
    expect(c.canTalk, isTrue);

    // 다음 말은 버튼을 눌러야 듣습니다.
    voice.say('두 번째 거');
    await c.talk();
    await settle();
    expect(voice.listens, 2);
    expect(interpreter.payloads.last['state'], 'recommending');
    // 말로 고르면 한 번 확인하고, 그 질문 뒤에도 듣지 않고 기다립니다.
    final chosen = c.recommendations[1].menu;
    expect(c.state, ConversationState.confirming);
    expect(voice.spoken.last, '${chosen.name} 1개 담을까요?');
    expect(voice.listens, 2);

    // 화면의 "네" 버튼
    await c.handleText('네');
    await settle();
    expect(cart.entries.map((e) => e.menu.id), [chosen.id]);
    expect(voice.listens, 2);
  });

  test('못 들었으면 마이크 버튼을 다시 누르라고 안내하고 기다립니다', () async {
    final c = build();
    voice.silence();
    await c.start();
    await settle();

    expect(voice.listens, 1);
    expect(voice.spoken.last, contains('마이크 버튼을 누르고 다시 말씀해 주세요'));
    expect(c.state, ConversationState.listening);
    expect(c.active, isTrue);
    expect(c.canTalk, isTrue);
  });

  test('대화 중에 "말로 주문하기"를 다시 누르면 마이크 버튼과 같습니다', () async {
    final c = build();
    voice.silence();
    await c.start();
    await settle();
    voice.silence();
    await c.start();
    await settle();
    expect(voice.listens, 2);
  });

  test('추가 제안 옵션을 묻다 인식 서비스가 끊겨도 고르던 메뉴를 버리지 않고, 화면에서 옵션을 고르면 바로 담습니다', () async {
    catalog = upsellCatalog;
    final c = build();
    voice.say('순두부 하나');
    interpreter.reply(
      const InterpretResult(
        intent: 'order',
        items: [InterpretedItem(menuId: '3', quantity: 1)],
      ),
    );
    await c.start();
    await settle();
    expect(voice.spoken.last, '순두부찌개 1개 담을까요?');

    await c.handleText('네');
    await settle();
    expect(c.state, ConversationState.upsell);
    expect(voice.spoken.last, contains('아이스 아메리카노도 같이 하시겠어요?'));

    // 추가 제안에 "네" → 사이즈 질문
    await c.handleText('네');
    await settle();
    expect(c.state, ConversationState.choosingOption);
    expect(c.optionChoices.map((o) => o.name), ['레귤러', '라지']);

    // 마이크를 눌렀는데 인식 서비스 연결이 끊김
    voice.script.add(const VoiceEvent(VoiceEventType.error, code: 'network'));
    await c.talk();
    await settle();
    expect(c.active, isTrue);
    expect(c.state, ConversationState.choosingOption);
    expect(c.optionChoices, hasLength(2));
    expect(voice.spoken.last, contains('연결하지 못했어요'));

    // 화면의 옵션 버튼으로 고르면 다시 묻지 않고 바로 담습니다.
    await c.chooseOption(c.optionChoices.last);
    await settle();
    final drink = cart.entries.singleWhere((e) => e.menu.id == '50');
    expect(drink.options.map((o) => o.name), ['라지']);
    expect(drink.recommended, isTrue);
    expect(voice.spoken.any((s) => s.contains('아메리카노 라지 1개 담을까요?')), isFalse);
    expect(voice.spoken.last, startsWith('아이스 아메리카노 라지 1개 담았어요.'));
    expect(c.state, ConversationState.listening);
  });
}
