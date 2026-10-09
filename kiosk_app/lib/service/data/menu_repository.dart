import '../models/menu_item.dart';

/// 이후 서버 구현으로 교체할 메뉴 공급 인터페이스입니다.
abstract class MenuRepository {
  Future<List<MenuItem>> loadMenus();
}

class MockMenuRepository implements MenuRepository {
  const MockMenuRepository();
  @override
  Future<List<MenuItem>> loadMenus() async => const [
    MenuItem(
      id: 'rice-1',
      name: '제육덮밥',
      category: '식사',
      price: 9000,
      description: '매콤한 제육과 따뜻한 밥',
    ),
    MenuItem(
      id: 'rice-2',
      name: '비빔밥',
      category: '식사',
      price: 8000,
      description: '다양한 채소를 곁들인 한 그릇',
    ),
    MenuItem(
      id: 'soup-1',
      name: '순두부찌개',
      category: '국물',
      price: 8500,
      description: '부드러운 순두부와 얼큰한 국물',
    ),
    MenuItem(
      id: 'soup-2',
      name: '콩나물국밥',
      category: '국물',
      price: 7500,
      description: '콩나물이 들어간 시원한 국밥',
    ),
    MenuItem(
      id: 'side-1',
      name: '만두',
      category: '사이드',
      price: 4000,
      description: '따뜻한 만두 한 접시',
    ),
    MenuItem(
      id: 'drink-1',
      name: '콜라',
      category: '음료',
      price: 2000,
      description: '시원한 콜라',
    ),
    MenuItem(
      id: 'drink-2',
      name: '사이다',
      isSoldOut: true,
      category: '음료',
      price: 2000,
      description: '시원한 사이다',
    ),
    // 왼쪽 카테고리 목록의 스크롤 확인용 임시 메뉴입니다.
    MenuItem(
      id: 'noodle-1',
      name: '잔치국수',
      category: '면류',
      price: 7000,
      description: '따뜻한 국물의 잔치국수',
    ),
    MenuItem(
      id: 'grill-1',
      name: '불고기',
      category: '구이',
      price: 12000,
      description: '달콤한 양념 불고기',
    ),
    MenuItem(
      id: 'fried-1',
      name: '새우튀김',
      category: '튀김',
      price: 6000,
      description: '바삭한 새우튀김',
    ),
    MenuItem(
      id: 'snack-1',
      name: '떡볶이',
      category: '분식',
      price: 5000,
      description: '매콤한 떡볶이',
    ),
    MenuItem(
      id: 'salad-1',
      name: '채소 샐러드',
      category: '샐러드',
      price: 6500,
      description: '신선한 채소 샐러드',
    ),
    MenuItem(
      id: 'dessert-1',
      name: '바닐라 아이스크림',
      category: '디저트',
      price: 3000,
      description: '부드러운 바닐라 아이스크림',
    ),
    MenuItem(
      id: 'set-1',
      name: '덮밥 세트',
      category: '세트',
      price: 11000,
      description: '덮밥과 음료를 함께 제공하는 세트',
    ),
  ];
}
