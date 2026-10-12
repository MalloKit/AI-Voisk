import type { AdminSnapshot, Order } from "./models";

export const alertTypes = {
  offline: "오프라인",
  connectionError: "연결 오류",
  updateRequired: "업데이트 필요",
};
export const alertStatuses = {
  unconfirmed: "미확인",
  acknowledged: "확인 완료",
  resolved: "해소됨",
};
export const connectionLabel = (v: string) =>
  v === "online" ? "온라인" : "오프라인";
export function dateLabel(value: string | Date, time = false) {
  const d = new Date(value),
    pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}${time ? ` ${pad(d.getHours())}:${pad(d.getMinutes())}` : ""}`;
}
export function diningLabel(o: Pick<Order, "order_type" | "table_no">) {
  const type =
    o.order_type ??
    (o.table_no === 0
      ? "takeaway"
      : o.table_no !== null && o.table_no > 0
        ? "dine_in"
        : "unknown");
  if (type === "takeaway") return "포장";
  if (type === "dine_in")
    return o.table_no !== null && o.table_no > 0
      ? `매장 식사 / 테이블 ${o.table_no}번`
      : "매장 식사";
  return "주문 유형 미확인";
}
export function mockOrders(data: AdminSnapshot): Order[] {
  return data.orders
    .map((o) => {
      const items = data.items
        .filter((i) => i.orderId === o.id)
        .map((i) => ({
          item_id: i.id,
          menu_id: i.menuId,
          menu_name: data.menus.find((m) => m.id === i.menuId)!.name,
          quantity: i.quantity,
          options: data.options
            .filter((v) => v.id === i.optionId)
            .map((v) => ({ option_id: v.id, name: v.name })),
        }));
      return {
        order_id: o.id,
        store_id: o.storeId,
        store_name: data.stores.find((s) => s.id === o.storeId)!.name,
        ordered_at: o.orderedAt,
        table_no: o.tableNo,
        quantity: items.reduce((n, i) => n + i.quantity, 0),
        items,
      };
    })
    .sort(
      (a, b) =>
        new Date(b.ordered_at).getTime() - new Date(a.ordered_at).getTime(),
    );
}
export function filterOrders(
  orders: Order[],
  query: string,
  store: number,
  days: number,
  at: Date,
  bounded = false,
) {
  const start = new Date(at);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days + 1);
  const end = new Date(at);
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + 1);
  return orders.filter(
    (o) =>
      (!store || o.store_id === store) &&
      String(o.order_id).includes(query.trim()) &&
      (!days ||
        (new Date(o.ordered_at) >= start &&
          (!bounded || new Date(o.ordered_at) < end))),
  );
}
