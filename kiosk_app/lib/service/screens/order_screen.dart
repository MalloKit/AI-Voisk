import 'dart:async';

import 'package:flutter/material.dart';

import '../controllers/cart_controller.dart';
import '../data/menu_repository.dart';
import '../data/api_menu_repository.dart';
import '../models/menu_item.dart';
import '../models/menu_option.dart';
import '../data/order_repository.dart';
import 'checkout_dialog.dart';

class OrderScreen extends StatefulWidget {
  const OrderScreen({
    super.key,
    this.repository,
    this.orderMode,
    this.orderRepository,
    this.storeId = const int.fromEnvironment('STORE_ID'),
    this.deviceId = const int.fromEnvironment('DEVICE_ID'),
  });
  final OrderRepository? orderRepository;
  final int storeId;
  final int deviceId;
  final MenuRepository? repository;
  final String? orderMode;
  @override
  State<OrderScreen> createState() => _OrderScreenState();
}

class _OrderScreenState extends State<OrderScreen> {
  Future<void> _checkout() async {
    const address = String.fromEnvironment(
      'ORDER_API_BASE_URL',
      defaultValue: String.fromEnvironment('MENU_API_BASE_URL'),
    );
    final id = await showDialog<int>(
      context: context,
      barrierDismissible: false,
      builder: (_) => CheckoutDialog(
        entries: _cart.entries,
        repository:
            widget.orderRepository ?? ApiOrderRepository(baseUrl: address),
        storeId: widget.storeId,
        deviceId: widget.deviceId,
        orderMode: widget.orderMode,
      ),
    );
    if (id != null && mounted) _cart.clear();
  }

  final _cart = CartController();
  final _categoryScrollController = ScrollController();
  final _menuScrollController = ScrollController();
  late Future<List<MenuItem>> _menus;
  late final MenuRepository _repository;
  String _category = '전체';
  int _textSizeStep = 0;
  double get _textScale => 1 + _textSizeStep * 0.1;

  Widget _scaled(Widget child) => MediaQuery(
    data: MediaQuery.of(context)
        .copyWith(textScaler: TextScaler.linear(_textScale)),
    child: ScrollConfiguration(
      behavior: ScrollConfiguration.of(context)
          .copyWith(overscroll: false, physics: const ClampingScrollPhysics()),
      child: child,
    ),
  );

