// DB 행 기준 모델. 컬럼 이름 변환(snake_case → camelCase)은 Repository에서만 한다.
export type Page = "today" | "menus" | "orders" | "store";

export interface Owner {
  id: number; // owner_id
  loginId: string; // own_login_id
}
export interface Store {
  id: number; // store_id
  name: string; // store_nm VARCHAR(100)
  address1: string; // store_add1
  address2: string | null; // store_add2
  storeCode: string; // store_code CHAR(5)
  phone: string; // store_phone
  businessNo: string; // business_no CHAR(10)
  representative: string; // store_owner_nm
  storeType: string; // store_type
  adminId: number;
  ownerId: number | null;
}
export interface Category {
  id: number; // category_id
  storeId: number;
  name: string; // category_nm VARCHAR(100)
  sort: number; // category_sort
}
export interface Menu {
  id: number; // menu_id
  categoryId: number;
  name: string; // menu_nm VARCHAR(50)
  price: number; // menu_price
  description: string | null; // menu_des VARCHAR(500)
  isActive: boolean; // false면 판매 중지, 키오스크에 보이지 않음
  isSoldOut: boolean; // true면 키오스크에 품절로 보임
  sort: number; // menu_sort
}
export interface MenuOption {
  id: number; // option_id
  menuId: number;
  name: string; // option_nm VARCHAR(50)
  sort: number; // menu_option_sort
  isActive: boolean;
  isSoldOut: boolean;
  extraPrice: number; // extra_price, 0 이상
}
export type OrderType = "takeaway" | "dine_in";
export interface Order {
  id: number; // order_id
  storeId: number;
  deviceId: number | null;
  clientOrderId: string | null; // UUID, 이전 주문은 NULL
  orderType: OrderType | null; // 이관 전 주문은 NULL이고 tableNo로 해석
  tableNo: number | null; // 신규 주문은 NULL
  orderedAt: string; // ISO 8601 UTC
}
export interface OrderItem {
  id: number; // item_id
  orderId: number;
  menuId: number;
  quantity: number; // item_quantity, 1 이상
  legacyOptionId: number | null; // order_item.option_id (이전 단일 옵션)
}
export interface OrderItemOption {
  itemId: number;
  optionId: number;
}

// 연결 상태와 마지막 접속 시각은 아직 DB에 없는 Mock 계약이다.
export interface KioskDevice {
  id: number; // device_id
  storeId: number;
  isActive: boolean;
  connection: "online" | "offline";
  lastSeenAt: string | null;
}

export interface StoreProfile {
  store: Store;
  owner: Owner;
}
export interface MenuBoard {
  categories: Category[];
  menus: Menu[];
  options: MenuOption[];
}
export interface OrderHistory {
  orders: Order[];
  items: OrderItem[];
  itemOptions: OrderItemOption[];
}

// 메뉴 관리 저장 묶음. 서버는 한 트랜잭션으로 처리한다.
// 음수 id는 같은 묶음 안에서 새로 만드는 항목의 임시 id이고, categoryId·menuId가 이를 가리킬 수 있다.
// sort는 category_sort(매장 전체), menu_sort(카테고리별), menu_option_sort(메뉴별)로 1부터 빈틈없이 매긴다.
// 품절(is_sold_out)은 따로 즉시 반영하므로 기존 행 수정에는 넣지 않는다.
export interface MenuBoardChanges {
  categories: {
    create: { tempId: number; name: string; sort: number }[];
    update: { id: number; name: string; sort: number }[];
    remove: number[];
  };
  menus: {
    create: (Omit<Menu, "id"> & { tempId: number })[];
    update: Omit<Menu, "isSoldOut">[];
  };
  options: {
    create: (Omit<MenuOption, "id" | "isActive"> & { tempId: number })[];
    update: Omit<MenuOption, "isSoldOut">[];
  };
}
// 저장 뒤 전체 상태와 임시 id → 실제 id 대응표
export interface MenuBoardSaveResult {
  board: MenuBoard;
  ids: Record<number, number>;
}
