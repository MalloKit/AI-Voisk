import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../data/admin_data.dart';
import '../../data/future/models/device.dart';
import '../../data/future/models/device_alert.dart';
import '../../theme/app_spacing.dart';
import '../../widgets/admin_widgets.dart';
import '../orders/orders_page.dart';
import '../stores/stores_page.dart';

class DashboardPage extends StatelessWidget {
  const DashboardPage({
    super.key,
    required this.data,
    required this.onStores,
    required this.onOrders,
    required this.onUnlinked,
    required this.onDevices,
    required this.onAlerts,
  });
  final AdminData data;
  final VoidCallback onStores;
  final VoidCallback onOrders;
  final VoidCallback onUnlinked;
  final VoidCallback onDevices;
  final VoidCallback onAlerts;
  @override
  Widget build(BuildContext context) {
    final unlinked = data.stores
        .where((store) => store.ownerId == null)
        .toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const PageHeading(
          title: '운영 요약',
          description: '등록 매장과 점주 연결, 최근 주문 현황을 한눈에 확인합니다.',
        ),
        Text(
          '전체 등록 데이터 · 시연 기준일 ${dateLabel(data.referenceDate)}',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: AppSpacing.lg),
        LayoutBuilder(
          builder: (context, constraints) {
            final columns = math.max(
              1,
              math.min(
                4,
                (constraints.maxWidth / AppSizes.metricWidth).floor(),
              ),
            );
            final width =
                (constraints.maxWidth - AppSpacing.lg * (columns - 1)) /
                columns;
            return Wrap(
              spacing: AppSpacing.lg,
              runSpacing: AppSpacing.lg,
              children: [
                _Metric(
                  width: width,
                  title: '등록 매장',
                  value: '${data.stores.length}곳',
                  caption: '전체 매장',
                  icon: Icons.storefront_outlined,
                ),
                _Metric(
                  width: width,
                  title: '점주 계정',
                  value: '${data.owners.length}개',
                  caption: '등록 계정',
                  icon: Icons.people_outline,
                ),
                _Metric(
                  width: width,
                  title: '점주 미연결 매장',
                  value: '${unlinked.length}곳',
                  caption: '연결 여부 확인',
                  icon: Icons.link_off,
                ),
                _Metric(
                  width: width,
                  title: '최근 7일 주문',
                  value: '${data.ordersForDays(7).length}건',
                  caption: '시연 기준일 포함',
                  icon: Icons.receipt_long_outlined,
                ),
              ],
            );
          },
        ),
        const SizedBox(height: AppSpacing.xxl),
        AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SectionHeading(title: '기기 및 알림 현황'),
              Text(
                '등록 기기 ${data.devices.length}대 · 오프라인 ${data.devices.where((device) => device.connection == DeviceConnection.offline).length}대 · 미확인 알림 ${data.alerts.where((alert) => alert.status == AlertStatus.unconfirmed).length}건',
              ),
              const SizedBox(height: AppSpacing.sm),
              Text(
                '향후 기능 Mock · 관측 기준 ${dateTimeLabel(data.observedAt)}',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: AppSpacing.lg),
              Wrap(
                spacing: AppSpacing.lg,
                runSpacing: AppSpacing.sm,
                children: [
                  AppButton(label: '기기 목록 보기', onPressed: onDevices),
                  AppButton(label: '알림 목록 보기', onPressed: onAlerts),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.xxl),
        SectionHeading(
          title: '최근 주문',
          trailing: AppButton(label: '주문 전체 보기', onPressed: onOrders),
        ),
        OrderTable(data: data, orders: data.orders.take(5).toList()),
        const SizedBox(height: AppSpacing.xxl),
        SectionHeading(
          title: '점주 미연결 매장',
          trailing: AppButton(label: '미연결 매장 보기', onPressed: onUnlinked),
        ),
        AppTable(
          columns: const ['매장명', '업종', '담당 관리자', '점주 연결', ''],
          emptyMessage: '모든 매장에 점주 계정이 연결되어 있습니다.',
          rows: unlinked
              .map(
                (store) => DataRow(
                  key: ValueKey(store.id),
                  cells: [
                    DataCell(Text(store.name)),
                    DataCell(Text(store.type)),
                    DataCell(Text(data.admin(store.adminId).name)),
                    const DataCell(ConnectionBadge(connected: false)),
                    DataCell(
                      AppButton(
                        label: '상세',
                        onPressed: () => showStoreDetails(context, data, store),
                      ),
                    ),
                  ],
                ),
              )
              .toList(),
        ),
        const SizedBox(height: AppSpacing.xl),
        AppButton(
          label: '등록 매장 전체 보기',
          icon: Icons.arrow_forward,
          onPressed: onStores,
        ),
      ],
    );
  }
}

class _Metric extends StatelessWidget {
  const _Metric({
    required this.width,
    required this.title,
    required this.value,
    required this.caption,
    required this.icon,
  });
  final double width;
  final String title;
  final String value;
  final String caption;
  final IconData icon;
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SizedBox(
      width: width,
      child: AppCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(child: Text(title, style: theme.textTheme.bodyMedium)),
                Icon(icon, color: theme.colorScheme.primary),
              ],
            ),
            const SizedBox(height: AppSpacing.lg),
            Text(value, style: theme.textTheme.headlineMedium),
            const SizedBox(height: AppSpacing.sm),
            Text(
              caption,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
