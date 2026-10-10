import '../admin_snapshot.dart';
import '../mock/mock_data.dart';
import '../future/mock/future_mock_data.dart';
import '../future/models/device_alert.dart';
import 'admin_data_source.dart';

class MockAdminDataSource implements AdminDataSource {
  MockAdminDataSource({DateTime Function()? clock})
    : _clock = clock ?? DateTime.now;
  final DateTime Function() _clock;
  final _alerts = List<DeviceAlert>.of(FutureMockData.alerts);
  @override
  Future<AdminSnapshot> load() async => AdminSnapshot(
    stores: MockData.stores,
    owners: MockData.owners,
    admins: MockData.admins,
    orders: MockData.orders,
    menus: MockData.menus,
    options: MockData.options,
    items: MockData.items,
    devices: FutureMockData.devices,
    alerts: _alerts,
    referenceDate: MockData.referenceDate,
    observedAt: FutureMockData.observedAt,
    isMock: true,
  );
  @override
  Future<void> acknowledgeAlert(String alertId) async {
    final index = _alerts.indexWhere((alert) => alert.id == alertId);
    if (index < 0) throw StateError('Unknown alert ID');
    if (_alerts[index].status == AlertStatus.unconfirmed) {
      _alerts[index] = _alerts[index].acknowledge(_clock());
    }
  }
}
