import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:kiosk_app/core/json_file_store.dart';
import 'package:kiosk_app/core/kiosk_services.dart';
import 'package:kiosk_app/core/kiosk_settings.dart';
import 'package:kiosk_app/core/l10n.dart';
import 'package:kiosk_app/data/catalog_repository.dart';
import 'package:kiosk_app/data/kiosk_api.dart';
import 'package:kiosk_app/data/order_outbox.dart';
import 'package:kiosk_app/domain/catalog.dart';
import 'package:kiosk_app/domain/conversation_controller.dart';
import 'package:kiosk_app/domain/recommendation_engine.dart';
import 'package:kiosk_app/service/models/menu_item.dart';
import 'package:kiosk_app/service/screens/order_screen.dart';

import 'fakes.dart';

class FixedCatalog implements CatalogSource {
  FixedCatalog(this.catalog);
  final KioskCatalog catalog;
  @override
  KioskCatalog? current;
  @override
  Future<KioskCatalog> loadCatalog() async => current = catalog;
  @override
  Future<List<MenuItem>> loadMenus() async => catalog.menus;
}

void main() {
  late FakeVoicePort voice;
  late FakeInterpreter interpreter;
  late List<http.Request> requests;
  late KioskServices services;

  setUp(() {
    voice = FakeVoicePort();
    interpreter = FakeInterpreter();
    requests = [];
    final api = KioskApi(
      baseUrl: 'http://10.0.0.9:8001',
      deviceId: 70,
      token: 'tok_0123456789abcdefghijklmnopqrstuvwxyzABCD',
      client: MockClient((request) async {
        requests.add(request);
        return switch (request.url.path) {
          '/kiosk/staff-call' => http.Response(
            jsonEncode({'alert_id': 5, 'replayed': false}),
            200,
          ),
          _ => http.Response(
            jsonEncode({'order_id': 101, 'replayed': false}),
            200,
          ),
        };
      }),
    );
    services = KioskServices(
      config: const KioskConfig(
        serverUrl: 'http://10.0.0.9:8001',
        storeId: 1,
        deviceId: 70,
        token: 'tok_0123456789abcdefghijklmnopqrstuvwxyzABCD',
      ),
      settings: null,
      catalog: FixedCatalog(demoCatalog),
      api: api,
      outbox: OrderOutbox(send: api.postRaw, store: MemoryJsonStore()),
      voice: voice,
      interpreter: interpreter,
    );
  });

  Future<void> open(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1280, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(L10n.instance.reset);
    await tester.pumpWidget(
      MaterialApp(
        home: OrderScreen(orderMode: '포장', services: services),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('말로 주문하기 → 추천 카드 표시 → 카드를 누르면 추천 경유로 담깁니다', (tester) async {
    await open(tester);
    voice.say('해장에 좋은 거');
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
        ],
      ),
    );
    await tester.tap(find.text('말로 주문하기'));
    await tester.runAsync(() => settle());
    await tester.pump();
    expect(find.byKey(const Key('voice-panel')), findsOneWidget);
    expect(find.byKey(const Key('voice-privacy')), findsOneWidget);
    expect(find.text('“해장에 좋은 거”'), findsOneWidget);
    expect(find.byKey(const Key('rec-card-0')), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(const Key('rec-card-0')),
        matching: find.text('순두부찌개'),
      ),
      findsOneWidget,
    );
    expect(find.text('국물이 있어 속 풀기 좋아요'), findsWidgets);
    await tester.tap(find.byKey(const Key('rec-card-0')));
    await tester.runAsync(() => settle());
    await tester.pump();
    expect(
      tester.widget<Text>(find.byKey(const Key('cart-total'))).data,
      '8,500원',
    );
    expect(find.text('장바구니 · 1개'), findsOneWidget);
    expect(interpreter.logs.last['selected_menu_id'], 3);
    // 음성 패널을 닫으면 대기로 돌아갑니다.
    await tester.tap(find.text('음성 주문 끝내기'));
    await tester.runAsync(() => settle());
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('voice-panel')), findsNothing);
  });

  testWidgets('음성 확인 단계의 네/아니요 버튼으로도 담을 수 있습니다', (tester) async {
    await open(tester);
    voice.say('제육 두 개');
    interpreter.reply(
      const InterpretResult(
        intent: 'order',
        items: [InterpretedItem(menuId: '1', quantity: 2)],
      ),
    );
    await tester.tap(find.text('말로 주문하기'));
    await tester.runAsync(() => settle());
    await tester.pump();
    expect(find.text('제육덮밥 2개 담을까요?'), findsOneWidget);
    // 음성으로 처리한 메뉴는 화면에서도 강조됩니다.
    final card = tester.widget<AnimatedContainer>(
      find.byKey(const ValueKey('menu-card-1')),
    );
    expect((card.decoration as BoxDecoration).border, isNotNull);
    await tester.tap(find.byKey(const Key('voice-yes')));
    await tester.runAsync(() => settle());
    await tester.pump();
    expect(
      tester.widget<Text>(find.byKey(const Key('cart-total'))).data,
      '18,000원',
    );
    await tester.tap(find.text('음성 주문 끝내기'));
    await tester.runAsync(() => settle());
    await tester.pumpAndSettle();
  });

  testWidgets('음성으로 담은 주문은 결제 시 voice·추천 경유로 서버에 기록됩니다', (tester) async {
    await open(tester);
    voice.say('해장');
    interpreter.reply(
      const InterpretResult(
        intent: 'recommend',
        recommendations: [RecommendationCandidate(menuId: '3', fit: 95)],
      ),
    );
    await tester.tap(find.text('말로 주문하기'));
    await tester.runAsync(() => settle());
    await tester.pump();
    await tester.tap(find.byKey(const Key('rec-card-0')));
    await tester.runAsync(() => settle());
    await tester.pump();
    await tester.tap(find.text('음성 주문 끝내기'));
    await tester.runAsync(() => settle());
    await tester.pumpAndSettle();
    await tester.tap(find.text('결제하기'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('payment-method-card')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('결제'));
    await tester.runAsync(() => settle());
    await tester.pumpAndSettle();
    final request = requests.singleWhere(
      (r) => r.url.path == '/kiosk/payments/demo/card',
    );
    final body = jsonDecode(request.body) as Map<String, dynamic>;
    expect(body['expected_amount'], 8500);
    expect(body['order']['order_channel'], 'voice');
    expect(body['order']['device_id'], 70);
    expect(body['order']['items'], [
      {
        'menu_id': 3,
        'quantity': 1,
        'option_ids': <int>[],
        'is_recommended': true,
      },
    ]);
    expect(find.text('결제가 완료되었습니다'), findsOneWidget);
    expect(find.text('주문번호 101'), findsOneWidget);
    await tester.tap(find.text('확인 · 장바구니 비우기'));
    await tester.pumpAndSettle();
    expect(find.text('장바구니 · 0개'), findsOneWidget);
  });

  testWidgets('직원 호출은 서버 알림으로 보냅니다', (tester) async {
    await open(tester);
    await tester.tap(find.text('직원 호출'));
    await tester.runAsync(() => settle());
    await tester.pump();
    expect(find.text('직원을 호출했습니다'), findsOneWidget);
    expect(find.text('시연 모드에서는 실제 알림을 보내지 않습니다.'), findsNothing);
    final call = requests.singleWhere((r) => r.url.path == '/kiosk/staff-call');
    expect(jsonDecode(call.body), {'reason': 'touch'});
    await tester.tap(find.text('닫기'));
    await tester.pumpAndSettle();
  });

  testWidgets('영어 화면에서도 음성 주문은 한국어임을 알립니다', (tester) async {
    await open(tester);
    L10n.instance.language = AppLanguage.en;
    await tester.pumpAndSettle();
    expect(find.text('Order by voice'), findsOneWidget);
    await tester.tap(find.text('Order by voice'));
    await tester.pump();
    expect(find.text('Voice ordering supports Korean only.'), findsOneWidget);
    await tester.runAsync(() => settle());
    await tester.tap(find.text('End voice order'));
    await tester.runAsync(() => settle());
    await tester.pumpAndSettle();
  });

  test('추천 엔진 결과 타입이 화면 카드와 맞습니다', () {
    final ranked = const RecommendationEngine().rank(
      const [RecommendationCandidate(menuId: '3', fit: 90)],
      demoMenus,
      const StoreAiSettings(),
    );
    expect(ranked.single.menu.name, '순두부찌개');
  });
}
