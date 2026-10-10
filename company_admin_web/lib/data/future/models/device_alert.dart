// Future frontend contract only, not an existing DB table or API agreement.
enum AlertType { offline, connectionError, updateRequired }

enum AlertStatus { unconfirmed, acknowledged, resolved }

class DeviceAlert {
  const DeviceAlert({
    required this.id,
    required this.deviceId,
    required this.type,
    required this.status,
    required this.occurredAt,
    required this.description,
    this.acknowledgedAt,
  });
  final String id;
  final String deviceId;
  final AlertType type;
  final AlertStatus status;
  final DateTime occurredAt;
  final String description;
  final DateTime? acknowledgedAt;

  DeviceAlert acknowledge(DateTime at) => DeviceAlert(
    id: id,
    deviceId: deviceId,
    type: type,
    status: AlertStatus.acknowledged,
    occurredAt: occurredAt,
    description: description,
    acknowledgedAt: at,
  );
}
