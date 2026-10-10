import '../models.dart';

// Fixed dates keep demonstrations and period filters reproducible.
abstract final class MockData {
  static final referenceDate = DateTime(2026, 10, 3);
  static const admins = [
    CompanyAdmin(id: 1, name: '김지안'),
    CompanyAdmin(id: 2, name: '박도윤'),
  ];
  static const owners = [
    Owner(id: 1, loginId: 'mallo_cafe'),
    Owner(id: 2, loginId: 'seoul_kitchen'),
    Owner(id: 3, loginId: 'green_table'),
    Owner(id: 4, loginId: 'new_owner'),
  ];
  static const stores = [
    Store(
      id: 1,
      name: '말로 카페 성수',
      address: '서울 성동구 성수이로 10',
      addressDetail: '1층',
      postcode: '04782',
      phone: '02-000-1001',
      businessNo: '0000000001',
      representative: '이서준',
      type: '카페',
      adminId: 1,
      ownerId: 1,
    ),
    Store(
      id: 2,
      name: '서울 한끼',
      address: '서울 마포구 월드컵북로 20',
      addressDetail: '2층',
      postcode: '03992',
      phone: '02-000-1002',
      businessNo: '0000000002',
      representative: '최하린',
      type: '한식',
      adminId: 2,
      ownerId: 2,
    ),
    Store(
      id: 3,
      name: '그린 테이블',
      address: '서울 강남구 테헤란로 30',
      addressDetail: '',
      postcode: '06234',
      phone: '02-000-1003',
      businessNo: '0000000003',
      representative: '정유진',
      type: '샐러드',
      adminId: 1,
      ownerId: 3,
    ),
    Store(
      id: 4,
      name: '말로 카페 연남',
      address: '서울 마포구 동교로 40',
      addressDetail: '1층',
      postcode: '03983',
      phone: '02-000-1004',
      businessNo: '0000000004',
      representative: '이서준',
      type: '카페',
      adminId: 1,
      ownerId: 1,
    ),
    Store(
      id: 5,
      name: '온기 분식',
      address: '서울 송파구 백제고분로 50',
      addressDetail: '',
      postcode: '05560',
      phone: '02-000-1005',
      businessNo: '0000000005',
      representative: '한지우',
      type: '분식',
      adminId: 2,
    ),
    Store(
      id: 6,
      name: '모닝 베이커리',
      address: '서울 서초구 서초대로 60',
      addressDetail: '상가 101호',
      postcode: '06600',
      phone: '02-000-1006',
      businessNo: '0000000006',
      representative: '윤수아',
      type: '베이커리',
      adminId: 2,
    ),
  ];
  static const menus = [
    Menu(id: 1, name: '아메리카노'),
    Menu(id: 2, name: '카페라떼'),
    Menu(id: 3, name: '제육덮밥'),
    Menu(id: 4, name: '된장찌개'),
    Menu(id: 5, name: '치킨 샐러드'),
    Menu(id: 6, name: '떡볶이'),
    Menu(id: 7, name: '크루아상'),
    Menu(id: 8, name: '아메리카노'),
  ];
  static const options = [MenuOption(id: 1, menuId: 1, name: '샷 추가')];
  static final orders = [
    Order(
      id: 1008,
      storeId: 1,
      orderedAt: DateTime(2026, 10, 3, 14, 32),
      tableNo: 3,
    ),
    Order(
      id: 1007,
      storeId: 2,
      orderedAt: DateTime(2026, 10, 3, 13, 15),
      tableNo: 2,
    ),
    Order(
      id: 1006,
      storeId: 3,
      orderedAt: DateTime(2026, 10, 3, 12, 40),
      tableNo: 5,
    ),
    Order(
      id: 1005,
      storeId: 4,
      orderedAt: DateTime(2026, 10, 2, 10, 20),
      tableNo: 1,
    ),
    Order(
      id: 1004,
      storeId: 5,
      orderedAt: DateTime(2026, 9, 30, 16, 5),
      tableNo: 4,
    ),
    Order(
      id: 1003,
      storeId: 6,
      orderedAt: DateTime(2026, 9, 28, 9, 10),
      tableNo: 2,
    ),
    Order(
      id: 1002,
      storeId: 2,
      orderedAt: DateTime(2026, 9, 15, 12, 30),
      tableNo: 3,
    ),
    Order(
      id: 1001,
      storeId: 1,
      orderedAt: DateTime(2026, 8, 31, 11, 20),
      tableNo: 1,
    ),
  ];
  static const items = [
    OrderItem(id: 1, orderId: 1008, menuId: 1, quantity: 2, optionId: 1),
    OrderItem(id: 2, orderId: 1008, menuId: 2, quantity: 1),
    OrderItem(id: 3, orderId: 1007, menuId: 3, quantity: 2),
    OrderItem(id: 4, orderId: 1006, menuId: 5, quantity: 1),
    OrderItem(id: 5, orderId: 1005, menuId: 8, quantity: 3),
    OrderItem(id: 6, orderId: 1004, menuId: 6, quantity: 2),
    OrderItem(id: 7, orderId: 1003, menuId: 7, quantity: 4),
    OrderItem(id: 8, orderId: 1002, menuId: 4, quantity: 1),
    OrderItem(id: 9, orderId: 1001, menuId: 1, quantity: 1),
  ];
}
