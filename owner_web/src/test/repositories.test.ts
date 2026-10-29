import { describe, expect, it } from "vitest";
import { MockOwnerRepository } from "../data/ownerRepository";
import { ordersOn, soldOutMenuCount, storeDay } from "../data/selectors";
import { DEMO_NOW } from "../data/demoClock";

const DAY = 86_400_000;

describe("T0001 Mock 메뉴", () => {
  it("seed_test_menus.sql과 같은 카테고리·메뉴를 같은 순서로 가진다", async () => {
    const board = await new MockOwnerRepository().getMenuBoard();
    expect(board.categories.map((c) => [c.name, c.sort])).toEqual(
      [
        "식사",
        "국물",
        "사이드",
        "음료",
        "면류",
        "구이",
        "튀김",
        "분식",
        "샐러드",
        "디저트",
        "세트",
      ].map((name, i) => [name, i + 1]),
    );
    const category = (id: number) =>
      board.categories.find((c) => c.id === id)!.name;
    expect(
      board.menus.map((m) => [category(m.categoryId), m.name, m.price, m.sort]),
    ).toEqual([
      ["식사", "제육덮밥", 9000, 1],
      ["식사", "비빔밥", 8000, 2],
      ["국물", "순두부찌개", 8500, 3],
      ["국물", "콩나물국밥", 7500, 4],
      ["사이드", "만두", 4000, 5],
      ["음료", "콜라", 2000, 6],
      ["음료", "사이다", 2000, 7],
      ["면류", "잔치국수", 7000, 8],
      ["구이", "불고기", 12000, 9],
      ["튀김", "새우튀김", 6000, 10],
      ["분식", "떡볶이", 5000, 11],
      ["샐러드", "채소 샐러드", 6500, 12],
      ["디저트", "바닐라 아이스크림", 3000, 13],
      ["세트", "덮밥 세트", 11000, 14],
    ]);
    expect(board.menus.filter((m) => m.isSoldOut).map((m) => m.name)).toEqual([
      "사이다",
    ]);
    expect(board.menus.every((m) => m.isActive)).toBe(true);
    expect(soldOutMenuCount(board)).toBe(1);
  });

  it("seed_test_options.sql과 같은 옵션 10개를 가진다", async () => {
    const board = await new MockOwnerRepository().getMenuBoard();
    const menu = (id: number) => board.menus.find((m) => m.id === id)!.name;
    expect(
      board.options.map((o) => [menu(o.menuId), o.name, o.sort, o.extraPrice]),
    ).toEqual([
      ["제육덮밥", "밥 추가", 1, 1000],
      ["제육덮밥", "계란 추가", 2, 1000],
      ["제육덮밥", "고기 추가", 3, 2000],
      ["비빔밥", "밥 추가", 1, 1000],
      ["비빔밥", "계란 추가", 2, 1000],
      ["비빔밥", "고기 추가", 3, 2000],
      ["순두부찌개", "공깃밥 추가", 1, 1000],
      ["순두부찌개", "두부 추가", 2, 1500],
      ["콩나물국밥", "공깃밥 추가", 1, 1000],
      ["만두", "소스 추가", 1, 500],
    ]);
    expect(board.options.every((o) => o.isActive && !o.isSoldOut)).toBe(true);
  });

  it("판매 중지 메뉴는 품절 개수에 넣지 않는다", async () => {
    const board = await new MockOwnerRepository().getMenuBoard();
    board.menus.find((m) => m.name === "사이다")!.isActive = false;
    board.menus.find((m) => m.name === "콜라")!.isSoldOut = true;
    expect(soldOutMenuCount(board)).toBe(1);
  });

  it("복사본을 돌려주어 화면에서 바꿔도 저장소 데이터는 그대로다", async () => {
    const repository = new MockOwnerRepository();
    const board = await repository.getMenuBoard();
    board.menus[0].name = "변경";
    board.categories.pop();
    const again = await repository.getMenuBoard();
    expect(again.menus[0].name).toBe("제육덮밥");
    expect(again.categories).toHaveLength(11);
  });
});

describe("T0001 Mock 주문", () => {
  it("시연 기준 시각 전 30일 안에 20건이 있고 오늘 주문도 있다", async () => {
    const { orders } = await new MockOwnerRepository().getOrderHistory();
    const now = new Date(DEMO_NOW).getTime();
    expect(orders).toHaveLength(20);
    for (const o of orders) {
      const at = new Date(o.orderedAt).getTime();
      expect(at).toBeLessThanOrEqual(now);
      expect(now - at).toBeLessThan(30 * DAY);
      expect(o.orderedAt.endsWith("Z")).toBe(true);
    }
    expect(ordersOn(orders, DEMO_NOW).map((o) => o.id)).toEqual([
      17, 18, 19, 20,
    ]);
  });

  it("서버와 같은 주문 유형을 쓰고 신규 주문처럼 테이블 번호가 없다", async () => {
    const { orders } = await new MockOwnerRepository().getOrderHistory();
    expect(new Set(orders.map((o) => o.orderType))).toEqual(
      new Set(["takeaway", "dine_in"]),
    );
    expect(orders.every((o) => o.tableNo === null)).toBe(true);
    expect(new Set(orders.map((o) => o.clientOrderId)).size).toBe(20);
  });

  it("품목과 옵션이 같은 매장 메뉴를 가리키고 한 품목에 옵션 여러 개가 있다", async () => {
    const repository = new MockOwnerRepository();
    const { menus, options } = await repository.getMenuBoard();
    const { orders, items, itemOptions } = await repository.getOrderHistory();
    const devices = await repository.getDevices();
    for (const o of orders) {
      expect(items.some((i) => i.orderId === o.id)).toBe(true);
      expect(devices.some((d) => d.id === o.deviceId)).toBe(true);
    }
    for (const item of items) {
      expect(orders.some((o) => o.id === item.orderId)).toBe(true);
      expect(menus.some((m) => m.id === item.menuId)).toBe(true);
      expect(item.quantity).toBeGreaterThanOrEqual(1);
      expect(item.legacyOptionId).toBeNull();
    }
    for (const link of itemOptions) {
      const item = items.find((i) => i.id === link.itemId)!;
      expect(options.find((o) => o.id === link.optionId)?.menuId).toBe(
        item.menuId,
      );
    }
    const perItem = new Map<number, number>();
    for (const link of itemOptions)
      perItem.set(link.itemId, (perItem.get(link.itemId) ?? 0) + 1);
    expect(Math.max(...perItem.values())).toBeGreaterThanOrEqual(3);
    const keys = itemOptions.map((l) => `${l.itemId}-${l.optionId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("오늘 판정은 브라우저 시간대가 아니라 매장 시간대(한국)를 따른다", () => {
    expect(storeDay("2026-10-28T14:59:59Z")).toBe("2026-10-28");
    expect(storeDay("2026-10-28T15:00:00Z")).toBe("2026-10-29");
  });
});

describe("Mock 키오스크 기기", () => {
  it("정상 기기와 연결 끊긴 기기를 하나씩 가진다", async () => {
    const devices = await new MockOwnerRepository().getDevices();
    expect(devices.map((d) => [d.id, d.connection])).toEqual([
      [1, "online"],
      [2, "offline"],
    ]);
  });
});
