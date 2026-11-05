import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { MockAdminRepository } from "../data/adminRepository";
import type { ApiOwner, ApiStore, Order } from "../data/models";
import type { StoreRepository } from "../data/storeRepository";
import type { OwnerRepository } from "../data/ownerRepository";
import type { OrderRepository } from "../data/orderRepository";
import { parseStore } from "../data/storeRepository";
import { parseOrder } from "../data/orderRepository";

const store = (id = 1, ownerId: number | null = null): ApiStore => parseStore({
  store_id: id, store_name: "DB 매장 " + id, address: "실제 주소", address_detail: "2층",
  store_code: "A0001", phone: "051-001", business_no: "0000000001",
  representative: "실제 대표", store_type: "카페", admin_id: 1,
  admin_name: "DB 관리자", owner_id: ownerId,
  owner_login_id: ownerId === null ? null : "DB_OWNER",
});
const owner = (id = 1): ApiOwner => ({ id, loginId: "DB_OWNER_" + id, storeCount: 0 });
const order = (id = 1): Order => parseOrder({
  order_id: id, store_id: 1, store_name: "DB 매장 1",
  ordered_at: new Date().toISOString(), order_type: "takeaway", table_no: null, quantity: 1,
});
const metric = (name: string) => screen.getByRole("region", { name });
const nav = (name: string) => within(screen.getByRole("navigation", { name: "주요 화면" }))
  .getByRole("button", { name });

function repositories() {
  return {
    stores: {
      load: vi.fn<StoreRepository["load"]>().mockResolvedValue([]),
      detail: vi.fn<StoreRepository["detail"]>().mockResolvedValue(store()),
    },
    owners: {
      load: vi.fn<OwnerRepository["load"]>().mockResolvedValue([]),
      detail: vi.fn<OwnerRepository["detail"]>().mockResolvedValue({ ...owner(), stores: [] }),
    },
    orders: {
      load: vi.fn<OrderRepository["load"]>().mockResolvedValue([]),
      detail: vi.fn<OrderRepository["detail"]>().mockResolvedValue({ ...order(), items: [] }),
    },
  };
}
async function open(repos = repositories()) {
  const user = userEvent.setup();
  render(<App alertRepository={null} deviceRepository={null} repository={new MockAdminRepository()} storeRepository={repos.stores}
    ownerRepository={repos.owners} orderRepository={repos.orders} />);
  await screen.findByRole("heading", { name: "운영 요약", level: 1 });
  return { user, ...repos };
}
async function expectOwnerCount(count: number) {
  const user = userEvent.setup();
  await user.click(nav("점주 계정"));
  await screen.findByText(`점주 계정 목록 · ${count}개`);
  await user.click(nav("운영 요약"));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => { resolve = finish; });
  return { promise, resolve };
}

