import 'package:flutter/foundation.dart';

import '../models/menu_item.dart';
import '../models/menu_option.dart';

class CartEntry {
  CartEntry(this.menu, this.quantity, [List<MenuOption> options = const []])
    : options = List.unmodifiable(options);
  final MenuItem menu;
  final int quantity;
  final List<MenuOption> options;
  String get id {
    final ids = options.map((option) => option.id).toList()..sort();
    return ids.isEmpty ? menu.id : '${menu.id}:${ids.join(',')}';
  }

  int get unitPrice =>
      menu.price + options.fold(0, (sum, option) => sum + option.price);
  int get subtotal => unitPrice * quantity;
}

/// 터치와 향후 음성 기능에서 같은 메서드를 호출합니다.
class CartController extends ChangeNotifier {
  final Map<String, CartEntry> _entries = {};
  List<CartEntry> get entries => List.unmodifiable(_entries.values);
  int get total =>
      _entries.values.fold(0, (sum, entry) => sum + entry.subtotal);
  int get itemCount =>
      _entries.values.fold(0, (sum, entry) => sum + entry.quantity);

  void add(MenuItem menu, int quantity, {List<MenuOption> options = const []}) {
    if (quantity < 1) throw ArgumentError.value(quantity, 'quantity');
    final entry = CartEntry(menu, quantity, options);
    _entries[entry.id] = CartEntry(
      menu,
      (_entries[entry.id]?.quantity ?? 0) + quantity,
      options,
    );
    notifyListeners();
  }

  void setQuantity(String entryId, int quantity) {
    final entry = _entries[entryId];
    if (entry == null) return;
    if (quantity < 1) throw ArgumentError.value(quantity, 'quantity');
    _entries[entryId] = CartEntry(entry.menu, quantity, entry.options);
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
    );
    notifyListeners();
  }

  void remove(String entryId) {
    if (_entries.remove(entryId) != null) notifyListeners();
  }
}
