import 'package:flutter/material.dart';

import '../controllers/cart_controller.dart';
import '../data/order_repository.dart';

class CheckoutDialog extends StatefulWidget {
  const CheckoutDialog({
    super.key,
    required this.entries,
    required this.repository,
    required this.storeId,
    required this.deviceId,
    this.orderMode,
  });
  final List<CartEntry> entries;
  final OrderRepository repository;
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
  int? orderId;
  String? error;
  Future<void> submit() async {
    if (sending || orderId != null) return;
    if (!['포장', '매장 식사'].contains(widget.orderMode)) {
      setState(() => error = '시작 화면에서 주문 방식을 선택해 주세요.');
      return;
    }
    if (widget.storeId < 1 || widget.deviceId < 1) {
      setState(() => error = '실제 매장·기기 ID를 실행 설정에 지정해 주세요.');
      return;
    }
    if (widget.repository case ApiOrderRepository(:final baseUrl)) {
      final uri = Uri.tryParse(baseUrl);
      if (uri == null ||
          !['http', 'https'].contains(uri.scheme) ||
          uri.host.isEmpty) {
        setState(() => error = '주문 API 주소를 실행 설정에 지정해 주세요.');
        return;
      }
    }
    try {
      pending ??= PendingOrder(
        entries: widget.entries,
        storeId: widget.storeId,
        deviceId: widget.deviceId,
        orderType: widget.orderMode == '포장' ? 'takeaway' : 'dine_in',
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
      final id = await widget.repository.submit(pending!);
      if (mounted) setState(() => orderId = id);
    } catch (e) {
      if (mounted) {
        setState(() {
          rejectedWithoutSave = e is OrderValidationError;
          error = e is StateError
              ? e.message.toString()
              : '연결이 지연되거나 실패했습니다. 같은 주문으로 다시 시도해 주세요.';
        });
      }
    } finally {
      if (mounted) setState(() => sending = false);
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: pending == null || orderId != null || rejectedWithoutSave,
    child: AlertDialog(
      title: Text(orderId == null ? '주문 내용 확인' : '주문이 완료되었습니다'),
      content: SizedBox(
        width: 360,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (orderId != null)
              Text('주문 번호 #$orderId')
            else ...[
              const Text('실제 결제 없이 주문을 저장합니다.'),
              const SizedBox(height: 16),
              Text('주문 방식: ${widget.orderMode ?? '선택되지 않음'}'),
              const SizedBox(height: 16),
              ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 240),
                child: SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      for (final entry in widget.entries) ...[
                        Text('${entry.menu.name} · ${entry.quantity}개'),
                        if (entry.options.isNotEmpty)
                          Text(
                            '옵션: ${entry.options.map((o) => o.name).join(', ')}',
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
                const Text('중복 방지를 위해 같은 주문으로 재시도합니다. 화면을 새로고침하지 마세요.'),
            ],
          ],
        ),
      ),
      actions: [
        if (pending == null)
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('취소'),
          ),
        if (rejectedWithoutSave)
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('주문 수정'),
          ),
        if (orderId != null)
          FilledButton(
            onPressed: () => Navigator.pop(context, orderId),
            child: const Text('확인'),
          )
        else
          FilledButton(
            onPressed: sending ? null : submit,
            child: Text(
              sending
                  ? '저장 중…'
                  : pending == null
                  ? '주문 저장'
                  : '같은 주문 재시도',
            ),
          ),
      ],
    ),
  );
}
