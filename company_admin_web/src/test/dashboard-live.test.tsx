import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { MockAdminRepository } from "../data/adminRepository";
import type { Order } from "../data/models";
import type { OrderRepository } from "../data/orderRepository";
import { parseOrder } from "../data/orderRepository";

const order = (id: number, daysAgo = 0): Order =>
  parseOrder({
    order_id: id,
    store_id: 1,
    store_name: "실제 매장",
    ordered_at: new Date(Date.now() - daysAgo * 86400000).toISOString(),
    order_type: "takeaway",
    table_no: null,
    quantity: 1,
  });

const detail = (id: number): Order => ({
  ...order(id),
  items: [
    {
      item_id: 1,
      menu_id: 1,
      menu_name: "제육덮밥",
      quantity: 1,
      options: [{ option_id: 1, name: "밥 추가" }],
    },
  ],
});

describe("live orders on company dashboard", () => {
  it("counts actual recent orders, displays latest five, and loads real details", async () => {
    const recent = [order(10), order(12)];
    const older = [order(8, 10), order(7, 11), order(6, 12), order(5, 13)];
    const repository: OrderRepository = {
      load: vi.fn().mockResolvedValue([...older, ...recent]),
      detail: vi.fn().mockResolvedValue(detail(12)),
    };
    const user = userEvent.setup();
    render(
      <App deviceRepository={null} ownerRepository={null} storeRepository={null}
        repository={new MockAdminRepository()}
        orderRepository={repository}
      />,
    );
    await screen.findByRole("heading", { name: "운영 요약" });
    await waitFor(() => expect(screen.getByText("2건")).toBeInTheDocument());
    expect(screen.getByText("실제 주문 API")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "최근 주문 · 실제 API" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "주문 상세: #12" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "주문 상세: #5" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "주문 상세: #1008" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "주문 상세: #12" }));
    await screen.findByText("옵션: 밥 추가");
    expect(repository.detail).toHaveBeenCalledWith(12, expect.any(AbortSignal));
    expect(screen.getByRole("dialog")).toHaveAccessibleName("실제 주문 #12");
  });

  it("shows an error instead of pretending Mock orders are real and can retry", async () => {
    const repository: OrderRepository = {
      load: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue([]),
      detail: vi.fn().mockResolvedValue(detail(1)),
    };
    const user = userEvent.setup();
    render(
      <App deviceRepository={null} ownerRepository={null} storeRepository={null}
        repository={new MockAdminRepository()}
        orderRepository={repository}
      />,
    );
    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent("Mock 주문으로 대체하지 않습니다");
    expect(screen.getByText("조회 실패")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "주문 상세: #1008" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(screen.getByText("0건")).toBeInTheDocument());
    expect(repository.load).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/조건에 맞는 결과가 없습니다/)).toBeInTheDocument();
  });

  it("reuses the same order list when moving between dashboard and orders", async () => {
    const repository: OrderRepository = {
      load: vi.fn().mockResolvedValueOnce([order(30)]).mockResolvedValueOnce([order(30), order(31)]),
      detail: vi.fn().mockResolvedValue(detail(30)),
    };
    const user = userEvent.setup();
    render(
      <App deviceRepository={null} ownerRepository={null} storeRepository={null} repository={new MockAdminRepository()} orderRepository={repository} />,
    );
    await screen.findByRole("button", { name: "주문 상세: #30" });
    expect(repository.load).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("navigation", { name: "주요 화면" }).querySelectorAll("button")[3]);
    await screen.findByText("실제 주문 목록 · 1건");
    expect(repository.load).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "새로고침" }));
    await screen.findByText("실제 주문 목록 · 2건");
    expect(repository.load).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("navigation", { name: "주요 화면" }).querySelectorAll("button")[0]);
    expect(screen.getByText("2건")).toBeInTheDocument();
  });

  it("refreshes dashboard live orders without modifying the other Mock metrics", async () => {
    const repository: OrderRepository = {
      load: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([order(20)]),
      detail: vi.fn().mockResolvedValue(detail(20)),
    };
    const user = userEvent.setup();
    render(
      <App deviceRepository={null} ownerRepository={null} storeRepository={null} repository={new MockAdminRepository()} orderRepository={repository} />,
    );
    await screen.findByText("0건");
    expect(screen.getByText("6곳")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "새로고침" }));
    await screen.findByRole("button", { name: "주문 상세: #20" });
    expect(screen.getByText("1건")).toBeInTheDocument();
    expect(repository.load).toHaveBeenCalledTimes(2);
  });
});
