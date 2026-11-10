import 'package:flutter/foundation.dart';

import '../models/menu_item.dart';
import '../models/menu_option.dart';

class CartEntry {
  CartEntry(
    this.menu,
    this.quantity, [
    List<MenuOption> options = const [],
    this.recommended = false,
  ]) : options = List.unmodifiable(options);
  final MenuItem menu;
  final int quantity;
  final List<MenuOption> options;

  /// 추천 카드에서 고른 품목이면 true. 주문 전송 시 추천 경유 매출로 집계합니다.
  final bool recommended;
  String get id {
    final ids = options.map((option) => option.id).toList()..sort();
    return ids.isEmpty ? menu.id : '${menu.id}:${ids.join(',')}';
  }

  int get unitPrice =>
      menu.price + options.fold(0, (sum, option) => sum + option.price);
  int get subtotal => unitPrice * quantity;
}

/// 장바구니 상태. 터치와 음성 모두 domain/order_commands.dart의 명령을 거쳐 이 메서드를 호출합니다.
class CartController extends ChangeNotifier {
  final Map<String, CartEntry> _entries = {};
  List<CartEntry> get entries => List.unmodifiable(_entries.values);
  int get total =>
      _entries.values.fold(0, (sum, entry) => sum + entry.subtotal);
  int get itemCount =>
      _entries.values.fold(0, (sum, entry) => sum + entry.quantity);

  CartEntry? entry(String entryId) => _entries[entryId];

  void add(
    MenuItem menu,
    int quantity, {
    List<MenuOption> options = const [],
    bool recommended = false,
  }) {
    if (menu.isSoldOut) throw StateError('품절 메뉴는 담을 수 없습니다.');
    if (quantity < 1) throw ArgumentError.value(quantity, 'quantity');
    final entry = CartEntry(menu, quantity, options);
    final existing = _entries[entry.id];
    _entries[entry.id] = CartEntry(
      menu,
      (existing?.quantity ?? 0) + quantity,
      options,
      recommended || (existing?.recommended ?? false),
    );
    notifyListeners();
  }

  void setQuantity(String entryId, int quantity) {
    final entry = _entries[entryId];
    if (entry == null) return;
    if (quantity < 1) throw ArgumentError.value(quantity, 'quantity');
    _entries[entryId] = CartEntry(
      entry.menu,
      quantity,
      entry.options,
      entry.recommended,
    );
    notifyListeners();
  }

  /// 기존 항목을 수정하며, 같은 메뉴·옵션 항목이 있으면 수량을 합칩니다.
  void update(
    String entryId,
    int quantity, {
    required List<MenuOption> options,
  }) {
    final original = _entries[entryId];
    if (original == null) return;
    if (quantity < 1) throw ArgumentError.value(quantity, 'quantity');
    final updated = CartEntry(original.menu, quantity, options);
    _entries.remove(entryId);
    final existing = _entries[updated.id];
    _entries[updated.id] = CartEntry(
      original.menu,
      quantity + (existing?.quantity ?? 0),
      options,
      original.recommended || (existing?.recommended ?? false),
    );
    notifyListeners();
  }

  void remove(String entryId) {
    if (_entries.remove(entryId) != null) notifyListeners();
  }

  void clear() {
    if (_entries.isEmpty) return;
    _entries.clear();
    notifyListeners();
  }

  /// 명령 되돌리기용. 항목 순서를 포함해 이전 상태로 복원합니다.
  List<CartEntry> snapshot() => List.of(_entries.values);

  void restore(List<CartEntry> entries) {
    _entries
      ..clear()
      ..addEntries(entries.map((entry) => MapEntry(entry.id, entry)));
    notifyListeners();
  }
}
