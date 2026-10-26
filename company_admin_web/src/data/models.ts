export type Page =
  "dashboard" | "stores" | "owners" | "orders" | "devices" | "alerts";
export interface Store {
  id: number;
  name: string;
  address: string;
  addressDetail: string;
  postcode: string;
  phone: string;
  businessNo: string;
  representative: string;
  type: string;
  adminId: number;
  ownerId: number | null;
}
export interface Owner {
  id: number;
  loginId: string;
}
export interface CompanyAdmin {
  id: number;
  name: string;
}
export interface Device {
  id: string;
  storeId: number;
  connection: "online" | "offline";
  lastConnectedAt: string | null;
  appVersion: string;
}
export type AlertType = "offline" | "connectionError" | "updateRequired";
export type AlertStatus = "unconfirmed" | "acknowledged" | "resolved";
export interface DeviceAlert {
  id: string;
  deviceId: string;
  type: AlertType;
  status: AlertStatus;
  occurredAt: string;
  acknowledgedAt: string | null;
  description: string;
}
export interface MockOrder {
  id: number;
  storeId: number;
  orderedAt: string;
  tableNo: number;
}
export interface MockItem {
  id: number;
  orderId: number;
  menuId: number;
  quantity: number;
  optionId: number | null;
}
export interface AdminSnapshot {
  stores: Store[];
  owners: Owner[];
  admins: CompanyAdmin[];
  orders: MockOrder[];
  menus: { id: number; name: string }[];
  options: { id: number; menuId: number; name: string }[];
  items: MockItem[];
  devices: Device[];
  alerts: DeviceAlert[];
  referenceDate: string;
  observedAt: string;
  isMock: true;
}
export interface OrderOption {
  option_id: number;
  name: string;
}
export interface OrderItem {
  item_id: number;
  menu_id: number;
  menu_name: string;
  quantity: number;
  options: OrderOption[];
}
export interface Order {
  order_id: number;
  store_id: number;
  store_name: string;
  ordered_at: string;
  table_no: number | null;
  order_type?: string | null;
  device_id?: number | null;
  quantity: number;
  items: OrderItem[];
}

/** store_code is intentionally not interpreted as a postcode. */
export interface ApiStore extends Omit<Store, "postcode"> {
  storeCode: string;
  adminName: string | null;
  ownerLoginId: string | null;
}

export interface ApiOwner extends Owner {
  storeCount: number;
}
export interface OwnerStore {
  id: number;
  name: string;
  address: string;
  addressDetail: string;
  adminId: number;
  adminName: string | null;
}
export interface ApiOwnerDetail extends ApiOwner {
  stores: OwnerStore[];
}
