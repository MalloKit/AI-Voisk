import 'package:flutter/material.dart';

import '../core/l10n.dart';
import '../data/order_outbox.dart';
import '../service/models/menu_item.dart';

/// 이 키오스크에서 접수한 최근 주문과 전송 상태. 연결이 끊겨 보내지 못한 주문도 보여 줍니다.
class OrderHistoryDialog extends StatelessWidget {
  const OrderHistoryDialog({super.key, required this.outbox});
  final OrderOutbox? outbox;

  static String statusLabel(OutboxStatus status) => switch (status) {
    OutboxStatus.sent => tr('접수 완료'),
    OutboxStatus.pending => tr('전송 대기'),
    OutboxStatus.rejected => tr('접수 실패'),
  };

  @override
  Widget build(BuildContext context) {
    final box = outbox;
    return AlertDialog(
      title: Text(tr('주문내역')),
      content: SizedBox(
        width: 560,
        height: 420,
        child: box == null
            ? Center(child: Text(tr('서버에 연결된 키오스크에서만 주문내역을 볼 수 있습니다.')))
            : ListenableBuilder(
                listenable: box,
                builder: (context, _) {
                  final entries = box.entries.take(20).toList();
                  if (entries.isEmpty) {
                    return Center(child: Text(tr('아직 접수된 주문이 없습니다.')));
                  }
                  return ListView.separated(
                    itemCount: entries.length,
                    separatorBuilder: (_, _) => const Divider(height: 1),
                    itemBuilder: (context, index) {
                      final entry = entries[index];
                      final time = TimeOfDay.fromDateTime(
                        entry.createdAt.toLocal(),
                      ).format(context);
                      return ListTile(
                        title: Text(
                          entry.summary,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        subtitle: Text(
                          [
                            time,
                            formatWon(entry.total),
                            if (entry.orderId != null)
                              tr('주문번호 {id}', {'id': entry.orderId}),
                          ].join(' · '),
                        ),
                        trailing: Chip(
                          label: Text(statusLabel(entry.status)),
                          backgroundColor: switch (entry.status) {
                            OutboxStatus.sent => const Color(0xFFD5EEE3),
                            OutboxStatus.pending => const Color(0xFFFFF0DC),
                            OutboxStatus.rejected => const Color(0xFFFADBD8),
                          },
                        ),
                      );
                    },
                  );
                },
              ),
      ),
      actions: [
        if (box != null && box.pendingCount > 0)
          TextButton(onPressed: box.flush, child: Text(tr('지금 다시 보내기'))),
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(tr('닫기')),
        ),
      ],
    );
  }
}
