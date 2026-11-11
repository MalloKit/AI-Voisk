import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:kiosk_app/core/kiosk_services.dart';

/// 태블릿에 설치하는 release APK 설정을 지킵니다.
void main() {
  test('앱 버전은 pubspec.yaml의 version과 같습니다', () {
    final pubspec = File('pubspec.yaml').readAsStringSync();
    final version = RegExp(r'^version:\s*(\S+)', multiLine: true).firstMatch(pubspec)!.group(1);
    expect(appVersion, version);
  });

  test('release 빌드도 시연 LAN 서버(HTTP)에 접속할 수 있습니다', () {
    final manifest = File('android/app/src/main/AndroidManifest.xml').readAsStringSync();
    expect(manifest, contains('android:networkSecurityConfig="@xml/network_security_config"'));
    final config = File('android/app/src/main/res/xml/network_security_config.xml').readAsStringSync();
    expect(config, contains('cleartextTrafficPermitted="true"'));
  });
}