  void _showRole(String role) {
    showDialog<void>(
      context: context,
      builder: (_) => _scaled(
        AlertDialog(
          title: Text('$role 기능'),
          content: const Text('준비 중입니다.'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('닫기'),
            ),
          ],
        ),
      ),
    );
  }

  OverlayEntry? _notice;

  ButtonStyle _feedbackStyle() => ButtonStyle(
    backgroundColor: WidgetStateProperty.resolveWith(
      (states) => states.contains(WidgetState.disabled)
          ? const Color(0xFFE0E0E0)
          : states.contains(WidgetState.pressed)
          ? const Color(0xFF00695C)
          : const Color(0xFFEAF1ED),
    ),
    foregroundColor: WidgetStateProperty.resolveWith(
      (states) => states.contains(WidgetState.disabled)
          ? const Color(0xFF757575)
          : states.contains(WidgetState.pressed)
          ? Colors.white
          : const Color(0xFF246B58),
    ),
  );

  void _clearNotice() {
    _notice?.remove();
    _notice?.dispose();
    _notice = null;
  }

  void _showNotice(String message) {
    _clearNotice();
    _notice = OverlayEntry(
      builder: (_) => Positioned.fill(
        child: IgnorePointer(
          child: TweenAnimationBuilder<double>(
            tween: Tween(begin: 1, end: 0),
            duration: const Duration(milliseconds: 2500),
            curve: const Interval(0.88, 1),
            onEnd: _clearNotice,
            builder: (context, opacity, child) =>
                Opacity(opacity: opacity, child: child),
            child: Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Material(
                  key: const Key('center-notice'),
                  elevation: 8,
                  color: const Color(0xFF153E39),
                  borderRadius: BorderRadius.circular(18),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 28,
                      vertical: 20,
                    ),
                    child: Text(
                      message,
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: Colors.white, fontSize: 20),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    Overlay.of(context).insert(_notice!);
  }

  @override
  void initState() {
    super.initState();
    _repository = widget.repository ?? configuredMenuRepository();
    _menus = _repository.loadMenus();
  }

  @override
  void dispose() {
    _clearNotice();
    _categoryScrollController.dispose();
    _menuScrollController.dispose();
    _cart.dispose();
    super.dispose();
  }

  Future<void> _selectMenu(MenuItem menu, {CartEntry? editing}) async {
    if (menu.isSoldOut) return;
    var quantity = editing?.quantity ?? 1;
    final selectedOptions =
        editing?.options.map((option) => option.id).toSet() ?? <String>{};
    final options = _repository is ApiMenuRepository
        ? menu.options
        : sampleOptions(menu.category);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, updateDialog) {
          final unitPrice =
              menu.price +
              options
                  .where((option) => selectedOptions.contains(option.id))
                  .fold<int>(0, (sum, option) => sum + option.price);
          return _scaled(
            AlertDialog(
              constraints: const BoxConstraints(maxWidth: 640),
              title: Text(
                menu.name,
                style: const TextStyle(
                  fontSize: 28,
                  fontWeight: FontWeight.bold,
                ),
              ),
              content: SizedBox(
                width: 560,
                child: SingleChildScrollView(
                  physics: const ClampingScrollPhysics(),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        menu.description,
                        style: const TextStyle(fontSize: 18),
                      ),
                      const SizedBox(height: 12),
                      Text(
                        '기본 가격 ${formatWon(menu.price)}',
                        style: const TextStyle(fontSize: 20),
                      ),
                      if (options.isNotEmpty) ...[
                        const SizedBox(height: 24),
                        const Text(
                          '추가 선택',
                          style: TextStyle(
                            fontSize: 22,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(height: 8),
                        for (final option in options)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: OutlinedButton(
                              style: OutlinedButton.styleFrom(
                                minimumSize: const Size(0, 64),
                                backgroundColor:
                                    selectedOptions.contains(option.id)
                                    ? const Color(0xFFD5EEE3)
                                    : Colors.white,
                              ),
                              onPressed: option.isSoldOut
                                  ? null
                                  : () => updateDialog(() {
                                      if (!selectedOptions.add(option.id)) {
                                        selectedOptions.remove(option.id);
                                      }
                                    }),
                              child: Row(
                                children: [
                                  Icon(
                                    selectedOptions.contains(option.id)
                                        ? Icons.check_circle
                                        : Icons.add_circle_outline,
                                  ),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: Text(
                                      option.isSoldOut
                                          ? '${option.name} (품절)'
                                          : option.name,
                                      style: const TextStyle(fontSize: 20),
                                    ),
                                  ),
                                  Text(
                                    '+${formatWon(option.price)}',
                                    style: const TextStyle(fontSize: 20),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        const Text('추가 가격은 메뉴 1개마다 적용됩니다.'),
                      ],
                      const SizedBox(height: 20),
                      Row(
                        children: [
                          const Expanded(
                            child: Text('수량', style: TextStyle(fontSize: 22)),
                          ),
                          _QuantitySelector(
                            quantity: quantity,
                            onMinus: quantity > 1
                                ? () => updateDialog(() => quantity--)
                                : null,
                            onPlus: () => updateDialog(() => quantity++),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Text(
                        '선택 금액 ${formatWon(unitPrice * quantity)}',
                        key: const Key('selection-total'),
                        style: const TextStyle(
                          fontSize: 26,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(context, false),
                  child: const Text('취소'),
                ),
                FilledButton(
                  style: FilledButton.styleFrom(
                    minimumSize: const Size(180, 56),
                  ),
                  onPressed: () => Navigator.pop(context, true),
                  child: Text(
                    editing == null ? '장바구니 담기' : '변경 저장',
                    style: const TextStyle(fontSize: 20),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
    if (!mounted || confirmed != true) return;
    final chosenOptions = options
        .where((option) => selectedOptions.contains(option.id))
        .toList();
    if (editing == null) {
      _cart.add(menu, quantity, options: chosenOptions);
    } else {
      _cart.update(editing.id, quantity, options: chosenOptions);
    }
    _showNotice(
      editing == null
          ? '${menu.name} $quantity개를 담았습니다.'
          : '${menu.name} 선택 내용을 변경했습니다.',
    );
  }

  @override
  Widget build(BuildContext context) => _scaled(_buildScreen());

  Widget _buildScreen() => Scaffold(
    bottomNavigationBar: SafeArea(
      top: false,
      child: Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          border: Border(top: BorderSide(color: Color(0xFFCBDAD2))),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            PopupMenuButton<String>(
              tooltip: '설정',
              onSelected: _showRole,
              itemBuilder: (_) => const [
                PopupMenuItem(value: '관리자', child: Text('관리자')),
                PopupMenuItem(value: '점주', child: Text('점주')),
              ],
              child: const Padding(
                padding: EdgeInsets.all(12),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.settings_outlined),
                    SizedBox(width: 8),
                    Text('설정'),
                  ],
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Wrap(
                alignment: WrapAlignment.end,
                crossAxisAlignment: WrapCrossAlignment.center,
                spacing: 8,
                children: [
                  OutlinedButton(
                    onPressed: _textSizeStep > -1
                        ? () => setState(() => _textSizeStep--)
                        : null,
                    child: const Text('글자 작게'),
                  ),
                  Text(
                    '${(_textScale * 100).round()}%',
                    key: const Key('text-size-value'),
                  ),
                  OutlinedButton(
                    onPressed: _textSizeStep < 2
                        ? () => setState(() => _textSizeStep++)
                        : null,
                    child: const Text('글자 크게'),
                  ),
                  PopupMenuButton<String>(
                    tooltip: 'Language',
                    itemBuilder: (context) => const [
                      PopupMenuItem(value: 'ko', child: Text('한국어')),
                      PopupMenuItem(value: 'ja', child: Text('日本語')),
                      PopupMenuItem(value: 'en', child: Text('English')),
                      PopupMenuItem(value: 'zh', child: Text('中文')),
                    ],
                    child: const Padding(
                      padding: EdgeInsets.all(12),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.language),
                          SizedBox(width: 8),
                          Text('Language', style: TextStyle(fontSize: 18)),
                          Icon(Icons.arrow_drop_up),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    ),
    appBar: AppBar(
      title: Text(
        widget.orderMode == null
            ? 'AI 보이스크 · 메뉴 주문'
            : 'AI 보이스크 · 메뉴 주문 · ${widget.orderMode}',
      ),
      actions: [
        OutlinedButton.icon(
          onPressed: () => showDialog<void>(
            context: context,
            builder: (_) => _scaled(const _StaffCallDialog()),
          ),
          style: _feedbackStyle(),
          icon: const Icon(Icons.support_agent),
          label: const Text('직원 호출'),
        ),
        const SizedBox(width: 8),
        OutlinedButton.icon(
          onPressed: () {},
          style: _feedbackStyle(),
          icon: const Icon(Icons.mic_none),
          label: const Text('마이크'),
        ),
        const SizedBox(width: 12),
      ],
    ),
    body: ScrollConfiguration(
      behavior: ScrollConfiguration.of(context)
          .copyWith(overscroll: false, physics: const ClampingScrollPhysics()),
      child: SafeArea(
        child: FutureBuilder<List<MenuItem>>(
          future: _menus,
          builder: (context, snapshot) {
            if (snapshot.hasError) {
              return Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Text('메뉴를 불러오지 못했습니다.'),
                    FilledButton(
                      onPressed: () => setState(() {
                        _menus = _repository.loadMenus();
                      }),
                      child: const Text('다시 시도'),
                    ),
                  ],
                ),
              );
            }
            if (!snapshot.hasData) {
              return const Center(child: CircularProgressIndicator());
            }
            final menus = snapshot.data!;
            final categories = ['전체', ...menus.map((m) => m.category).toSet()];
            final visible = menus
                .where((m) => _category == '전체' || m.category == _category)
                .toList();
            return Column(
              children: [
                Expanded(
                  child: LayoutBuilder(
                    builder: (context, constraints) {
                      final compact = constraints.maxWidth < 850;
                      final cartWidth =
                          (compact ? 230.0 : 320.0) *
                          _textScale.clamp(1.0, 1.2);
                      return Row(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Container(
                            width: compact ? 100 : 124,
                            color: const Color(0xFF153E39),
                            child: Column(
                              children: [
                                Expanded(
                                  child: RawScrollbar(
                                    key: const Key('category-scrollbar'),
                                    controller: _categoryScrollController,
                                    thumbVisibility: true,
                                    trackVisibility: true,
                                    interactive: true,
                                    thickness: 10,
                                    radius: const Radius.circular(5),
                                    thumbColor: const Color(0xFFBCE9D8),
                                    trackColor: const Color(0xFF32564F),
                                    child: ListView(
                                      controller: _categoryScrollController,
                                      primary: false,
                                      key: const Key('category-list'),
                                      padding: const EdgeInsets.symmetric(
                                        vertical: 12,
                                      ),
                                      children: [
                                        for (final category in categories)
                                          Padding(
                                            padding: const EdgeInsets.symmetric(
                                              horizontal: 14,
                                              vertical: 4,
                                            ),
                                            child: FilledButton(
                                              style: FilledButton.styleFrom(
                                                backgroundColor:
                                                    category == _category
                                                    ? const Color(0xFFBCE9D8)
                                                    : Colors.transparent,
                                                foregroundColor:
                                                    category == _category
                                                    ? const Color(0xFF153E39)
                                                    : Colors.white,
                                                minimumSize: const Size(0, 64),
                                                padding:
                                                    const EdgeInsets.symmetric(
                                                      horizontal: 4,
                                                    ),
                                              ),
                                              onPressed: () => setState(
                                                () => _category = category,
                                              ),
                                              child: Text(
                                                category,
                                                style: const TextStyle(
                                                  fontSize: 18,
                                                ),
                                              ),
                                            ),
                                          ),
                                      ],
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                          Expanded(
                            child: Container(
                              color: const Color(0xFFF5F7F5),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  Padding(
                                    padding: const EdgeInsets.all(16),
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          _category == '전체'
                                              ? '전체 메뉴'
                                              : _category,
                                          style: const TextStyle(
                                            fontSize: 24,
                                            fontWeight: FontWeight.bold,
                                          ),
                                        ),
                                        const SizedBox(height: 4),
                                        const Text('메뉴를 눌러 수량을 선택해 주세요.'),
                                      ],
                                    ),
                                  ),
                                  Expanded(
                                    child: visible.isEmpty
                                        ? const Center(
                                            child: Text('등록된 메뉴가 없습니다.'),
                                          )
                                        : LayoutBuilder(
                                            builder: (context, gridConstraints) {
                                              final columns =
                                                  (gridConstraints.maxWidth /
                                                          180)
                                                      .floor()
                                                      .clamp(1, 4);
                                              return RawScrollbar(
                                                key: const Key(
                                                  'menu-scrollbar',
                                                ),
                                                controller:
                                                    _menuScrollController,
                                                thumbVisibility: true,
                                                trackVisibility: true,
                                                interactive: true,
                                                thickness: 10,
                                                radius: const Radius.circular(
                                                  5,
                                                ),
                                                thumbColor: const Color(
                                                  0xFF246B58,
                                                ),
                                                trackColor: const Color(
                                                  0xFFDDE7E1,
                                                ),
                                                child: GridView.builder(
                                                  controller:
                                                      _menuScrollController,
                                                  primary: false,
                                                  padding:
                                                      const EdgeInsets.fromLTRB(
                                                        12,
                                                        0,
                                                        12,
                                                        12,
                                                      ),
                                                  gridDelegate:
                                                      SliverGridDelegateWithFixedCrossAxisCount(
                                                        crossAxisCount: columns,
                                                        mainAxisExtent:
                                                            210 *
                                                            _textScale.clamp(
                                                              1.0,
                                                              1.2,
                                                            ),
                                                        crossAxisSpacing: 12,
                                                        mainAxisSpacing: 12,
                                                      ),
                                                  itemCount: visible.length,
                                                  itemBuilder: (context, index) {
                                                    final menu = visible[index];
                                                    return Card(
                                                      margin: EdgeInsets.zero,
                                                      color: menu.isSoldOut
                                                          ? const Color(
                                                              0xFFEEEEEE,
                                                            )
                                                          : Colors.white,
                                                      clipBehavior:
                                                          Clip.antiAlias,
                                                      child: InkWell(
                                                        onTap: menu.isSoldOut
                                                            ? null
                                                            : () => _selectMenu(
                                                                menu,
                                                              ),
                                                        child: Padding(
                                                          padding:
                                                              const EdgeInsets.all(
                                                                12,
                                                              ),
                                                          child: Column(
                                                            children: [
                                                              Expanded(
                                                                child: Center(
                                                                  child: Container(
                                                                    width: 92,
                                                                    height: 92,
                                                                    decoration: const BoxDecoration(
                                                                      color: Color(
                                                                        0xFFFFF0DC,
                                                                      ),
                                                                      shape: BoxShape
                                                                          .circle,
                                                                    ),
                                                                    child: Icon(
                                                                      _categoryIcon(
                                                                        menu.category,
                                                                      ),
                                                                      size: 52,
                                                                      color: const Color(
                                                                        0xFFBB743A,
                                                                      ),
                                                                    ),
                                                                  ),
                                                                ),
                                                              ),
                                                              if (menu
                                                                  .isSoldOut)
                                                                const Text(
                                                                  '품절',
                                                                  style: TextStyle(
                                                                    color: Color(
                                                                      0xFFB3261E,
                                                                    ),
                                                                    fontWeight:
                                                                        FontWeight
                                                                            .bold,
                                                                  ),
                                                                ),
                                                              const SizedBox(
                                                                height: 8,
                                                              ),
                                                              Text(
                                                                menu.name,
                                                                textAlign:
                                                                    TextAlign
                                                                        .center,
                                                                style: const TextStyle(
                                                                  fontSize: 19,
                                                                  fontWeight:
                                                                      FontWeight
                                                                          .bold,
                                                                ),
                                                              ),
                                                              const SizedBox(
                                                                height: 6,
                                                              ),
                                                              Text(
                                                                formatWon(
                                                                  menu.price,
                                                                ),
                                                                style: const TextStyle(
                                                                  fontSize: 18,
                                                                  color: Color(
                                                                    0xFF246B58,
                                                                  ),
                                                                ),
                                                              ),
                                                            ],
                                                          ),
                                                        ),
                                                      ),
                                                    );
                                                  },
                                                ),
                                              );
                                            },
                                          ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                          const VerticalDivider(width: 1),
                          SizedBox(width: cartWidth, child: _cartPanel()),
                        ],
                      );
                    },
                  ),
                ),
              ],
            );
          },
        ),
      ),
    ),
  );

  IconData _categoryIcon(String category) => switch (category) {
    '식사' => Icons.rice_bowl,
    '국물' => Icons.soup_kitchen,
    '사이드' => Icons.restaurant,
    '음료' => Icons.local_drink,
    _ => Icons.restaurant_menu,
  };

  Future<void> _clearCart() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => _scaled(
        AlertDialog(
          title: const Text('장바구니 전체 비우기'),
          content: const Text('담긴 음식을 모두 삭제할까요?'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('취소'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('모두 삭제'),
            ),
          ],
        ),
      ),
    );
    if (mounted && confirmed == true) _cart.clear();
  }

  Widget _cartPanel() => ListenableBuilder(
    listenable: _cart,
    builder: (context, _) => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  '장바구니 · ${_cart.itemCount}개',
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              TextButton(
                onPressed: () {},
                style: _feedbackStyle().copyWith(
                  padding: const WidgetStatePropertyAll(
                    EdgeInsets.symmetric(horizontal: 6),
                  ),
                  minimumSize: const WidgetStatePropertyAll(Size(0, 40)),
                ),
                child: const Text('주문내역', style: TextStyle(fontSize: 13)),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Align(
            alignment: Alignment.centerRight,
            child: TextButton.icon(
              onPressed: _cart.entries.isEmpty ? null : _clearCart,
              icon: const Icon(Icons.delete_sweep_outlined),
              label: const Text('전체 비우기'),
            ),
          ),
        ),
        Expanded(
          child: _cart.entries.isEmpty
              ? const Center(child: Text('메뉴를 담으면 여기에 표시됩니다.'))
              : ListView(
                  children: _cart.entries
                      .map(
                        (entry) => Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 16,
                            vertical: 8,
                          ),
                          child: InkWell(
                            key: ValueKey('cart-entry-${entry.id}'),
                            onTap: () =>
                                _selectMenu(entry.menu, editing: entry),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Expanded(
                                      child: Text(
                                        entry.menu.name,
                                        style: const TextStyle(
                                          fontSize: 18,
                                          fontWeight: FontWeight.bold,
                                        ),
                                      ),
                                    ),
                                    IconButton(
                                      tooltip: '${entry.menu.name} 삭제',
                                      onPressed: () => _cart.remove(entry.id),
                                      icon: const Icon(Icons.delete_outline),
                                    ),
                                  ],
                                ),
                                if (entry.options.isNotEmpty)
                                  Text(
                                    entry.options
                                        .map(
                                          (option) =>
                                              '${option.name} +${formatWon(option.price)}',
                                        )
                                        .join(' · '),
                                  ),
                                Text(
                                  '${formatWon(entry.unitPrice)} × ${entry.quantity} = ${formatWon(entry.subtotal)}',
                                ),
                                _QuantitySelector(
                                  quantity: entry.quantity,
                                  onMinus: entry.quantity > 1
                                      ? () => _cart.setQuantity(
                                          entry.id,
                                          entry.quantity - 1,
                                        )
                                      : null,
                                  onPlus: () => _cart.setQuantity(
                                    entry.id,
                                    entry.quantity + 1,
                                  ),
                                ),
                                const Text(
                                  '눌러서 옵션 수정',
                                  style: TextStyle(
                                    fontSize: 12,
                                    color: Color(0xFF246B58),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      )
                      .toList(),
                ),
        ),
        const Divider(height: 1),
        Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              const Expanded(
                child: Text('합계 금액', style: TextStyle(fontSize: 20)),
              ),
              Text(
                formatWon(_cart.total),
                key: const Key('cart-total'),
                style: const TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: OutlinedButton.icon(
            onPressed: _cart.entries.isEmpty ? null : _checkout,
            style: _feedbackStyle().copyWith(
              backgroundColor: WidgetStateProperty.resolveWith((states) {
                if (states.contains(WidgetState.disabled)) {
                  return const Color(0xFFE0E0E0);
                }
                return states.contains(WidgetState.pressed)
                    ? const Color(0xFF153E39)
                    : const Color(0xFF00695C);
              }),
              foregroundColor: WidgetStateProperty.resolveWith(
                (states) => states.contains(WidgetState.disabled)
                    ? const Color(0xFF757575)
                    : Colors.white,
              ),
              minimumSize: const WidgetStatePropertyAll(Size(0, 52)),
              textStyle: const WidgetStatePropertyAll(
                TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
              ),
            ),
            icon: const Icon(Icons.check_circle_outline),
            label: const Text('주문 완료 (시연)'),
          ),
        ),
      ],
    ),
  );
}

/// 화면 시연용 안내이며 실제 직원에게 알림을 보내지는 않습니다.
class _StaffCallDialog extends StatefulWidget {
  const _StaffCallDialog();
  @override
  State<_StaffCallDialog> createState() => _StaffCallDialogState();
}

class _StaffCallDialogState extends State<_StaffCallDialog> {
  late final Timer _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer(const Duration(milliseconds: 2500), () {
      if (mounted) Navigator.of(context).pop();
    });
  }

  @override
  void dispose() {
    _timer.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    content: const Text(
      '직원을 호출했습니다',
      textAlign: TextAlign.center,
      style: TextStyle(fontSize: 22),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.of(context).pop(),
        child: const Text('닫기'),
      ),
    ],
  );
}

class _QuantitySelector extends StatelessWidget {
  const _QuantitySelector({
    required this.quantity,
    required this.onMinus,
    required this.onPlus,
  });
  final int quantity;
  final VoidCallback? onMinus;
  final VoidCallback onPlus;
  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      IconButton(
        tooltip: '수량 줄이기',
        onPressed: onMinus,
        icon: const Icon(Icons.remove_circle_outline),
      ),
      Text('$quantity개', style: const TextStyle(fontSize: 20)),
      IconButton(
        tooltip: '수량 늘리기',
        onPressed: onPlus,
        icon: const Icon(Icons.add_circle_outline),
      ),
    ],
  );
}
