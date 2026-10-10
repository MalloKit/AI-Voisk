class MenuOption {
  const MenuOption({
    required this.id,
    required this.name,
    required this.price,
    this.isSoldOut = false,
  });
  final String id;
  final String name;
  final int price;
  final bool isSoldOut;
}

/// 메뉴 한 개당 적용되는 임시 추가 옵션입니다.
List<MenuOption> sampleOptions(String category) => switch (category) {
  '식사' => const [
    MenuOption(id: 'extra-rice', name: '밥 추가', price: 1000),
    MenuOption(id: 'egg', name: '계란 추가', price: 1000),
    MenuOption(id: 'extra-meat', name: '고기 추가', price: 2000),
  ],
  '국물' => const [
    MenuOption(id: 'extra-rice', name: '공깃밥 추가', price: 1000),
    MenuOption(id: 'tofu', name: '두부 추가', price: 1500),
  ],
  '사이드' => const [MenuOption(id: 'sauce', name: '소스 추가', price: 500)],
  _ => const [],
};
