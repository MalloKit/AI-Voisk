import { STORE_TIME_ZONE } from "./demoClock";
import type { KioskDevice, MenuBoard, Order } from "./models";

// 판매 중인 메뉴 중 품절인 것. 판매 중지 메뉴는 키오스크에 보이지 않으므로 세지 않는다.
export const soldOutMenuCount = (board: MenuBoard) =>
  board.menus.filter((m) => m.isActive && m.isSoldOut).length;

// 키오스크 메뉴 버전 상태. 회사 관리자 웹 menuVersionStatus와 같은 규칙이다.
// 둘 중 하나라도 모르면 최신이라고 하지 않는다.
export function menuVersionStatus(
  device: Pick<KioskDevice, "currentMenuVersion" | "appliedMenuVersion">,
): { kind: "latest" | "pending" | "unknown"; label: string } {
  const { currentMenuVersion: current, appliedMenuVersion: applied } = device;
  if (current === null || applied === null)
    return { kind: "unknown", label: "미확인" };
  return applied >= current
    ? { kind: "latest", label: "최신" }
    : {
        kind: "pending",
        label: `반영 대기 (적용 ${applied} / 최신 ${current})`,
      };
}

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
