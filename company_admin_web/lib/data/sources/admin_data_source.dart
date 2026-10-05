import '../admin_snapshot.dart';

abstract interface class AdminDataSource {
  Future<AdminSnapshot> load();
  Future<void> acknowledgeAlert(String alertId);
}
