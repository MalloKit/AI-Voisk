import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/kiosk_services.dart';
import '../../core/l10n.dart';
import '../../data/catalog_repository.dart';
import '../../data/usability_log.dart';
import '../../domain/catalog.dart';
import '../../domain/conversation_controller.dart';
import '../../domain/order_commands.dart';
import '../../screens/settings_screen.dart';
import '../../voice/voice_panel.dart';
import '../../widgets/menu_image.dart';
import '../controllers/cart_controller.dart';
import '../data/api_menu_repository.dart';
import '../data/menu_repository.dart';
import '../data/order_repository.dart';
import '../models/menu_item.dart';
import '../models/menu_option.dart';
import 'checkout_dialog.dart';
import 'payment_screen.dart';

class OrderScreen extends StatefulWidget {
  const OrderScreen({
    super.key,
    this.repository,
    this.orderMode,
    this.orderRepository,
    this.services,
    this.storeId = const int.fromEnvironment('STORE_ID'),
    this.deviceId = const int.fromEnvironment('DEVICE_ID'),
    this.idleLimit = const Duration(seconds: 90),
    this.idleConfirm = const Duration(seconds: 20),
  });
  final OrderRepository? orderRepository;
  final int storeId;
  final int deviceId;
  final MenuRepository? repository;
  final String? orderMode;

  /// 생략하면 main에서 만든 [KioskServices.current]를 씁니다. 위젯 테스트는 보통 null입니다.
  final KioskServices? services;

  /// 아무 조작이 없으면 다음 고객을 위해 처음 화면으로 돌아가는 시간과, 장바구니가 있을 때 묻는 시간.
  final Duration idleLimit;
  final Duration idleConfirm;
  @override
  State<OrderScreen> createState() => _OrderScreenState();
}

class _OrderScreenState extends State<OrderScreen> {
  final _cart = CartController();
  late final OrderCommandBus _bus = OrderCommandBus(_cart);
  final _categoryScrollController = ScrollController();
  final _menuScrollController = ScrollController();
  late Future<KioskCatalog> _future;
  late final CatalogSource _source;
  KioskServices? _services;
  ConversationController? _conversation;
  KioskCatalog? _catalog;
  String _category = '전체';
  int _textSizeStep = 0;
  bool _senior = false;
  Set<String> _highlighted = {};
  Timer? _highlightTimer;
  MenuItem? _viewing;
  DateTime _viewingAt = DateTime.fromMillisecondsSinceEpoch(0);
  bool _updatePending = false;
  final _noVoice = ValueNotifier(0);
  Timer? _idleTimer;
  bool _idleAsking = false;

  // 사용성 측정: 이번 고객이 처음 화면을 만진 시각과 탭 수(구상안 15장).
  DateTime? _orderStartedAt;
  int _orderTaps = 0;

  double get _textScale => 1 + _textSizeStep * 0.1;
  int get _storeId => _services?.config.isKioskMode == true
      ? _services!.config.storeId
      : widget.storeId;
  int get _deviceId => _services?.config.isKioskMode == true
      ? _services!.config.deviceId
      : widget.deviceId;

  Widget _scaled(Widget child) => MediaQuery(
    data: MediaQuery.of(context)
        .copyWith(textScaler: TextScaler.linear(_textScale)),
    child: ScrollConfiguration(
      behavior: ScrollConfiguration.of(context)
          .copyWith(overscroll: false, physics: const ClampingScrollPhysics()),
      child: child,
    ),
  );

  @override
  void initState() {
    super.initState();
    _services =
        widget.services ??
        (widget.repository == null ? KioskServices.current : null);
    _source = widget.repository != null
        ? PlainCatalogSource(widget.repository!)
        : _services?.catalog ?? PlainCatalogSource(configuredMenuRepository());
    _future = _load();
    final services = _services;
    if (services?.voice != null && services?.interpreter != null) {
      _conversation = ConversationController(
        voice: services!.voice!,
        interpreter: services.interpreter!,
        bus: _bus,
        catalog: () => _catalog ?? const KioskCatalog(menus: []),
        viewingMenu: () =>
            DateTime.now().difference(_viewingAt) < const Duration(minutes: 1)
            ? _viewing
            : null,
        onHighlight: _highlight,
        onCheckout: _checkout,
      );
    }
    services?.sync?.addListener(_onSync);
    _cart.addListener(_onCartChanged);
    L10n.instance.addListener(_onLanguage);
    _resetIdle();
  }

  // ---------- 무조작 초기화 ----------

