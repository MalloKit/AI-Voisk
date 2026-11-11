import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:kiosk_app/core/json_file_store.dart';
import 'package:kiosk_app/data/catalog_repository.dart';
import 'package:kiosk_app/data/kiosk_api.dart';
import 'package:kiosk_app/data/order_outbox.dart';
import 'package:kiosk_app/data/usability_log.dart';
import 'package:kiosk_app/domain/catalog.dart';
import 'package:kiosk_app/domain/conversation_controller.dart';
import 'package:kiosk_app/domain/order_commands.dart';
import 'package:kiosk_app/domain/recommendation_engine.dart';
import 'package:kiosk_app/service/controllers/cart_controller.dart';
import 'package:kiosk_app/service/models/menu_item.dart';
import 'package:kiosk_app/service/models/menu_option.dart';

import 'fakes.dart';

/// 맵기(필수 하나)와 치즈 추가(자유 옵션)가 있는 떡볶이.
const tteok = MenuItem(
  id: '40',
  name: '떡볶이',
  category: '분식',
  price: 5000,
  description: '',
  options: [
    MenuOption(id: '41', name: '순한맛', price: 0, group: '맵기'),
    MenuOption(id: '42', name: '매운맛', price: 0, group: '맵기'),
    MenuOption(id: '43', name: '치즈 추가', price: 1000),
  ],
);

final groupCatalog = KioskCatalog(
  menus: [...demoCatalog.menus, tteok],
  aiReady: true,
  settings: const StoreAiSettings(upsellEnabled: false),
);

