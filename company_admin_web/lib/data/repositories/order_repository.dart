import 'dart:convert';

import 'package:http/http.dart' as http;

class LiveOrder {
  LiveOrder.fromJson(Map<String, dynamic> row)
    : id = row['order_id'] as int,
      storeId = row['store_id'] as int,
      storeName = row['store_name'] as String,
      orderedAt = DateTime.parse(row['ordered_at'] as String).toLocal(),
      tableNo = row['table_no'] as int,
      quantity = (row['quantity'] as num?)?.toInt() ?? 0,
      items = List<Map<String, dynamic>>.from(row['items'] as List? ?? []);
  final int id, storeId, tableNo, quantity;
  final String storeName;
  final DateTime orderedAt;
  final List<Map<String, dynamic>> items;
  String get diningLabel => tableNo == 0 ? '포장' : '매장 식사 / 테이블 $tableNo번';
}

abstract class OrderRepository {
  Future<List<LiveOrder>> load();
  Future<LiveOrder> detail(int id);
}

class ApiOrderRepository implements OrderRepository {
  ApiOrderRepository({required this.baseUrl, this.client});
  final String baseUrl;
  final http.Client? client;
  Future<Map<String, dynamic>> _get(
    String path, [
    Map<String, String>? query,
  ]) async {
    final uri = Uri.parse(baseUrl);
    if (!['http', 'https'].contains(uri.scheme) || uri.host.isEmpty) {
      throw StateError('주문 API 주소를 확인해 주세요.');
    }
    final transport = client ?? http.Client();
    try {
      final response = await transport
          .get(
            uri.replace(
              path: '${uri.path.replaceFirst(RegExp(r'/$'), '')}$path',
              queryParameters: query,
            ),
          )
          .timeout(const Duration(seconds: 20));
      if (response.statusCode != 200) {
        throw StateError('실제 주문을 조회하지 못했습니다. 서버 연결을 확인해 주세요.');
      }
      return jsonDecode(utf8.decode(response.bodyBytes))
          as Map<String, dynamic>;
    } finally {
      if (client == null) transport.close();
    }
  }

  @override
  Future<List<LiveOrder>> load() async {
    final result = <LiveOrder>[];
    int total;
    do {
      final page = await _get('/admin/orders', {
        'limit': '200',
        'offset': '${result.length}',
      });
      final rows = (page['orders'] as List)
          .map((row) => LiveOrder.fromJson(row as Map<String, dynamic>))
          .toList();
      total = page['total'] as int;
      result.addAll(rows);
      if (rows.isEmpty) break;
    } while (result.length < total);
    return result;
  }

  @override
  Future<LiveOrder> detail(int id) async =>
      LiveOrder.fromJson(await _get('/admin/orders/$id'));
}

OrderRepository? configuredOrderRepository() {
  const address = String.fromEnvironment('ORDER_API_BASE_URL');
  return address.isEmpty ? null : ApiOrderRepository(baseUrl: address);
}
