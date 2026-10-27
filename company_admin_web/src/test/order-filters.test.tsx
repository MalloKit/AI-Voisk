import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { MockAdminRepository } from "../data/adminRepository";
import { parseOrder } from "../data/orderRepository";
import type { OrderRepository } from "../data/orderRepository";
import type { Order } from "../data/models";
import { dateLabel, filterOrdersAdvanced, getOrderKind } from "../data/selectors";

function row(id: number, type: string | null, table: number | null, device: number | null, date = new Date().toISOString()): Order {
  return parseOrder({
    order_id: id, store_id: 1, store_name: "테스트 매장",
    ordered_at: date, order_type: type, table_no: table, device_id: device, quantity: 1,
  });
}
async function open(orders: Order[], live = true) {
  const repo: OrderRepository = {
    load: vi.fn().mockResolvedValue(orders),
    detail: vi.fn().mockResolvedValue({ ...orders[0], items: [] }),
  };
  const user = userEvent.setup();
  render(<App alertRepository={null} deviceRepository={null} ownerRepository={null} storeRepository={null} repository={new MockAdminRepository()} orderRepository={live ? repo : null} />);
  await screen.findByRole("heading", { name: "운영 요약" });
  await user.click(within(screen.getByRole("navigation", { name: "주요 화면" })).getByRole("button", { name: "주문 조회" }));
  if (live) await screen.findByText(`실제 주문 목록 · ${orders.length}건`);
  else await screen.findByText("주문 목록 · 6건");
  return { user, repo };
}
describe("order type, device and custom-date filters", () => {
  it("combines type and device including legacy and unclassified orders, without reloading API", async () => {
    const { user, repo } = await open([
      row(1, "takeaway", null, 1),
      row(2, "dine_in", 3, 2),
      row(3, null, 0, null),
      row(4, null, null, null),
    ]);
    await user.selectOptions(screen.getByLabelText("주문 유형"), "takeaway");
    expect(screen.getByText("실제 주문 목록 · 2건")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("기기"), "1");
    expect(screen.getByText("실제 주문 목록 · 1건")).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveTextContent("#1");
    await user.selectOptions(screen.getByLabelText("기기"), "unknown");
    expect(screen.getByRole("table")).toHaveTextContent("#3");
    await user.selectOptions(screen.getByLabelText("주문 유형"), "unknown");
    expect(screen.getByRole("table")).toHaveTextContent("#4");
    expect(repo.load).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "초기화" }));
    expect(screen.getByLabelText("주문 유형")).toHaveValue("all");
    expect(screen.getByLabelText("기기")).toHaveValue("all");
    expect(screen.getByText("실제 주문 목록 · 4건")).toBeInTheDocument();
  });
  it("custom date range includes both ends and supports one-sided bounds", async () => {
    const now = new Date();
    const dayBefore = new Date(now.getFullYear(), now.getMonth(), now.getDate()-1, 12);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
    const dayAfter = new Date(now.getFullYear(), now.getMonth(), now.getDate()+1, 12);
    const { user, repo } = await open([
      row(11, "takeaway", null, 1, dayBefore.toISOString()),
      row(12, "takeaway", null, 1, today.toISOString()),
      row(13, "takeaway", null, 1, dayAfter.toISOString()),
    ]);
    await user.selectOptions(screen.getByLabelText("조회 기간"), "-1");
    fireEvent.change(screen.getByLabelText("시작일"), { target: { value: dateLabel(today) } });
    expect(screen.getByText("실제 주문 목록 · 2건")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("종료일"), { target: { value: dateLabel(today) } });
    expect(screen.getByText("실제 주문 목록 · 1건")).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveTextContent("#12");
    fireEvent.change(screen.getByLabelText("시작일"), { target: { value: "" } });
    expect(screen.getByText("실제 주문 목록 · 2건")).toBeInTheDocument();
    expect(repo.load).toHaveBeenCalledTimes(1);
  });
  it("invalid date range is explained, and reset restores presets", async () => {
    const { user } = await open([row(1, "takeaway", null, 5)]);
    await user.selectOptions(screen.getByLabelText("조회 기간"), "-1");
    fireEvent.change(screen.getByLabelText("시작일"), { target: { value: "2026-10-28" } });
    fireEvent.change(screen.getByLabelText("종료일"), { target: { value: "2026-10-20" } });
    expect(screen.getByRole("alert")).toHaveTextContent("시작일이 종료일보다 늦습니다");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "초기화" }));
    expect(screen.getByLabelText("조회 기간")).toHaveValue("7");
    expect(screen.queryByLabelText("시작일")).not.toBeInTheDocument();
    expect(screen.getByText("실제 주문 목록 · 1건")).toBeInTheDocument();
  });
  it("supports unknown explicit types, NULL devices, and custom day selection", () => {
    expect(getOrderKind(row(3, null, 0, null))).toBe("takeaway");
    expect(getOrderKind(row(4, null, null, null))).toBe("unknown");
    expect(getOrderKind(row(5, "invalid", 0, null))).toBe("unknown");
    const input = [
      row(21, "takeaway", null, 1, new Date(2026, 6, 9, 12).toISOString()),
      row(22, "takeaway", null, 1, new Date(2026, 6, 10, 12).toISOString()),
      row(23, "dine_in", 2, null, new Date(2026, 6, 11, 12).toISOString()),
    ];
    expect(filterOrdersAdvanced(input, "", 0, -1, new Date(), false, {
      kind: "all", device: "all", fromDate: "2026-07-09", toDate: "2026-07-10",
    }).map((o) => o.order_id)).toEqual([21, 22]);
    expect(filterOrdersAdvanced(input, "", 0, -1, new Date(), false, {
      kind: "all", device: "unknown", fromDate: "", toDate: "",
    }).map((o) => o.order_id)).toEqual([23]);
  });
  it("retains fixed Mock periods and honestly reports missing device IDs", async () => {
    const { user } = await open([], false);
    expect(screen.getByText(/Mock 주문에는 기기 ID가 없습니다/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("기기"), "unknown");
    expect(screen.getByText("주문 목록 · 6건")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("조회 기간"), "1");
    expect(screen.getByText("주문 목록 · 3건")).toBeInTheDocument();
  });
});
