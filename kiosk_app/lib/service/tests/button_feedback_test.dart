import 'package:flutter/material.dart';
// 서비스 폴더만 수정하기 위해 둔 테스트이며 앱 실행 코드에서는 사용하지 않습니다.
// ignore: depend_on_referenced_packages
import 'package:flutter_test/flutter_test.dart';
import 'package:kiosk_app/main.dart';

void main() {
  testWidgets('담기 알림은 정중앙에 표시되고 자동으로 사라짐', (tester) async {
    await tester.pumpWidget(const MyApp());
    await tester.pumpAndSettle();
    await tester.tap(find.text('제육덮밥'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('장바구니 담기'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    final notice = find.byKey(const Key('center-notice'));
    expect(notice, findsOneWidget);
    expect(find.text('제육덮밥 1개를 담았습니다.'), findsOneWidget);
    expect(find.byType(SnackBar), findsNothing);
    expect(tester.getCenter(notice), tester.getCenter(find.byType(Scaffold)));
    await tester.pumpAndSettle();
    expect(notice, findsNothing);
  });
  testWidgets('직원 호출 자동 닫기와 수동 닫기', (tester) async {
    await tester.pumpWidget(const MyApp());
    await tester.pumpAndSettle();
    await tester.tap(find.text('직원 호출'));
    await tester.pumpAndSettle();
    expect(find.text('직원을 호출했습니다'), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 2600));
    await tester.pumpAndSettle();
    expect(find.text('직원을 호출했습니다'), findsNothing);
    await tester.tap(find.text('직원 호출'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('닫기'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('제육덮밥'));
    await tester.pumpAndSettle();
    await tester.pump(const Duration(seconds: 3));
    expect(find.text('장바구니 담기'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('버튼 색상 전환만 실행하며 주문 금액은 유지', (tester) async {
    await tester.pumpWidget(const MyApp());
    await tester.pumpAndSettle();
    for (final label in ['직원 호출', '마이크', '주문내역', '결제하기']) {
      final finder = find
          .ancestor(
            of: find.text(label),
            matching: find.byWidgetPredicate(
              (widget) => widget is ButtonStyleButton,
            ),
          )
          .first;
      Color? color() => tester
          .widget<Material>(
            find.descendant(of: finder, matching: find.byType(Material)).first,
          )
          .color;
      final initial = color();
      final gesture = await tester.startGesture(
        tester.getCenter(find.text(label)),
      );
      await tester.pumpAndSettle();
      expect(color(), isNot(initial));
      await gesture.up();
      await tester.pumpAndSettle();
      if (label == '직원 호출') {
        await tester.tap(find.text('닫기'));
        await tester.pumpAndSettle();
      }
      expect(color(), initial);
      expect(
        tester.widget<Text>(find.byKey(const Key('cart-total'))).data,
        '0원',
      );
    }
    expect(tester.takeException(), isNull);
  });
}
