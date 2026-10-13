import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kiosk_app/main.dart';
import 'package:kiosk_app/service/controllers/cart_controller.dart';
import 'package:kiosk_app/service/models/menu_item.dart';
import 'package:kiosk_app/service/models/menu_option.dart';

void main() {
  test('추가 옵션 가격, 옵션별 분리와 수량 변경', () {
    final cart = CartController();
    addTearDown(cart.dispose);
    const menu = MenuItem(
      id: 'rice',
      name: '제육덮밥',
      category: '식사',
      price: 9000,
      description: '테스트',
    );
    final options = sampleOptions('식사');
    cart.add(menu, 2, options: [options[0], options[2]]);
    expect(cart.total, 24000);
    cart.add(menu, 1);
    expect(cart.entries.length, 2);
    cart.add(menu, 1, options: [options[2], options[0]]);
    expect(cart.entries.length, 2);
    expect(cart.total, 45000);
    final optionEntry = cart.entries.first;
    cart.setQuantity(optionEntry.id, 1);
    expect(cart.total, 21000);
    expect(cart.entries.first.options.length, 2);
    cart.remove(optionEntry.id);
    expect(cart.total, 9000);
  });
  test('동일 메뉴 합산, 수량 변경, 삭제와 합계', () {
    final cart = CartController();
    addTearDown(cart.dispose);
    const menu = MenuItem(
      id: 'rice',
      name: '제육덮밥',
      category: '식사',
      price: 9000,
      description: '테스트',
    );
    cart.add(menu, 2);
    cart.add(menu, 1);
    expect(cart.entries.length, 1);
    expect(cart.total, 27000);
    cart.setQuantity(menu.id, 2);
    expect(cart.total, 18000);
    expect(() => cart.setQuantity(menu.id, 0), throwsArgumentError);
    cart.remove(menu.id);
    expect(cart.total, 0);
    expect(cart.entries, isEmpty);
  });
  for (final size in [const Size(600, 900), const Size(1200, 800)]) {
    testWidgets('카테고리와 주문 흐름 $size', (tester) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(const MyApp());
      await tester.pumpAndSettle();
      await tester.tap(find.text('포장'));
      await tester.pumpAndSettle();
      // 언어 선택 창만 표시하고 실제 번역은 하지 않습니다.
      await tester.tap(find.text('Language'));
      await tester.pumpAndSettle();
      expect(find.text('日本語'), findsOneWidget);
      expect(find.text('English'), findsOneWidget);
      expect(find.text('中文'), findsOneWidget);
      await tester.tap(find.text('English'));
      await tester.pumpAndSettle();
      expect(find.text('English'), findsNothing);
      expect(find.text('전체 메뉴'), findsOneWidget);
      expect(find.byType(StretchingOverscrollIndicator), findsNothing);
      final gridContext = tester.element(find.byType(GridView));
      expect(
        ScrollConfiguration.of(gridContext).getScrollPhysics(gridContext),
        isA<ClampingScrollPhysics>(),
      );
      await tester.tap(find.text('음료'));
      await tester.pumpAndSettle();
      expect(find.text('콜라'), findsOneWidget);
      expect(find.text('제육덮밥'), findsNothing);
      await tester.tap(find.text('전체'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('제육덮밥'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('수량 늘리기'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('장바구니 담기'));
      await tester.pumpAndSettle();
      expect(
        tester.widget<Text>(find.byKey(const Key('cart-total'))).data,
        '18,000원',
      );
      await tester.tap(find.byTooltip('수량 늘리기'));
      await tester.pumpAndSettle();
      expect(
        tester.widget<Text>(find.byKey(const Key('cart-total'))).data,
        '27,000원',
      );
      await tester.tap(find.byTooltip('수량 줄이기'));
      await tester.pumpAndSettle();
      expect(
        tester.widget<Text>(find.byKey(const Key('cart-total'))).data,
        '18,000원',
      );
      await tester.tap(find.byTooltip('제육덮밥 삭제'));
      await tester.pumpAndSettle();
      expect(find.text('0원'), findsOneWidget);
      await tester.tap(find.text('제육덮밥'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('밥 추가'));
      await tester.pumpAndSettle();
      expect(
        tester.widget<Text>(find.byKey(const Key('selection-total'))).data,
        '선택 금액 10,000원',
      );
      await tester.tap(find.byTooltip('수량 늘리기'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('장바구니 담기'));
      await tester.pumpAndSettle();
      expect(
        tester.widget<Text>(find.byKey(const Key('cart-total'))).data,
        '20,000원',
      );
      expect(find.text('밥 추가 +1,000원'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }
}