  /// 화면을 만질 때마다 다시 잽니다. 고객이 떠나면 장바구니·음성 대화가 다음 고객에게 남지 않게 합니다.
  void _resetIdle() {
    _idleTimer?.cancel();
    _idleTimer = Timer(widget.idleLimit, _onIdle);
  }

  Future<void> _onIdle() async {
    if (!mounted || _idleAsking) return;
    // 결제 화면·설정처럼 위에 다른 화면이 떠 있거나 음성 대화 중이면 기다립니다.
    if (!(ModalRoute.of(context)?.isCurrent ?? true) ||
        (_conversation?.active ?? false)) {
      _resetIdle();
      return;
    }
    if (_cart.entries.isEmpty) {
      _goHome();
      return;
    }
    _idleAsking = true;
    final keep = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (_) => _scaled(_IdleDialog(timeout: widget.idleConfirm)),
    );
    _idleAsking = false;
    if (!mounted) return;
    if (keep == true) {
      _resetIdle();
    } else {
      _goHome();
    }
  }

  /// 장바구니·대화를 비우고 처음(포장/매장 식사 선택) 화면으로 돌아갑니다.
  void _goHome() {
    _idleTimer?.cancel();
    unawaited(_conversation?.stop());
    _finishOrder(clearOnly: true);
    final navigator = Navigator.of(context);
    if (navigator.canPop()) {
      navigator.popUntil((route) => route.isFirst);
    } else {
      _resetIdle();
    }
  }

  Future<KioskCatalog> _load() async {
    final catalog = await _source.loadCatalog();
    _catalog = catalog;
    if (mounted &&
        catalog.settings.defaultMode == 'senior' &&
        !_senior &&
        _cart.entries.isEmpty) {
      _setSenior(true);
    }
    unawaited(_services?.images?.sync(catalog.menus));
    return catalog;
  }

  void _onLanguage() {
    if (mounted) setState(() {});
  }

  void _onSync() {
    final sync = _services?.sync;
    if (sync == null || !sync.updateAvailable) return;
    _updatePending = true;
    _maybeApplyUpdate();
  }

  void _onCartChanged() => _maybeApplyUpdate();

  /// 진행 중인 주문은 시작 시점 메뉴로 끝내고, 장바구니가 비면 새 메뉴를 적용합니다(구상안 동기화 규칙).
  Future<void> _maybeApplyUpdate() async {
    final sync = _services?.sync;
    if (!_updatePending ||
        sync == null ||
        _cart.entries.isNotEmpty ||
        (_conversation?.active ?? false)) {
      if (mounted) setState(() {});
      return;
    }
    _updatePending = false;
    final applied = await sync.applyUpdate();
    if (!mounted) return;
    // 받는 동안 고객이 담기 시작했으면 지금 바꾸지 않고 주문이 끝난 뒤 적용합니다.
    if (_cart.entries.isNotEmpty || (_conversation?.active ?? false)) {
      if (applied) _updatePending = true;
      setState(() {});
      return;
    }
    if (applied) {
      setState(
        () => _future = Future.value(_catalog = _source.current ?? _catalog),
      );
      unawaited(_services?.images?.sync(_catalog?.menus ?? const []));
    }
  }

  @override
  void dispose() {
    _clearNotice();
    _idleTimer?.cancel();
    _highlightTimer?.cancel();
    _services?.sync?.removeListener(_onSync);
    L10n.instance.removeListener(_onLanguage);
    _conversation?.dispose();
    _categoryScrollController.dispose();
    _menuScrollController.dispose();
    _cart.dispose();
    super.dispose();
  }

  // ---------- 화면 피드백 ----------

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
    if (!mounted) return;
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

  /// 음성으로 처리한 메뉴를 강조합니다. 보이도록 해당 분류로 이동합니다.
  /// focus는 고객이 고른 메뉴일 때만 true이고, 그때만 "이거"가 가리키는 메뉴로 기억합니다
  /// (추천·추가 제안 강조가 "이거"를 바꾸지 않게).
  void _highlight(Set<String> ids, {bool focus = false}) {
    if (!mounted || ids.isEmpty) return;
    final menus = _catalog?.menus ?? const <MenuItem>[];
    final categories = menus
        .where((m) => ids.contains(m.id))
        .map((m) => m.category)
        .toSet();
    setState(() {
      _highlighted = ids;
      if (categories.length == 1) {
        _category = categories.first;
      } else if (categories.length > 1) {
        _category = '전체';
      }
      if (focus && ids.length == 1) {
        _viewing =
            menus.where((m) => m.id == ids.first).firstOrNull ?? _viewing;
        _viewingAt = DateTime.now();
      }
    });
    _highlightTimer?.cancel();
    _highlightTimer = Timer(const Duration(seconds: 6), () {
      if (mounted) setState(() => _highlighted = {});
    });
  }

  void _setSenior(bool value) {
    setState(() {
      _senior = value;
      // 시니어 모드는 큰 글씨(120%)로 바꾸고, 끄면 기본 크기로 돌아갑니다.
      _textSizeStep = value ? 2 : 0;
    });
  }

  // ---------- 버튼 동작 ----------

  Future<void> _startVoice() async {
    final conversation = _conversation;
    if (conversation == null) {
      _showNotice(tr('음성 주문은 서버에 연결된 키오스크에서 사용할 수 있습니다.'));
      return;
    }
    if (L10n.instance.language != AppLanguage.ko) {
      _showNotice(tr('음성 주문은 한국어만 지원합니다.'));
    }
    if (conversation.active) {
      await conversation.talk();
      return;
    }
    await conversation.start(seniorMode: _senior);
    if (!conversation.active && conversation.message.isNotEmpty) {
      _showNotice(conversation.message);
    }
  }

  Future<void> _staffCall() async {
    final api = _services?.api;
    var sent = api == null;
    if (api != null) {
      try {
        await api.staffCall('touch');
        sent = true;
      } catch (_) {
        sent = false;
      }
    }
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      builder: (_) => _scaled(_StaffCallDialog(sent: sent, demo: api == null)),
    );
  }

  Future<void> _openSettings() async {
    final services = _services;
    if (services?.settings == null) {
      await showDialog<void>(
        context: context,
        builder: (_) => _scaled(
          AlertDialog(
            title: Text(tr('키오스크 설정')),
            content: Text(tr('앱을 서버 연결 설정으로 실행하면 사용할 수 있습니다.')),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(context).pop(),
                child: Text(tr('닫기')),
              ),
            ],
          ),
        ),
      );
      return;
    }
    if (!await askAdminPin(
          context,
          services!.settings!,
          deviceToken: services.config.token,
        ) ||
        !mounted) {
      return;
    }
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => SettingsScreen(services: services),
      ),
    );
  }

  Future<void> _checkout() async {
    final conversation = _conversation;
    if (conversation?.active ?? false) await conversation!.stop();
    if (!mounted || _cart.entries.isEmpty) return;
    final channel = _bus.usedVoice ? 'voice' : 'touch';
    if (const bool.fromEnvironment('PAYMENT_DEMO', defaultValue: true)) {
      var reprice = false;
      final completed = await Navigator.of(context).push<bool>(
        MaterialPageRoute(
          builder: (_) => PaymentScreen(
            entries: _cart.entries,
            orderMode: widget.orderMode,
            storeId: _storeId,
            deviceId: _deviceId,
            orderChannel: channel,
            gateway: _services?.orders,
            onRepriceRequested: () => reprice = true,
          ),
        ),
      );
      if (completed == true && mounted) _finishOrder();
      if (reprice && mounted) await _reprice();
      return;
    }
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
        gateway: _services?.orders,
        orderChannel: channel,
        storeId: _storeId,
        deviceId: _deviceId,
        orderMode: widget.orderMode,
      ),
    );
    if (id != null && mounted) _finishOrder();
  }

  /// 결제 중 메뉴가 바뀌어 서버가 거절했을 때: 최신 메뉴를 받아 장바구니를 새 가격으로 다시 담습니다.
  /// 판매 중지·품절이거나 필수 옵션을 더 고를 수 없게 된 항목은 빼고 알려 줍니다.
  Future<void> _reprice() async {
    final before = _cart.total;
    KioskCatalog fresh;
    try {
      fresh = await _source.loadCatalog();
    } catch (_) {
      _showNotice(tr('새 메뉴를 받지 못했습니다. 잠시 후 다시 결제해 주세요.'));
      return;
    }
    if (!mounted) return;
    final removed = <String>[];
    final entries = List.of(_cart.entries);
    _cart.clear();
    for (final entry in entries) {
      final menu = fresh.menuById(entry.menu.id);
      final options = [
        for (final option in entry.options)
          ?menu?.options.where((o) => o.id == option.id && !o.isSoldOut).firstOrNull,
      ];
      if (menu == null ||
          menu.isSoldOut ||
          options.length != entry.options.length ||
          menu.missingGroups(options).isNotEmpty) {
        removed.add(entry.menu.name);
        continue;
      }
      _cart.add(menu, entry.quantity, options: options, recommended: entry.recommended);
    }
    setState(() => _future = Future.value(_catalog = fresh));
    _updatePending = false;
    _showNotice(
      removed.isEmpty
          ? tr('새 가격으로 바꿨습니다. {before} → {after}', {
              'before': formatWon(before),
              'after': formatWon(_cart.total),
            })
          : tr('판매가 끝난 {names}을(를) 빼고 새 가격으로 바꿨습니다.', {
              'names': removed.join(', '),
            }),
    );
  }

  /// 주문 완료: 장바구니·명령 기록·추가 제안 여부를 비우고 다음 고객을 위해 한국어로 돌립니다.
  /// 다음 고객이 포장/매장 식사를 다시 고르도록 처음 화면으로 돌아갑니다.
  void _finishOrder({bool clearOnly = false}) {
    final started = _orderStartedAt;
    if (!clearOnly && started != null) {
      unawaited(
        _services?.usability?.add(
          UsabilityRecord(
            channel: _bus.usedVoice ? 'voice' : 'touch',
            taps: _orderTaps,
            seconds: DateTime.now().difference(started).inSeconds,
            items: _cart.itemCount,
            senior: _senior,
          ),
        ),
      );
    }
    _orderStartedAt = null;
    _orderTaps = 0;
    _bus.run(const ClearCartCommand());
    _bus.reset();
    _conversation?.resetOrder();
    L10n.instance.reset();
    if (_senior) _setSenior(_catalog?.settings.defaultMode == 'senior');
    if (clearOnly || !mounted) return;
    final navigator = Navigator.of(context);
    if (navigator.canPop()) navigator.popUntil((route) => route.isFirst);
  }

  Future<void> _selectMenu(MenuItem menu, {CartEntry? editing}) async {
    if (menu.isSoldOut) return;
    _viewing = menu;
    _viewingAt = DateTime.now();
    var quantity = editing?.quantity ?? 1;
    final selectedOptions =
        editing?.options.map((option) => option.id).toSet() ?? <String>{};
    // 서버 메뉴는 DB 옵션을, 서버 없는 시연 메뉴는 분류별 임시 옵션을 씁니다(기존 동작 유지).
    final source = _source;
    // 서버(또는 서버와 같은 형식) 메뉴는 받은 옵션을, 서버 없는 임시 메뉴만 분류별 예시 옵션을 씁니다.
    final serverMenu =
        source is! PlainCatalogSource ||
        source.repository is ApiMenuRepository;
    final options = serverMenu ? menu.options : sampleOptions(menu.category);
    final groups = <String, List<MenuOption>>{};
    for (final option in options) {
      if (option.group != null) groups.putIfAbsent(option.group!, () => []).add(option);
    }
    final extras = options.where((option) => option.group == null).toList();
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
                      if (menu.imageUrl != null)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: Center(
                            child: MenuImage(
                              menu: menu,
                              store: _services?.images,
                              size: 140,
                            ),
                          ),
                        ),
                      Text(
                        menu.description,
                        style: const TextStyle(fontSize: 18),
                      ),
                      const SizedBox(height: 12),
                      Text(
                        tr('기본 가격 {price}', {'price': formatWon(menu.price)}),
                        style: const TextStyle(fontSize: 20),
                      ),
                      for (final group in groups.entries) ...[
                        const SizedBox(height: 24),
                        Text(
                          tr('{group} 선택 (필수)', {'group': group.key}),
                          key: Key('option-group-${group.key}'),
                          style: const TextStyle(
                            fontSize: 22,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            for (final option in group.value)
                              ChoiceChip(
                                key: Key('option-${option.id}'),
                                selected: selectedOptions.contains(option.id),
                                labelPadding: const EdgeInsets.symmetric(
                                  horizontal: 16,
                                  vertical: 10,
                                ),
                                label: Text(
                                  option.isSoldOut
                                      ? '${option.name} (${tr('품절')})'
                                      : option.price > 0
                                      ? '${option.name} +${formatWon(option.price)}'
                                      : option.name,
                                  style: const TextStyle(fontSize: 20),
                                ),
                                // 같은 그룹은 하나만 고릅니다.
                                onSelected: option.isSoldOut
                                    ? null
                                    : (_) => updateDialog(() {
                                        selectedOptions
                                          ..removeAll(group.value.map((o) => o.id))
                                          ..add(option.id);
                                      }),
                              ),
                          ],
                        ),
                      ],
                      if (extras.isNotEmpty) ...[
                        const SizedBox(height: 24),
                        Text(
                          tr('추가 선택'),
                          style: const TextStyle(
                            fontSize: 22,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(height: 8),
                        for (final option in extras)
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
                                          ? '${option.name} (${tr('품절')})'
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
                        Text(tr('추가 가격은 메뉴 1개마다 적용됩니다.')),
                      ],
                      const SizedBox(height: 20),
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              tr('수량'),
                              style: const TextStyle(fontSize: 22),
                            ),
                          ),
                          _QuantitySelector(
                            quantity: quantity,
                            onMinus: quantity > 1
                                ? () => updateDialog(() => quantity--)
                                : null,
                            onPlus: quantity < CartController.maxQuantity
                                ? () => updateDialog(() => quantity++)
                                : null,
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Text(
                        tr('선택 금액 {price}', {
                          'price': formatWon(unitPrice * quantity),
                        }),
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
                  child: Text(tr('취소')),
                ),
                FilledButton(
                  style: FilledButton.styleFrom(
                    minimumSize: const Size(180, 56),
                  ),
                  // 필수 그룹을 모두 골라야 담을 수 있습니다.
                  onPressed:
                      groups.keys.every(
                        (group) => groups[group]!.any(
                          (o) => selectedOptions.contains(o.id),
                        ),
                      )
                      ? () => Navigator.pop(context, true)
                      : null,
                  child: Text(
                    editing == null ? tr('장바구니 담기') : tr('변경 저장'),
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
      _bus.run(AddItemCommand(menu, quantity, options: chosenOptions));
    } else {
      _bus.run(
        UpdateEntryCommand(editing.id, quantity, chosenOptions, menu.name),
      );
    }
    _showNotice(
      editing == null
          ? tr('{name} {count}개를 담았습니다.', {
              'name': menu.name,
              'count': quantity,
            })
          : tr('{name} 선택 내용을 변경했습니다.', {'name': menu.name}),
    );
  }

  @override
  Widget build(BuildContext context) => Listener(
    // 화면 어디를 만져도 무조작 시간을 다시 잽니다.
    behavior: HitTestBehavior.translucent,
    onPointerDown: (_) {
      _resetIdle();
      _orderStartedAt ??= DateTime.now();
      _orderTaps++;
    },
    child: _scaled(_buildScreen()),
  );

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
              tooltip: tr('설정'),
              onSelected: (_) => _openSettings(),
              itemBuilder: (_) => [
                PopupMenuItem(value: 'settings', child: Text(tr('키오스크 설정'))),
              ],
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.settings_outlined),
                    const SizedBox(width: 8),
                    Text(tr('설정')),
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
                  FilterChip(
                    key: const Key('senior-mode'),
                    selected: _senior,
                    onSelected: _setSenior,
                    avatar: const Icon(Icons.elderly),
                    label: Text(tr('크게·천천히')),
                  ),
                  OutlinedButton(
                    onPressed: _textSizeStep > -1
                        ? () => setState(() => _textSizeStep--)
                        : null,
                    child: Text(tr('글자 작게')),
                  ),
                  Text(
                    '${(_textScale * 100).round()}%',
                    key: const Key('text-size-value'),
                  ),
                  OutlinedButton(
                    onPressed: _textSizeStep < 2
                        ? () => setState(() => _textSizeStep++)
                        : null,
                    child: Text(tr('글자 크게')),
                  ),
                  PopupMenuButton<AppLanguage>(
                    tooltip: 'Language',
                    onSelected: (language) => L10n.instance.language = language,
                    itemBuilder: (context) => [
                      for (final language in AppLanguage.values)
                        PopupMenuItem(
                          value: language,
                          child: Text(language.label),
                        ),
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
            ? tr('AI 보이스크 · 메뉴 주문')
            : tr('AI 보이스크 · 메뉴 주문 · {mode}', {'mode': tr(widget.orderMode!)}),
      ),
      actions: [
        OutlinedButton.icon(
          onPressed: _staffCall,
          style: _feedbackStyle(),
          icon: const Icon(Icons.support_agent),
          label: Text(tr('직원 호출')),
        ),
        const SizedBox(width: 8),
        ListenableBuilder(
          listenable: _conversation ?? _noVoice,
          builder: (context, _) {
            final active = _conversation?.active ?? false;
            // 마이크는 누를 때만 켜집니다. 실제로 듣는 동안만 빨간 "듣는 중"이고,
            // 대화 중에 듣지 않을 때는 "말하기"(누르면 한 번 듣기)입니다.
            final listening = _conversation?.micOpen ?? false;
            return OutlinedButton.icon(
              key: const Key('voice-button'),
              onPressed: _startVoice,
              style: _feedbackStyle().copyWith(
                backgroundColor: listening
                    ? const WidgetStatePropertyAll(Color(0xFFD94F3D))
                    : null,
                foregroundColor: listening
                    ? const WidgetStatePropertyAll(Colors.white)
                    : null,
              ),
              icon: Icon(listening ? Icons.mic : Icons.mic_none),
              label: Text(
                listening
                    ? tr('듣는 중')
                    : active
                    ? tr('말하기')
                    : tr('말로 주문하기'),
              ),
            );
          },
        ),
        const SizedBox(width: 12),
      ],
    ),
    body: ScrollConfiguration(
      behavior: ScrollConfiguration.of(context)
          .copyWith(overscroll: false, physics: const ClampingScrollPhysics()),
      child: SafeArea(
        child: FutureBuilder<KioskCatalog>(
          future: _future,
          builder: (context, snapshot) {
            if (snapshot.hasError) {
              return Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(tr('메뉴를 불러오지 못했습니다.')),
                    FilledButton(
                      onPressed: () => setState(() => _future = _load()),
                      child: Text(tr('다시 시도')),
                    ),
                  ],
                ),
              );
            }
            if (!snapshot.hasData) {
              return const Center(child: CircularProgressIndicator());
            }
            final catalog = snapshot.data!;
            final menus = catalog.menus;
            final categories = ['전체', ...menus.map((m) => m.category).toSet()];
            final visible = menus
                .where((m) => _category == '전체' || m.category == _category)
                .toList();
            return Stack(
              children: [
                Column(
                  children: [
                    if (catalog.fromCache || _updatePending)
                      _statusBanner(catalog),
                    Expanded(child: _layout(categories, visible)),
                  ],
                ),
                if (_conversation != null)
                  ListenableBuilder(
                    listenable: _conversation!,
                    builder: (context, _) => _conversation!.active
                        ? Positioned(
                            left: 24,
                            // 오른쪽 장바구니(합계·결제하기)는 가리지 않습니다.
                            right:
                                (MediaQuery.sizeOf(context).width < 850
                                        ? 230.0
                                        : 320.0) *
                                    _textScale.clamp(1.0, 1.2) +
                                16,
                            bottom: 16,
                            child: Center(
                              child: ConstrainedBox(
                                constraints: const BoxConstraints(
                                  maxWidth: 980,
                                ),
                                child: VoicePanel(
                                  controller: _conversation!,
                                  images: _services?.images,
                                  onStaffCalled: (ok) => _showNotice(
                                    ok
                                        ? tr('직원을 호출했습니다')
                                        : tr('직원 호출을 보내지 못했습니다. 카운터에 말씀해 주세요.'),
                                  ),
                                ),
                              ),
                            ),
                          )
                        : const SizedBox.shrink(),
                  ),
              ],
            );
          },
        ),
      ),
    ),
  );

  Widget _statusBanner(KioskCatalog catalog) => Container(
    key: const Key('sync-banner'),
    width: double.infinity,
    color: catalog.fromCache
        ? const Color(0xFFFFF0DC)
        : const Color(0xFFEAF1ED),
    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
    child: Text(
      catalog.fromCache
          ? tr('서버에 연결되지 않아 마지막으로 받은 메뉴를 보여 드립니다. 주문은 연결되면 자동으로 전송됩니다.')
          : tr('새 메뉴 정보가 있습니다. 지금 주문이 끝나면 반영됩니다.'),
      style: const TextStyle(fontSize: 14),
    ),
  );

  Widget _layout(
    List<String> categories,
    List<MenuItem> visible,
  ) => LayoutBuilder(
    builder: (context, constraints) {
      final compact = constraints.maxWidth < 850;
      final cartWidth = (compact ? 230.0 : 320.0) * _textScale.clamp(1.0, 1.2);
      return Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            width: compact ? 100 : 124,
            color: const Color(0xFF153E39),
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
                padding: const EdgeInsets.symmetric(vertical: 12),
                children: [
                  for (final category in categories)
                    Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 4,
                      ),
                      child: FilledButton(
                        style: FilledButton.styleFrom(
                          backgroundColor: category == _category
                              ? const Color(0xFFBCE9D8)
                              : Colors.transparent,
                          foregroundColor: category == _category
                              ? const Color(0xFF153E39)
                              : Colors.white,
                          minimumSize: const Size(0, 64),
                          padding: const EdgeInsets.symmetric(horizontal: 4),
                        ),
                        onPressed: () => setState(() => _category = category),
                        // 분류 이름은 매장이 입력한 값이라 번역하지 않습니다('전체'만 화면 문구).
                        child: Text(
                          category == '전체' ? tr('전체') : category,
                          style: const TextStyle(fontSize: 18),
                        ),
                      ),
                    ),
                ],
              ),
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
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _category == '전체' ? tr('전체 메뉴') : _category,
                          style: const TextStyle(
                            fontSize: 24,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          _conversation == null
                              ? tr('메뉴를 눌러 수량을 선택해 주세요.')
                              : tr('메뉴를 누르거나, 위의 "말로 주문하기"를 눌러 말로 주문해 보세요.'),
                        ),
                      ],
                    ),
                  ),
                  Expanded(
                    child: visible.isEmpty
                        ? Center(child: Text(tr('등록된 메뉴가 없습니다.')))
                        : LayoutBuilder(
                            builder: (context, gridConstraints) {
                              final columns = (gridConstraints.maxWidth / 180)
                                  .floor()
                                  .clamp(1, 4);
                              return RawScrollbar(
                                key: const Key('menu-scrollbar'),
                                controller: _menuScrollController,
                                thumbVisibility: true,
                                trackVisibility: true,
                                interactive: true,
                                thickness: 10,
                                radius: const Radius.circular(5),
                                thumbColor: const Color(0xFF246B58),
                                trackColor: const Color(0xFFDDE7E1),
                                child: GridView.builder(
                                  controller: _menuScrollController,
                                  primary: false,
                                  padding: const EdgeInsets.fromLTRB(
                                    12,
                                    0,
                                    12,
                                    12,
                                  ),
                                  gridDelegate:
                                      SliverGridDelegateWithFixedCrossAxisCount(
                                        crossAxisCount: columns,
                                        mainAxisExtent:
                                            210 * _textScale.clamp(1.0, 1.2),
                                        crossAxisSpacing: 12,
                                        mainAxisSpacing: 12,
                                      ),
                                  itemCount: visible.length,
                                  itemBuilder: (context, index) =>
                                      _menuCard(visible[index]),
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
  );

  Widget _menuCard(MenuItem menu) {
    final highlighted = _highlighted.contains(menu.id);
    return AnimatedContainer(
      key: ValueKey('menu-card-${menu.id}'),
      duration: const Duration(milliseconds: 250),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: highlighted ? const Color(0xFFD94F3D) : Colors.transparent,
          width: 4,
        ),
      ),
      child: Card(
        margin: EdgeInsets.zero,
        color: menu.isSoldOut ? const Color(0xFFEEEEEE) : Colors.white,
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: menu.isSoldOut ? null : () => _selectMenu(menu),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              children: [
                Expanded(
                  child: Center(
                    child: MenuImage(menu: menu, store: _services?.images),
                  ),
                ),
                if (menu.isSoldOut)
                  Text(
                    tr('품절'),
                    style: const TextStyle(
                      color: Color(0xFFB3261E),
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                if (menu.storePick && !menu.isSoldOut)
                  Text(
                    tr('추천'),
                    style: const TextStyle(
                      color: Color(0xFFBB743A),
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                const SizedBox(height: 8),
                Text(
                  menu.name,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 19,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  formatWon(menu.price),
                  style: const TextStyle(
                    fontSize: 18,
                    color: Color(0xFF246B58),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _clearCart() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => _scaled(
        AlertDialog(
          title: Text(tr('장바구니 전체 비우기')),
          content: Text(tr('담긴 음식을 모두 삭제할까요?')),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: Text(tr('취소')),
            ),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: Text(tr('모두 삭제')),
            ),
          ],
        ),
      ),
    );
    if (mounted && confirmed == true) _bus.run(const ClearCartCommand());
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
                  tr('장바구니 · {count}개', {'count': _cart.itemCount}),
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
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
              label: Text(tr('전체 비우기')),
            ),
          ),
        ),
        Expanded(
          child: _cart.entries.isEmpty
              ? Center(
                  child: Text(
                    tr('메뉴를 담으면 여기에 표시됩니다.'),
                    textAlign: TextAlign.center,
                  ),
                )
              : ListView(children: _cart.entries.map(_cartEntry).toList()),
        ),
        const Divider(height: 1),
        Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Expanded(
                child: Text(tr('합계 금액'), style: const TextStyle(fontSize: 20)),
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
            label: Text(
              const bool.fromEnvironment('PAYMENT_DEMO', defaultValue: true)
                  ? tr('결제하기')
                  : tr('주문 완료'),
            ),
          ),
        ),
      ],
    ),
  );

  Widget _cartEntry(CartEntry entry) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
    child: InkWell(
      key: ValueKey('cart-entry-${entry.id}'),
      onTap: () => _selectMenu(entry.menu, editing: entry),
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
              if (entry.recommended)
                Padding(
                  padding: const EdgeInsets.only(right: 4),
                  child: Icon(
                    Icons.auto_awesome,
                    size: 18,
                    color: Colors.orange.shade700,
                    semanticLabel: tr('추천'),
                  ),
                ),
              IconButton(
                tooltip: tr('{name} 삭제', {'name': entry.menu.name}),
                onPressed: () =>
                    _bus.run(RemoveEntryCommand(entry.id, entry.menu.name)),
                icon: const Icon(Icons.delete_outline),
              ),
            ],
          ),
          if (entry.options.isNotEmpty)
            Text(
              entry.options
                  .map((option) => '${option.name} +${formatWon(option.price)}')
                  .join(' · '),
            ),
          Text(
            '${formatWon(entry.unitPrice)} × ${entry.quantity} = ${formatWon(entry.subtotal)}',
          ),
          _QuantitySelector(
            quantity: entry.quantity,
            onMinus: entry.quantity > 1
                ? () => _bus.run(
                    SetQuantityCommand(
                      entry.id,
                      entry.quantity - 1,
                      entry.menu.name,
                    ),
                  )
                : null,
            onPlus: entry.quantity < CartController.maxQuantity
                ? () => _bus.run(
                    SetQuantityCommand(
                      entry.id,
                      entry.quantity + 1,
                      entry.menu.name,
                    ),
                  )
                : null,
          ),
          Text(
            tr('눌러서 옵션 수정'),
            style: const TextStyle(fontSize: 12, color: Color(0xFF246B58)),
          ),
        ],
      ),
    ),
  );
}

