// Future frontend contract: these fields do NOT exist in the current DB.
enum DeviceConnection { online, offline }

class Device {
  const Device({
    required this.id,
    required this.storeId,
    required this.connection,
    required this.lastConnectedAt,
    required this.appVersion,
  });
  final String id;
  final int storeId;
  final DeviceConnection connection;
  final DateTime? lastConnectedAt;
  final String appVersion;
}
