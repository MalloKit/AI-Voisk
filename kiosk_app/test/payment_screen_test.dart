import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kiosk_app/service/controllers/cart_controller.dart';
import 'package:kiosk_app/service/models/menu_item.dart';
import 'package:kiosk_app/service/screens/payment_screen.dart';

void main() {
  testWidgets('긴 주문 목록만 스크롤하며 합계와 결제 제목 위치는 유지', (tester) async {
    tester.view.physicalSize = const Size(960, 600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        home: PaymentScreen(
          entries: [
            for (var i = 0; i < 12; i++)
              CartEntry(
                MenuItem(
                  id: '$i',
                  name: '메뉴 $i',
                  category: '식사',
                  price: 1000,
                  description: '',
                ),
                1,
              ),
          ],
        ),
      ),
    );
    final total = find.byKey(const Key('payment-total'));
    final position = tester.getTopLeft(total);
    final nextPosition = tester.getTopLeft(find.text('결제 방법을 선택해 주세요'));
    final list = find.byKey(const Key('payment-order-list'));
    expect(
      tester.widget<SingleChildScrollView>(list).physics,
      isA<ClampingScrollPhysics>(),
    );
    await tester.drag(list, const Offset(0, -450));
    await tester.pumpAndSettle();
    expect(tester.getTopLeft(total), position);
    expect(tester.getTopLeft(find.text('결제 방법을 선택해 주세요')), nextPosition);
    expect(tester.widget<Text>(total).data, '12,000원');
    expect(tester.takeException(), isNull);
  });

  Future<void> open(
    WidgetTester tester, {
    Size size = const Size(1200, 800),
  }) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        home: PaymentScreen(
          orderMode: '포장',
          entries: [
            CartEntry(
              const MenuItem(
                id: '1',
                name: '비빔밥',
                category: '식사',
                price: 8000,
                description: '',
              ),
              2,
            ),
          ],
        ),
      ),
    );
  }

  testWidgets('960×600 태블릿에서 네 결제 수단이 전체 스크롤 없이 표시', (tester) async {
    await open(tester, size: const Size(960, 600));
    for (final label in [
      '카드 결제',
      '카카오페이',
      '네이버페이',
      '현금 결제',
      '결제 방법을 선택해 주세요',
    ]) {
      final rect = tester.getRect(find.text(label));
      expect(rect.top, greaterThanOrEqualTo(0));
      expect(rect.bottom, lessThanOrEqualTo(600));
    }
    expect(tester.takeException(), isNull);
  });

  testWidgets('수단 선택 즉시 이동, 실패 후 재선택, 현금은 수납 대기', (tester) async {
    await open(tester, size: const Size(960, 600));
    final sizes = PaymentMethod.values
        .map(
          (method) => tester.getSize(
            find.byKey(ValueKey('payment-method-${method.name}')),
          ),
        )
        .toList();
    expect(sizes.toSet(), hasLength(1));
    for (final method in ['카카오페이', '네이버페이']) {
      await tester.tap(find.text(method));
      await tester.pump();
      await tester.tap(find.text('결제 실패 시연'));
      await tester.pump();
      expect(find.textContaining('결제 실패 시연입니다.'), findsOneWidget);
      await tester.tap(find.text('취소 · 결제 수단 다시 선택'));
      await tester.pumpAndSettle();
    }
    await tester.tap(find.text('현금 결제'));
    await tester.pump();
    expect(find.textContaining('키오스크에서는 현금을 받지 않습니다.'), findsOneWidget);
    await tester.tap(find.text('현금 결제 안내 확인'));
    await tester.pumpAndSettle();
    expect(find.text('현금 수납 전입니다. 결제 완료 상태가 아닙니다.'), findsOneWidget);
    expect(find.text('카운터에서 결제할 금액'), findsOneWidget);
    expect(find.text('16,000원'), findsOneWidget);
    expect(find.text('포장'), findsOneWidget);
    expect(find.text('총 2개'), findsOneWidget);
    final confirm = tester.getRect(find.text('확인 · 장바구니 비우기'));
    expect(confirm.bottom, lessThanOrEqualTo(600));
    expect(tester.takeException(), isNull);
  });
}
