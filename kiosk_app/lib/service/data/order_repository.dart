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
    required int tableNo,
    String? clientOrderId,
  }) : body = jsonEncode({
         'store_id': storeId,
         'device_id': deviceId,
         'client_order_id': clientOrderId ?? newOrderUuid(),
         'order_type': tableNo == 0 ? 'takeaway' : 'dine_in',
         'table_no': tableNo,
         'items': entries
             .map(
               (entry) => {
                 'menu_id': int.parse(entry.menu.id),
                 'quantity': entry.quantity,
                 'option_ids': entry.options
                     .map((o) => int.parse(o.id))
                     .toList(),
               },
             )
             .toList(),
       });
  // Encoded once: a failed retry cannot mutate the UUID or cart payload.
  final String body;
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
  Future<int> submit(PendingOrder order) async {
    final uri = Uri.parse(baseUrl);
    if (!['http', 'https'].contains(uri.scheme) || uri.host.isEmpty) {
      throw StateError('주문 API 주소가 설정되지 않았습니다.');
    }
    final transport = client ?? http.Client();
    try {
      final response = await transport
          .post(
            uri.replace(
              path: '${uri.path.replaceFirst(RegExp(r'/$'), '')}/orders',
              query: null,
            ),
            headers: {'Content-Type': 'application/json'},
            body: order.body,
          )
          .timeout(const Duration(seconds: 20));
      if (response.statusCode != 200) {
        final detail = jsonDecode(utf8.decode(response.bodyBytes))['detail'];
        if ([403, 422].contains(response.statusCode)) {
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
