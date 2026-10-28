import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { MockAdminRepository } from "../data/adminRepository";
import { parseStore } from "../data/storeRepository";
import { parseOrder } from "../data/orderRepository";
import type { ApiAlert, ApiDevice, ApiOwner } from "../data/models";

const store = parseStore({ store_id: 99, store_name: "갱신 매장", address: "부산", address_detail: null,
  store_code: "00123", phone: "051-123-4567", business_no: "0000000001", representative: "대표",
  store_type: "카페", admin_id: 1, admin_name: "관리자", owner_id: null, owner_login_id: null });
const owner: ApiOwner = { id: 99, loginId: "refresh-owner", storeCount: 0 };
const order = parseOrder({ order_id: 99, store_id: 99, store_name: "갱신 매장", ordered_at: new Date().toISOString(),
  order_type: "takeaway", table_no: null, quantity: 1 });
const device: ApiDevice = { device_id: 99, device_code: "REFRESH-99", store_id: 99, store_name: "갱신 매장",
  store_address: "부산", store_address_detail: null, is_active: false, registered_at: "2026-01-01T00:00:00Z",
  app_version: null, last_seen_at: null, last_synced_at: null };
const alert: ApiAlert = { alert_id: 99, device_id: 99, device_code: "REFRESH-99", store_id: 99, store_name: "갱신 매장",
  alert_type: "NEW_TYPE", severity: "NOTICE", message: "갱신 알림", alert_status: "UNREAD",
  occurred_at: "2026-01-01T00:00:00Z", acknowledged_at: null, acknowledged_by: null,
  acknowledged_by_name: null, resolved_at: null };
