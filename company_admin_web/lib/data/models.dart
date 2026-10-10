// Read-only projections of DB fields. Passwords never enter the frontend.
class CompanyAdmin {
  const CompanyAdmin({required this.id, required this.name});
  final int id;
  final String name;
}

class Owner {
  const Owner({required this.id, required this.loginId});
  final int id;
  final String loginId;
}

class Store {
  const Store({
    required this.id,
    required this.name,
    required this.address,
    required this.addressDetail,
    required this.postcode,
    required this.phone,
    required this.businessNo,
    required this.representative,
    required this.type,
    required this.adminId,
    this.ownerId,
  });
  final int id;
  final String name;
  final String address;
  final String addressDetail;
  final String postcode;
  final String phone;
  final String businessNo;
  final String representative;
  final String type;
  final int adminId;
  final int? ownerId;
}

class Order {
  const Order({
    required this.id,
    required this.storeId,
    required this.orderedAt,
    required this.tableNo,
  });
  final int id;
  final int storeId;
  final DateTime orderedAt;
  final int tableNo;
}

class Menu {
  const Menu({required this.id, required this.name});
  final int id;
  final String name;
}

class MenuOption {
  const MenuOption({
    required this.id,
    required this.menuId,
    required this.name,
  });
  final int id;
  final int menuId;
  final String name;
}

class OrderItem {
  const OrderItem({
    required this.id,
    required this.orderId,
    required this.menuId,
    required this.quantity,
    this.optionId,
  });
  final int id;
  final int orderId;
  final int menuId;
  final int quantity;
  final int? optionId;
}
