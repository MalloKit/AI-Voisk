import 'package:flutter/material.dart';
// ignore: depend_on_referenced_packages
import 'package:flutter_test/flutter_test.dart';
import 'package:kiosk_app/main_preview.dart';

void main() {
  for (final size in [const Size(1200, 750), const Size(600, 900)]) {
    testWidgets('식사 방식 선택, 설정, 글자 크기와 복귀 $size', (tester) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(const PreviewApp());
      await tester.pumpAndSettle();
      expect(find.text('관리자'), findsNothing);
      for (final mode in ['포장', '매장 식사']) {
        await tester.tap(find.text(mode));
        await tester.pumpAndSettle();
        expect(find.text('AI 보이스크 · 메뉴 주문 · $mode'), findsOneWidget);
        for (final role in ['관리자', '점주']) {
          await tester.tap(find.text('설정'));
          await tester.pumpAndSettle();
          expect(find.text('서비스'), findsNothing);
          await tester.tap(find.text(role));
          await tester.pumpAndSettle();
          if (role != '서비스') {
            expect(find.text('$role 기능'), findsOneWidget);
            await tester.tap(find.text('닫기'));
            await tester.pumpAndSettle();
          }
        }
        for (var i = 0; i < 2; i++) {
          await tester.tap(find.text('글자 크게'));
          await tester.pumpAndSettle();
        }
        expect(find.text('120%'), findsOneWidget);
        final menuContext = tester.element(find.text('제육덮밥').first);
        expect(MediaQuery.textScalerOf(menuContext).scale(20), closeTo(24, 0.01));
        await tester.tap(find.text('제육덮밥').first);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        await tester.tap(find.text('취소'));
        await tester.pumpAndSettle();
        for (var i = 0; i < 3; i++) {
          await tester.tap(find.text('글자 작게'));
          await tester.pumpAndSettle();
        }
        expect(find.text('90%'), findsOneWidget);
        await tester.pageBack();
        await tester.pumpAndSettle();
        expect(find.text('포장'), findsOneWidget);
        expect(find.text('매장 식사'), findsOneWidget);
        expect(tester.takeException(), isNull);
      }
    });
  }
}