const records = [[store], [owner], [order], [device], [alert]] as const;
function sources() {
  return {
    stores: { load: vi.fn().mockResolvedValue([]), detail: vi.fn() },
    owners: { load: vi.fn().mockResolvedValue([]), detail: vi.fn() },
    orders: { load: vi.fn().mockResolvedValue([]), detail: vi.fn() },
    devices: { load: vi.fn().mockResolvedValue([]), detail: vi.fn() },
    alerts: { load: vi.fn().mockResolvedValue([]), detail: vi.fn() },
  };
}
const loaders = (s: ReturnType<typeof sources>) => [s.stores.load, s.owners.load, s.orders.load, s.devices.load, s.alerts.load];
const metric = (name: string) => screen.getByRole("region", { name });
const nav = (name: string) => within(screen.getByRole("navigation", { name: "주요 화면" })).getByRole("button", { name });
const refresh = () => screen.getByRole("button", { name: "전체 새로고침" });
function deferred() {
  let resolve!: (value: unknown) => void, reject!: (reason: Error) => void;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
async function open(s = sources(), mockDevices = false, mockAlerts = false) {
  render(<App repository={new MockAdminRepository()} storeRepository={s.stores} ownerRepository={s.owners}
    orderRepository={s.orders} deviceRepository={mockDevices ? null : s.devices} alertRepository={mockAlerts ? null : s.alerts} />);
  await waitFor(() => expect(refresh()).toBeEnabled());
  return userEvent.setup();
}

describe("dashboard whole refresh", () => {
  it("has one normal refresh action with icon, and refreshes all five lists and metrics", async () => {
    const s = sources(), user = await open(s);
    expect(screen.getAllByRole("button", { name: /새로고침/ })).toHaveLength(1);
    expect(refresh().querySelector("svg")).not.toBeNull();
    expect(refresh().closest(".dashboard-heading")).toHaveTextContent("운영 요약");
    loaders(s).forEach((load, index) => load.mockResolvedValueOnce(records[index]));
    await user.click(refresh());
    await waitFor(() => expect(metric("최근 7일 주문")).toHaveTextContent("1건"));
    expect(metric("등록 매장")).toHaveTextContent("1곳");
    await expect(s.owners.load.mock.results.at(-1)!.value).resolves.toEqual([owner]);
    expect(metric("점주 미연결 매장")).toHaveTextContent("1곳");
    expect(metric("기기 현황")).toHaveTextContent("등록 기기1대활성 기기0대비활성 기기1대");
    expect(metric("미열람 알림")).toHaveTextContent("미열람 알림1건");
    expect(screen.getByRole("button", { name: "주문 상세: #99" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "매장 상세: 갱신 매장" })).toBeInTheDocument();
    loaders(s).forEach((load) => expect(load).toHaveBeenCalledTimes(2));
    for (const name of ["기기 목록 보기", "알림 목록 보기", "주문 전체 보기", "미연결 매장 보기", "등록 매장 전체 보기"])
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "최근 주문 내역 전체 보기" })).toHaveTextContent("전체 보기");
    expect(screen.getByRole("link", { name: "점주 미연결 매장 전체 보기" })).toHaveTextContent("전체 보기");
  });

  it("starts all requests independently, blocks duplicate clicks until the slowest request settles, and retries a failure alone", async () => {
    const s = sources(), user = await open(s), pending = Array.from({ length: 5 }, deferred);
    loaders(s).forEach((load, index) => load.mockReturnValueOnce(pending[index].promise));
    const button = refresh();
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    await waitFor(() => loaders(s).forEach((load) => expect(load).toHaveBeenCalledTimes(2)));
    expect(button).toBeDisabled(); expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveTextContent("새로고침 중");
    await act(async () => { pending.slice(0, 4).forEach((p, i) => p.resolve(records[i])); });
    expect(metric("등록 매장")).toHaveTextContent("1곳");
    expect(metric("기기 현황")).toHaveTextContent("등록 기기1대");
    expect(metric("미열람 알림")).toHaveTextContent("조회 중");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    loaders(s).forEach((load) => expect(load).toHaveBeenCalledTimes(2));
    await act(async () => { pending[4].reject(new Error("unavailable")); });
    expect(button).toBeEnabled();
    expect(metric("미열람 알림")).toHaveTextContent("조회 실패");
    expect(metric("최근 7일 주문")).toHaveTextContent("1건");
    s.alerts.load.mockResolvedValueOnce([alert]);
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(metric("미열람 알림")).toHaveTextContent("미열람 알림1건"));
    loaders(s).slice(0, 4).forEach((load) => expect(load).toHaveBeenCalledTimes(2));
    expect(s.alerts.load).toHaveBeenCalledTimes(3);
    await user.click(refresh());
    await waitFor(() => expect(refresh()).toBeEnabled());
    loaders(s).slice(0, 4).forEach((load) => expect(load).toHaveBeenCalledTimes(3));
    expect(s.alerts.load).toHaveBeenCalledTimes(4);
  });

  it.each([0, 1, 2, 3, 4])("isolates source %i failure and recovers without refreshing healthy sources", async (index) => {
    const s = sources(), user = await open(s);
    loaders(s).forEach((load, i) => i === index ? load.mockRejectedValueOnce(new Error("failed")) : load.mockResolvedValueOnce(records[i]));
    await user.click(refresh());
    await waitFor(() => expect(refresh()).toBeEnabled());
    const regions = ["등록 매장", "점주 계정", "최근 7일 주문", "기기 현황", "미열람 알림"];
    regions.forEach((name, i) => i !== 1 && expect(metric(name)).toHaveTextContent(i === index ? "조회 실패" : ["1곳", "1개", "1건", "등록 기기1대", "미열람 알림1건"][i]));
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    loaders(s)[index].mockResolvedValueOnce(records[index]);
    await user.click(screen.getByRole("button", { name: ["매장 다시 시도", "점주 다시 시도", "다시 시도", "다시 시도", "다시 시도"][index] }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    loaders(s).forEach((load, i) => expect(load).toHaveBeenCalledTimes(i === index ? 3 : 2));
    if (index !== 1) expect(metric(regions[index])).not.toHaveTextContent("조회 실패");
    else await expect(s.owners.load.mock.results.at(-1)!.value).resolves.toEqual([owner]);
  });

  it.each([0, 1, 2, 3, 4])("shares refreshes with management page %i and allows navigation while pending", async (index) => {
    const s = sources(), user = await open(s), pending = Array.from({ length: 5 }, deferred);
    loaders(s).forEach((load, i) => load.mockReturnValueOnce(pending[i].promise));
    await user.click(refresh());
    const names = ["매장 관리", "점주 계정", "주문 조회", "기기 관리", "장애/알림"];
    await user.click(nav(names[index]));
    await screen.findByRole("heading", { name: names[index], level: 1 });
    loaders(s).forEach((load) => expect(load).toHaveBeenCalledTimes(2));
    await act(async () => { pending.forEach((p, i) => p.resolve(records[i])); });
    expect(screen.getByRole("table")).toHaveTextContent(index === 1 ? "refresh-owner" : index === 4 ? "갱신 알림" : "갱신 매장");
    await user.click(screen.getByRole("button", { name: "새로고침" }));
    await waitFor(() => expect(loaders(s)[index]).toHaveBeenCalledTimes(3));
    await user.click(nav("운영 요약"));
    await waitFor(() => expect(refresh()).toBeEnabled());
    loaders(s).forEach((load, i) => expect(load).toHaveBeenCalledTimes(i === index ? 3 : 2));
    const namesToCheck = ["등록 매장", "점주 계정", "최근 7일 주문", "기기 현황", "미열람 알림"];
    if (index !== 1) expect(metric(namesToCheck[index])).toHaveTextContent(["0곳", "0개", "0건", "등록 기기0대", "미열람 알림0건"][index]);
    else {
      await user.click(nav("점주 계정"));
      await screen.findByText("점주 계정 목록 · 0개");
    }
  });

  it.each([[true, false], [false, true]])("preserves independent Mock device=%s / Mock alert=%s sources", async (mockDevices, mockAlerts) => {
    const s = sources(), user = await open(s, mockDevices, mockAlerts);
    await user.click(refresh());
    await waitFor(() => expect(refresh()).toBeEnabled());
    expect(s.devices.load).toHaveBeenCalledTimes(mockDevices ? 0 : 2);
    expect(s.alerts.load).toHaveBeenCalledTimes(mockAlerts ? 0 : 2);
    expect(metric("기기 현황")).toHaveTextContent(mockDevices ? "등록 기기6대" : "등록 기기0대");
    expect(metric("미열람 알림")).toHaveTextContent(mockAlerts ? "미열람 알림미제공" : "미열람 알림0건");
  });

  it("allows repeated refresh in explicit all-Mock mode without API requests or metric changes", async () => {
    const user = userEvent.setup();
    render(<App repository={new MockAdminRepository()} storeRepository={null} ownerRepository={null}
      orderRepository={null} deviceRepository={null} alertRepository={null} />);
    await waitFor(() => expect(refresh()).toBeEnabled());
    for (let i = 0; i < 2; i++) {
      await user.click(refresh());
      await waitFor(() => expect(refresh()).toBeEnabled());
      expect(metric("등록 매장")).toHaveTextContent("6곳");
      expect(metric("미열람 알림")).toHaveTextContent("미제공");
      expect(metric("기기 현황")).toHaveTextContent("등록 기기6대");
    }
  });
});


