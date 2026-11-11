import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

/// 서버가 저장하지 않고 거절한 요청(검증 실패·권한 없음). 같은 내용으로 재시도해도 결과가 같습니다.
class KioskApiException implements Exception {
  KioskApiException(this.status, this.message, {this.code});
  final int status;
  final String message;
  final String? code;

  bool get isRejection =>
      const {400, 401, 403, 404, 409, 413, 415, 422}.contains(status);

  @override
  String toString() => 'KioskApiException($status, $code)';
}

/// 서버에 닿지 못했거나 결과를 알 수 없음(시간 초과·5xx). 같은 요청을 나중에 다시 보내면 됩니다.
class KioskUnavailable implements Exception {
  KioskUnavailable(this.reason, {this.code});
  final String reason;
  final String? code;

  @override
  String toString() => 'KioskUnavailable($reason)';
}

/// 기기 토큰으로 /kiosk API를 호출합니다. 토큰은 헤더로만 보내고 로그·URL에 넣지 않습니다.
class KioskApi {
  KioskApi({
    required this.baseUrl,
    required this.deviceId,
    required this.token,
    this.client,
    this.timeout = const Duration(seconds: 15),
  });

  final String baseUrl;
  final int deviceId;

  /// 헤더로만 보냅니다. 화면·로그·URL에 쓰지 않습니다.
  final String token;
  final http.Client? client;
  final Duration timeout;

  Map<String, String> get authHeaders => {
    'X-Device-Id': '$deviceId',
    'Authorization': 'Bearer $token',
  };

  Uri resolve(String path) {
    final root = Uri.parse(baseUrl);
    if (!['http', 'https'].contains(root.scheme) || root.host.isEmpty) {
      throw KioskUnavailable('bad_url');
    }
    final clean = root.path.replaceFirst(RegExp(r'/$'), '');
    return root.replace(path: '$clean$path', query: null);
  }

  Uri get webSocketUri {
    final base = resolve('/kiosk/ws');
    return base.replace(scheme: base.scheme == 'https' ? 'wss' : 'ws');
  }

  Future<Object?> _send(
    String method,
    String path, {
    Object? body,
    Duration? wait,
  }) async {
    final transport = client ?? http.Client();
    final uri = resolve(path);
    try {
      final headers = {
        ...authHeaders,
        if (body != null) 'Content-Type': 'application/json',
      };
      final request = http.Request(method, uri)..headers.addAll(headers);
      if (body != null) {
        request.body = body is String ? body : jsonEncode(body);
      }
      final streamed = await transport.send(request).timeout(wait ?? timeout);
      final response = await http.Response.fromStream(streamed)
          .timeout(wait ?? timeout);
      final text = utf8.decode(response.bodyBytes);
      Object? data;
      try {
        data = text.isEmpty ? null : jsonDecode(text);
      } on FormatException {
        data = null;
      }
      if (response.statusCode >= 200 && response.statusCode < 300) return data;
      final detail = data is Map ? data['detail'] : null;
      final code = detail is Map ? detail['code'] as String? : null;
      final message = detail is Map
          ? (detail['message'] as String? ?? '요청을 처리하지 못했습니다.')
          : (detail is String ? detail : '요청을 처리하지 못했습니다.');
      if (response.statusCode >= 500 || response.statusCode == 429) {
        throw KioskUnavailable(
          message,
          code: code ?? (response.statusCode == 429 ? 'rate_limited' : null),
        );
      }
      throw KioskApiException(response.statusCode, message, code: code);
    } on KioskApiException {
      rethrow;
    } on KioskUnavailable {
      rethrow;
    } on TimeoutException {
      throw KioskUnavailable('timeout');
    } on SocketException {
      throw KioskUnavailable('offline');
    } on http.ClientException {
      throw KioskUnavailable('offline');
    } on HandshakeException {
      throw KioskUnavailable('tls');
    } finally {
      if (client == null) transport.close();
    }
  }

  Future<Map<String, dynamic>> bootstrap() async =>
      (await _send('GET', '/kiosk/bootstrap')) as Map<String, dynamic>;

  Future<int> menuVersion() async =>
      ((await _send('GET', '/kiosk/menu-version')) as Map)['menu_version']
          as int;

  Future<Map<String, dynamic>> heartbeat(
    int appliedVersion,
    String appVersion,
  ) async => (await _send(
    'POST',
    '/kiosk/heartbeat',
    body: {'applied_menu_version': appliedVersion, 'app_version': appVersion},
  )) as Map<String, dynamic>;

  /// 주문·결제 전송. body는 한 번 인코딩한 문자열을 그대로 재전송합니다(같은 UUID).
  Future<Map<String, dynamic>> postRaw(String path, String body) async =>
      (await _send('POST', path, body: body, wait: const Duration(seconds: 20)))
          as Map<String, dynamic>;

  Future<Map<String, dynamic>> interpret(Map<String, Object?> payload) async =>
      (await _send(
        'POST',
        '/kiosk/voice/interpret',
        body: payload,
        wait: const Duration(seconds: 25),
      )) as Map<String, dynamic>;

  Future<void> recommendationLog(Map<String, Object?> payload) async {
    await _send('POST', '/kiosk/rec-logs', body: payload);
  }

  Future<int> staffCall(String reason) async =>
      ((await _send('POST', '/kiosk/staff-call', body: {'reason': reason}))
              as Map)['alert_id']
          as int;

  /// 메뉴 사진 원본 바이트. 크기와 형식을 확인한 뒤에만 돌려줍니다.
  Future<List<int>> downloadImage(String path) async {
    final transport = client ?? http.Client();
    try {
      final response = await transport.get(resolve(path)).timeout(timeout);
      final type = response.headers['content-type'] ?? '';
      if (response.statusCode != 200 ||
          !type.startsWith('image/') ||
          response.bodyBytes.length > 2 * 1024 * 1024) {
        throw KioskUnavailable('image');
      }
      return response.bodyBytes;
    } on TimeoutException {
      throw KioskUnavailable('timeout');
    } on SocketException {
      throw KioskUnavailable('offline');
    } on http.ClientException {
      throw KioskUnavailable('offline');
    } finally {
      if (client == null) transport.close();
    }
  }
}
