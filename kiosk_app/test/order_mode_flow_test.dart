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
    testWidgets('시작 선택 $mode → 복수 옵션 → 확인 → 저장 → 주문번호', (tester) async {
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
      await tester.tap(find.text('주문 완료 (시연)'));
      await tester.pumpAndSettle();
      expect(find.text('주문 방식: $mode'), findsOneWidget);
      expect(find.byType(SegmentedButton<String>), findsNothing);
      expect(find.byType(TextField), findsNothing);
      expect(find.text('제육덮밥 · 2개'), findsOneWidget);
      expect(find.text('옵션: 밥 추가, 계란 추가'), findsOneWidget);
      await tester.tap(find.text('주문 저장'));
      await tester.pumpAndSettle();
      expect(requests, hasLength(1));
      expect(
        requests.single['order_type'],
        mode == '포장' ? 'takeaway' : 'dine_in',
      );
      expect(requests.single['table_no'], isNull);
      expect(requests.single['items'], [
        {
          'menu_id': 1,
          'quantity': 2,
          'option_ids': [1, 2],
        },
      ]);
      expect(find.text('주문 번호 #81'), findsOneWidget);
      await tester.tap(find.text('확인'));
      await tester.pumpAndSettle();
      expect(find.text('0원'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }
}
