import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../controllers/cart_controller.dart';
import '../models/menu_item.dart';
import '../data/kakaopay_repository.dart';
import '../data/order_repository.dart';
import 'kakaopay_checkout_view.dart';

enum PaymentMethod {
  card('카드 결제', Icons.credit_card),
  kakao('카카오페이', Icons.chat_bubble_outline),
  naver('네이버페이', Icons.account_balance_wallet_outlined),
  cash('현금 결제', Icons.payments_outlined);

  const PaymentMethod(this.label, this.icon);
  final String label;
  final IconData icon;
}

/// 외부 결제·주문 API를 호출하지 않는 화면 시연입니다.
class PaymentScreen extends StatefulWidget {
  const PaymentScreen({
    super.key,
    required this.entries,
    this.orderMode,
    this.storeId = 0,
    this.deviceId = 0,
    this.kakaoRepository,
  });
  final List<CartEntry> entries;
  final String? orderMode;
  final int storeId;
  final int deviceId;
  final KakaoTestRepository? kakaoRepository;

  @override
  State<PaymentScreen> createState() => _PaymentScreenState();
}

class _PaymentScreenState extends State<PaymentScreen> {
  PaymentMethod? method;
  int step = 0;
  String? error;
  bool busy = false;
  Map<String, dynamic>? kakaoSession;
  PendingOrder? kakaoOrder;
  PendingOrder? pendingCounterOrder;
  int? savedOrderId;

