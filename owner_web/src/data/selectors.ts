import { STORE_TIME_ZONE } from "./demoClock";
import type { MenuBoard, Order } from "./models";

// 판매 중인 메뉴 중 품절인 것. 판매 중지 메뉴는 키오스크에 보이지 않으므로 세지 않는다.
export const soldOutMenuCount = (board: MenuBoard) =>
  board.menus.filter((m) => m.isActive && m.isSoldOut).length;

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: STORE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
// 매장 시간대 기준 날짜(YYYY-MM-DD). 브라우저 시간대와 무관하다.
export const storeDay = (iso: string | Date) => dayFormat.format(new Date(iso));

export const ordersOn = (orders: Order[], now: string | Date) => {
  const day = storeDay(now);
  return orders.filter((o) => storeDay(o.orderedAt) === day);
};
