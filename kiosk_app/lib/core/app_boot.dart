import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'kiosk_services.dart';
import 'kiosk_settings.dart';

/// 실제 기기 실행 준비: 가로 고정, 시스템 바 숨김, 서비스 조립, 동기화 시작, 화면 고정 복원.
/// 위젯 테스트는 이 함수를 부르지 않으므로 서비스 없이 로컬 시연 방식으로 동작합니다.
Future<void> bootKiosk() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.landscapeLeft,
    DeviceOrientation.landscapeRight,
  ]);
  await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
  final settings = await KioskSettings.open();
  final services = KioskServices.current = await KioskServices.boot(settings);
  services.sync?.start();
  if (settings.lockTask) unawaited(services.system.startLockTask());
}
