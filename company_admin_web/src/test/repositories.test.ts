import { describe, expect, it, vi } from "vitest";
import { MockAdminRepository } from "../data/adminRepository";
import { ApiOrderRepository, parseOrder } from "../data/orderRepository";
import { diningLabel, filterOrders, mockOrders } from "../data/selectors";

export const apiOrder = (id = 1, table: number | null = 0, type?: string) => ({
  order_id: id,
  store_id: 1,
  store_name: "실제 매장",
  ordered_at: new Date().toISOString(),
  table_no: table,
  order_type: type,
  quantity: 2,
  device_id: 1,
});
export const apiDetail = (id = 1) => ({
  ...apiOrder(id),
  items: [
    {
      item_id: 1,
      menu_id: 1,
      menu_name: "제육덮밥",
      quantity: 2,
      options: [
        { option_id: 1, name: "밥 추가" },
        { option_id: 2, name: "계란 추가" },
      ],
    },
  ],
});
const response = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status });

describe("Flutter Mock fixture and repository parity", () => {
  it("preserves fixed period counts, relationships, one owner with multiple stores and quantities", async () => {
    const d = await new MockAdminRepository().load(),
      orders = mockOrders(d);
    expect([
      d.stores.length,
      d.owners.length,
      d.devices.length,
      d.alerts.length,
    ]).toEqual([6, 4, 6, 6]);
    expect(
      [1, 7, 30, 0].map(
        (days) =>
          filterOrders(orders, "", 0, days, new Date(d.referenceDate), true)
            .length,
      ),
    ).toEqual([3, 6, 7, 8]);
    expect(d.stores.filter((s) => s.ownerId === 1)).toHaveLength(2);
    expect(orders.find((o) => o.order_id === 1008)?.quantity).toBe(3);
    for (const item of d.items) {
      expect(d.menus.some((m) => m.id === item.menuId)).toBe(true);
      if (item.optionId !== null)
        expect(d.options.find((v) => v.id === item.optionId)?.menuId).toBe(
          item.menuId,
        );
    }
    for (const a of d.alerts)
      expect(d.devices.some((v) => v.id === a.deviceId)).toBe(true);
  });
  it("acknowledges once in memory, preserves offline status, snapshots and resets in a new repository", async () => {
    const r = new MockAdminRepository(() => new Date("2026-10-12T09:00:00Z"));
    const before = await r.load();
    await r.acknowledgeAlert("AL-1006");
    await r.acknowledgeAlert("AL-1006");
    const after = await r.load();
    expect(before.alerts[0].status).toBe("unconfirmed");
    expect(after.alerts[0]).toMatchObject({
      status: "acknowledged",
      acknowledgedAt: "2026-10-12T09:00:00.000Z",
    });
    expect(after.devices.find((d) => d.id === "VK-SEO-002")?.connection).toBe(
      "offline",
    );
    expect((await new MockAdminRepository().load()).alerts[0].status).toBe(
      "unconfirmed",
    );
    await expect(r.acknowledgeAlert("missing")).rejects.toThrow();
  });
});
describe("read-only FastAPI contract", () => {
  it("calls native browser fetch without using the repository as its receiver", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async function (
      this: unknown,
    ) {
      expect(this).not.toBeInstanceOf(ApiOrderRepository);
      return response({ orders: [], total: 0 });
    });
    expect(await new ApiOrderRepository("http://localhost").load()).toEqual([]);
  });
  it("keeps limit 200 / offset paging, base path, GET requests and detail multiple options", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ orders: [apiOrder()], total: 2 }))
      .mockResolvedValueOnce(response({ orders: [apiOrder(2, 3)], total: 2 }))
      .mockResolvedValueOnce(response(apiDetail()));
    const repo = new ApiOrderRepository(
      "http://localhost:8001/base/",
      transport,
    );
    const orders = await repo.load();
    expect(orders).toHaveLength(2);
    expect((await repo.detail(1)).items[0].options).toHaveLength(2);
    expect(transport.mock.calls.map((c) => c[0])).toEqual([
      "http://localhost:8001/base/admin/orders?limit=200&offset=0",
      "http://localhost:8001/base/admin/orders?limit=200&offset=1",
      "http://localhost:8001/base/admin/orders/1",
    ]);
    expect(transport.mock.calls.every((c) => c[1]?.method === "GET")).toBe(
      true,
    );
    expect(orders.map(diningLabel)).toEqual(["포장", "매장 식사 / 테이블 3번"]);
  });
  it("preserves explicit types and NULL tables, legacy fallback and unknown types", () => {
    expect(diningLabel(parseOrder(apiOrder(3, null, "takeaway")))).toBe("포장");
    expect(diningLabel(parseOrder(apiOrder(4, null, "dine_in")))).toBe(
      "매장 식사",
    );
    expect(diningLabel(parseOrder(apiOrder(5, null)))).toBe("주문 유형 미확인");
    expect(diningLabel(parseOrder(apiOrder(6, 3, "takeaway")))).toBe("포장");
    expect(diningLabel(parseOrder(apiOrder(7, 0, "invalid")))).toBe(
      "주문 유형 미확인",
    );
  });
  it("handles empty pages and stops if the server reports more data but returns no rows", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ orders: [], total: 5 }));
    expect(
      await new ApiOrderRepository("http://localhost", transport).load(),
    ).toEqual([]);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("rejects API errors, malformed responses, invalid URL and invalid detail id without Mock fallback", async () => {
    await expect(
      new ApiOrderRepository(
        "http://localhost",
        vi.fn().mockResolvedValue(response({ detail: "private" }, 503)),
      ).load(),
    ).rejects.toThrow("실제 주문");
    expect(() => parseOrder({ ...apiOrder(), ordered_at: "bad" })).toThrow();
    expect(() => parseOrder({ ...apiOrder(), items: [{}] })).toThrow();
    await expect(
      new ApiOrderRepository("ftp://localhost").load(),
    ).rejects.toThrow("주소");
    await expect(
      new ApiOrderRepository("http://localhost").detail(0),
    ).rejects.toThrow("ID");
  });
  it("aborts in-flight requests when the screen is closed", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) =>
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            ),
          ),
      );
    const controller = new AbortController();
    const promise = new ApiOrderRepository("http://localhost", transport).load(
      controller.signal,
    );
    controller.abort();
    await expect(promise).rejects.toThrow("aborted");
  });
  it("enforces a request timeout", async () => {
    vi.useFakeTimers();
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) =>
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("timeout", "AbortError")),
            ),
          ),
      );
    const promise = new ApiOrderRepository(
      "http://localhost",
      transport,
      20,
    ).load();
    const check = expect(promise).rejects.toThrow("timeout");
    await vi.advanceTimersByTimeAsync(21);
    await check;
  });
});
