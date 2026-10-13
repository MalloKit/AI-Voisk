import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:kiosk_app/service/controllers/cart_controller.dart';
import 'package:kiosk_app/service/data/order_repository.dart';
import 'package:kiosk_app/service/models/menu_item.dart';
import 'package:kiosk_app/service/models/menu_option.dart';

void main() {
  const address = String.fromEnvironment('LOCAL_DEMO_API');
  test('실제 HTTP → FastAPI → 메모리 DB 저장 및 UUID 재전송', () async {
    final health = jsonDecode(
      (await http.get(Uri.parse('$address/test/fixture-health'))).body,
    );
    expect(health, {
      'dataSource': 'isolated-memory',
      'liveDatabaseBlocked': true,
    });
    final repo = ApiOrderRepository(baseUrl: address);
    for (final mode in ['takeaway', 'dine_in']) {
      final pending = PendingOrder(
        entries: [
          CartEntry(
            const MenuItem(
              id: '10',
              name: '메뉴',
              category: '식사',
              price: 1,
              description: '',
            ),
            2,
            mode == 'takeaway'
                ? const [MenuOption(id: '101', name: '추가', price: 0)]
                : const [
                    MenuOption(id: '101', name: '추가', price: 0),
                    MenuOption(id: '102', name: '추가2', price: 0),
                  ],
          ),
        ],
        storeId: 1,
        deviceId: 7,
        orderType: mode,
      );
      final id = await repo.submit(pending);
      expect(await repo.submit(pending), id);
    }
  }, skip: address.isEmpty ? '메모리 서버 실행 후 LOCAL_DEMO_API 지정 필요' : false);
}
