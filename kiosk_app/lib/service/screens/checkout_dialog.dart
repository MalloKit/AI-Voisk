import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

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
  final table = TextEditingController();
  late String mode = widget.orderMode ?? '포장';
  PendingOrder? pending;
  bool sending = false;
  bool rejectedWithoutSave = false;
  int? orderId;
  String? error;
  @override
  void dispose() {
    table.dispose();
    super.dispose();
  }

  Future<void> submit() async {
    if (sending || orderId != null) return;
    final number = mode == '포장' ? 0 : int.tryParse(table.text);
    if (number == null || (mode != '포장' && number < 1) || number > 2147483647) {
      setState(() => error = '매장 식사는 1 이상의 테이블 번호를 입력해 주세요.');
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
        tableNo: number,
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
      title: Text(orderId == null ? '시연용 주문 완료' : '주문이 완료되었습니다'),
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
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: '포장', label: Text('포장')),
                  ButtonSegment(value: '매장 식사', label: Text('매장 식사')),
                ],
                selected: {mode},
                onSelectionChanged: pending != null
                    ? null
                    : (values) => setState(() {
                        mode = values.single;
                        error = null;
                      }),
              ),
              if (mode == '매장 식사')
                TextField(
                  controller: table,
                  enabled: pending == null,
                  keyboardType: TextInputType.number,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  decoration: const InputDecoration(labelText: '테이블 번호 (1 이상)'),
                ),
              if (mode == '포장') const Text('테이블 번호 없이 포장으로 저장합니다.'),
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
