import 'dart:convert';
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:kiosk_app/service/controllers/cart_controller.dart';
import 'package:kiosk_app/service/data/order_repository.dart';
import 'package:kiosk_app/service/models/menu_item.dart';
import 'package:kiosk_app/service/models/menu_option.dart';
import 'package:kiosk_app/service/screens/checkout_dialog.dart';

final entries = [
  CartEntry(
    const MenuItem(
      id: '10',
      name: '메뉴',
      category: '식사',
      price: 1,
      description: '',
    ),
    2,
    const [
      MenuOption(id: '101', name: '추가', price: 999),
      MenuOption(id: '102', name: '추가2', price: 999),
    ],
  ),
];

void main() {
  test('가격 없이 복수 옵션 전송, 실패 재시도 UUID 유지', () async {
    final bodies = <String>[];
    final client = MockClient((request) async {
      bodies.add(request.body);
      return bodies.length == 1
          ? http.Response(
              '{"detail":"실패"}',
              503,
              headers: {'content-type': 'application/json; charset=utf-8'},
            )
          : http.Response('{"order_id":77,"replayed":true}', 200);
    });
    final repo = ApiOrderRepository(
      baseUrl: 'http://localhost:8000',
      client: client,
    );
    final pending = PendingOrder(
      entries: entries,
      storeId: 1,
      deviceId: 7,
      tableNo: 0,
    );
    await expectLater(repo.submit(pending), throwsStateError);
    expect(await repo.submit(pending), 77);
    expect(bodies[0], bodies[1]);
    final payload = jsonDecode(bodies[0]);
    expect(payload['table_no'], 0);
    expect(payload['order_type'], 'takeaway');
    expect(payload['items'], [
      {
        'menu_id': 10,
        'quantity': 2,
        'option_ids': [101, 102],
      },
    ]);
    expect(
      payload['client_order_id'],
      matches(
        RegExp(
          r'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$',
        ),
      ),
    );
    client.close();
  });

  testWidgets('매장 식사 테이블 검증, 저장 중 중복 클릭 차단, 실패 후 재시도', (tester) async {
    final bodies = <String>[];
    final firstResponse = Completer<http.Response>();
    final client = MockClient((request) async {
      bodies.add(request.body);
      return bodies.length == 1
          ? await firstResponse.future
          : http.Response('{"order_id":77}', 200);
    });
    addTearDown(client.close);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => TextButton(
              onPressed: () => showDialog<int>(
                context: context,
                barrierDismissible: false,
                builder: (_) => CheckoutDialog(
                  entries: entries,
                  repository: ApiOrderRepository(
                    baseUrl: 'http://localhost',
                    client: client,
                  ),
                  storeId: 1,
                  deviceId: 7,
                  orderMode: '매장 식사',
                ),
              ),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('주문 저장'));
    await tester.pumpAndSettle();
    expect(bodies, isEmpty);
    expect(find.text('매장 식사는 1 이상의 테이블 번호를 입력해 주세요.'), findsOneWidget);
    await tester.enterText(find.byType(TextField), '3');
    await tester.tap(find.text('주문 저장'));
    await tester.tap(find.text('주문 저장'));
    await tester.pump();
    await tester.tap(find.text('저장 중…'));
    firstResponse.complete(http.Response('{"detail":"retry"}', 503));
    await tester.pumpAndSettle();
    expect(bodies.length, 1);
    expect(find.text('같은 주문 재시도'), findsOneWidget);
    await tester.tap(find.text('같은 주문 재시도'));
    await tester.pumpAndSettle();
    expect(bodies[0], bodies[1]);
    expect(jsonDecode(bodies[0])['table_no'], 3);
    expect(find.text('주문 번호 #77'), findsOneWidget);
    await tester.tap(find.text('확인'));
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsNothing);
  });

  testWidgets('포장은 테이블 입력 없이 0 전송', (tester) async {
    final client = MockClient((request) async {
      expect(jsonDecode(request.body)['table_no'], 0);
      return http.Response('{"order_id":78}', 200);
    });
    addTearDown(client.close);
    await tester.pumpWidget(
      MaterialApp(
        home: CheckoutDialog(
          entries: entries,
          repository: ApiOrderRepository(
            baseUrl: 'http://localhost',
            client: client,
          ),
          storeId: 1,
          deviceId: 7,
          orderMode: '포장',
        ),
      ),
    );
    expect(find.byType(TextField), findsNothing);
    await tester.tap(find.text('주문 저장'));
    await tester.pumpAndSettle();
    expect(find.text('주문 번호 #78'), findsOneWidget);
  });

  testWidgets('확정된 검증 거절은 주문 수정 가능, 같은 주문 재시도 UUID 유지', (tester) async {
    final bodies = <String>[];
    final client = MockClient((request) async {
      bodies.add(request.body);
      return http.Response('{"detail":"invalid"}', 422);
    });
    addTearDown(client.close);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => TextButton(
              onPressed: () => showDialog<int>(
                context: context,
                barrierDismissible: false,
                builder: (_) => CheckoutDialog(
                  entries: entries,
                  repository: ApiOrderRepository(
                    baseUrl: 'http://localhost',
                    client: client,
                  ),
                  storeId: 1,
                  deviceId: 7,
                ),
              ),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('주문 저장'));
    await tester.pumpAndSettle();
    expect(find.text('주문 수정'), findsOneWidget);
    await tester.tap(find.text('같은 주문 재시도'));
    await tester.pumpAndSettle();
    expect(bodies[0], bodies[1]);
    await tester.tap(find.text('주문 수정'));
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsNothing);
  });
}