  Future<void> submitCounterOrder() async {
    if (busy) return;
    final selected = method;
    final saveEnabled = selected == PaymentMethod.cash
        ? const bool.fromEnvironment('KIOSK_SAVE_CASH_ORDERS')
        : const bool.fromEnvironment('KIOSK_SAVE_DEMO_PAYMENTS') &&
              (selected == PaymentMethod.card ||
                  selected == PaymentMethod.naver);
    if (!saveEnabled) {
      setState(() => step = 2);
      return;
    }
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final order = pendingCounterOrder ??= PendingOrder(
        entries: widget.entries,
        storeId: widget.storeId,
        deviceId: widget.deviceId,
        orderType: widget.orderMode == '포장' ? 'takeaway' : 'dine_in',
      );
      final repository = ApiOrderRepository(
        baseUrl: const String.fromEnvironment(
          'ORDER_API_BASE_URL',
          defaultValue: String.fromEnvironment('MENU_API_BASE_URL'),
        ),
      );
      final id = selected == PaymentMethod.cash
          ? await repository.submitCashOrder(order, total)
          : await repository.submitDemoPayment(
              order,
              selected == PaymentMethod.card ? 'card' : 'naverpay',
              total,
            );
      if (!mounted) return;
      setState(() {
        savedOrderId = id;
        pendingCounterOrder = null;
        step = 2;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        if (e is OrderValidationError) pendingCounterOrder = null;
        error = e is OrderValidationError
            ? e.message.toString()
            : '주문 저장 결과를 확인하지 못했습니다. 같은 버튼을 눌러 다시 시도해 주세요.';
      });
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  bool get kakaoEnabled =>
      widget.kakaoRepository != null ||
      const bool.fromEnvironment('KAKAOPAY_TEST');
  bool get kakaoActive => method == PaymentMethod.kakao && kakaoEnabled;
  bool get kakaoPending =>
      kakaoSession != null &&
      ![
        'approved',
        'cancelled',
        'failed',
        'expired',
      ].contains(kakaoSession!['status']);
  KakaoTestRepository get kakao =>
      widget.kakaoRepository ??
      KakaoTestRepository(
        baseUrl: const String.fromEnvironment(
          'ORDER_API_BASE_URL',
          defaultValue: String.fromEnvironment('MENU_API_BASE_URL'),
        ),
      );

  Future<void> kakaoRequest({bool prepare = false, bool cancel = false}) async {
    if (busy) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      Map<String, dynamic> result;
      if (prepare) {
        if (widget.storeId < 1 ||
            widget.deviceId < 1 ||
            !['포장', '매장 식사'].contains(widget.orderMode)) {
          throw StateError('실제 매장·기기 ID와 주문 방식을 확인해 주세요.');
        }
        kakaoOrder ??= PendingOrder(
          entries: widget.entries,
          storeId: widget.storeId,
          deviceId: widget.deviceId,
          orderType: widget.orderMode == '포장' ? 'takeaway' : 'dine_in',
        );
        result = await kakao.ready(kakaoOrder!);
      } else {
        final id = kakaoSession!['payment_id'] as String;
        result = cancel
            ? await kakao.abandon(id)
            : kakaoSession?['status'] == 'save_failed'
            ? await kakao.retrySave(id)
            : await kakao.status(id);
      }
      if (!mounted) return;
      setState(() {
        kakaoSession = result;
        if (result['status'] == 'approved' && result['total_amount'] == total) {
          step = 2;
        } else if (result['total_amount'] != total) {
          error = '서버 금액과 장바구니 금액이 다릅니다. 대기 취소 후 메뉴를 다시 불러와 주세요.';
        } else if (result['status'] == 'unknown') {
          error = '승인 결과 확인이 필요합니다. 새 결제를 만들지 말고 개발자센터에서 확인해 주세요.';
        } else if (result['status'] == 'save_failed') {
          error = stoppedMessage('save_failed');
        } else if ([
          'cancelled',
          'failed',
          'expired',
        ].contains(result['status'])) {
          error = stoppedMessage(result['status']);
        }
      });
    } catch (e) {
      if (mounted) {
        setState(
          () => error = e is StateError
              ? e.message.toString()
              : '연결 실패. 같은 요청으로 다시 확인해 주세요.',
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  String stoppedMessage(dynamic status) => switch (status) {
    'save_failed' => '결제는 승인됐지만 주문 저장에 실패했습니다. 주문 저장만 다시 시도해 주세요.',
    'expired' => '결제 대기 시간이 지났습니다. 장바구니는 유지됩니다. 다시 결제해 주세요.',
    'failed' => '결제를 완료하지 못했습니다. 장바구니는 유지됩니다. 다시 시도하거나 다른 수단을 선택해 주세요.',
    _ => '결제 대기를 취소했습니다. 장바구니는 유지됩니다.',
  };

  void retryKakao() {
    if (busy || kakaoPending) return;
    setState(() {
      kakaoSession = null;
      kakaoOrder = null;
      error = null;
    });
    kakaoRequest(prepare: true);
  }

  int get total => widget.entries.fold(0, (sum, item) => sum + item.subtotal);

  void changeMethod() {
    if (busy || kakaoPending || pendingCounterOrder != null) return;
    setState(() {
      step = 0;
      error = null;
      if (kakaoSession != null &&
          [
            'cancelled',
            'failed',
            'expired',
          ].contains(kakaoSession!['status'])) {
        kakaoSession = null;
        kakaoOrder = null;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    const green = Color(0xFF00695C);
    final cash = method == PaymentMethod.cash;
    return ScrollConfiguration(
      behavior: const MaterialScrollBehavior().copyWith(
        overscroll: false,
        physics: const ClampingScrollPhysics(),
      ),
      child: PopScope(
        canPop: step == 0 && !busy,
        onPopInvokedWithResult: (didPop, result) {
          if (didPop) return;
          if (step == 2) {
            Navigator.pop(context, true);
          } else {
            changeMethod();
          }
        },
        child: Scaffold(
          backgroundColor: const Color(0xFFF5F8F6),
          appBar: AppBar(
            toolbarHeight: 48,
            backgroundColor: const Color(0xFFF5F8F6),
            automaticallyImplyLeading: false,
            leading: step == 2
                ? null
                : IconButton(
                    tooltip: step == 0 ? '주문으로 돌아가기' : '결제 수단 다시 선택',
                    icon: const Icon(Icons.arrow_back),
                    onPressed: step == 0
                        ? () => Navigator.pop(context, false)
                        : changeMethod,
                  ),
            title: Text(
              step == 2
                  ? (cash ? '현금 결제 안내' : '결제 완료')
                  : '결제하기',
            ),
          ),
          body: SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (kakaoActive) ...[
                    const Text(
                      '카카오페이 · 실제 청구 없음',
                      style: TextStyle(
                        color: green,
                        fontSize: 17,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 8),
                  ],
                  Expanded(
                    child: step == 2
                        ? _fitPanel(_completion(cash, green))
                        : LayoutBuilder(
                            builder: (context, bounds) {
                              Widget payment() => LayoutBuilder(
                                builder: (context, panel) {
                                  final content = _payment(
                                    green,
                                    availableHeight: step == 0 || kakaoActive
                                        ? panel.maxHeight
                                        : null,
                                  );
                                  final embedded =
                                      step == 1 &&
                                      kakaoActive &&
                                      kakaoSession?['status'] == 'ready' &&
                                      kakaoSession?['checkout_url'] != null &&
                                      kakaoSession?['total_amount'] == total;
                                  // 네이티브 WebView를 FittedBox로 변환하지 않습니다.
                                  return embedded
                                      ? content
                                      : _fitPanel(content);
                                },
                              );
                              if (bounds.maxWidth >= 640) {
                                return Row(
                                  crossAxisAlignment:
                                      CrossAxisAlignment.stretch,
                                  children: [
                                    Expanded(child: _summary()),
                                    const SizedBox(width: 24),
                                    Expanded(flex: 2, child: payment()),
                                  ],
                                );
                              }
                              return Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  SizedBox(
                                    height: bounds.maxHeight * .36,
                                    child: _summary(),
                                  ),
                                  const SizedBox(height: 12),
                                  Expanded(child: payment()),
                                ],
                              );
                            },
                          ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  // 화면 전체는 고정하고, 높이가 부족하면 결제 패널만 축소합니다.
  Widget _fitPanel(Widget child) => LayoutBuilder(
    builder: (context, bounds) => FittedBox(
      fit: BoxFit.scaleDown,
      alignment: Alignment.topCenter,
      child: SizedBox(width: bounds.maxWidth, child: child),
    ),
  );

  Widget _completion(bool cash, Color green) {
    final statusColor = cash ? const Color(0xFF956000) : green;
    final cashOrderId = cash ? savedOrderId : null;
    final quantity = widget.entries.fold(
      0,
      (sum, entry) => sum + entry.quantity,
    );
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 680),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              cash ? Icons.storefront_outlined : Icons.check_circle_outline,
              size: 64,
              color: statusColor,
            ),
            const SizedBox(height: 12),
            Text(
              cashOrderId != null
                  ? '현금 수납 대기'
                  : cash
                  ? '카운터에서 현금으로 결제해 주세요'
                  : kakaoActive
                  ? '카카오페이 승인 완료'
                  : '결제가 완료되었습니다',
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
            ),
            if (cash) ...[
              const SizedBox(height: 8),
              Text(
                cashOrderId != null
                    ? '카운터에 주문번호를 보여 주고 아래 금액을 결제해 주세요.'
                    : '현금 수납 전입니다. 결제 완료 상태가 아닙니다.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 17, color: statusColor),
              ),
            ],
            const SizedBox(height: 20),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 18),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: const Color(0xFFDCE5E0)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (cashOrderId != null) ...[
                    const Text(
                      '주문번호',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 17),
                    ),
                    Text(
                      '$cashOrderId번',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 44,
                        fontWeight: FontWeight.bold,
                        color: statusColor,
                      ),
                    ),
                    const Divider(height: 20),
                  ],
                  Text(
                    cash ? '카운터에서 결제할 금액' : '결제 금액',
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 17),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    formatWon(total),
                    key: const Key('payment-completion-total'),
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 36,
                      fontWeight: FontWeight.bold,
                      color: statusColor,
                    ),
                  ),
                  const Divider(height: 24),
                  _completionDetail('결제 수단', method!.label),
                  const SizedBox(height: 8),
                  _completionDetail('주문 방식', widget.orderMode ?? '미선택'),
                  const SizedBox(height: 8),
                  _completionDetail('메뉴 수량', '총 $quantity개'),
                ],
              ),
            ),
            if (cashOrderId == null) ...[
              const SizedBox(height: 14),
              Text(
                kakaoActive && kakaoSession?['order_saved'] == true
                    ? '주문번호 ${kakaoSession!['order_id']}'
                    : savedOrderId != null
                    ? '주문번호 $savedOrderId'
                    : '매장에 주문이 접수되지 않았으며 주문번호는 발급되지 않습니다.',
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 16, color: Color(0xFF52625B)),
              ),
            ],
            const SizedBox(height: 18),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              style: FilledButton.styleFrom(
                backgroundColor: green,
                minimumSize: const Size(0, 56),
              ),
              child: const Text(
                '확인 · 장바구니 비우기',
                style: TextStyle(fontSize: 21),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _completionDetail(String label, String value) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      SizedBox(
        width: 110,
        child: Text(
          label,
          style: const TextStyle(fontSize: 18, color: Color(0xFF52625B)),
        ),
      ),
      Expanded(
        child: Text(
          value,
          textAlign: TextAlign.end,
          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
        ),
      ),
    ],
  );

  Widget _summary() => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      const Text(
        '주문 내용',
        style: TextStyle(fontSize: 25, fontWeight: FontWeight.bold),
      ),
      const SizedBox(height: 12),
      Text(
        widget.orderMode ?? '주문 방식 미선택',
        style: const TextStyle(fontSize: 18),
      ),
      const Divider(height: 32),
      Expanded(
        child: SingleChildScrollView(
          key: const Key('payment-order-list'),
          physics: const ClampingScrollPhysics(),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final entry in widget.entries) ...[
                Text(
                  '${entry.menu.name} · ${entry.quantity}개',
                  style: const TextStyle(fontSize: 20),
                ),
                if (entry.options.isNotEmpty)
                  Text(
                    entry.options
                        .map((o) => '${o.name} +${formatWon(o.price)}')
                        .join(', '),
                    style: const TextStyle(
                      fontSize: 16,
                      color: Color(0xFF52645C),
                    ),
                  ),
                const SizedBox(height: 6),
                Text(
                  formatWon(entry.subtotal),
                  style: const TextStyle(fontSize: 19),
                ),
                const SizedBox(height: 20),
              ],
            ],
          ),
        ),
      ),
      const Divider(),
      const Text('총 결제 금액', style: TextStyle(fontSize: 19)),
      Text(
        formatWon(total),
        key: const Key('payment-total'),
        style: const TextStyle(fontSize: 32, fontWeight: FontWeight.bold),
      ),
    ],
  );

  Widget _kakaoPanel(Color green, double? height) {
    final session = kakaoSession;
    final stopped = [
      'cancelled',
      'failed',
      'expired',
    ].contains(session?['status']);
    final url = session?['browser_url'] as String?;
    final canOpen =
        session?['status'] == 'ready' && session?['total_amount'] == total;
    final checkoutUrl = session?['checkout_url'] as String?;
    if (canOpen && checkoutUrl != null) {
      return SizedBox(
        height: height ?? 420,
        child: KakaoCheckoutView(
          key: ValueKey(session!['payment_id']),
          repository: kakao,
          paymentId: session['payment_id'] as String,
          checkoutUrl: checkoutUrl,
          expiresIn: session['expires_in'] as int?,
          onResult: (result) {
            if (!mounted) return;
            setState(() {
              kakaoSession = result;
              if (result['status'] == 'approved' &&
                  result['total_amount'] == total) {
                step = 2;
                error = null;
              } else {
                error = result['status'] == 'unknown'
                    ? '승인 여부를 확인할 수 없습니다. 새 결제를 만들지 말고 개발자센터에서 확인해 주세요.'
                    : stoppedMessage(result['status']);
              }
            });
          },
        ),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          session?['status'] == 'failed' ? '결제 실패' : '카카오페이 결제',
          style: const TextStyle(fontSize: 26, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 16),
        Text('결제 금액 ${formatWon(total)}', style: const TextStyle(fontSize: 22)),
        const SizedBox(height: 12),
        Text(
          session == null
              ? '키오스크 안에서 카카오페이 공식 QR 결제창을 준비합니다.'
              : canOpen
              ? '서버가 이전 버전입니다. API 서버를 재시작하면 앱 안에서 QR을 표시할 수 있습니다.'
              : '서버에서 결제 결과를 확인합니다.',
          style: const TextStyle(fontSize: 18),
        ),
        if (error != null) ...[
          const SizedBox(height: 12),
          Text(
            error!,
            style: TextStyle(
              color: Theme.of(context).colorScheme.error,
              fontSize: 17,
            ),
          ),
        ],
        if (canOpen && url != null) ...[
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: busy
                ? null
                : () async {
                    await Clipboard.setData(ClipboardData(text: url));
                    if (mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('PC 브라우저 주소창에 붙여 넣어 주세요.'),
                        ),
                      );
                    }
                  },
            icon: const Icon(Icons.copy),
            label: const Text('PC 결제 주소 복사'),
          ),
          const Text(
            'PC에서 결제를 마친 뒤 아래 결과 확인을 눌러 주세요.',
            style: TextStyle(fontSize: 17),
          ),
        ],
        const SizedBox(height: 16),
        FilledButton(
          onPressed: busy
              ? null
              : stopped
              ? retryKakao
              : () => kakaoRequest(prepare: session == null),
          style: FilledButton.styleFrom(
            backgroundColor: green,
            minimumSize: const Size(0, 56),
          ),
          child: Text(
            busy
                ? '확인 중…'
                : stopped
                ? '카카오페이 다시 시도'
                : session?['status'] == 'save_failed'
                ? '주문 저장 다시 시도'
                : session == null
                ? '결제 준비'
                : '결제 결과 확인',
            style: const TextStyle(fontSize: 21),
          ),
        ),
        if (session?['status'] == 'ready')
          TextButton(
            onPressed: busy ? null : () => kakaoRequest(cancel: true),
            child: const Text('결제 취소'),
          ),
        TextButton(
          onPressed: busy || kakaoPending ? null : changeMethod,
          child: const Text('결제 수단 다시 선택'),
        ),
        if (kakaoPending)
          const Text(
            '결제 진행 중에는 결과를 확인하거나 대기를 취소한 뒤 돌아갈 수 있습니다.',
            style: TextStyle(fontSize: 15),
          ),
      ],
    );
  }

  Widget _payment(Color green, {double? availableHeight}) {
    if (step == 1 && kakaoActive) return _kakaoPanel(green, availableHeight);
    if (step == 1) {
      final cash = method == PaymentMethod.cash;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            method!.label,
            style: const TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 24),
          Icon(method!.icon, size: 80, color: green),
          const SizedBox(height: 24),
          Text(
            switch (method!) {
              PaymentMethod.card => '실제 서비스에서는 카드 단말기 안내에 따라 결제합니다.',
              PaymentMethod.kakao ||
              PaymentMethod.naver => '실제 서비스에서는 결제 서비스가 제공하는 QR 또는 바코드로 진행합니다.',
              PaymentMethod.cash =>
                '현금은 카운터에서 직원에게 지불합니다.\n키오스크에서는 현금을 받지 않습니다.',
            },
            style: const TextStyle(fontSize: 21),
            textAlign: TextAlign.center,
          ),
          if (error != null) ...[
            const SizedBox(height: 20),
            Text(
              error!,
              style: TextStyle(
                fontSize: 19,
                color: Theme.of(context).colorScheme.error,
              ),
            ),
          ],
          const SizedBox(height: 28),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: green,
              minimumSize: const Size(0, 64),
            ),
            onPressed: busy ? null : submitCounterOrder,
            child: Text(
              busy
                  ? '저장 중…'
                  : cash
                  ? '현금 결제 안내 확인'
                  : '결제',
              style: const TextStyle(fontSize: 21),
            ),
          ),
          const SizedBox(height: 12),
          TextButton(
            onPressed: busy || pendingCounterOrder != null
                ? null
                : changeMethod,
            child: const Text(
              '취소 · 결제 수단 다시 선택',
              style: TextStyle(fontSize: 18),
            ),
          ),
        ],
      );
    }
    return Column(
      mainAxisAlignment: availableHeight == null
          ? MainAxisAlignment.start
          : MainAxisAlignment.spaceBetween,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
          '결제 방법을 선택해 주세요',
          style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 12),
        LayoutBuilder(
          builder: (context, constraints) => Wrap(
            spacing: 12,
            runSpacing: 12,
            children: [
              for (final value in PaymentMethod.values)
                SizedBox(
                  key: ValueKey('payment-method-${value.name}'),
                  height: availableHeight == null
                      ? 72 + 40 * MediaQuery.textScalerOf(context).scale(1)
                      : ((availableHeight -
                                    128 *
                                        MediaQuery.textScalerOf(context)
                                            .scale(1)) /
                                2)
                            .clamp(112, 500),
                  width:
                      constraints.maxWidth <
                          340 * MediaQuery.textScalerOf(context).scale(1)
                      ? constraints.maxWidth
                      : (constraints.maxWidth - 12) / 2,
                  child: OutlinedButton(
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.all(12),
                      minimumSize: const Size(0, 48),
                      foregroundColor: green,
                      backgroundColor: method == value
                          ? const Color(0xFFD5EEE3)
                          : Colors.white,
                      side: BorderSide(
                        color: method == value
                            ? green
                            : const Color(0xFFB9C8C1),
                        width: 2,
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(16),
                      ),
                    ),
                    onPressed: widget.entries.isEmpty
                        ? null
                        : () {
                            setState(() {
                              method = value;
                              step = 1;
                              error = null;
                            });
                            if (value == PaymentMethod.kakao && kakaoEnabled) {
                              kakaoRequest(prepare: kakaoSession == null);
                            }
                          },
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(value.icon, size: 28),
                        const SizedBox(height: 8),
                        SizedBox(
                          height:
                              28 * MediaQuery.textScalerOf(context).scale(1),
                          child: Center(
                            child: Text(
                              value.label,
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                fontSize: 22,
                                height: 1.2,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 2),
                        SizedBox(
                          height:
                              18 * MediaQuery.textScalerOf(context).scale(1),
                          child: Center(
                            child: value == PaymentMethod.cash
                                ? const Text(
                                    '카운터 결제',
                                    style: TextStyle(fontSize: 15, height: 1.2),
                                  )
                                : null,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}
