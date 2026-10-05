import '../admin_snapshot.dart';

abstract interface class AdminRepository {
  Future<AdminSnapshot> load();
  // Acknowledgement does not resolve an incident or change device connectivity.
  Future<void> acknowledgeAlert(String alertId);
}