/// 직원 호출 결과 안내. 서버 연결이 없으면 시연 안내임을 함께 표시합니다.
class _StaffCallDialog extends StatefulWidget {
  const _StaffCallDialog({required this.sent, required this.demo});
  final bool sent;
  final bool demo;
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
    content: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          widget.sent
              ? tr('직원을 호출했습니다')
              : tr('직원 호출을 보내지 못했습니다. 카운터에 말씀해 주세요.'),
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 22),
        ),
        if (widget.demo)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              tr('시연 모드에서는 실제 알림을 보내지 않습니다.'),
              style: const TextStyle(fontSize: 14),
            ),
          ),
      ],
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.of(context).pop(),
        child: Text(tr('닫기')),
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
  final VoidCallback? onPlus;
  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      IconButton(
        tooltip: tr('수량 줄이기'),
        onPressed: onMinus,
        icon: const Icon(Icons.remove_circle_outline),
      ),
      Text(
        tr('{count}개', {'count': quantity}),
        style: const TextStyle(fontSize: 20),
      ),
      IconButton(
        tooltip: tr('수량 늘리기'),
        onPressed: onPlus,
        icon: const Icon(Icons.add_circle_outline),
      ),
    ],
  );
}

/// 아무 조작이 없을 때 "계속 주문하시겠어요?"를 묻습니다. 시간이 지나면 처음 화면으로 돌아갑니다.
class _IdleDialog extends StatefulWidget {
  const _IdleDialog({required this.timeout});
  final Duration timeout;

  @override
  State<_IdleDialog> createState() => _IdleDialogState();
}

class _IdleDialogState extends State<_IdleDialog> {
  late int _left = widget.timeout.inSeconds;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      if (_left <= 1) {
        _timer?.cancel();
        Navigator.of(context).pop(false);
        return;
      }
      setState(() => _left--);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    key: const Key('idle-dialog'),
    title: Text(tr('계속 주문하시겠어요?'), style: const TextStyle(fontSize: 26)),
    content: Text(
      tr('{seconds}초 뒤 처음 화면으로 돌아가고 장바구니가 비워집니다.', {'seconds': _left}),
      style: const TextStyle(fontSize: 20),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.of(context).pop(false),
        child: Text(tr('처음으로'), style: const TextStyle(fontSize: 20)),
      ),
      FilledButton(
        style: FilledButton.styleFrom(minimumSize: const Size(200, 60)),
        onPressed: () => Navigator.of(context).pop(true),
        child: Text(tr('계속 주문하기'), style: const TextStyle(fontSize: 22)),
      ),
    ],
  );
}
