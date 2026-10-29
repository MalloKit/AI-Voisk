import { describe, expect, it } from "vitest";
import { MockOwnerRepository } from "../data/ownerRepository";
import { DEMO_NOW } from "../data/demoClock";
import { updateMenu } from "../data/menuDraft";
import {
  filterOrders,
  formatBusinessNo,
  formatDateTime,
  menuSummary,
  orderViews,
  ordersDaysAgo,
  resolveOrderType,
  storeDaysAgo,
  topMenus,
  totalAmount,
  type Period,
  type TypeFilter,
} from "../data/orderSelectors";

async function views() {
  const repository = new MockOwnerRepository();
  const [history, board] = await Promise.all([
    repository.getOrderHistory(),
    repository.getMenuBoard(),
  ]);
  return { history, board, orders: orderViews(history, board) };
}
const ids = (list: { id: number }[]) => list.map((o) => o.id);
const filter = async (period: Period, type: TypeFilter = "all", query = "") =>
  filterOrders((await views()).orders, { period, type, query }, DEMO_NOW);

describe("주문 금액 계산 (현재 메뉴 가격 기준)", () => {
  it("메뉴 가격과 옵션 여러 개의 추가 금액을 더해 수량만큼 곱한다", async () => {
    const { orders } = await views();
    const o18 = orders.find((o) => o.id === 18)!;
    expect(
      o18.lines.map((l) => [
        l.menuName,
        l.quantity,
        l.options.map((x) => `${x.name} ${x.extraPrice}`),
        l.unitPrice,
        l.amount,
      ]),
    ).toEqual([
      ["제육덮밥", 1, ["밥 추가 1000", "계란 추가 1000"], 11000, 11000],
      ["만두", 1, [], 4000, 4000],
    ]);
    expect([o18.quantity, o18.amount]).toEqual([2, 15000]);
    const o19 = orders.find((o) => o.id === 19)!;
    expect(o19.amount).toBe((8500 + 1000 + 1500) * 2);
    expect(menuSummary(orders.find((o) => o.id === 1)!)).toBe(
      "제육덮밥 외 1건",
    );
    expect(menuSummary(o19)).toBe("순두부찌개");
  });

  it("메뉴 가격이 바뀌면 지난 주문 금액도 현재 가격으로 다시 계산된다", async () => {
    const { history, board } = await views();
    const raised = updateMenu(board, 4, { price: 8000 }); // 콩나물국밥 7,500 → 8,000
    expect(orderViews(history, raised).find((o) => o.id === 17)?.amount).toBe(
      8000,
    );
  });

  it("order_item_option과 이전 단일 옵션을 합치고 중복은 한 번만 센다", async () => {
    const { history, board } = await views();
    const legacy = {
      ...history,
      items: history.items.map((i) =>
        i.id === 1 ? { ...i, legacyOptionId: 1 } : i,
      ),
    };
    const o1 = orderViews(legacy, board).find((o) => o.id === 1)!;
    expect(o1.lines[0].options.map((x) => x.id)).toEqual([1, 2]);
  });

  it("최신 주문이 먼저 온다", async () => {
    expect(ids((await views()).orders).slice(0, 5)).toEqual([
      20, 19, 18, 17, 16,
    ]);
  });
});

describe("주문 유형", () => {
  it("order_type을 우선하고 이관 전 주문은 table_no로 해석한다", () => {
    expect(resolveOrderType("dine_in", 0)).toBe("dine_in");
    expect(resolveOrderType(null, 0)).toBe("takeaway");
    expect(resolveOrderType(null, 3)).toBe("dine_in");
    expect(resolveOrderType(null, null)).toBeNull();
  });
});

describe("기간·구분·주문번호 필터", () => {
  it("기간은 한국 날짜 기준으로 오늘, 최근 7일, 최근 30일, 전체", async () => {
    expect(ids(await filter("today"))).toEqual([20, 19, 18, 17]);
    expect(ids(await filter("7d"))).toEqual([
      20, 19, 18, 17, 16, 15, 14, 13, 12,
    ]);
    expect(await filter("30d")).toHaveLength(20);
    expect(await filter("all")).toHaveLength(20);
  });

  it("한국 자정을 기준으로 날짜가 바뀐다", () => {
    expect(storeDaysAgo("2026-10-28T15:00:00Z", DEMO_NOW)).toBe(0);
    expect(storeDaysAgo("2026-10-28T14:59:59Z", DEMO_NOW)).toBe(1);
  });

  it("구분과 기간을 함께 걸러 낸다", async () => {
    expect(await filter("all", "takeaway")).toHaveLength(8);
    expect(await filter("all", "dine_in")).toHaveLength(12);
    expect(ids(await filter("7d", "takeaway"))).toEqual([20, 17, 15, 12]);
  });

  it("주문번호는 숫자만 비교한다", async () => {
    expect(ids(await filter("all", "all", "#19"))).toEqual([19]);
    expect(ids(await filter("all", "all", "17번"))).toEqual([17]);
    expect(await filter("today", "all", "5")).toEqual([]);
  });

  it("건수와 합계", async () => {
    expect(totalAmount(await filter("7d"))).toBe(130000);
    expect(totalAmount(await filter("today", "takeaway"))).toBe(16500);
  });
});

describe("오늘 현황 계산", () => {
  it("오늘·어제 매출", async () => {
    const { orders } = await views();
    expect(totalAmount(ordersDaysAgo(orders, 0, DEMO_NOW))).toBe(53500);
    expect(totalAmount(ordersDaysAgo(orders, 1, DEMO_NOW))).toBe(22000);
  });

  it("많이 팔린 메뉴는 수량, 같으면 매출 순으로 5개", async () => {
    const { orders } = await views();
    expect(
      topMenus(ordersDaysAgo(orders, 0, DEMO_NOW)).map((t) => [
        t.name,
        t.quantity,
        t.amount,
      ]),
    ).toEqual([
      ["순두부찌개", 2, 22000],
      ["콜라", 2, 4000],
      ["제육덮밥", 1, 11000],
      ["콩나물국밥", 1, 7500],
      ["떡볶이", 1, 5000],
    ]);
  });
});

describe("표시 형식", () => {
  it("UTC 시각을 한국 시간으로 보여 준다", () => {
    expect(formatDateTime("2026-10-29T02:48:00.000Z")).toBe("2026-10-29 11:48");
    expect(formatDateTime("2026-10-28T15:05:00Z")).toBe("2026-10-29 00:05");
  });

  it("사업자등록번호를 000-00-00000 형식으로", () => {
    expect(formatBusinessNo("1234567890")).toBe("123-45-67890");
    expect(formatBusinessNo("0000000000")).toBe("000-00-00000");
    expect(formatBusinessNo("12345")).toBe("12345");
  });
});
