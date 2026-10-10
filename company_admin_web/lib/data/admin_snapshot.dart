import 'models.dart';
import 'future/models/device.dart';
import 'future/models/device_alert.dart';

// Immutable result shared by Mock and future API repository implementations.
class AdminSnapshot {
  AdminSnapshot({
    required Iterable<Store> stores,
    required Iterable<Owner> owners,
    required Iterable<CompanyAdmin> admins,
    required Iterable<Order> orders,
    required Iterable<Menu> menus,
    required Iterable<MenuOption> options,
    required Iterable<OrderItem> items,
    required Iterable<Device> devices,
    required Iterable<DeviceAlert> alerts,
    required this.referenceDate,
    required this.observedAt,
    required this.isMock,
  }) : stores = List.unmodifiable(stores),
       owners = List.unmodifiable(owners),
       admins = List.unmodifiable(admins),
       orders = List.unmodifiable(orders),
       menus = List.unmodifiable(menus),
       options = List.unmodifiable(options),
       items = List.unmodifiable(items),
       devices = List.unmodifiable(devices),
       alerts = List.unmodifiable(alerts);
  final List<Store> stores;
  final List<Owner> owners;
  final List<CompanyAdmin> admins;
  final List<Order> orders;
  final List<Menu> menus;
  final List<MenuOption> options;
  final List<OrderItem> items;
  final List<Device> devices;
  final List<DeviceAlert> alerts;
  final DateTime referenceDate;
  final DateTime observedAt;
  final bool isMock;
}
