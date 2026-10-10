import 'package:flutter/material.dart';

import '../../data/repositories/order_repository.dart';
import '../../data/admin_data.dart';
import '../../theme/app_spacing.dart';
import '../../widgets/admin_widgets.dart';

class LiveOrdersPage extends StatefulWidget {
  const LiveOrdersPage({super.key, required this.repository});
  final OrderRepository repository;
  @override
  State<LiveOrdersPage> createState() => _LiveOrdersPageState();
}

class _LiveOrdersPageState extends State<LiveOrdersPage> {
  final search = TextEditingController();
  late Future<List<LiveOrder>> orders;
  int storeId = 0, days = 7;
  @override
  void initState() {
    super.initState();
    orders = widget.repository.load();
  }

  @override
  void dispose() {
    search.dispose();
    super.dispose();
  }

  void reload() {
    final next = widget.repository.load();
    setState(() {
      orders = next;
    });
  }

  Future<void> details(LiveOrder order) => showDetails(
    context,
    title: '실제 주문 #${order.id}',
    child: FutureBuilder<LiveOrder>(
      future: widget.repository.detail(order.id),
      builder: (context, result) {
        if (result.hasError) return const Text('주문 상세 조회 실패. 닫은 뒤 다시 시도해 주세요.');
        if (!result.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        final data = result.data!;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            DetailField(label: '매장', value: data.storeName),
            DetailField(label: '주문 시각', value: dateTimeLabel(data.orderedAt)),
            DetailField(label: '주문 유형', value: data.diningLabel),
            const Divider(),
            for (final item in data.items)
              DetailField(
                label: '${item['menu_name']} · ${item['quantity']}개',
                value:
                    '옵션: ${(item['options'] as List).isEmpty ? '없음' : (item['options'] as List).map((o) => o['name']).join(', ')}',
              ),
            const Text('실제 DB 조회 · 메뉴/옵션명은 현재 등록 정보입니다. 주문 당시 가격은 저장되지 않습니다.'),
          ],
        );
      },
    ),
  );
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      const PageHeading(
        title: '주문 조회',
        description: '실제 API 주문 데이터 · 다른 관리 화면은 Mock 데이터입니다.',
      ),
      FutureBuilder<List<LiveOrder>>(
        future: orders,
        builder: (context, result) {
          if (result.hasError) {
            return AppCard(
              child: Column(
                children: [
                  const Text('실제 주문 조회 실패. Mock 데이터로 대체하지 않습니다.'),
                  AppButton(label: '다시 시도', onPressed: reload),
                ],
              ),
            );
          }
          if (!result.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          final all = result.data!;
          final today = DateTime.now();
          final start = DateTime(
            today.year,
            today.month,
            today.day,
          ).subtract(Duration(days: days - 1));
          final filtered = all
              .where(
                (o) =>
                    (storeId == 0 || o.storeId == storeId) &&
                    '${o.id}'.contains(search.text.trim()) &&
                    (days == 0 || !o.orderedAt.isBefore(start)),
              )
              .toList();
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              AppCard(
                child: Wrap(
                  spacing: AppSpacing.lg,
                  runSpacing: AppSpacing.lg,
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
                        if (storeId != 0) storeId: '매장 #$storeId',
                        for (final o in all) o.storeId: o.storeName,
                      },
                      onChanged: (id) => setState(() => storeId = id),
                    ),
                    AppFilter(
                      label: '조회 기간',
                      value: days,
                      items: const {
                        1: '오늘',
                        7: '최근 7일',
                        30: '최근 30일',
                        0: '전체 기간',
                      },
                      onChanged: (value) => setState(() => days = value),
                    ),
                    AppButton(
                      label: '새로고침',
                      icon: Icons.refresh,
                      onPressed: reload,
                    ),
                    AppButton(
                      label: '초기화',
                      onPressed: () => setState(() {
                        search.clear();
                        storeId = 0;
                        days = 7;
                      }),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.xl),
              SectionHeading(title: '실제 주문 목록 · ${filtered.length}건'),
              AppTable(
                columns: const [
                  '주문 ID',
                  '매장',
                  '주문 시각',
                  '주문 유형 / 테이블',
                  '총 수량',
                  '',
                ],
                rows: filtered
                    .map(
                      (o) => DataRow(
                        cells: [
                          DataCell(Text('#${o.id}')),
                          DataCell(Text(o.storeName)),
                          DataCell(Text(dateTimeLabel(o.orderedAt))),
                          DataCell(Text(o.diningLabel)),
                          DataCell(Text('${o.quantity}개')),
                          DataCell(
                            AppButton(label: '상세', onPressed: () => details(o)),
                          ),
                        ],
                      ),
                    )
                    .toList(),
              ),
            ],
          );
        },
      ),
    ],
  );
}
