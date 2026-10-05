import 'package:flutter/material.dart';

import '../../data/admin_data.dart';
import '../../data/models.dart';
import '../../theme/app_spacing.dart';
import '../../widgets/admin_widgets.dart';

class OrdersPage extends StatefulWidget {
  const OrdersPage({super.key, required this.data});
  final AdminData data;
  @override
  State<OrdersPage> createState() => _OrdersPageState();
}

class _OrdersPageState extends State<OrdersPage> {
  final search = TextEditingController();
  int storeId = 0;
  int days = 7;
  @override
  void dispose() {
    search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final data = widget.data;
    final query = search.text.trim();
    final orders = data
        .ordersForDays(days == 0 ? null : days)
        .where(
          (order) =>
              (storeId == 0 || order.storeId == storeId) &&
              '${order.id}'.contains(query),
        )
        .toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const PageHeading(
          title: '주문 조회',
          description: '매장별 주문 시각, 테이블 번호와 주문 품목을 확인합니다.',
        ),
        AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Wrap(
                spacing: AppSpacing.lg,
                runSpacing: AppSpacing.lg,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  AppSearch(
                    controller: search,
                    label: '주문 ID',
                    onChanged: (_) => setState(() {}),
                  ),
                  AppFilter(
                    label: '매장',
                    value: storeId,
                    items: {
                      0: '전체 매장',
                      for (final store in data.stores) store.id: store.name,
                    },
                    onChanged: (value) => setState(() => storeId = value),
                  ),
                  AppFilter(
                    label: '조회 기간',
                    value: days,
                    items: const {
                      1: '기준일',
                      7: '최근 7일',
                      30: '최근 30일',
                      0: '전체 기간',
                    },
                    onChanged: (value) => setState(() => days = value),
                  ),
                  AppButton(
                    label: '초기화',
                    icon: Icons.refresh,
                    onPressed: () => setState(() {
                      search.clear();
                      storeId = 0;
                      days = 7;
                    }),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.lg),
              Text(
                '시연 기준일 ${dateLabel(data.referenceDate)} · 기간은 기준일을 포함합니다.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.xl),
        SectionHeading(title: '주문 목록 · ${orders.length}건'),
        OrderTable(data: data, orders: orders),
      ],
    );
  }
}

class OrderTable extends StatelessWidget {
  const OrderTable({super.key, required this.data, required this.orders});
  final AdminData data;
  final List<Order> orders;
  @override
  Widget build(BuildContext context) => AppTable(
    columns: const ['주문 ID', '매장', '주문 시각', '테이블', '총 수량', ''],
    rows: orders
        .map(
          (order) => DataRow(
            key: ValueKey(order.id),
            cells: [
              DataCell(Text('#${order.id}')),
              DataCell(Text(data.store(order.storeId).name)),
              DataCell(Text(dateTimeLabel(order.orderedAt))),
              DataCell(Text('${order.tableNo}번')),
              DataCell(Text('${data.quantityForOrder(order.id)}개')),
              DataCell(
                AppButton(
                  label: '상세',
                  onPressed: () => showOrderDetails(context, data, order),
                ),
              ),
            ],
          ),
        )
        .toList(),
  );
}

Future<void> showOrderDetails(
  BuildContext context,
  AdminData data,
  Order order,
) => showDetails(
  context,
  title: '주문 #${order.id}',
  child: Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      DetailField(label: '매장', value: data.store(order.storeId).name),
      DetailField(label: '주문 시각', value: dateTimeLabel(order.orderedAt)),
      DetailField(label: '테이블 번호', value: '${order.tableNo}번'),
      const Divider(),
      const SizedBox(height: AppSpacing.lg),
      const SectionHeading(title: '주문 품목'),
      for (final item in data.itemsForOrder(order.id))
        DetailField(
          label: '${data.menu(item.menuId).name} · ${item.quantity}개',
          value: '옵션: ${data.option(item.optionId)?.name ?? '없음'}',
        ),
      Text(
        '메뉴·옵션 이름은 현재 등록 정보를 기준으로 표시합니다.',
        style: Theme.of(context).textTheme.bodySmall,
      ),
    ],
  ),
);
