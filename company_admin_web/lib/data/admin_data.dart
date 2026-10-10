import 'admin_snapshot.dart';
import 'future/models/device.dart';
import 'future/models/device_alert.dart';
import 'models.dart';

// UI projection of a repository result. No dependency on a Mock data source.
class AdminData {
  const AdminData(this.snapshot);
  final AdminSnapshot snapshot;
  List<Store> get stores => snapshot.stores;
  List<Owner> get owners => snapshot.owners;
  List<CompanyAdmin> get admins => snapshot.admins;
  List<Order> get orders =>
      List.of(snapshot.orders)
        ..sort((a, b) => b.orderedAt.compareTo(a.orderedAt));
  List<Device> get devices => snapshot.devices;
  List<DeviceAlert> get alerts =>
      List.of(snapshot.alerts)
        ..sort((a, b) => b.occurredAt.compareTo(a.occurredAt));
  DateTime get referenceDate => snapshot.referenceDate;
  DateTime get observedAt => snapshot.observedAt;
  bool get isMock => snapshot.isMock;
  Device device(String id) => devices.firstWhere((device) => device.id == id);
  List<DeviceAlert> alertsForDevice(String id) =>
      alerts.where((alert) => alert.deviceId == id).toList();
  Store store(int id) => stores.firstWhere((store) => store.id == id);
  CompanyAdmin admin(int id) => admins.firstWhere((admin) => admin.id == id);
  Owner? owner(int? id) =>
      id == null ? null : owners.firstWhere((owner) => owner.id == id);
  List<Store> storesForOwner(int id) =>
      stores.where((store) => store.ownerId == id).toList();
  List<OrderItem> itemsForOrder(int id) =>
      snapshot.items.where((item) => item.orderId == id).toList();
  Menu menu(int id) => snapshot.menus.firstWhere((menu) => menu.id == id);
  MenuOption? option(int? id) => id == null
      ? null
      : snapshot.options.firstWhere((option) => option.id == id);
  int quantityForOrder(int id) =>
      itemsForOrder(id).fold(0, (sum, item) => sum + item.quantity);
  List<Order> ordersForDays(int? days) {
    if (days == null) return orders;
    final start = referenceDate.subtract(Duration(days: days - 1));
    final end = referenceDate.add(const Duration(days: 1));
    return orders
        .where(
          (order) =>
              !order.orderedAt.isBefore(start) && order.orderedAt.isBefore(end),
        )
        .toList();
  }
}

String dateLabel(DateTime date) =>
    '${date.year}-${_pad(date.month)}-${_pad(date.day)}';
String dateTimeLabel(DateTime date) =>
    '${dateLabel(date)} ${_pad(date.hour)}:${_pad(date.minute)}';
String _pad(int value) => value.toString().padLeft(2, '0');
