import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:kiosk_app/service/data/kakaopay_repository.dart';
import 'package:kiosk_app/service/screens/kakaopay_checkout_view.dart';

void main() {
  test('콜백은 현재 결제 세션과 localhost만 허용하고 API로 전달', () {
    final repository = KakaoTestRepository(baseUrl: 'http://10.0.2.2:8001');
    expect(
      repository
          .callbackUri(
            'http://localhost:8001/payments/kakaopay/approval/abc?pg_token=test',
            'abc',
          )
          .toString(),
      'http://10.0.2.2:8001/payments/kakaopay/approval/abc?pg_token=test',
    );
    for (final url in [
      'http://localhost:8001/payments/kakaopay/approval/other?pg_token=test',
      'https://evil.example/payments/kakaopay/approval/abc?pg_token=test',
      'http://localhost:8001/admin/orders',
      'http://localhost:8001/payments/kakaopay/approval/abc',
    ]) {
      expect(repository.callbackUri(url, 'abc'), isNull);
    }
    expect(
      KakaoTestRepository.isProviderUrl(
        Uri.parse('https://online-payment.kakaopay.com/test'),
      ),
      isTrue,
    );
    expect(
      KakaoTestRepository.isProviderUrl(
        Uri.parse('https://online-payment.kakaopay.com.evil.example/test'),
      ),
      isFalse,
    );
  });

  testWidgets('공식 콜백을 서버로 전달한 뒤 승인 상태 자동 반영', (tester) async {
    var approved = false;
    Map<String, dynamic>? result;
    final client = MockClient((request) async {
      if (request.url.path.contains('/approval/')) {
        expect(request.url.host, '10.0.2.2');
        expect(request.url.queryParameters['pg_token'], 'test');
        approved = true;
        return http.Response('<h1>approved</h1>', 200);
      }
      return http.Response(
        jsonEncode({
          'payment_id': 'abc',
          'status': approved ? 'approved' : 'ready',
          'total_amount': 1000,
        }),
        200,
      );
    });
    addTearDown(client.close);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: KakaoCheckoutView(
            repository: KakaoTestRepository(
              baseUrl: 'http://10.0.2.2:8001',
              client: client,
            ),
            paymentId: 'abc',
            checkoutUrl: 'https://online-payment.kakaopay.com/test',
            onResult: (value) => result = value,
            webViewBuilder: (callback) => TextButton(
              onPressed: () => callback(
                'http://localhost:8001/payments/kakaopay/approval/abc?pg_token=test',
              ),
              child: const Text('모의 인증 완료'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('모의 인증 완료'));
    await tester.pumpAndSettle();
    expect(result?['status'], 'approved');
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('서버 승인 상태를 주기적으로 확인하고 대기 취소 가능', (tester) async {
    var status = 'ready';
    Map<String, dynamic>? result;
    final client = MockClient((request) async {
      if (request.url.path.contains('/abandon/')) status = 'cancelled';
      return http.Response(
        jsonEncode({
          'payment_id': 'abc',
          'status': status,
          'total_amount': 1000,
        }),
        200,
      );
    });
    addTearDown(client.close);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: KakaoCheckoutView(
            repository: KakaoTestRepository(
              baseUrl: 'http://10.0.2.2:8001',
              client: client,
            ),
            paymentId: 'abc',
            checkoutUrl: 'https://online-payment.kakaopay.com/test',
            onResult: (value) => result = value,
            webViewBuilder: (_) => const Text('공식 QR 화면 자리'),
          ),
        ),
      ),
    );
    await tester.pump(const Duration(seconds: 3));
    await tester.pumpAndSettle();
    expect(find.text('남은 시간 정보 없음 · API 서버를 재시작해 주세요.'), findsOneWidget);
    expect(result, isNull);
    await tester.tap(find.text('결제 대기 취소'));
    await tester.pumpAndSettle();
    expect(find.text('결제 대기를 취소할까요?'), findsOneWidget);
    expect(result, isNull);
    expect(status, 'ready');
    await tester.tap(find.text('계속 결제하기'));
    await tester.pumpAndSettle();
    expect(find.text('공식 QR 화면 자리'), findsOneWidget);
    expect(status, 'ready');
    await tester.tap(find.text('결제 대기 취소'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('대기 취소하기'));
    await tester.pumpAndSettle();
    expect(result?['status'], 'cancelled');
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets('남은 시간은 감소하고 만료 확인 전에는 재결제를 만들지 않음', (tester) async {
    Map<String, dynamic>? result;
    var expired = false;
    final client = MockClient(
      (request) async => http.Response(
        jsonEncode({
          'payment_id': 'abc',
          'status': expired ? 'expired' : 'ready',
          'total_amount': 1000,
          'expires_in': expired ? 0 : 1,
        }),
        200,
      ),
    );
    addTearDown(client.close);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: KakaoCheckoutView(
            repository: KakaoTestRepository(
              baseUrl: 'http://10.0.2.2:8001',
              client: client,
            ),
            paymentId: 'abc',
            checkoutUrl: 'https://online-payment.kakaopay.com/test',
            expiresIn: 1,
            onResult: (value) => result = value,
            webViewBuilder: (_) => const Text('QR 테스트 영역'),
          ),
        ),
      ),
    );
    expect(find.text('남은 시간 00:01'), findsOneWidget);
    final originalStyle = tester
        .widget<Text>(find.byKey(const Key('kakaopay-countdown')))
        .style;
    await tester.pump(const Duration(seconds: 1));
    await tester.pump();
    expect(find.textContaining('남은 시간 00:00'), findsOneWidget);
    expect(find.text('QR 테스트 영역'), findsNothing);
    expect(result, isNull);
    expect(
      tester.widget<Text>(find.byKey(const Key('kakaopay-countdown'))).style,
      originalStyle,
    );
    expired = true;
    await tester.pump(const Duration(seconds: 1));
    await tester.pumpAndSettle();
    expect(result?['status'], 'expired');
    await tester.pumpWidget(const SizedBox());
    expect(tester.takeException(), isNull);
  });
}
