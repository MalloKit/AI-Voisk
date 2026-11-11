import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// 키오스크 접속 설정. 실행 옵션(dart-define)을 기본값으로, 관리자 설정 화면에서 바꾼 값을 우선합니다.
class KioskConfig {
  const KioskConfig({
    this.serverUrl = '',
    this.storeId = 0,
    this.deviceId = 0,
    this.token = '',
  });

  final String serverUrl;
  final int storeId;
  final int deviceId;

  /// 기기 토큰. 안드로이드 Keystore로 암호화한 저장소에만 둡니다.
  final String token;

  /// 기기 토큰까지 있으면 /kiosk API(LAN·음성·동기화)를 씁니다.
  bool get isKioskMode =>
      serverUrl.isNotEmpty && deviceId > 0 && storeId > 0 && token.length >= 20;

  static const fromEnvironment = KioskConfig(
    serverUrl: String.fromEnvironment('MENU_API_BASE_URL'),
    storeId: int.fromEnvironment('STORE_ID'),
    deviceId: int.fromEnvironment('DEVICE_ID'),
    token: String.fromEnvironment('DEVICE_TOKEN'),
  );
}

abstract class SecretStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

class SecureSecretStore implements SecretStore {
  const SecureSecretStore();
  static const _storage = FlutterSecureStorage();

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

class MemorySecretStore implements SecretStore {
  final Map<String, String> values = {};

  @override
  Future<String?> read(String key) async => values[key];

  @override
  Future<void> write(String key, String value) async => values[key] = value;

  @override
  Future<void> delete(String key) async => values.remove(key);
}

class KioskSettings {
  KioskSettings(this.prefs, this.secrets);
  final SharedPreferences prefs;
  final SecretStore secrets;

  static const _server = 'server_url';
  static const _store = 'store_id';
  static const _device = 'device_id';
  static const _token = 'device_token';
  static const _pinHash = 'admin_pin_hash';
  static const _pinSalt = 'admin_pin_salt';
  static const _lockTask = 'lock_task';
  static const _pinFailures = 'admin_pin_failures';
  static const _pinLockedUntil = 'admin_pin_locked_until';

  static Future<KioskSettings> open({
    SecretStore secrets = const SecureSecretStore(),
  }) async => KioskSettings(await SharedPreferences.getInstance(), secrets);

  Future<KioskConfig> loadConfig() async {
    const base = KioskConfig.fromEnvironment;
    String token = base.token;
    try {
      token = await secrets.read(_token) ?? base.token;
    } catch (_) {
      // 보안 저장소를 읽지 못하면(키 손상 등) 토큰을 다시 입력해야 합니다.
    }
    return KioskConfig(
      serverUrl: prefs.getString(_server) ?? base.serverUrl,
      storeId: prefs.getInt(_store) ?? base.storeId,
      deviceId: prefs.getInt(_device) ?? base.deviceId,
      token: token,
    );
  }

  Future<void> saveConfig(KioskConfig config) async {
    await prefs.setString(_server, config.serverUrl);
    await prefs.setInt(_store, config.storeId);
    await prefs.setInt(_device, config.deviceId);
    if (config.token.isEmpty) {
      await secrets.delete(_token);
    } else {
      await secrets.write(_token, config.token);
    }
  }

  bool get lockTask => prefs.getBool(_lockTask) ?? false;
  Future<void> setLockTask(bool value) => prefs.setBool(_lockTask, value);

  // ---------- 관리자 PIN ----------

  bool get hasPin => prefs.getString(_pinHash) != null;

  String _hash(String pin, String salt) {
    // PIN은 짧으므로 소금을 섞어 여러 번 해시합니다. 원문은 저장하지 않습니다.
    List<int> digest = utf8.encode('$salt:$pin');
    for (var i = 0; i < 20000; i++) {
      digest = sha256.convert(digest).bytes;
    }
    return base64Encode(digest);
  }

  static bool validPin(String pin) => RegExp(r'^\d{4,8}$').hasMatch(pin);

  Future<void> setPin(String pin) async {
    if (!validPin(pin)) throw ArgumentError('PIN은 숫자 4~8자리입니다.');
    final random = Random.secure();
    final salt = base64Encode(List.generate(16, (_) => random.nextInt(256)));
    await prefs.setString(_pinSalt, salt);
    await prefs.setString(_pinHash, _hash(pin, salt));
    await prefs.setInt(_pinFailures, 0);
  }

  /// 5번 틀리면 5분 동안 잠급니다. 남은 잠금 시간이 있으면 그 시간을 돌려줍니다.
  Duration? pinLockRemaining(DateTime now) {
    final until = prefs.getInt(_pinLockedUntil);
    if (until == null) return null;
    final remaining = DateTime.fromMillisecondsSinceEpoch(until)
        .difference(now);
    return remaining.isNegative ? null : remaining;
  }

  Future<bool> checkPin(String pin, {DateTime? now}) async {
    final moment = now ?? DateTime.now();
    if (pinLockRemaining(moment) != null) return false;
    final salt = prefs.getString(_pinSalt);
    final stored = prefs.getString(_pinHash);
    if (salt == null || stored == null) return false;
    final ok = _hash(pin, salt) == stored;
    if (ok) {
      await prefs.setInt(_pinFailures, 0);
      return true;
    }
    final failures = (prefs.getInt(_pinFailures) ?? 0) + 1;
    await prefs.setInt(_pinFailures, failures);
    if (failures >= 5) {
      await prefs.setInt(_pinFailures, 0);
      await prefs.setInt(
        _pinLockedUntil,
        moment.add(const Duration(minutes: 5)).millisecondsSinceEpoch,
      );
    }
    return false;
  }
}
