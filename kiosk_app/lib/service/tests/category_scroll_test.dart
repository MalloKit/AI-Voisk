import 'package:flutter/material.dart';
// ignore: depend_on_referenced_packages
import 'package:flutter_test/flutter_test.dart';
import 'package:kiosk_app/main.dart';

void main() {
  testWidgets('카테고리 끝까지 스크롤하고 선택 후 위로 복귀', (tester) async {
    tester.view.physicalSize = const Size(1200, 750);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(const MyApp());
    await tester.pumpAndSettle();
    final list = find.byKey(const Key('category-list'));
    final scrollable = find.descendant(
      of: list,
      matching: find.byType(Scrollable),
    );
    final position = tester.state<ScrollableState>(scrollable).position;
    expect(position.maxScrollExtent, greaterThan(0));
    final scrollbarFinder = find.byKey(const Key('category-scrollbar'));
    final scrollbar = tester.widget<RawScrollbar>(scrollbarFinder);
    expect(scrollbar.thumbVisibility, isTrue);
    expect(scrollbar.interactive, isTrue);
    final bounds = tester.getRect(scrollbarFinder);
    final contentHeight = position.viewportDimension + position.maxScrollExtent;
    final thumbHeight =
        position.viewportDimension * position.viewportDimension / contentHeight;
    final gesture = await tester.startGesture(
      Offset(bounds.right - 5, bounds.top + thumbHeight / 2),
    );
    await gesture.moveBy(const Offset(0, 120));
    await gesture.up();
    await tester.pumpAndSettle();
    expect(position.pixels, greaterThan(0));
    scrollbar.controller!.jumpTo(0);
    await tester.pumpAndSettle();
    await tester.drag(list, const Offset(0, -1000));
    await tester.pumpAndSettle();
    expect(position.pixels, greaterThan(0));
    await tester.tap(find.text('세트'));
    await tester.pumpAndSettle();
    expect(find.text('덮밥 세트'), findsOneWidget);
    expect(find.text('제육덮밥'), findsNothing);
    await tester.tap(find.text('덮밥 세트'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('장바구니 담기'));
    await tester.pumpAndSettle();
    expect(
      tester.widget<Text>(find.byKey(const Key('cart-total'))).data,
      '11,000원',
    );
    await tester.drag(list, const Offset(0, 1000));
    await tester.pumpAndSettle();
    await tester.tap(find.text('전체'));
    await tester.pumpAndSettle();
    expect(find.text('전체 메뉴'), findsOneWidget);
    expect(find.text('제육덮밥'), findsOneWidget);
    expect(find.text('설정'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
