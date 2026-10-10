import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:company_admin_web/data/repositories/order_repository.dart';

void main() {
  const address = String.fromEnvironment('LOCAL_DEMO_API');
  test(
    '키오스크가 저장한 주문을 실제 HTTP로 관리자 목록·상세 조회',
    () async {
      final health = jsonDecode(
        (await http.get(Uri.parse('$address/test/fixture-health'))).body,
      );
      expect(health, {
        'dataSource': 'isolated-memory',
        'liveDatabaseBlocked': true,
      });
      final repo = ApiOrderRepository(baseUrl: address);
      final rows = await repo.load();
      expect(rows, hasLength(2));
      expect(rows.map((o) => o.tableNo).toSet(), {0, 3});
      for (final row in rows) {
        final detail = await repo.detail(row.id);
        expect(detail.storeName, '시연 매장');
        expect(detail.items.single['quantity'], 2);
        expect(detail.items.single['menu_name'], '메뉴');
        expect(
          detail.items.single['options'],
          hasLength(row.tableNo == 0 ? 1 : 2),
        );
        expect(detail.diningLabel, row.tableNo == 0 ? '포장' : '매장 식사 / 테이블 3번');
      }
    },
    skip: address.isEmpty
        ? '키오스크 메모리 서버 연동 테스트 실행 후 LOCAL_DEMO_API 지정 필요'
        : false,
  );
}
