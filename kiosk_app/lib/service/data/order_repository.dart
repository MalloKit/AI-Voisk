import 'dart:convert';
import 'dart:math';

import 'package:http/http.dart' as http;

import '../controllers/cart_controller.dart';

String newOrderUuid() {
  final random = Random.secure();
  final bytes = List.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}

class PendingOrder {
  PendingOrder({
    required List<CartEntry> entries,
    required int storeId,
    required int deviceId,
    required String orderType,
    String? clientOrderId,
    String? orderChannel,
  }) : clientOrderId = clientOrderId ?? newOrderUuid(),
       total = entries.fold(0, (sum, entry) => sum + entry.subtotal),
       summary = entries
           .map((entry) => '${entry.menu.name} ${entry.quantity}')
           .join(', ') {
    body = jsonEncode({
      'store_id': storeId,
      'device_id': deviceId,
      'client_order_id': this.clientOrderId,
      'order_type': orderType,
      'table_no': null,
      // 음성 대화로 완성한 주문은 voice. 생략하면 서버가 기록하지 않습니다.
      'order_channel': ?orderChannel,
      'items': entries
          .map(
            (entry) => {
              'menu_id': int.parse(entry.menu.id),
              'quantity': entry.quantity,
              'option_ids': entry.options.map((o) => int.parse(o.id)).toList(),
              if (entry.recommended) 'is_recommended': true,
            },
          )
          .toList(),
    });
  }

  final String clientOrderId;
  final int total;

  /// 주문내역 화면용 요약. 서버에는 보내지 않습니다.
  final String summary;

  // Encoded once: a failed retry cannot mutate the UUID or cart payload.
  late final String body;
}

abstract class OrderRepository {
  Future<int> submit(PendingOrder order);
}

/// The local server rejects these requests before saving (or fully rolls back).
class OrderValidationError extends StateError {
  OrderValidationError(super.message);
}

class ApiOrderRepository implements OrderRepository {
  ApiOrderRepository({required this.baseUrl, this.client});
  final String baseUrl;
  final http.Client? client;
  @override
  Future<int> submit(PendingOrder order) => _submit('/orders', order.body);

  Future<int> submitDemoPayment(
    PendingOrder order,
    String method,
    int amount,
  ) => _submitPayment('/payments/demo/$method', order, amount);

  Future<int> submitCashOrder(PendingOrder order, int amount) =>
      _submitPayment('/payments/cash/pending', order, amount);

  Future<int> _submitPayment(String path, PendingOrder order, int amount) =>
      _submit(
        path,
        jsonEncode({
          'order': jsonDecode(order.body),
          'expected_amount': amount,
        }),
      );

  Future<int> _submit(String path, String body) async {
    final uri = Uri.parse(baseUrl);
    if (!['http', 'https'].contains(uri.scheme) || uri.host.isEmpty) {
      throw StateError('주문 API 주소가 설정되지 않았습니다.');
    }
    final transport = client ?? http.Client();
    try {
      final response = await transport
          .post(
            uri.replace(
              path: '${uri.path.replaceFirst(RegExp(r'/$'), '')}$path',
              query: null,
            ),
            headers: {'Content-Type': 'application/json'},
            body: body,
          )
          .timeout(const Duration(seconds: 20));
      if (response.statusCode != 200) {
        final raw = jsonDecode(utf8.decode(response.bodyBytes))['detail'];
        // 서버가 {code, message}로 보내는 거절도 문구를 그대로 보여 줍니다.
        final detail = raw is Map ? raw['message'] : raw;
        if ([403, 422].contains(response.statusCode) ||
            (response.statusCode == 503 &&
                detail == '주문 유형 DB 변경이 적용되지 않았습니다. 저장하지 않았습니다.')) {
          throw OrderValidationError(
            detail is String ? detail : '주문 정보를 확인해 주세요.',
          );
        }
        throw StateError(detail is String ? detail : '주문 정보를 확인해 주세요.');
      }
      return (jsonDecode(utf8.decode(response.bodyBytes))
              as Map<String, dynamic>)['order_id']
          as int;
    } finally {
      if (client == null) transport.close();
    }
  }
}
