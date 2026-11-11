class MenuOption {
  const MenuOption({
    required this.id,
    required this.name,
    required this.price,
    this.isSoldOut = false,
    this.group,
  });
  final String id;
  final String name;
  final int price;
  final bool isSoldOut;

  /// 같은 그룹(맵기·사이즈 등)에서는 하나를 꼭 골라야 합니다. null이면 자유롭게 더하는 옵션입니다.
  final String? group;

  factory MenuOption.fromJson(Map<String, dynamic> row) {
    final price = row['price'] as int;
    if (price < 0) throw const FormatException('잘못된 옵션 가격입니다.');
    return MenuOption(
      id: row['id'] as String,
      name: row['name'] as String,
      price: price,
      isSoldOut: row['isSoldOut'] as bool? ?? false,
      group: (row['group'] as String?)?.trim().isEmpty ?? true
          ? null
          : (row['group'] as String).trim(),
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'price': price,
    'isSoldOut': isSoldOut,
    'group': group,
  };
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
