import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:company_admin_web/app.dart';
import 'package:company_admin_web/data/repositories/order_repository.dart';

Map<String, dynamic> order(int id, int tableNo) => {
  'order_id': id,
  'store_id': 1,
  'store_name': '실제 매장',
  'ordered_at': DateTime.now().toUtc().toIso8601String(),
  'table_no': tableNo,
  'quantity': 2,
};

void main() {
  test('명시적 유형과 NULL 테이블, 기존 주문의 테이블 조회 호환', () {
    for (final type in ['takeaway', 'dine_in']) {
      final row = LiveOrder.fromJson({
        ...order(3, 0),
        'table_no': null,
        'order_type': type,
      });
      expect(row.tableNo, isNull);
      expect(row.diningLabel, type == 'takeaway' ? '포장' : '매장 식사');
    }
    expect(LiveOrder.fromJson(order(1, 0)).diningLabel, '포장');
    expect(LiveOrder.fromJson(order(2, 3)).diningLabel, '매장 식사 / 테이블 3번');
    expect(
      LiveOrder.fromJson({...order(4, 0), 'table_no': null}).diningLabel,
      '주문 유형 미확인',
    );
  });

  test('API 페이지 조회 및 상세 복수 옵션 매핑', () async {
    final client = MockClient((request) async {
      final offset = request.url.queryParameters['offset'];
      return http.Response(
        jsonEncode(
          request.url.path.endsWith('/1')
              ? {
                  ...order(1, 0),
                  'items': [
                    {
                      'menu_name': '메뉴',
                      'quantity': 2,
                      'options': [
                        {'name': '밥 추가'},
                        {'name': '고기 추가'},
                      ],
                    },
                  ],
                }
              : {
                  'orders': [
                    order(offset == '0' ? 1 : 2, offset == '0' ? 0 : 3),
                  ],
                  'total': 2,
                },
        ),
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
    });
    addTearDown(client.close);
    final repo = ApiOrderRepository(
      baseUrl: 'http://localhost',
      client: client,
    );
    final rows = await repo.load();
    expect(rows.length, 2);
    expect(rows.first.diningLabel, '포장');
    expect(rows.last.diningLabel, '매장 식사 / 테이블 3번');
    expect((await repo.detail(1)).items.single['options'], hasLength(2));
  });

  testWidgets('실제 주문 조회, 검색·매장·기간 필터와 복수 옵션 상세', (tester) async {
    tester.view.physicalSize = const Size(1440, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final client = MockClient(
      (request) async => http.Response(
        jsonEncode(
          request.url.path.endsWith('/1')
              ? {
                  ...order(1, 0),
                  'items': [
                    {
                      'menu_name': '메뉴',
                      'quantity': 2,
                      'options': [
                        {'name': '밥 추가'},
                        {'name': '고기 추가'},
                      ],
                    },
                  ],
                }
              : {
                  'orders': [
                    order(1, 0),
                    {...order(2, 3), 'store_id': 2, 'store_name': '실제 매장2'},
                    {
                      ...order(3, 0),
                      'ordered_at': DateTime.now()
                          .subtract(const Duration(days: 10))
                          .toUtc()
                          .toIso8601String(),
                    },
                  ],
                  'total': 3,
                },
        ),
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      ),
    );
    addTearDown(client.close);
    await tester.pumpWidget(
      CompanyAdminApp(
        orderRepository: ApiOrderRepository(
          baseUrl: 'http://localhost',
          client: client,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Mock 데이터'), findsOneWidget);
    await tester.tap(find.text('주문 조회'));
    await tester.pumpAndSettle();
    expect(find.text('실제 주문 API'), findsOneWidget);
    expect(find.text('포장'), findsOneWidget);
    expect(find.text('매장 식사 / 테이블 3번'), findsOneWidget);
    await tester.enterText(find.byType(TextField), '1');
    await tester.pumpAndSettle();
    expect(find.text('#2'), findsNothing);
    await tester.tap(find.text('상세'));
    await tester.pumpAndSettle();
    expect(find.text('옵션: 밥 추가, 고기 추가'), findsOneWidget);
    await tester.tap(find.text('닫기'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('초기화'));
    await tester.pumpAndSettle();
    expect(find.text('#2'), findsOneWidget);
    expect(find.text('#3'), findsNothing);
    await tester.tap(find.text('최근 7일'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('전체 기간').last);
    await tester.pumpAndSettle();
    expect(find.text('#3'), findsOneWidget);
    await tester.tap(find.text('전체 매장'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('실제 매장').last);
    await tester.pumpAndSettle();
    expect(find.text('#2'), findsNothing);
    expect(find.text('#3'), findsOneWidget);
    await tester.tap(find.text('매장 관리'));
    await tester.pumpAndSettle();
    expect(find.text('Mock 데이터'), findsOneWidget);
  });

  testWidgets('API 오류 시 Mock으로 대체하지 않고 재시도', (tester) async {
    tester.view.physicalSize = const Size(1440, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    var fail = true;
    final client = MockClient(
      (request) async => fail
          ? http.Response('{}', 503)
          : http.Response('{"orders":[],"total":0}', 200),
    );
    addTearDown(client.close);
    await tester.pumpWidget(
      CompanyAdminApp(
        orderRepository: ApiOrderRepository(
          baseUrl: 'http://localhost',
          client: client,
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('주문 조회'));
    await tester.pumpAndSettle();
    expect(find.text('실제 주문 조회 실패. Mock 데이터로 대체하지 않습니다.'), findsOneWidget);
    fail = false;
    await tester.tap(find.text('다시 시도'));
    await tester.pumpAndSettle();
    expect(find.text('실제 주문 목록 · 0건'), findsOneWidget);
  });
}