describe("operational dashboard presentation", () => {
  it("shows the four requested metrics in order, compact device facts and only two view-all links", async () => {
    await open();
    const metrics = document.querySelector(".metrics")!;
    expect(Array.from(metrics.querySelectorAll("section")).map((node) => node.getAttribute("aria-label")))
      .toEqual(["등록 매장", "점주 미연결 매장", "최근 7일 주문", "미열람 알림"]);
    expect(screen.queryByRole("region", { name: "점주 계정" })).not.toBeInTheDocument();
    expect(metric("미열람 알림").querySelector("svg")).not.toBeNull();
    expect(Array.from(metric("기기 현황").querySelectorAll("dt")).map((node) => node.textContent))
      .toEqual(["등록 기기", "활성 기기", "비활성 기기"]);
    expect(metric("기기 현황")).toHaveTextContent("활성·비활성은 기기의 온라인 연결 상태를 의미하지 않습니다.");
    expect(screen.queryByRole("heading", { name: "기기 및 알림 현황" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "알림 현황" })).not.toBeInTheDocument();
    expect(screen.queryByText(/UNREAD 이외 상태|전체 등록 알림/)).not.toBeInTheDocument();
    expect(document.querySelectorAll(".dashboard-list-link")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /새로고침/ })).toHaveLength(1);
  });

  it("supports keyboard links, real details, unlinked filter and default sidebar filtering without extra loads", async () => {
    const s = sources();
    s.stores.load.mockResolvedValue([store, { ...store, id: 100, name: "연결 매장", ownerId: 99, ownerLoginId: "refresh-owner" }]);
    s.orders.load.mockResolvedValue([order]);
    s.stores.detail.mockResolvedValue(store);
    s.orders.detail.mockResolvedValue({ ...order, items: [] });
    const user = await open(s), before = window.location.href;
    await user.click(screen.getByRole("button", { name: "주문 상세: #99" }));
    await waitFor(() => expect(s.orders.detail).toHaveBeenCalledWith(99, expect.any(AbortSignal)));
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "매장 상세: 갱신 매장" }));
    await waitFor(() => expect(s.stores.detail).toHaveBeenCalledWith(99, expect.any(AbortSignal)));
    await user.keyboard("{Escape}");
    const orderLink = screen.getByRole("link", { name: "최근 주문 내역 전체 보기" });
    orderLink.focus(); await user.keyboard("{Enter}");
    await screen.findByRole("heading", { name: "주문 조회", level: 1 });
    await user.click(nav("운영 요약"));
    screen.getByRole("link", { name: "점주 미연결 매장 전체 보기" }).focus();
    await user.keyboard("{Enter}");
    await screen.findByText("매장 목록 · 1곳");
    expect(screen.getByLabelText("점주 연결")).toHaveValue("미연결");
    expect(screen.getByRole("table")).not.toHaveTextContent("연결 매장");
    await user.click(nav("매장 관리"));
    await screen.findByText("매장 목록 · 2곳");
    expect(screen.getByLabelText("점주 연결")).toHaveValue("전체");
    expect(window.location.href).toBe(before);
    loaders(s).forEach((load) => expect(load).toHaveBeenCalledTimes(1));
  });

  it.each([0, 3, 7])("keeps recent-seven-day count separate from the latest maximum five older orders: %i rows", async (count) => {
    const s = sources(), old = new Date(Date.now() - 30 * 86400000).toISOString();
    s.orders.load.mockResolvedValue(Array.from({ length: count }, (_, index) => ({ ...order, order_id: index + 1, ordered_at: old })));
    await open(s);
    expect(metric("최근 7일 주문")).toHaveTextContent("0건");
    expect(screen.getByRole("heading", { name: "최근 주문 내역" })).toBeInTheDocument();
    const details = screen.queryAllByRole("button", { name: /주문 상세:/ });
    expect(details).toHaveLength(Math.min(5, count));
    expect(details.map((node) => node.getAttribute("aria-label")))
      .toEqual(Array.from({ length: Math.min(5, count) }, (_, index) => `주문 상세: #${count - index}`));
  });

  it("recovers a failed alert source through whole refresh without interpreting unknown states as unread", async () => {
    const s = sources();
    s.alerts.load.mockRejectedValueOnce(new Error("unavailable")).mockResolvedValueOnce([alert, { ...alert, alert_id: 100, alert_status: "FUTURE_STATE" }]);
    const user = await open(s);
    expect(metric("미열람 알림")).toHaveTextContent("조회 실패");
    expect(metric("미열람 알림")).not.toHaveTextContent("0건");
    expect(screen.getByRole("alert")).toHaveTextContent("실제 알림 조회 실패");
    await user.click(refresh());
    await waitFor(() => expect(refresh()).toBeEnabled());
    expect(metric("미열람 알림")).toHaveTextContent("1건");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    loaders(s).forEach((load) => expect(load).toHaveBeenCalledTimes(2));
  });
});
