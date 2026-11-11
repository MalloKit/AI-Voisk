import 'menu_option.dart';

/// 서버에서 받은 메뉴도 이 모델로 변환해 화면에 전달합니다.
class MenuItem {
  const MenuItem({
    required this.id,
    required this.name,
    required this.category,
    required this.price,
    required this.description,
    this.isSoldOut = false,
    this.options = const [],
    this.tags = const [],
    this.synonyms = const [],
    this.costRate,
    this.recExcluded = false,
    this.storePick = false,
    this.imageUrl,
  });
  final String id;
  final String name;
  final String category;

  /// 금액은 원 단위 정수로 계산합니다.
  final int price;
  final String description;
  final bool isSoldOut;
  final List<MenuOption> options;

  /// 상황 태그(해장, 든든한 …)와 동의어(아아, 제육 …). 점주 웹에서 관리합니다.
  final List<String> tags;
  final List<String> synonyms;

  /// 원가율(%). 낮을수록 매장 이익이 큽니다. 모르면 null입니다.
  final int? costRate;
  final bool recExcluded;
  final bool storePick;

  /// 서버 기준 상대 경로(/media/menu/…). 없으면 아이콘을 보여 줍니다.
  final String? imageUrl;

  /// 필수 옵션 그룹(그룹 이름 → 선택지). 메뉴판 순서를 지킵니다.
  Map<String, List<MenuOption>> get optionGroups {
    final groups = <String, List<MenuOption>>{};
    for (final option in options) {
      final group = option.group;
      if (group != null) groups.putIfAbsent(group, () => []).add(option);
    }
    return groups;
  }

  /// 그룹 없이 자유롭게 더하는 옵션(곱빼기·치즈 추가 등).
  List<MenuOption> get extraOptions =>
      options.where((option) => option.group == null).toList();

  /// 골라야 하는데 아직 고르지 않은 그룹 이름(메뉴판 순서).
  List<String> missingGroups(Iterable<MenuOption> chosen) {
    final picked = chosen.map((option) => option.group).toSet();
    return [
      for (final group in optionGroups.keys)
        if (!picked.contains(group)) group,
    ];
  }

  factory MenuItem.fromJson(Map<String, dynamic> row) {
    final price = row['price'] as int;
    if (price < 0) throw const FormatException('잘못된 메뉴 가격입니다.');
    final options = ((row['options'] ?? const []) as List)
        .map((value) => MenuOption.fromJson(value as Map<String, dynamic>))
        .toList();
    // 필수 그룹의 선택지가 모두 품절이면 메뉴도 주문할 수 없으므로 품절로 봅니다.
    final groups = <String, bool>{};
    for (final option in options.where((o) => o.group != null)) {
      groups[option.group!] = (groups[option.group!] ?? false) || !option.isSoldOut;
    }
    return MenuItem(
      id: row['id'] as String,
      name: row['name'] as String,
      category: row['category'] as String,
      price: price,
      description: row['description'] as String? ?? '',
      isSoldOut:
          (row['isSoldOut'] as bool? ?? false) || groups.values.contains(false),
      options: options,
      tags: _strings(row['tags']),
      synonyms: _strings(row['synonyms']),
      costRate: row['costRate'] as int?,
      recExcluded: row['recExcluded'] as bool? ?? false,
      storePick: row['storePick'] as bool? ?? false,
      imageUrl: row['imageUrl'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'category': category,
    'price': price,
    'description': description,
    'isSoldOut': isSoldOut,
    'options': options.map((option) => option.toJson()).toList(),
    'tags': tags,
    'synonyms': synonyms,
    'costRate': costRate,
    'recExcluded': recExcluded,
    'storePick': storePick,
    'imageUrl': imageUrl,
  };
}

List<String> _strings(Object? value) =>
    ((value ?? const []) as List).whereType<String>().toList();

String formatWon(int amount) =>
    '${amount.toString().replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+(?!\d))'), (match) => '${match[1]},')}원';
