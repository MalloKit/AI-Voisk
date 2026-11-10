import '../service/controllers/cart_controller.dart';
import '../service/models/menu_item.dart';
import '../service/models/menu_option.dart';

/// 장바구니를 바꾸는 명령(Command 패턴). 터치와 음성이 같은 명령을 써서 장바구니는 한 곳에서만 바뀝니다.
sealed class OrderCommand {
  const OrderCommand();

  /// 화면 알림·음성 안내에 쓰는 한국어 설명입니다.
  String get description;
  void execute(CartController cart);
}

class AddItemCommand extends OrderCommand {
  const AddItemCommand(
    this.menu,
    this.quantity, {
    this.options = const [],
    this.recommended = false,
  });
  final MenuItem menu;
  final int quantity;
  final List<MenuOption> options;
  final bool recommended;

  @override
  String get description => '${menu.name} $quantity개';

  @override
  void execute(CartController cart) =>
      cart.add(menu, quantity, options: options, recommended: recommended);
}

class SetQuantityCommand extends OrderCommand {
  const SetQuantityCommand(this.entryId, this.quantity, this.menuName);
  final String entryId;
  final int quantity;
  final String menuName;

  @override
  String get description => '$menuName $quantity개로 변경';

  @override
  void execute(CartController cart) => cart.setQuantity(entryId, quantity);
}

class UpdateEntryCommand extends OrderCommand {
  const UpdateEntryCommand(
    this.entryId,
    this.quantity,
    this.options,
    this.menuName,
  );
  final String entryId;
  final int quantity;
  final List<MenuOption> options;
  final String menuName;

  @override
  String get description => '$menuName 선택 변경';

  @override
  void execute(CartController cart) =>
      cart.update(entryId, quantity, options: options);
}

class RemoveEntryCommand extends OrderCommand {
  const RemoveEntryCommand(this.entryId, this.menuName);
  final String entryId;
  final String menuName;

  @override
  String get description => '$menuName 삭제';

  @override
  void execute(CartController cart) => cart.remove(entryId);
}

class ClearCartCommand extends OrderCommand {
  const ClearCartCommand();

  @override
  String get description => '장바구니 비우기';

  @override
  void execute(CartController cart) => cart.clear();
}

enum CommandSource { touch, voice }

class CommandRecord {
  CommandRecord(this.command, this.source, this.before);
  final OrderCommand command;
  final CommandSource source;
  final List<CartEntry> before;
}

/// 명령을 실행하고 기록합니다. 기록은 실행 취소와 "이번 주문이 음성으로 완성됐는가" 판단에 씁니다.
class OrderCommandBus {
  OrderCommandBus(this.cart);
  final CartController cart;
  final List<CommandRecord> _history = [];

  List<CommandRecord> get history => List.unmodifiable(_history);

  void run(OrderCommand command, {CommandSource source = CommandSource.touch}) {
    final before = cart.snapshot();
    command.execute(cart);
    _history.add(CommandRecord(command, source, before));
  }

  void runAll(
    Iterable<OrderCommand> commands, {
    CommandSource source = CommandSource.touch,
  }) {
    final before = cart.snapshot();
    try {
      for (final command in commands) {
        command.execute(cart);
        _history.add(CommandRecord(command, source, before));
      }
    } catch (_) {
      // 일부만 담기지 않도록 전부 되돌립니다.
      cart.restore(before);
      rethrow;
    }
  }

  bool undoLast() {
    if (_history.isEmpty) return false;
    cart.restore(_history.removeLast().before);
    return true;
  }

  /// 현재 장바구니에 음성 명령이 하나라도 반영됐으면 음성 주문으로 기록합니다.
  bool get usedVoice =>
      _history.any((record) => record.source == CommandSource.voice);

  /// 결제가 끝나 새 주문을 시작할 때 기록을 비웁니다.
  void reset() => _history.clear();
}
