import 'package:flutter/material.dart';
// 공통 테스트 폴더를 수정하지 않고 미리보기 폴더에만 둔 검사입니다.
// ignore: depend_on_referenced_packages
import 'package:flutter_test/flutter_test.dart';
import 'package:kiosk_app/main_preview.dart';

void main() {
  for (final size in [const Size(1200, 750), const Size(600, 900)]) {
    testWidgets('역할 안내와 고객 서비스 진입·복귀 $size', (tester) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(const PreviewApp());
      await tester.pumpAndSettle();
      for (final role in ['관리자', '점주']) {
        await tester.ensureVisible(find.text(role));
        await tester.tap(find.text(role));
        await tester.pumpAndSettle();
        expect(find.text('$role 기능'), findsOneWidget);
        expect(find.text('준비 중입니다.'), findsOneWidget);
        await tester.tap(find.text('닫기'));
        await tester.pumpAndSettle();
      }
      await tester.ensureVisible(find.text('고객 서비스'));
      await tester.tap(find.text('고객 서비스'));
      await tester.pumpAndSettle();
      expect(find.text('AI 보이스크 · 메뉴 주문'), findsOneWidget);
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.text('고객 서비스'), findsOneWidget);
      expect(find.text('관리자'), findsOneWidget);
      expect(find.text('점주'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }
}
