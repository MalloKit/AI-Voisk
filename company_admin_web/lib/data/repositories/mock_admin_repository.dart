import '../admin_snapshot.dart';
import '../sources/admin_data_source.dart';
import 'admin_repository.dart';

class MockAdminRepository implements AdminRepository {
  MockAdminRepository(this.source);
  final AdminDataSource source;
  @override
  Future<AdminSnapshot> load() => source.load();
  @override
  Future<void> acknowledgeAlert(String alertId) =>
      source.acknowledgeAlert(alertId);
}
