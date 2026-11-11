import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:kiosk_app/home/role_select_screen.dart';
import 'package:kiosk_app/service/data/api_menu_repository.dart';
import 'package:kiosk_app/service/data/order_repository.dart';
import 'package:kiosk_app/service/models/menu_item.dart';
import 'package:kiosk_app/service/models/menu_option.dart';

class DemoMenuRepository extends ApiMenuRepository {
  DemoMenuRepository() : super(baseUrl: 'http://localhost', storeId: 1);
  @override
  Future<List<MenuItem>> loadMenus() async => const [
    MenuItem(
      id: '1',
      name: '제육덮밥',
      category: '식사',
      price: 9000,
      description: '',
      options: [
        MenuOption(id: '1', name: '밥 추가', price: 1000),
        MenuOption(id: '2', name: '계란 추가', price: 1000),
      ],
    ),
  ];
}

void main() {
  for (final mode in ['포장', '매장 식사']) {
    testWidgets('시작 선택 $mode → 복수 옵션 → 결제 시연, 실제 주문 요청 없음', (tester) async {
      tester.view.physicalSize = const Size(1200, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final requests = <Map<String, dynamic>>[];
      final client = MockClient((request) async {
        requests.add(jsonDecode(request.body) as Map<String, dynamic>);
        return http.Response('{"order_id":81}', 200);
      });
      addTearDown(client.close);
      await tester.pumpWidget(
        MaterialApp(
          home: RoleSelectScreen(
            menuRepository: DemoMenuRepository(),
            orderRepository: ApiOrderRepository(
              baseUrl: 'http://localhost',
              client: client,
            ),
            storeId: 1,
            deviceId: 1,
          ),
        ),
      );
      await tester.tap(find.text(mode));
      await tester.pumpAndSettle();
      await tester.tap(find.text('제육덮밥'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('밥 추가'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('계란 추가'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('수량 늘리기'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('장바구니 담기'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('결제하기'));
      await tester.pumpAndSettle();
      expect(find.text(mode), findsOneWidget);
      expect(find.byType(SegmentedButton<String>), findsNothing);
      expect(find.byType(TextField), findsNothing);
      expect(find.text('제육덮밥 · 2개'), findsOneWidget);
      expect(find.text('밥 추가 +1,000원, 계란 추가 +1,000원'), findsOneWidget);
      expect(
        tester.widget<Text>(find.byKey(const Key('payment-total'))).data,
        '22,000원',
      );
      await tester.tap(find.text('카드 결제'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('결제'));
      await tester.pumpAndSettle();
      expect(requests, isEmpty);
      expect(find.text('결제가 완료되었습니다'), findsOneWidget);
      await tester.tap(find.text('확인 · 장바구니 비우기'));
      await tester.pumpAndSettle();
      // 다음 고객이 포장/매장 식사를 다시 고르도록 처음 화면으로 돌아갑니다.
      expect(find.text('포장'), findsOneWidget);
      expect(find.text('매장 식사'), findsOneWidget);
      expect(find.text('결제하기'), findsNothing);
      expect(tester.takeException(), isNull);
    });
  }
}
