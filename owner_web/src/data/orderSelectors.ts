import { STORE_TIME_ZONE } from "./demoClock";
import type { MenuBoard, OrderHistory, OrderType } from "./models";
import { storeDay } from "./selectors";

// 주문 화면용 계산. order_item에 주문 당시 가격이 없어 금액은 현재 메뉴·옵션 가격으로 계산한다.

export interface OrderLine {
  itemId: number;
  menuId: number;
  menuName: string;
  quantity: number;
  menuPrice: number;
  options: { id: number; name: string; extraPrice: number }[];
  unitPrice: number; // 메뉴 가격 + 옵션 추가 금액 (1개 기준)
  amount: number; // unitPrice × 수량
}
export interface OrderView {
  id: number;
  orderedAt: string;
  orderType: OrderType | null;
  deviceId: number | null;
  lines: OrderLine[];
  quantity: number;
  amount: number;
}

// 명시된 유형을 우선하고, 이관 전 주문은 table_no로 해석한다(서버·회사 관리자 웹과 같은 규칙).
export function resolveOrderType(
  orderType: OrderType | null,
  tableNo: number | null,
): OrderType | null {
  if (orderType) return orderType;
  if (tableNo === 0) return "takeaway";
  if (tableNo !== null && tableNo > 0) return "dine_in";
  return null;
}
export const orderTypeLabel = (type: OrderType | null) =>
  type === "takeaway" ? "포장" : type === "dine_in" ? "매장 식사" : "미확인";

export function orderViews(history: OrderHistory, board: MenuBoard) {
  const menus = new Map(board.menus.map((m) => [m.id, m]));
  const options = new Map(board.options.map((o) => [o.id, o]));
  const lines = (orderId: number): OrderLine[] =>
    history.items
      .filter((i) => i.orderId === orderId)
      .sort((a, b) => a.id - b.id)
      .map((item) => {
        const menu = menus.get(item.menuId);
        // order_item_option과 이전 단일 옵션(order_item.option_id)을 합치고 중복을 뺀다.
        const optionIds = [
          ...new Set([
            ...history.itemOptions
              .filter((l) => l.itemId === item.id)
              .map((l) => l.optionId),
            ...(item.legacyOptionId === null ? [] : [item.legacyOptionId]),
          ]),
        ].sort((a, b) => a - b);
        const chosen = optionIds.map((id) => ({
          id,
          name: options.get(id)?.name ?? "(알 수 없는 옵션)",
          extraPrice: options.get(id)?.extraPrice ?? 0,
        }));
        const menuPrice = menu?.price ?? 0;
        const unitPrice =
          menuPrice + chosen.reduce((sum, o) => sum + o.extraPrice, 0);
        return {
          itemId: item.id,
          menuId: item.menuId,
          menuName: menu?.name ?? "(알 수 없는 메뉴)",
          quantity: item.quantity,
          menuPrice,
          options: chosen,
          unitPrice,
          amount: unitPrice * item.quantity,
        };
      });
  return history.orders
    .map((o): OrderView => {
      const list = lines(o.id);
      return {
        id: o.id,
        orderedAt: o.orderedAt,
        orderType: resolveOrderType(o.orderType, o.tableNo),
        deviceId: o.deviceId,
        lines: list,
        quantity: list.reduce((n, l) => n + l.quantity, 0),
        amount: list.reduce((n, l) => n + l.amount, 0),
      };
    })
    .sort(
      (a, b) =>
        new Date(b.orderedAt).getTime() - new Date(a.orderedAt).getTime() ||
        b.id - a.id,
    );
}

// 표의 메뉴 칸: "제육덮밥 외 1건"
export const menuSummary = (order: OrderView) =>
  order.lines.length === 0
    ? "-"
    : order.lines.length === 1
      ? order.lines[0].menuName
      : `${order.lines[0].menuName} 외 ${order.lines.length - 1}건`;

// 매장 날짜 기준으로 며칠 전인지. 오늘은 0.
export function storeDaysAgo(iso: string, now: string | Date) {
  const utc = (day: string) => {
    const [y, m, d] = day.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(storeDay(now)) - utc(storeDay(iso))) / 86_400_000);
}

export type Period = "today" | "7d" | "30d" | "all";
export const PERIODS: { value: Period; label: string }[] = [
  { value: "today", label: "오늘" },
  { value: "7d", label: "최근 7일" },
  { value: "30d", label: "최근 30일" },
  { value: "all", label: "전체" },
];
const PERIOD_DAYS: Record<Period, number> = {
  today: 0,
  "7d": 6,
  "30d": 29,
  all: Infinity,
};
export type TypeFilter = "all" | OrderType;

export function filterOrders(
  orders: OrderView[],
  { period, type, query }: { period: Period; type: TypeFilter; query: string },
  now: string | Date,
) {
  // "#17", "17번"처럼 써도 숫자만 비교한다.
  const digits = query.replace(/\D/g, "");
  return orders.filter((o) => {
    const ago = storeDaysAgo(o.orderedAt, now);
    return (
      ago >= 0 &&
      ago <= PERIOD_DAYS[period] &&
      (type === "all" || o.orderType === type) &&
      (!digits || String(o.id).includes(digits))
    );
  });
}

export const totalAmount = (orders: OrderView[]) =>
  orders.reduce((sum, o) => sum + o.amount, 0);

export const ordersDaysAgo = (
  orders: OrderView[],
  days: number,
  now: string | Date,
) => orders.filter((o) => storeDaysAgo(o.orderedAt, now) === days);

// 많이 팔린 메뉴: 수량, 같으면 매출, 같으면 이름 순
export function topMenus(orders: OrderView[], limit = 5) {
  const totals = new Map<
    number,
    { menuId: number; name: string; quantity: number; amount: number }
  >();
  for (const line of orders.flatMap((o) => o.lines)) {
    const row = totals.get(line.menuId) ?? {
      menuId: line.menuId,
      name: line.menuName,
      quantity: 0,
      amount: 0,
    };
    row.quantity += line.quantity;
    row.amount += line.amount;
    totals.set(line.menuId, row);
  }
  return [...totals.values()]
    .sort(
      (a, b) =>
        b.quantity - a.quantity ||
        b.amount - a.amount ||
        a.name.localeCompare(b.name, "ko"),
    )
    .slice(0, limit);
}

const parts = new Intl.DateTimeFormat("en-CA", {
  timeZone: STORE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
// 서버는 UTC로 준다. 화면에는 한국 시간으로 "2026-10-29 11:48"
export function formatDateTime(iso: string) {
  const p = Object.fromEntries(
    parts.formatToParts(new Date(iso)).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
export const formatTime = (iso: string) => formatDateTime(iso).slice(11);

// 사업자등록번호 10자리 → 000-00-00000
export const formatBusinessNo = (value: string) => {
  const digits = value.replace(/\D/g, "");
  return digits.length === 10
    ? `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`
    : value;
};
