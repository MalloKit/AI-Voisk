import 'package:flutter/material.dart';
// ignore: depend_on_referenced_packages
import 'package:flutter_test/flutter_test.dart';
import 'package:kiosk_app/main.dart';

void main() {
  testWidgets('품절 선택 차단과 전체 비우기 취소·확인, 결제 활성 상태', (tester) async {
    await tester.pumpWidget(const MyApp());
    await tester.pumpAndSettle();
    OutlinedButton payment() => tester.widget<OutlinedButton>(
      find.ancestor(
        of: find.text('주문 완료 (시연)'),
        matching: find.byType(OutlinedButton),
      ),
    );
    expect(payment().onPressed, isNull);
    await tester.tap(find.text('음료'));
    await tester.pumpAndSettle();
    expect(find.text('품절'), findsOneWidget);
    await tester.tap(find.text('사이다'));
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsNothing);
    await tester.tap(find.text('콜라'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('장바구니 담기'));
    await tester.pumpAndSettle();
    expect(payment().onPressed, isNotNull);
    await tester.tap(find.text('전체 비우기'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('취소'));
    await tester.pumpAndSettle();
    expect(find.text('장바구니 · 1개'), findsOneWidget);
    await tester.tap(find.text('전체 비우기'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('모두 삭제'));
    await tester.pumpAndSettle();
    expect(find.text('장바구니 · 0개'), findsOneWidget);
    expect(tester.widget<Text>(find.byKey(const Key('cart-total'))).data, '0원');
    expect(payment().onPressed, isNull);
    expect(tester.takeException(), isNull);
  });
}
