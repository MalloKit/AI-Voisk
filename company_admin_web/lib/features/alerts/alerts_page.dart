import 'package:flutter/material.dart';

import '../../data/admin_data.dart';
import '../../data/future/models/device_alert.dart';
import '../../theme/app_spacing.dart';
import '../../widgets/admin_widgets.dart';
import '../../widgets/device_status.dart';
import '../devices/devices_page.dart';

typedef AcknowledgeAlert = Future<DeviceAlert> Function(String id);

class AlertsPage extends StatefulWidget {
  const AlertsPage({
    super.key,
    required this.data,
    required this.onAcknowledge,
  });
  final AdminData data;
  final AcknowledgeAlert onAcknowledge;
  @override
  State<AlertsPage> createState() => _AlertsPageState();
}

class _AlertsPageState extends State<AlertsPage> {
  final search = TextEditingController();
  String type = '전체';
  String status = '전체';
  @override
  void dispose() {
    search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final data = widget.data;
    final query = search.text.trim().toLowerCase();
    final alerts = data.alerts
        .where(
          (alert) =>
              '${alert.id} ${alert.deviceId} ${data.store(data.device(alert.deviceId).storeId).name}'
                  .toLowerCase()
                  .contains(query) &&
              (type == '전체' || alertTypeLabel(alert.type) == type) &&
              (status == '전체' || alertStatusLabel(alert.status) == status),
        )
        .toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const PageHeading(
          title: '장애/알림',
          description: '오프라인, 연결 오류, 업데이트 필요 알림을 조회하고 확인합니다.',
        ),
        FutureDataNotice(observedAt: data.observedAt),
        const SizedBox(height: AppSpacing.xl),
        AppCard(
          child: Wrap(
            spacing: AppSpacing.lg,
            runSpacing: AppSpacing.lg,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              AppSearch(
                controller: search,
                label: '알림 ID / 기기 ID / 매장',
                onChanged: (_) => setState(() {}),
              ),
              AppFilter(
                label: '알림 유형',
                value: type,
                items: {
                  '전체': '전체',
                  for (final value in AlertType.values)
                    alertTypeLabel(value): alertTypeLabel(value),
                },
                onChanged: (value) => setState(() => type = value),
              ),
              AppFilter(
                label: '확인 상태',
                value: status,
                items: {
                  '전체': '전체',
                  for (final value in AlertStatus.values)
                    alertStatusLabel(value): alertStatusLabel(value),
                },
                onChanged: (value) => setState(() => status = value),
              ),
              AppButton(
                label: '초기화',
                icon: Icons.refresh,
                onPressed: () => setState(() {
                  search.clear();
                  type = '전체';
                  status = '전체';
                }),
              ),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.xl),
        SectionHeading(title: '알림 목록 · ${alerts.length}건'),
        AppTable(
          columns: const ['알림 ID', '유형', '기기 / 매장', '발생 시각', '확인 상태', ''],
          rows: alerts
              .map(
                (alert) => DataRow(
                  key: ValueKey(alert.id),
                  cells: [
                    DataCell(Text(alert.id)),
                    DataCell(Text(alertTypeLabel(alert.type))),
                    DataCell(
                      Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(alert.deviceId),
                          Text(
                            data
                                .store(data.device(alert.deviceId).storeId)
                                .name,
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ],
                      ),
                    ),
                    DataCell(Text(dateTimeLabel(alert.occurredAt))),
                    DataCell(AlertStatusBadge(status: alert.status)),
                    DataCell(
                      AppButton(
                        label: '상세',
                        onPressed: () => showDetails(
                          context,
                          title: '알림 ${alert.id}',
                          child: AlertDetails(
                            data: data,
                            alert: alert,
                            onAcknowledge: widget.onAcknowledge,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              )
              .toList(),
        ),
      ],
    );
  }
}

class AlertDetails extends StatefulWidget {
  const AlertDetails({
    super.key,
    required this.data,
    required this.alert,
    required this.onAcknowledge,
  });
  final AdminData data;
  final DeviceAlert alert;
  final AcknowledgeAlert onAcknowledge;
  @override
  State<AlertDetails> createState() => _AlertDetailsState();
}

class _AlertDetailsState extends State<AlertDetails> {
  late DeviceAlert alert = widget.alert;
  bool saving = false;
  bool failed = false;
  Future<void> acknowledge() async {
    setState(() {
      saving = true;
      failed = false;
    });
    try {
      final updated = await widget.onAcknowledge(alert.id);
      if (mounted) setState(() => alert = updated);
    } catch (_) {
      if (mounted) setState(() => failed = true);
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final device = widget.data.device(alert.deviceId);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        DetailField(label: '알림 유형', value: alertTypeLabel(alert.type)),
        DetailField(label: '확인 상태', value: alertStatusLabel(alert.status)),
        DetailField(label: '발생 시각', value: dateTimeLabel(alert.occurredAt)),
        DetailField(
          label: '기기 / 설치 매장',
          value: '${device.id} / ${widget.data.store(device.storeId).name}',
        ),
        DetailField(
          label: '기기 연결 상태',
          value: connectionLabel(device.connection),
        ),
        DetailField(label: '알림 내용', value: alert.description),
        if (alert.acknowledgedAt != null)
          DetailField(
            label: '확인 시각',
            value: dateTimeLabel(alert.acknowledgedAt!),
          ),
        const Divider(),
        const SizedBox(height: AppSpacing.lg),
        const Text('확인 완료는 알림을 검토했다는 의미이며 기기의 연결 상태나 장애 해소 여부를 변경하지 않습니다.'),
        const SizedBox(height: AppSpacing.lg),
        if (widget.data.isMock)
          const Text('시연 모드: 확인 결과는 메모리에만 유지되며 새로고침하면 초기화됩니다.'),
        if (failed) ...[
          const SizedBox(height: AppSpacing.lg),
          Text(
            '확인 처리에 실패했습니다. 다시 시도해 주세요.',
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        ],
        if (alert.status == AlertStatus.unconfirmed) ...[
          const SizedBox(height: AppSpacing.lg),
          AppButton(
            label: saving ? '처리 중…' : '확인 완료로 표시',
            onPressed: saving ? null : acknowledge,
            icon: Icons.check,
          ),
        ],
      ],
    );
  }
}
