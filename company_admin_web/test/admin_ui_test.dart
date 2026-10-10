import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:company_admin_web/app.dart';
import 'package:company_admin_web/data/admin_data.dart';
import 'package:company_admin_web/data/repositories/mock_admin_repository.dart';
import 'package:company_admin_web/data/sources/mock_admin_data_source.dart';

Future<void> openApp(
  WidgetTester tester, {
  Size size = const Size(1440, 1000),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(const CompanyAdminApp());
  await tester.pumpAndSettle();
}

void main() {
  test(
    'Mock periods and one owner with multiple stores stay consistent',
    () async {
      final data = AdminData(
        await MockAdminRepository(MockAdminDataSource()).load(),
      );
      expect(data.ordersForDays(1).length, 3);
      expect(data.ordersForDays(7).length, 6);
      expect(data.ordersForDays(30).length, 7);
      expect(data.ordersForDays(null).length, 8);
      expect(data.storesForOwner(1).length, 2);
      expect(data.quantityForOrder(1008), 3);
      for (final order in data.orders) {
        expect(data.store(order.storeId).id, order.storeId);
        expect(data.itemsForOrder(order.id), isNotEmpty);
        for (final item in data.itemsForOrder(order.id)) {
          expect(data.menu(item.menuId).id, item.menuId);
          if (item.optionId != null) {
            expect(data.option(item.optionId)!.menuId, item.menuId);
          }
        }
      }
    },
  );

  testWidgets('Store search, detail, empty results and reset', (tester) async {
    await openApp(tester);
    expect(find.text('시연 데이터'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('nav-stores')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), '말로 카페 성수');
    await tester.pumpAndSettle();
    expect(find.text('매장 목록 · 1곳'), findsOneWidget);
    await tester.tap(find.widgetWithText(OutlinedButton, '상세'));
    await tester.pumpAndSettle();
    expect(find.text('매장 기본 정보'), findsOneWidget);
    expect(find.text('mallo_cafe'), findsOneWidget);
    await tester.tap(find.widgetWithText(OutlinedButton, '닫기'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), '없는 매장');
    await tester.pumpAndSettle();
    expect(find.textContaining('조건에 맞는 결과가 없습니다.'), findsOneWidget);
    await tester.tap(find.widgetWithText(OutlinedButton, '초기화'));
    await tester.pumpAndSettle();
    expect(find.text('매장 목록 · 6곳'), findsOneWidget);
    await tester.tap(find.byTooltip('다음 페이지'));
    await tester.pumpAndSettle();
    expect(find.text('6–6 / 6건'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Owner connections and order details are read only', (
    tester,
  ) async {
    await openApp(tester);
    await tester.tap(find.byKey(const ValueKey('nav-owners')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'mallo_cafe');
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(OutlinedButton, '연결 매장'));
    await tester.pumpAndSettle();
    expect(find.text('연결 매장 · 2곳'), findsOneWidget);
    await tester.tap(find.widgetWithText(OutlinedButton, '닫기'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('nav-orders')));
    await tester.pumpAndSettle();
    expect(find.text('주문 목록 · 6건'), findsOneWidget);
    await tester.enterText(find.byType(TextField), '1008');
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(OutlinedButton, '상세'));
    await tester.pumpAndSettle();
    expect(find.text('주문 #1008'), findsOneWidget);
    expect(find.text('옵션: 샷 추가'), findsOneWidget);
    expect(find.text('아메리카노 · 2개'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Order period and store filters combine and reset', (
    tester,
  ) async {
    await openApp(tester);
    await tester.tap(find.byKey(const ValueKey('nav-orders')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('최근 7일'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('기준일').last);
    await tester.pumpAndSettle();
    expect(find.text('주문 목록 · 3건'), findsOneWidget);
    await tester.tap(find.text('전체 매장'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('서울 한끼').last);
    await tester.pumpAndSettle();
    expect(find.text('주문 목록 · 1건'), findsOneWidget);
    expect(find.text('#1007'), findsOneWidget);
    await tester.enterText(find.byType(TextField), '1008');
    await tester.pumpAndSettle();
    expect(find.textContaining('조건에 맞는 결과가 없습니다.'), findsOneWidget);
    await tester.tap(find.widgetWithText(OutlinedButton, '초기화'));
    await tester.pumpAndSettle();
    expect(find.text('주문 목록 · 6건'), findsOneWidget);
    expect(find.text('최근 7일'), findsOneWidget);
    expect(find.text('전체 매장'), findsOneWidget);
  });

  testWidgets('Narrow screen uses drawer and horizontally scrolling tables', (
    tester,
  ) async {
    await openApp(tester, size: const Size(390, 844));
    expect(find.byTooltip('메뉴 열기'), findsOneWidget);
    expect(tester.takeException(), isNull);
    for (final page in ['stores', 'owners', 'orders', 'devices', 'alerts']) {
      await tester.tap(find.byTooltip('메뉴 열기'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(ValueKey('nav-$page')));
      await tester.pumpAndSettle();
      expect(find.byType(Drawer), findsNothing);
      expect(tester.takeException(), isNull);
    }
  });
}
