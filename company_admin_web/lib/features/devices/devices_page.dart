import 'package:flutter/material.dart';

import '../../data/admin_data.dart';
import '../../data/future/models/device.dart';
import '../../theme/app_spacing.dart';
import '../../widgets/admin_widgets.dart';
import '../../widgets/device_status.dart';

class DevicesPage extends StatefulWidget {
  const DevicesPage({super.key, required this.data});
  final AdminData data;
  @override
  State<DevicesPage> createState() => _DevicesPageState();
}

class _DevicesPageState extends State<DevicesPage> {
  final search = TextEditingController();
  int storeId = 0;
  String connection = '전체';
  @override
  void dispose() {
    search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final data = widget.data;
    final query = search.text.trim().toLowerCase();
    final devices = data.devices
        .where(
          (device) =>
              '${device.id} ${data.store(device.storeId).name}'
                  .toLowerCase()
                  .contains(query) &&
              (storeId == 0 || device.storeId == storeId) &&
              (connection == '전체' ||
                  connectionLabel(device.connection) == connection),
        )
        .toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const PageHeading(
          title: '기기 관리',
          description: '설치된 기기의 연결 상태와 앱 버전을 확인합니다.',
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
                label: '기기 ID / 설치 매장',
                onChanged: (_) => setState(() {}),
              ),
              AppFilter(
                label: '설치 매장',
                value: storeId,
                items: {
                  0: '전체 매장',
                  for (final store in data.stores) store.id: store.name,
                },
                onChanged: (value) => setState(() => storeId = value),
              ),
              AppFilter(
                label: '연결 상태',
                value: connection,
                items: const {'전체': '전체', '온라인': '온라인', '오프라인': '오프라인'},
                onChanged: (value) => setState(() => connection = value),
              ),
              AppButton(
                label: '초기화',
                icon: Icons.refresh,
                onPressed: () => setState(() {
                  search.clear();
                  storeId = 0;
                  connection = '전체';
                }),
              ),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.xl),
        SectionHeading(title: '기기 목록 · ${devices.length}대'),
        AppTable(
          columns: const ['기기 ID', '설치 매장', '연결 상태', '마지막 연결', '앱 버전', ''],
          rows: devices
              .map(
                (device) => DataRow(
                  key: ValueKey(device.id),
                  cells: [
                    DataCell(Text(device.id)),
                    DataCell(Text(data.store(device.storeId).name)),
                    DataCell(DeviceStatusBadge(connection: device.connection)),
                    DataCell(
                      Text(
                        device.lastConnectedAt == null
                            ? '연결 이력 없음'
                            : dateTimeLabel(device.lastConnectedAt!),
                      ),
                    ),
                    DataCell(Text(device.appVersion)),
                    DataCell(
                      AppButton(
                        label: '상세',
                        onPressed: () =>
                            showDeviceDetails(context, data, device),
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

Future<void> showDeviceDetails(
  BuildContext context,
  AdminData data,
  Device device,
) => showDetails(
  context,
  title: '기기 ${device.id}',
  child: Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      DetailField(label: '기기 ID', value: device.id),
      DetailField(label: '설치 매장', value: data.store(device.storeId).name),
      DetailField(label: '설치 주소', value: data.store(device.storeId).address),
      DetailField(label: '연결 상태', value: connectionLabel(device.connection)),
      DetailField(
        label: '마지막 연결 시각',
        value: device.lastConnectedAt == null
            ? '연결 이력 없음'
            : dateTimeLabel(device.lastConnectedAt!),
      ),
      DetailField(label: '앱 버전', value: device.appVersion),
      const Divider(),
      const SizedBox(height: AppSpacing.lg),
      const SectionHeading(title: '관련 알림'),
      if (data.alertsForDevice(device.id).isEmpty) const Text('관련 알림이 없습니다.'),
      for (final alert in data.alertsForDevice(device.id))
        DetailField(
          label:
              '${alertTypeLabel(alert.type)} · ${alertStatusLabel(alert.status)}',
          value: '${alert.id} · ${dateTimeLabel(alert.occurredAt)}',
        ),
    ],
  ),
);

class FutureDataNotice extends StatelessWidget {
  const FutureDataNotice({super.key, required this.observedAt});
  final DateTime observedAt;
  @override
  Widget build(BuildContext context) => AppCard(
    child: Text(
      '향후 기능 · 현재 DB에 없는 기기/알림의 Mock 데이터입니다.\n'
      '상태 관측 기준: ${dateTimeLabel(observedAt)} · 실시간 모니터링이 아닙니다.',
      style: Theme.of(context).textTheme.bodySmall,
    ),
  );
}
