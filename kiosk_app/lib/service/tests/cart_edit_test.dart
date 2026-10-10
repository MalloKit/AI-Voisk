import 'package:flutter/material.dart';
// 서비스 폴더만 수정하기 위해 둔 테스트이며 앱 실행 코드에서는 사용하지 않습니다.
// ignore: depend_on_referenced_packages
import 'package:flutter_test/flutter_test.dart';
import 'package:kiosk_app/main.dart';

void main() {
  testWidgets('장바구니 옵션 추가·해제·취소 및 같은 조합 합치기', (tester) async {
    tester.view.physicalSize = const Size(1200, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(const MyApp());
    await tester.pumpAndSettle();
    await tester.tap(find.text('포장'));
    await tester.pumpAndSettle();
    Future<void> tap(Finder finder) async {
      await tester.tap(finder);
      await tester.pumpAndSettle();
    }

    String? total() =>
        tester.widget<Text>(find.byKey(const Key('cart-total'))).data;
    Finder entry(String id) => find.byKey(ValueKey('cart-entry-$id'));

    await tap(find.text('제육덮밥'));
    final optionScroll = find.descendant(
      of: find.byType(AlertDialog),
      matching: find.byType(SingleChildScrollView),
    ).first;
    final optionContext = tester.element(optionScroll);
    expect(ScrollConfiguration.of(optionContext)
        .buildOverscrollIndicator(optionContext, const SizedBox(),
          const ScrollableDetails(direction: AxisDirection.down)), isA<SizedBox>());
    await tap(find.text('장바구니 담기'));
    expect(total(), '9,000원');
    await tap(entry('rice-1'));
    await tap(find.text('밥 추가'));
    await tap(find.text('변경 저장'));
    expect(total(), '10,000원');
    expect(entry('rice-1:extra-rice'), findsOneWidget);

    await tap(entry('rice-1:extra-rice'));
    expect(find.text('선택 금액 10,000원'), findsOneWidget);
    await tap(find.text('밥 추가'));
    expect(find.text('선택 금액 9,000원'), findsOneWidget);
    await tap(find.text('취소'));
    expect(total(), '10,000원');

    await tap(find.text('제육덮밥').first);
    await tap(find.text('장바구니 담기'));
    expect(total(), '19,000원');
    await tap(entry('rice-1:extra-rice'));
    await tap(find.text('밥 추가'));
    await tap(find.text('변경 저장'));
    expect(total(), '18,000원');
    expect(entry('rice-1'), findsOneWidget);
    expect(entry('rice-1:extra-rice'), findsNothing);
    expect(find.text('장바구니 · 2개'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
