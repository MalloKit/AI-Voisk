import 'package:flutter/material.dart';

import '../../core/kiosk_services.dart';
import '../../core/l10n.dart';
import '../controllers/cart_controller.dart';
import '../data/order_repository.dart';

/// 실제 결제 없이 주문을 저장하는 확인 창(PAYMENT_DEMO=false).
/// 기기 토큰 모드에서는 주문을 Outbox에 먼저 저장하므로, 서버가 끊겨 있어도 접수 후 자동 전송합니다.
class CheckoutDialog extends StatefulWidget {
  const CheckoutDialog({
    super.key,
    required this.entries,
    required this.repository,
    required this.storeId,
    required this.deviceId,
    this.orderMode,
    this.gateway,
    this.orderChannel,
  });
  final List<CartEntry> entries;
  final OrderRepository repository;
  final OrderGateway? gateway;
  final String? orderChannel;
  final int storeId;
  final int deviceId;
  final String? orderMode;
  @override
  State<CheckoutDialog> createState() => _CheckoutDialogState();
}

class _CheckoutDialogState extends State<CheckoutDialog> {
  PendingOrder? pending;
  bool sending = false;
  bool rejectedWithoutSave = false;
  bool queued = false;
  int? orderId;
  String? error;

  bool get done => orderId != null || queued;

  Future<void> submit() async {
    if (sending || done) return;
    if (!['포장', '매장 식사'].contains(widget.orderMode)) {
      setState(() => error = tr('시작 화면에서 주문 방식을 선택해 주세요.'));
      return;
    }
    if (widget.storeId < 1 || widget.deviceId < 1) {
      setState(() => error = '실제 매장·기기 ID를 실행 설정에 지정해 주세요.');
      return;
    }
    if (widget.gateway == null) {
      if (widget.repository case ApiOrderRepository(:final baseUrl)) {
        final uri = Uri.tryParse(baseUrl);
        if (uri == null ||
            !['http', 'https'].contains(uri.scheme) ||
            uri.host.isEmpty) {
          setState(() => error = '주문 API 주소를 실행 설정에 지정해 주세요.');
          return;
        }
      }
    }
    try {
      pending ??= PendingOrder(
        entries: widget.entries,
        storeId: widget.storeId,
        deviceId: widget.deviceId,
        orderType: widget.orderMode == '포장' ? 'takeaway' : 'dine_in',
        orderChannel: widget.orderChannel,
      );
    } on FormatException {
      setState(() => error = 'Mock 메뉴는 저장할 수 없습니다. DB 메뉴 API를 연결해 주세요.');
      return;
    }
    setState(() {
      sending = true;
      rejectedWithoutSave = false;
      error = null;
    });
    try {
      final gateway = widget.gateway;
      if (gateway != null) {
        final result = await gateway.submit(pending!);
        if (!mounted) return;
        setState(() {
          switch (result) {
            case OrderSent(:final orderId):
              this.orderId = orderId ?? 0;
            case OrderQueued():
              queued = true;
            case OrderRejected(:final message):
              rejectedWithoutSave = true;
              error = message;
          }
        });
        return;
      }
      final id = await widget.repository.submit(pending!);
      if (mounted) setState(() => orderId = id);
    } catch (e) {
      if (mounted) {
        setState(() {
          rejectedWithoutSave = e is OrderValidationError;
          error = e is StateError
              ? e.message.toString()
              : tr('연결이 지연되거나 실패했습니다. 같은 주문으로 다시 시도해 주세요.');
        });
      }
    } finally {
      if (mounted) setState(() => sending = false);
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: pending == null || done || rejectedWithoutSave,
    child: AlertDialog(
      title: Text(done ? tr('주문이 완료되었습니다') : tr('주문 내용 확인')),
      content: SizedBox(
        width: 360,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (orderId != null)
              Text(tr('주문 번호 #{id}', {'id': orderId}))
            else if (queued)
              Text(tr('주문을 접수했습니다. 서버 연결이 복구되면 자동으로 전송됩니다.'))
            else ...[
              Text(tr('실제 결제 없이 주문을 저장합니다.')),
              const SizedBox(height: 16),
              Text(
                tr('주문 방식: {mode}', {
                  'mode': widget.orderMode == null
                      ? tr('선택되지 않음')
                      : tr(widget.orderMode!),
                }),
              ),
              const SizedBox(height: 16),
              ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 240),
                child: SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      for (final entry in widget.entries) ...[
                        Text(
                          '${entry.menu.name} · ${tr('{count}개', {'count': entry.quantity})}',
                        ),
                        if (entry.options.isNotEmpty)
                          Text(
                            tr('옵션: {names}', {
                              'names': entry.options
                                  .map((o) => o.name)
                                  .join(', '),
                            }),
                          ),
                        const SizedBox(height: 8),
                      ],
                    ],
                  ),
                ),
              ),
              if (error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 16),
                  child: Text(
                    error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ),
              if (pending != null && error != null && !rejectedWithoutSave)
                Text(tr('중복 방지를 위해 같은 주문으로 재시도합니다. 화면을 새로고침하지 마세요.')),
            ],
          ],
        ),
      ),
      actions: [
        if (pending == null)
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(tr('취소')),
          ),
        if (rejectedWithoutSave)
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(tr('주문 수정')),
          ),
        if (done)
          FilledButton(
            onPressed: () => Navigator.pop(context, orderId ?? 0),
            child: Text(tr('확인')),
          )
        else
          FilledButton(
            onPressed: sending ? null : submit,
            child: Text(
              sending
                  ? tr('저장 중…')
                  : pending == null
                  ? tr('주문 저장')
                  : tr('같은 주문 재시도'),
            ),
          ),
      ],
    ),
  );
}
