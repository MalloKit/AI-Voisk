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
  });
  final String id;
  final String name;
  final String category;

  /// 금액은 원 단위 정수로 계산합니다.
  final int price;
  final String description;
  final bool isSoldOut;
  final List<MenuOption> options;
}

String formatWon(int amount) =>
    '${amount.toString().replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+(?!\d))'), (match) => '${match[1]},')}원';