describe("shared live dashboard sources", () => {
  it("limits dashboard orders to five without pagination and preserves access to all seven orders", async () => {
    const repos = repositories();
    repos.orders.load.mockResolvedValue(Array.from({ length: 7 }, (_, i) => order(i + 1)));
    const { user } = await open(repos);
    await screen.findByRole("heading", { name: "최근 주문 내역 · 최대 5건" });
    const table = await screen.findByRole("table", { name: "주문 목록" });
    expect(within(table).getAllByRole("row")).toHaveLength(6);
    expect(table).toHaveTextContent("#7");
    expect(table).not.toHaveTextContent("#1");
    expect(table.closest(".table-card")?.querySelector(".pagination")).toBeNull();
    await user.click(screen.getByRole("button", { name: "주문 상세: #7" }));
    await within(screen.getByRole("dialog")).findByText("DB 매장 1");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "닫기" }));
    await user.click(screen.getByRole("link", { name: "최근 주문 내역 전체 보기" }));
    await screen.findByRole("heading", { name: "주문 조회", level: 1 });
    expect(screen.getByText("1–5 / 7건")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "다음 페이지" }));
    expect(screen.getByText("6–7 / 7건")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(3);
    expect(repos.orders.load).toHaveBeenCalledTimes(1);
  });

  it("shows successful zero store and owner counts without using Mock metrics", async () => {
    await open();
    await waitFor(() => expect(metric("등록 매장")).toHaveTextContent("0곳"));
    await expectOwnerCount(0);
    expect(metric("점주 미연결 매장")).toHaveTextContent("0곳");
    expect(metric("최근 7일 주문")).toHaveTextContent("0건");
    expect(screen.getByText("등록된 매장이 없습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/기기: Mock · 알림: Mock/)).not.toBeInTheDocument();
  });

  it("shows one actual unlinked store and zero owners, including real store detail", async () => {
    const repos = repositories();
    repos.stores.load.mockResolvedValue([store(1)]);
    const { user } = await open(repos);
    await waitFor(() => expect(metric("등록 매장")).toHaveTextContent("1곳"));
    await expectOwnerCount(0);
    expect(metric("점주 미연결 매장")).toHaveTextContent("1곳");
    await user.click(screen.getByRole("button", { name: "매장 상세: DB 매장 1" }));
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByText("DB 관리자");
    expect(dialog).toHaveTextContent("실제 주소 2층");
    expect(dialog).toHaveTextContent("A0001");
    const mock = await new MockAdminRepository().load();
    for (const s of mock.stores) expect(dialog).not.toHaveTextContent(s.name);
    expect(repos.stores.detail).toHaveBeenCalledWith(1, expect.any(AbortSignal));
  });

  it("counts only ownerId=null stores and applies that filter to the shared management list", async () => {
    const repos = repositories();
    repos.stores.load.mockResolvedValue([store(1), store(2, 7), store(3)]);
    repos.owners.load.mockResolvedValue([owner(7)]);
    const { user } = await open(repos);
    await waitFor(() => expect(metric("등록 매장")).toHaveTextContent("3곳"));
    expect(metric("점주 미연결 매장")).toHaveTextContent("2곳");
    await expectOwnerCount(1);
    await user.click(screen.getByRole("link", { name: "점주 미연결 매장 전체 보기" }));
    await screen.findByText("매장 목록 · 2곳");
    expect(screen.getByLabelText("점주 연결")).toHaveValue("미연결");
    expect(screen.getByRole("table")).not.toHaveTextContent("DB 매장 2");
    expect(repos.stores.load).toHaveBeenCalledTimes(1);
    await user.click(nav("운영 요약"));
    expect(metric("등록 매장")).toHaveTextContent("3곳");
    expect(repos.stores.load).toHaveBeenCalledTimes(1);
  });

  it("keeps all loading states independent from successful zero counts", async () => {
    const repos = repositories();
    const stores = deferred<ApiStore[]>(), owners = deferred<ApiOwner[]>(), orders = deferred<Order[]>();
    repos.stores.load.mockReturnValue(stores.promise);
    repos.owners.load.mockReturnValue(owners.promise);
    repos.orders.load.mockReturnValue(orders.promise);
    await open(repos);
    for (const label of ["등록 매장", "점주 미연결 매장", "최근 7일 주문"])
      expect(metric(label)).toHaveTextContent("조회 중");
    await act(async () => { stores.resolve([]); });
    expect(metric("등록 매장")).toHaveTextContent("0곳");
    expect(screen.getByRole("button", { name: "새로고침 중…" })).toBeDisabled();
    await act(async () => { owners.resolve([]); orders.resolve([]); });
    await expectOwnerCount(0);
    expect(metric("최근 7일 주문")).toHaveTextContent("0건");
  });

  it("isolates a store failure and retries only the store source", async () => {
    const repos = repositories();
    repos.stores.load.mockRejectedValueOnce(new Error("store unavailable")).mockResolvedValueOnce([store()]);
    repos.owners.load.mockResolvedValue([owner(), owner(2)]);
    repos.orders.load.mockResolvedValue([order()]);
    const { user } = await open(repos);
    await waitFor(() => expect(metric("등록 매장")).toHaveTextContent("조회 실패"));
    expect(metric("점주 미연결 매장")).toHaveTextContent("조회 실패");
    await expectOwnerCount(2);
    expect(metric("최근 7일 주문")).toHaveTextContent("1건");
    expect(screen.queryByRole("button", { name: "매장 상세: 말로 카페 성수" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "매장 다시 시도" }));
    await waitFor(() => expect(metric("등록 매장")).toHaveTextContent("1곳"));
    expect(repos.stores.load).toHaveBeenCalledTimes(2);
    expect(repos.owners.load).toHaveBeenCalledTimes(1);
    expect(repos.orders.load).toHaveBeenCalledTimes(1);
  });

  it("isolates an owner failure while store counts and order counts remain available", async () => {
    const repos = repositories();
    repos.stores.load.mockResolvedValue([store()]);
    repos.owners.load.mockRejectedValueOnce(new Error("owner unavailable")).mockResolvedValueOnce([]);
    repos.orders.load.mockResolvedValue([order()]);
    const { user } = await open(repos);
    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent("실제 점주 조회 실패");
    expect(metric("등록 매장")).toHaveTextContent("1곳");
    expect(metric("점주 미연결 매장")).toHaveTextContent("1곳");
    expect(metric("최근 7일 주문")).toHaveTextContent("1건");
    await user.click(screen.getByRole("button", { name: "점주 다시 시도" }));
    await expectOwnerCount(0);
    expect(repos.stores.load).toHaveBeenCalledTimes(1);
    expect(repos.orders.load).toHaveBeenCalledTimes(1);
  });

  it("isolates an order failure from actual store and owner metrics", async () => {
    const repos = repositories();
    repos.stores.load.mockResolvedValue([store()]);
    repos.owners.load.mockResolvedValue([owner()]);
    repos.orders.load.mockRejectedValue(new Error("orders unavailable"));
    await open(repos);
    await waitFor(() => expect(metric("최근 7일 주문")).toHaveTextContent("조회 실패"));
    expect(metric("등록 매장")).toHaveTextContent("1곳");
    await expectOwnerCount(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Mock 주문으로 대체하지 않습니다");
  });

  it("shares whole refresh results and keeps management store refresh independent", async () => {
    const repos = repositories();
    repos.stores.load.mockResolvedValueOnce([store()])
      .mockResolvedValueOnce([store(), store(2, 1)]).mockResolvedValueOnce([]);
    const { user } = await open(repos);
    await waitFor(() => expect(metric("등록 매장")).toHaveTextContent("1곳"));
    await user.click(screen.getByRole("button", { name: "전체 새로고침" }));
    await waitFor(() => expect(metric("등록 매장")).toHaveTextContent("2곳"));
    expect(metric("점주 미연결 매장")).toHaveTextContent("1곳");
    await user.click(nav("매장 관리"));
    await screen.findByText("매장 목록 · 2곳");
    expect(repos.stores.load).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole("button", { name: "새로고침" }));
    await screen.findByText("매장 목록 · 0곳");
    await user.click(nav("운영 요약"));
    expect(metric("등록 매장")).toHaveTextContent("0곳");
    expect(metric("점주 미연결 매장")).toHaveTextContent("0곳");
    expect(repos.stores.load).toHaveBeenCalledTimes(3);
    expect(repos.owners.load).toHaveBeenCalledTimes(2);
    expect(repos.orders.load).toHaveBeenCalledTimes(2);
  });

  it("shares whole refresh results and keeps management owner refresh independent", async () => {
    const repos = repositories();
    repos.owners.load.mockResolvedValueOnce([]).mockResolvedValueOnce([owner()])
      .mockResolvedValueOnce([owner(), owner(2)]);
    const { user } = await open(repos);
    await expectOwnerCount(0);
    await user.click(screen.getByRole("button", { name: "전체 새로고침" }));
    await expectOwnerCount(1);
    await user.click(nav("점주 계정"));
    await screen.findByText("점주 계정 목록 · 1개");
    expect(repos.owners.load).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole("button", { name: "새로고침" }));
    await screen.findByText("점주 계정 목록 · 2개");
    await user.click(nav("매장 관리"));
    await screen.findByText("매장 목록 · 0곳");
    await user.click(nav("운영 요약"));
    await expectOwnerCount(2);
    expect(repos.owners.load).toHaveBeenCalledTimes(3);
    expect(repos.stores.load).toHaveBeenCalledTimes(2);
    expect(repos.orders.load).toHaveBeenCalledTimes(2);
  });

  it("hides a stale store snapshot on refresh failure instead of showing zero or Mock rows", async () => {
    const repos = repositories();
    repos.stores.load.mockResolvedValueOnce([store()]).mockRejectedValueOnce(new Error("refresh failed"));
    const { user } = await open(repos);
    await screen.findByRole("button", { name: "매장 상세: DB 매장 1" });
    await user.click(screen.getByRole("button", { name: "전체 새로고침" }));
    await waitFor(() => expect(metric("등록 매장")).toHaveTextContent("조회 실패"));
    expect(screen.queryByRole("button", { name: "매장 상세: DB 매장 1" })).not.toBeInTheDocument();
    await expectOwnerCount(0);
  });

  it("retains explicit Mock demo mode for store and owner navigation", async () => {
    const user = userEvent.setup();
    render(<App alertRepository={null} deviceRepository={null} repository={new MockAdminRepository()} storeRepository={null}
      ownerRepository={null} orderRepository={null} />);
    await screen.findByRole("heading", { name: "운영 요약", level: 1 });
    expect(metric("등록 매장")).toHaveTextContent("6곳");
    await expectOwnerCount(4);
    expect(screen.queryByRole("region", { name: "점주 계정" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "점주 미연결 매장 전체 보기" }));
    await screen.findByText("매장 목록 · 2곳");
    await user.click(nav("점주 계정"));
    expect(screen.getByRole("heading", { name: "점주 계정", level: 1 })).toHaveTextContent("점주 계정");
    expect(screen.getByText("점주 계정 목록 · 4개")).toBeInTheDocument();
    expect(screen.queryByText(/명시적 시연 모드/)).not.toBeInTheDocument();
  });
});
