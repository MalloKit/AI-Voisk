import 'package:flutter/material.dart';

import '../data/future/models/device.dart';
import '../data/future/models/device_alert.dart';

String connectionLabel(DeviceConnection connection) =>
    connection == DeviceConnection.online ? '온라인' : '오프라인';
String alertTypeLabel(AlertType type) => switch (type) {
  AlertType.offline => '오프라인',
  AlertType.connectionError => '연결 오류',
  AlertType.updateRequired => '업데이트 필요',
};
String alertStatusLabel(AlertStatus status) => switch (status) {
  AlertStatus.unconfirmed => '미확인',
  AlertStatus.acknowledged => '확인 완료',
  AlertStatus.resolved => '해소됨',
};

class DeviceStatusBadge extends StatelessWidget {
  const DeviceStatusBadge({super.key, required this.connection});
  final DeviceConnection connection;
  @override
  Widget build(BuildContext context) => StatusBadge(
    label: connectionLabel(connection),
    attention: connection == DeviceConnection.offline,
  );
}

class AlertStatusBadge extends StatelessWidget {
  const AlertStatusBadge({super.key, required this.status});
  final AlertStatus status;
  @override
  Widget build(BuildContext context) => StatusBadge(
    label: alertStatusLabel(status),
    attention: status == AlertStatus.unconfirmed,
  );
}

class StatusBadge extends StatelessWidget {
  const StatusBadge({super.key, required this.label, this.attention = false});
  final String label;
  final bool attention;
  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Chip(
      backgroundColor: attention
          ? colors.errorContainer
          : colors.secondaryContainer,
      label: Text(
        label,
        style: TextStyle(
          color: attention
              ? colors.onErrorContainer
              : colors.onSecondaryContainer,
        ),
      ),
    );
  }
}
