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
        // 설정은 관리자 PIN을 거치는 키오스크 설정 하나입니다. 서버 연결 없이 실행하면 안내만 보여 줍니다.
        await tester.tap(find.text('설정'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('키오스크 설정'));
        await tester.pumpAndSettle();
        expect(find.text('앱을 서버 연결 설정으로 실행하면 사용할 수 있습니다.'), findsOneWidget);
        await tester.tap(find.text('닫기'));
        await tester.pumpAndSettle();
        for (var i = 0; i < 2; i++) {
          await tester.tap(find.text('글자 크게'));
          await tester.pumpAndSettle();
        }
        expect(find.text('120%'), findsOneWidget);
        final menuContext = tester.element(find.text('제육덮밥').first);
        expect(
          MediaQuery.textScalerOf(menuContext).scale(20),
          closeTo(24, 0.01),
        );
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
