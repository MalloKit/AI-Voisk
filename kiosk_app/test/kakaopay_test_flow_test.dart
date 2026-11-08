import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:kiosk_app/service/controllers/cart_controller.dart';
import 'package:kiosk_app/service/data/kakaopay_repository.dart';
import 'package:kiosk_app/service/models/menu_item.dart';
import 'package:kiosk_app/service/screens/payment_screen.dart';

void main() {
  testWidgets('테스트 결제 준비와 서버 승인 결과로만 완료, 주문 API 호출 없음', (tester) async {
    tester.view.physicalSize = const Size(1200, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final paths = <String>[];
    var approved = false;
    final client = MockClient((request) async {
      paths.add(request.url.path);
      if (request.method == 'POST') {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body.containsKey('price'), isFalse);
        expect(body['items'], [
          {'menu_id': 1, 'quantity': 2, 'option_ids': []},
        ]);
      }
      return http.Response(
        jsonEncode({
          'payment_id': 'fake-session',
          'status': approved ? 'approved' : 'ready',
          'total_amount': 16000,
          'browser_url':
              'http://localhost:8001/payments/kakaopay/browser/fake-session',
        }),
        200,
      );
    });
    addTearDown(client.close);
    await tester.pumpWidget(
      MaterialApp(
        home: PaymentScreen(
          orderMode: '포장',
          storeId: 1,
          deviceId: 1,
          kakaoRepository: KakaoTestRepository(
            baseUrl: 'http://localhost:8001',
            client: client,
          ),
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
    await tester.tap(find.text('카카오페이'));
    await tester.pumpAndSettle();
    expect(find.text('결제 성공 시연'), findsNothing);
    expect(find.text('PC 결제 주소 복사'), findsOneWidget);
    expect(find.text('카카오페이 테스트 승인 완료'), findsNothing);
    await tester.tap(find.text('결제 결과 확인'));
    await tester.pumpAndSettle();
    expect(find.text('카카오페이 테스트 승인 완료'), findsNothing);
    approved = true;
    await tester.tap(find.text('결제 결과 확인'));
    await tester.pumpAndSettle();
    expect(find.text('카카오페이 테스트 승인 완료'), findsOneWidget);
    expect(
      paths.every((path) => path.startsWith('/payments/kakaopay/')),
      isTrue,
    );
    expect(tester.takeException(), isNull);
  });
  for (final outcome in ['cancelled', 'failed', 'expired', 'unknown']) {
    testWidgets('결제 $outcome 상태에서 장바구니와 재시도 정책 유지', (tester) async {
      tester.view.physicalSize = const Size(1200, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final orderIds = <String>[];
      final client = MockClient((request) async {
        final preparing = request.url.path.endsWith('/ready');
        if (preparing) {
          final body = jsonDecode(request.body) as Map<String, dynamic>;
          orderIds.add(body['client_order_id'] as String);
          expect(body['items'], [
            {'menu_id': 1, 'quantity': 2, 'option_ids': []},
          ]);
        }
        return http.Response(
          jsonEncode({
            'payment_id': 'session-${orderIds.length}',
            'status': preparing ? 'ready' : outcome,
            'total_amount': 16000,
          }),
          200,
        );
      });
      addTearDown(client.close);
      await tester.pumpWidget(
        MaterialApp(
          home: PaymentScreen(
            orderMode: '포장',
            storeId: 1,
            deviceId: 1,
            kakaoRepository: KakaoTestRepository(
              baseUrl: 'http://localhost:8001',
              client: client,
            ),
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
      await tester.tap(find.text('카카오페이'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('결제 결과 확인'));
      await tester.pumpAndSettle();
      expect(find.text('카카오페이 테스트 승인 완료'), findsNothing);
      expect(find.text('비빔밥 · 2개'), findsOneWidget);
      if (outcome == 'unknown') {
        expect(find.text('카카오페이 다시 시도'), findsNothing);
        final button = tester.widget<TextButton>(
          find.widgetWithText(TextButton, '결제 수단 다시 선택'),
        );
        expect(button.onPressed, isNull);
      } else {
        expect(find.text('카카오페이 다시 시도'), findsOneWidget);
        await tester.tap(find.text('카카오페이 다시 시도'));
        await tester.pumpAndSettle();
        expect(orderIds, hasLength(2));
        expect(orderIds.first, isNot(orderIds.last));
      }
      expect(tester.takeException(), isNull);
    });
  }
}