void main() {
  late FakeVoicePort voice;
  late FakeInterpreter interpreter;
  late CartController cart;
  late OrderCommandBus bus;
  late List<(Set<String>, bool)> highlights;

  ConversationController build({
    Duration errorTimeout = const Duration(seconds: 20),
    int maxFailures = 3,
  }) => ConversationController(
    voice: voice,
    interpreter: interpreter,
    bus: bus,
    catalog: () => groupCatalog,
    onHighlight: (ids, {focus = false}) => highlights.add((ids, focus)),
    errorTimeout: errorTimeout,
    maxFailures: maxFailures,
  );

  setUp(() {
    voice = FakeVoicePort();
    interpreter = FakeInterpreter();
    cart = CartController();
    bus = OrderCommandBus(cart);
    highlights = [];
  });

  group('필수 옵션 되묻기', () {
    test('맵기를 말하지 않으면 묻고, "매운 걸로"를 기기에서 바로 알아듣습니다', () async {
      final c = build();
      voice
        ..say('떡볶이 하나')
        ..say('매운 걸로')
        ..say('네');
      interpreter.reply(
        const InterpretResult(
          intent: 'order',
          items: [InterpretedItem(menuId: '40', quantity: 1)],
        ),
      );
      await c.start();
      await settle();
      expect(
        voice.spoken,
        contains('떡볶이 맵기를 골라 주세요. 순한맛과 매운맛 중에 말씀하시거나 화면에서 눌러 주세요.'),
      );
      expect(voice.spoken, contains('떡볶이 매운맛 1개 담을까요?'));
      expect(cart.entries.single.options.map((o) => o.name), ['매운맛']);
      // 옵션 답과 "네"는 서버를 거치지 않습니다.
      expect(interpreter.payloads, hasLength(1));
    });

    test('화면의 옵션 버튼을 누르면 듣던 인식을 끊고 이어서 확인합니다', () async {
      final c = build();
      voice.say('떡볶이 둘');
      interpreter.reply(
        const InterpretResult(
          intent: 'order',
          items: [
            InterpretedItem(menuId: '40', quantity: 2, optionIds: ['43']),
          ],
        ),
      );
      await c.start();
      await settle();
      expect(c.state, ConversationState.choosingOption);
      expect(c.optionChoices.map((o) => o.name), ['순한맛', '매운맛']);
      final cancelsBefore = voice.cancels;
      unawaited(c.chooseOption(c.optionChoices.first));
      await settle();
      expect(voice.cancels, greaterThan(cancelsBefore));
      expect(c.state, ConversationState.confirming);
      unawaited(c.handleText('네'));
      await settle();
      expect(cart.entries.single.quantity, 2);
      expect(cart.entries.single.options.map((o) => o.name).toSet(), {
        '치즈 추가',
        '순한맛',
      });
      // 이전 듣기는 끊겼으므로 실패 안내가 나오지 않습니다.
      expect(voice.spoken.any((s) => s.contains('잘 들리지')), isFalse);
    });

    test('알아듣지 못하면 같은 질문을 다시 합니다', () async {
      final c = build();
      voice
        ..say('떡볶이 하나')
        ..say('음 글쎄요');
      interpreter
        ..reply(
          const InterpretResult(
            intent: 'order',
            items: [InterpretedItem(menuId: '40', quantity: 1)],
          ),
        )
        ..reply(const InterpretResult(intent: 'unknown'));
      await c.start();
      await settle();
      expect(
        voice.spoken.where((s) => s.startsWith('떡볶이 맵기를 골라 주세요')),
        hasLength(2),
      );
      expect(c.state, ConversationState.choosingOption);
    });
  });

  test('화면의 네·아니요 버튼은 듣던 인식을 끊습니다', () async {
    final c = build();
    voice.say('콜라 하나');
    interpreter.reply(
      const InterpretResult(
        intent: 'order',
        items: [InterpretedItem(menuId: '6', quantity: 1)],
      ),
    );
    await c.start();
    await settle();
    expect(c.state, ConversationState.confirming);
    final before = voice.cancels;
    unawaited(c.handleText('네'));
    await settle();
    expect(voice.cancels, greaterThan(before));
    expect(cart.entries.single.menu.name, '콜라');
  });

  test('추천·추가 제안 강조는 "이거" 대상(focus)으로 쓰지 않습니다', () async {
    final c = build();
    voice.say('해장할 거');
    interpreter.reply(
      const InterpretResult(
        intent: 'recommend',
        recommendations: [
          RecommendationCandidate(menuId: '3', fit: 90, reason: '국물'),
        ],
      ),
    );
    await c.start();
    await settle();
    expect(highlights, isNotEmpty);
    expect(highlights.every((h) => !h.$2), isTrue);
  });

  test('반복 실패 안내 뒤 조작이 없으면 음성 주문을 닫습니다', () async {
    final c = build(
      maxFailures: 1,
      errorTimeout: const Duration(milliseconds: 20),
    );
    voice.say('뭐라고');
    await c.start();
    await settle();
    expect(c.state, ConversationState.error);
    await Future<void>.delayed(const Duration(milliseconds: 60));
    expect(c.state, ConversationState.idle);
  });

  test('화면을 떠나면 듣기와 안내 음성을 멈춥니다', () async {
    final c = build();
    c.dispose();
    await settle();
    expect(voice.cancels, greaterThan(0));
    expect(voice.stops, greaterThan(0));
  });

  group('메뉴·장바구니', () {
    test('필수 그룹 선택지가 모두 품절이면 메뉴도 품절입니다', () {
      Map<String, dynamic> json(bool hotSoldOut) => {
        'id': '9',
        'name': '아메리카노',
        'category': '음료',
        'price': 3000,
        'options': [
          {'id': '91', 'name': '레귤러', 'price': 0, 'isSoldOut': hotSoldOut, 'group': '사이즈'},
          {'id': '92', 'name': '라지', 'price': 500, 'isSoldOut': true, 'group': '사이즈'},
          {'id': '93', 'name': '샷 추가', 'price': 500, 'isSoldOut': true, 'group': null},
        ],
      };
      expect(MenuItem.fromJson(json(false)).isSoldOut, isFalse);
      expect(MenuItem.fromJson(json(true)).isSoldOut, isTrue);
      final menu = MenuItem.fromJson(json(false));
      expect(menu.missingGroups(const []), ['사이즈']);
      expect(menu.missingGroups([menu.options.first]), isEmpty);
    });

    test('같은 메뉴를 더 담아도 수량은 99를 넘지 않습니다', () {
      final cart = CartController();
      final cola = demoCatalog.menuById('6')!;
      cart.add(cola, 90);
      cart.add(cola, 20);
      expect(cart.entries.single.quantity, CartController.maxQuantity);
      cart.setQuantity(cart.entries.single.id, 150);
      expect(cart.entries.single.quantity, 99);
    });
  });

  group('데이터 복구', () {
    OutboxEntry order(String id) => OutboxEntry(
      clientOrderId: id,
      path: '/kiosk/orders',
      body: '{"client_order_id":"$id"}',
      createdAt: DateTime(2026, 11, 11),
      summary: '콜라 1',
      total: 2000,
    );

    test('토큰 재발급(401) 동안의 주문은 거절하지 않고 보류했다가 다시 보냅니다', () async {
      var authorized = false;
      final outbox = OrderOutbox(
        send: (path, body) async {
          if (!authorized) throw KioskApiException(401, '기기 인증에 실패했습니다.');
          return {'order_id': 5};
        },
        store: MemoryJsonStore(),
      );
      final held = await outbox.submit(order('a'));
      expect(held.status, OutboxStatus.pending);
      authorized = true;
      await outbox.flush();
      expect(outbox.entries.single.status, OutboxStatus.sent);
    });

    test('전송 중에 들어온 주문도 이어서 보냅니다', () async {
      final sent = <String>[];
      final outbox = OrderOutbox(
        send: (path, body) async {
          await Future<void>.delayed(const Duration(milliseconds: 5));
          sent.add(body);
          return {'order_id': sent.length};
        },
        store: MemoryJsonStore(),
      );
      final first = outbox.submit(order('a'));
      await Future<void>.delayed(Duration.zero);
      final second = await outbox.submit(order('b'));
      await first;
      expect(second.status, OutboxStatus.sent);
    });

    KioskApi api(http.Response Function() respond) => KioskApi(
      baseUrl: 'http://10.0.0.9:8001',
      deviceId: 70,
      token: 'tok_0123456789abcdefghijklmnopqrstuvwxyzABCD',
      client: MockClient((_) async => respond()),
    );

    http.Response ok(Object body) => http.Response(
      jsonEncode(body),
      200,
      headers: {'content-type': 'application/json; charset=utf-8'},
    );

    final good = {
      'menu_version': 3,
      'menus': [
        {'id': '1', 'name': '제육덮밥', 'category': '식사', 'price': 9000},
      ],
    };

    test('읽을 수 없는 응답은 마지막 정상 메뉴를 덮지 않습니다', () async {
      final store = MemoryJsonStore();
      await CartRepositoryProbe.load(api(() => ok(good)), store);
      final broken = {
        'menus': [
          {'id': '1', 'name': '제육덮밥', 'category': '식사', 'price': -1},
        ],
      };
      await expectLater(
        CartRepositoryProbe.load(api(() => ok(broken)), store),
        throwsA(isA<FormatException>()),
      );
      final offline = CatalogRepository(
        api: KioskApi(
          baseUrl: 'http://10.0.0.9:8001',
          deviceId: 70,
          token: 'tok_0123456789abcdefghijklmnopqrstuvwxyzABCD',
          client: MockClient((_) async => throw http.ClientException('offline')),
        ),
        cache: store,
      );
      final cached = await offline.loadCatalog();
      expect(cached.menus.single.price, 9000);
    });

    test('인증 오류(401)면 저장한 메뉴로 계속 주문받습니다', () async {
      final store = MemoryJsonStore();
      await CartRepositoryProbe.load(api(() => ok(good)), store);
      final denied = await CatalogRepository(
        api: api(() => http.Response('{"detail":"x"}', 401)),
        cache: store,
      ).loadCatalog();
      expect(denied.fromCache, isTrue);
      expect(denied.menus.single.name, '제육덮밥');
    });
  });

  test('사용성 측정은 방식별 평균 탭 수·시간만 남기고 최근 기록만 유지합니다', () async {
    final log = UsabilityLog(MemoryJsonStore(), keep: 3);
    for (final (channel, taps, seconds) in [
      ('touch', 20, 60),
      ('touch', 10, 40),
      ('voice', 4, 30),
      ('voice', 6, 50),
    ]) {
      await log.add(
        UsabilityRecord(channel: channel, taps: taps, seconds: seconds, items: 2, senior: false),
      );
    }
    final summary = await log.summary();
    // 가장 오래된 1건(touch 20탭)은 지워집니다.
    expect(summary['touch']!.count, 1);
    expect(summary['touch']!.averageTaps, 10);
    expect(summary['voice']!.averageTaps, 5);
    expect(summary['voice']!.averageSeconds, 40);
    await log.clear();
    expect(await log.summary(), isEmpty);
  });
}

class CartRepositoryProbe {
  static Future<KioskCatalog> load(KioskApi api, MemoryJsonStore store) =>
      CatalogRepository(api: api, cache: store).loadCatalog();
}
