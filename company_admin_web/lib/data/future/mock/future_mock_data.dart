import '../models/device.dart';
import '../models/device_alert.dart';

// Separate from existing DB-backed samples. None of this data is persisted.
abstract final class FutureMockData {
  static final observedAt = DateTime(2026, 10, 3, 15);
  static final devices = <Device>[
    Device(
      id: 'VK-SEO-001',
      storeId: 1,
      connection: DeviceConnection.online,
      lastConnectedAt: DateTime(2026, 10, 3, 14, 59),
      appVersion: '1.1.0',
    ),
    Device(
      id: 'VK-SEO-002',
      storeId: 2,
      connection: DeviceConnection.offline,
      lastConnectedAt: DateTime(2026, 10, 3, 12, 8),
      appVersion: '1.0.2',
    ),
    Device(
      id: 'VK-SEO-003',
      storeId: 3,
      connection: DeviceConnection.online,
      lastConnectedAt: DateTime(2026, 10, 3, 14, 58),
      appVersion: '1.1.0',
    ),
    Device(
      id: 'VK-SEO-004',
      storeId: 4,
      connection: DeviceConnection.online,
      lastConnectedAt: DateTime(2026, 10, 3, 14, 57),
      appVersion: '1.0.2',
    ),
    Device(
      id: 'VK-SEO-005',
      storeId: 5,
      connection: DeviceConnection.offline,
      lastConnectedAt: DateTime(2026, 10, 2, 18, 30),
      appVersion: '1.0.0',
    ),
    Device(
      id: 'VK-SEO-006',
      storeId: 6,
      connection: DeviceConnection.offline,
      lastConnectedAt: null,
      appVersion: '1.0.0',
    ),
  ];
  static final alerts = <DeviceAlert>[
    DeviceAlert(
      id: 'AL-1006',
      deviceId: 'VK-SEO-002',
      type: AlertType.offline,
      status: AlertStatus.unconfirmed,
      occurredAt: DateTime(2026, 10, 3, 12, 15),
      description: '기기와의 연결이 끊겼습니다. 매장 네트워크와 기기 전원을 확인해 주세요.',
    ),
    DeviceAlert(
      id: 'AL-1005',
      deviceId: 'VK-SEO-003',
      type: AlertType.connectionError,
      status: AlertStatus.unconfirmed,
      occurredAt: DateTime(2026, 10, 3, 11, 40),
      description: '데이터 요청 중 연결 오류가 발생했습니다. 현재 온라인 상태와 별개로 발생한 알림입니다.',
    ),
    DeviceAlert(
      id: 'AL-1004',
      deviceId: 'VK-SEO-004',
      type: AlertType.updateRequired,
      status: AlertStatus.unconfirmed,
      occurredAt: DateTime(2026, 10, 3, 9),
      description: '권장 앱 버전 1.1.0으로 업데이트가 필요합니다. 실제 업데이트 작업은 이 화면에서 실행하지 않습니다.',
    ),
    DeviceAlert(
      id: 'AL-1003',
      deviceId: 'VK-SEO-005',
      type: AlertType.offline,
      status: AlertStatus.acknowledged,
      occurredAt: DateTime(2026, 10, 2, 18, 40),
      acknowledgedAt: DateTime(2026, 10, 3, 9, 30),
      description: '연결 끊김을 확인했습니다. 기기의 실제 연결 상태는 아직 오프라인입니다.',
    ),
    DeviceAlert(
      id: 'AL-1002',
      deviceId: 'VK-SEO-001',
      type: AlertType.connectionError,
      status: AlertStatus.resolved,
      occurredAt: DateTime(2026, 10, 2, 10, 10),
      acknowledgedAt: DateTime(2026, 10, 2, 10, 15),
      description: '이전에 발생했던 연결 오류가 해소된 시연 이력입니다.',
    ),
    DeviceAlert(
      id: 'AL-1001',
      deviceId: 'VK-SEO-006',
      type: AlertType.offline,
      status: AlertStatus.unconfirmed,
      occurredAt: DateTime(2026, 10, 1, 9),
      description: '등록 후 연결 이력이 없습니다. 설치 매장에서 초기 연결을 확인해 주세요.',
    ),
  ];
}
