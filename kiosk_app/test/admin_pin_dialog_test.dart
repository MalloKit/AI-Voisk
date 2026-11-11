import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kiosk_app/core/kiosk_settings.dart';
import 'package:kiosk_app/screens/settings_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

Future<KioskSettings> _settings() async {
  SharedPreferences.setMockInitialValues({});
  return KioskSettings(
    await SharedPreferences.getInstance(),
    MemorySecretStore(),
  );
}

// 버튼을 누르면 관리자 PIN 창을 열고 결과를 받아 둡니다.
Future<List<bool>> _open(
  WidgetTester tester,
  KioskSettings settings, {
  String deviceToken = '',
}) async {
  final results = <bool>[];
  await tester.pumpWidget(
    MaterialApp(
      home: Builder(
        builder: (context) => ElevatedButton(
          onPressed: () async => results.add(
            await askAdminPin(context, settings, deviceToken: deviceToken),
          ),
          child: const Text('설정 열기'),
        ),
      ),
    ),
  );
  await tester.tap(find.text('설정 열기'));
  await tester.pumpAndSettle();
  return results;
}

void main() {
  // 닫히는 애니메이션 중에 입력칸 컨트롤러를 먼저 정리하면 오류 화면이 났습니다.
  testWidgets('PIN을 만들고 창이 다 닫힐 때까지 오류가 없다', (tester) async {
    final settings = await _settings();
    final results = await _open(tester, settings);
    expect(find.text('관리자 PIN 만들기'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('pin-field')), '1234');
    await tester.enterText(find.byKey(const Key('pin-confirm-field')), '1234');
    await tester.tap(find.text('확인'));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('관리자 PIN 만들기'), findsNothing);
    expect(results, [true]);
    expect(settings.hasPin, isTrue);
  });

  testWidgets('PIN 창을 취소해도 오류가 없다', (tester) async {
    final settings = await _settings();
    final results = await _open(tester, settings);
    await tester.enterText(find.byKey(const Key('pin-field')), '12');
    await tester.tap(find.text('취소'));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(results, [false]);
    expect(settings.hasPin, isFalse);
  });

  testWidgets('토큰이 있는 기기는 토큰이 맞아야 PIN을 만든다', (tester) async {
    final settings = await _settings();
    final results = await _open(tester, settings, deviceToken: 'secret-token');
    await tester.enterText(find.byKey(const Key('pin-token-field')), 'wrong');
    await tester.enterText(find.byKey(const Key('pin-field')), '1234');
    await tester.enterText(find.byKey(const Key('pin-confirm-field')), '1234');
    await tester.tap(find.text('확인'));
    await tester.pumpAndSettle();
    expect(find.text('기기 토큰이 맞지 않습니다.'), findsOneWidget);

    await tester.enterText(
      find.byKey(const Key('pin-token-field')),
      'secret-token',
    );
    await tester.tap(find.text('확인'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(results, [true]);
  });

  testWidgets('PIN을 틀리면 창에 남고, 맞으면 오류 없이 닫힌다', (tester) async {
    final settings = await _settings();
    await settings.setPin('2468');
    final results = await _open(tester, settings);
    expect(find.text('관리자 PIN 입력'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('pin-field')), '1111');
    await tester.tap(find.text('확인'));
    await tester.pumpAndSettle();
    expect(find.text('PIN이 맞지 않습니다.'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('pin-field')), '2468');
    await tester.tap(find.text('확인'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(results, [true]);
  });
}
