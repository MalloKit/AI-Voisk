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
      category: '음료',
      price: 2000,
      description: '시원한 사이다',
    ),
  ];
}
