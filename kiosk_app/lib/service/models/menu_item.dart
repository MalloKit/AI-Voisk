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

  factory MenuItem.fromJson(Map<String, dynamic> row) {
    final price = row['price'] as int;
    if (price < 0) throw const FormatException('잘못된 메뉴 가격입니다.');
    return MenuItem(
      id: row['id'] as String,
      name: row['name'] as String,
      category: row['category'] as String,
      price: price,
      description: row['description'] as String? ?? '',
      isSoldOut: row['isSoldOut'] as bool? ?? false,
      options: ((row['options'] ?? const []) as List)
          .map((value) => MenuOption.fromJson(value as Map<String, dynamic>))
          .toList(),
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
