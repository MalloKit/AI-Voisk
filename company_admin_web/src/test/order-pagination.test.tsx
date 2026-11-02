import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { MockAdminRepository } from "../data/adminRepository";
import { ApiOrderRepository } from "../data/orderRepository";

const row = (id: number) => ({ order_id: id, store_id: 1, store_name: "실제 매장",
  ordered_at: new Date().toISOString(), order_type: "takeaway", table_no: null, device_id: 1, quantity: 1 });
function insertingTransport() {
  const rows = Array.from({ length: 201 }, (_, i) => row(201 - i));
  let page = 0;
  return vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.pathname !== "/admin/orders") return Response.json({ ...row(Number(url.pathname.split("/").at(-1))), items: [] });
    if (++page === 2) rows.unshift(row(202));
    const offset = Number(url.searchParams.get("offset"));
    return Response.json({ orders: rows.slice(offset, offset + 200), total: rows.length, limit: 200, offset });
  });
}

describe("order pagination during concurrent inserts", () => {
  it("deduplicates 201 original orders when one order arrives between pages, preserving order and detail", async () => {
    const http = insertingTransport(), repo = new ApiOrderRepository("http://localhost:8001", http);
    const rows = await repo.load();
    expect(rows.map((o) => o.order_id)).toEqual(Array.from({ length: 201 }, (_, i) => 201 - i));
    expect(http.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("offset"))).toEqual(["0", "200"]);
    expect((await repo.detail(2)).order_id).toBe(2);
  });
  it("shares deduplicated orders with the dashboard and order list without navigating into a new fetch", async () => {
    const http = insertingTransport(), repo = new ApiOrderRepository("http://localhost:8001", http);
    const user = userEvent.setup();
    render(<App repository={new MockAdminRepository()} storeRepository={null} ownerRepository={null}
      deviceRepository={null} alertRepository={null} orderRepository={repo} />);
    await waitFor(() => expect(screen.getByRole("region", { name: "최근 7일 주문" })).toHaveTextContent("201건"));
    expect(within(screen.getByRole("table", { name: "주문 목록" })).getAllByRole("row")).toHaveLength(6);
    await user.click(screen.getByRole("link", { name: "최근 주문 내역 전체 보기" }));
    await screen.findByText("주문 목록 · 201건");
    expect(http).toHaveBeenCalledTimes(2);
  });
  it("advances offset by received rows even when a page consists only of duplicates and total keeps growing", async () => {
    const http = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ orders: [row(2), row(1)], total: 5 }))
      .mockResolvedValueOnce(Response.json({ orders: [row(2), row(1)], total: 100 }))
      .mockResolvedValueOnce(Response.json({ orders: [row(1)], total: 200 }))
      .mockRejectedValue(new Error("Unexpected extra page"));
    const rows = await new ApiOrderRepository("http://localhost:8001", http).load();
    expect(rows.map((o) => o.order_id)).toEqual([2, 1]);
    expect(http.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("offset"))).toEqual(["0", "2", "4"]);
  });
  it("keeps the first occurrence without duplicating or moving it", async () => {
    const first = row(3);
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ orders: [first, row(2), { ...first, store_name: "나중 응답" }], total: 3 }));
    expect((await new ApiOrderRepository("http://localhost:8001", http).load()).map((o) => [o.order_id, o.store_name]))
      .toEqual([[3, "실제 매장"], [2, "실제 매장"]]);
  });
  it.each([0, 4])("terminates on an empty page with total=%i", async (total) => {
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ orders: [], total }));
    expect(await new ApiOrderRepository("http://localhost:8001", http).load()).toEqual([]);
    expect(http).toHaveBeenCalledTimes(1);
  });
  it("rejects a later network failure rather than returning a successful partial list", async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ orders: [row(2)], total: 2 })).mockRejectedValueOnce(new TypeError("network"));
    await expect(new ApiOrderRepository("http://localhost:8001", http).load()).rejects.toThrow();
    expect(http).toHaveBeenCalledTimes(2);
  });
});
