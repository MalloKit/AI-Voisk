import 'dart:convert';

import 'package:http/http.dart' as http;

import 'order_repository.dart';

/// 키는 서버에만 저장합니다. 이 저장소는 개발용 결제 API만 호출합니다.
class KakaoTestRepository {
  KakaoTestRepository({required this.baseUrl, this.client});
  final String baseUrl;
  final http.Client? client;

  Future<Map<String, dynamic>> request(String path, {String? body}) async {
    final root = Uri.tryParse(baseUrl);
    if (root == null ||
        !['http', 'https'].contains(root.scheme) ||
        root.host.isEmpty) {
      throw StateError('로컬 API 주소를 확인해 주세요.');
    }
    final transport = client ?? http.Client();
    try {
      final uri = root.replace(
        path:
            '${root.path.replaceFirst(RegExp(r'/$'), '')}/payments/kakaopay/$path',
        query: null,
      );
      final response =
          await (body == null
                  ? transport.get(uri)
                  : transport.post(
                      uri,
                      headers: {'Content-Type': 'application/json'},
                      body: body,
                    ))
              .timeout(const Duration(seconds: 40));
      final result = jsonDecode(utf8.decode(response.bodyBytes));
      if (response.statusCode != 200) {
        throw StateError(
          result is Map && result['detail'] is String
              ? result['detail'] as String
              : '결제 요청을 확인해 주세요.',
        );
      }
      return result as Map<String, dynamic>;
    } finally {
      if (client == null) transport.close();
    }
  }

  Future<Map<String, dynamic>> ready(PendingOrder order) =>
      request('ready', body: order.body);
  Future<Map<String, dynamic>> status(String id) =>
      request('status/${Uri.encodeComponent(id)}');
  Future<Map<String, dynamic>> abandon(String id) =>
      request('abandon/${Uri.encodeComponent(id)}', body: '{}');
  Future<Map<String, dynamic>> retrySave(String id) =>
      request('save/${Uri.encodeComponent(id)}', body: '{}');

  static bool isProviderUrl(Uri uri) =>
      uri.scheme == 'https' &&
      uri.userInfo.isEmpty &&
      (uri.port == 443) &&
      ['kakaopay.com', 'kakao.com'].any((host) => uri.host.endsWith('.$host'));

  /// 결제창의 localhost 콜백만 에뮬레이터가 접근하는 API 주소로 전달합니다.
  /// 콜백 URL을 임의의 목적지에 요청하는 프록시로 사용하지 않습니다.
  Uri? callbackUri(String url, String paymentId) {
    final incoming = Uri.tryParse(url);
    final root = Uri.tryParse(baseUrl);
    if (incoming == null ||
        root == null ||
        incoming.scheme != 'http' ||
        incoming.host != 'localhost' ||
        incoming.port != 8001 ||
        incoming.userInfo.isNotEmpty ||
        !['http', 'https'].contains(root.scheme) ||
        root.host.isEmpty) {
      return null;
    }
    final paths = [
      'approval',
      'cancel',
      'fail',
    ].map((kind) => '/payments/kakaopay/$kind/$paymentId');
    if (!paths.contains(incoming.path)) return null;
    final pg = incoming.queryParameters['pg_token'];
    if (incoming.path.contains('/approval/') &&
        (pg == null || pg.isEmpty || pg.length > 1024)) {
      return null;
    }
    return root
        .replace(
          path: '${root.path.replaceFirst(RegExp(r'/$'), '')}${incoming.path}',
          queryParameters: pg == null ? {} : {'pg_token': pg},
          fragment: '',
        )
        .removeFragment();
  }

  Future<Map<String, dynamic>> finishCallback(String url, String id) async {
    final target = callbackUri(url, id);
    if (target == null) throw StateError('허용되지 않은 결제 콜백입니다.');
    final transport = client ?? http.Client();
    try {
      final response = await transport
          .get(target)
          .timeout(const Duration(seconds: 40));
      if (response.statusCode != 200) {
        throw StateError('승인 결과를 확인하지 못했습니다. 결과 확인을 다시 눌러 주세요.');
      }
    } finally {
      if (client == null) transport.close();
    }
    return status(id);
  }
}
