import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:company_admin_web/app.dart';
import 'package:company_admin_web/data/admin_data.dart';
import 'package:company_admin_web/data/admin_snapshot.dart';
import 'package:company_admin_web/data/future/models/device.dart';
import 'package:company_admin_web/data/future/models/device_alert.dart';
import 'package:company_admin_web/data/repositories/admin_repository.dart';
import 'package:company_admin_web/data/repositories/mock_admin_repository.dart';
import 'package:company_admin_web/data/sources/mock_admin_data_source.dart';
import 'package:company_admin_web/widgets/admin_widgets.dart';

import 'admin_ui_test.dart' show openApp;

class ControlledRepository implements AdminRepository {
  final delegate = MockAdminRepository(MockAdminDataSource());
  int failures = 0;
  bool failAcknowledgement = false;
  Completer<AdminSnapshot>? pending;
  @override
  Future<AdminSnapshot> load() async {
    if (failures > 0) {
      failures--;
      throw StateError('Test load failure');
    }
    if (pending != null) return pending!.future;
    return delegate.load();
  }

  @override
  Future<void> acknowledgeAlert(String id) async {
    if (failAcknowledgement) throw StateError('Test acknowledgement failure');
    await delegate.acknowledgeAlert(id);
  }
}

void main() {
  test(
    'Future samples link to stores and acknowledgement keeps device offline',
    () async {
      final at = DateTime(2026, 10, 5, 10);
      final repo = MockAdminRepository(MockAdminDataSource(clock: () => at));
      final before = AdminData(await repo.load());
      for (final device in before.devices) {
        expect(before.store(device.storeId).id, device.storeId);
      }
      for (final alert in before.alerts) {
        expect(before.device(alert.deviceId).id, alert.deviceId);
      }
      await repo.acknowledgeAlert('AL-1006');
      final after = AdminData(await repo.load());
      expect(before.alerts.first.status, AlertStatus.unconfirmed);
      expect(after.alerts.first.status, AlertStatus.acknowledged);
      expect(after.alerts.first.acknowledgedAt, at);
      expect(after.device('VK-SEO-002').connection, DeviceConnection.offline);
      await repo.acknowledgeAlert('AL-1006');
      expect((await repo.load()).alerts.first.acknowledgedAt, at);
      expect(
        (await MockAdminRepository(
          MockAdminDataSource(),
        ).load()).alerts.first.status,
        AlertStatus.unconfirmed,
      );
      await expectLater(repo.acknowledgeAlert('missing'), throwsStateError);
    },
  );

  testWidgets('Device filters, detail and no connection history', (
    tester,
  ) async {
    await openApp(tester);
    await tester.tap(find.byKey(const ValueKey('nav-devices')));
    await tester.pumpAndSettle();
    expect(find.text('기기 목록 · 6대'), findsOneWidget);
    await tester.tap(find.text('전체').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('오프라인').last);
    await tester.pumpAndSettle();
    expect(find.text('기기 목록 · 3대'), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'VK-SEO-006');
    await tester.pumpAndSettle();
    expect(find.text('연결 이력 없음'), findsOneWidget);
    await tester.tap(find.widgetWithText(OutlinedButton, '상세'));
    await tester.pumpAndSettle();
    expect(find.text('기기 VK-SEO-006'), findsOneWidget);
    expect(find.text('마지막 연결 시각'), findsOneWidget);
    await tester.tap(find.widgetWithText(OutlinedButton, '닫기'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'unknown');
    await tester.pumpAndSettle();
    expect(find.textContaining('조건에 맞는 결과가 없습니다.'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'Alert acknowledgement updates list and survives screen navigation',
    (tester) async {
      await openApp(tester);
      await tester.tap(find.byKey(const ValueKey('nav-alerts')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'AL-1006');
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(OutlinedButton, '상세'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(OutlinedButton, '확인 완료로 표시'));
      await tester.pumpAndSettle();
      expect(find.text('확인 시각'), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, '확인 완료로 표시'), findsNothing);
      await tester.tap(find.widgetWithText(OutlinedButton, '닫기'));
      await tester.pumpAndSettle();
      expect(find.text('확인 완료'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('nav-devices')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'VK-SEO-002');
      await tester.pumpAndSettle();
      expect(find.text('오프라인'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('nav-alerts')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'AL-1006');
      await tester.pumpAndSettle();
      expect(find.text('확인 완료'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('Alert type and status filters combine and reset', (
    tester,
  ) async {
    await openApp(tester);
    await tester.tap(find.byKey(const ValueKey('nav-alerts')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('전체').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('업데이트 필요').last);
    await tester.pumpAndSettle();
    expect(find.text('알림 목록 · 1건'), findsOneWidget);
    await tester.tap(find.text('전체').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('해소됨').last);
    await tester.pumpAndSettle();
    expect(find.textContaining('조건에 맞는 결과가 없습니다.'), findsOneWidget);
    await tester.tap(find.widgetWithText(OutlinedButton, '초기화'));
    await tester.pumpAndSettle();
    expect(find.text('알림 목록 · 6건'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Repository failure shows retry and recovers', (tester) async {
    final repo = ControlledRepository()..failures = 1;
    await tester.pumpWidget(CompanyAdminApp(repository: repo));
    await tester.pumpAndSettle();
    expect(find.text('데이터를 불러오지 못했습니다.'), findsOneWidget);
    await tester.tap(find.widgetWithText(OutlinedButton, '다시 시도'));
    await tester.pumpAndSettle();
    expect(find.text('시연 데이터'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Async repository loading is visible', (tester) async {
    final repo = ControlledRepository()..pending = Completer<AdminSnapshot>();
    await tester.pumpWidget(CompanyAdminApp(repository: repo));
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    repo.pending!.complete(await repo.delegate.load());
    await tester.pumpAndSettle();
    expect(find.text('시연 데이터'), findsOneWidget);
  });

  testWidgets(
    'Failed acknowledgement can be retried without changing device state',
    (tester) async {
      await openApp(tester);
      final repo = ControlledRepository()..failAcknowledgement = true;
      await tester.pumpWidget(CompanyAdminApp(repository: repo));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('nav-alerts')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'AL-1006');
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(OutlinedButton, '상세'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(OutlinedButton, '확인 완료로 표시'));
      await tester.pumpAndSettle();
      expect(find.text('확인 처리에 실패했습니다. 다시 시도해 주세요.'), findsOneWidget);
      repo.failAcknowledgement = false;
      await tester.tap(find.widgetWithText(OutlinedButton, '확인 완료로 표시'));
      await tester.pumpAndSettle();
      expect(find.text('확인 시각'), findsOneWidget);
      expect(
        find.byWidgetPredicate(
          (widget) =>
              widget is DetailField &&
              widget.label == '기기 연결 상태' &&
              widget.value == '오프라인',
        ),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );
}
