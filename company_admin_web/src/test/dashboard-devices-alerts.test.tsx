import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { MockAdminRepository } from "../data/adminRepository";
import { ApiDeviceRepository } from "../data/deviceRepository";
import { ApiAlertRepository } from "../data/alertRepository";
import type { ApiAlert, ApiDevice } from "../data/models";

const device = (id = 1, active = true): ApiDevice => ({
  device_id: id, device_code: "DB-" + id, store_id: 1, store_name: "실제 매장",
  store_address: "실제 주소", store_address_detail: null, is_active: active,
  registered_at: "2026-01-01T00:00:00+00:00", app_version: null,
  last_seen_at: id % 2 ? null : "2000-01-01T00:00:00+00:00", last_synced_at: null,
});
const alert = (id = 1, status = "UNREAD"): ApiAlert => ({
  alert_id: id, device_id: 1, device_code: "DB-1", store_id: 1, store_name: "실제 매장",
  alert_type: "NEW_TYPE", severity: "NEW_SEVERITY", message: "실제 알림", alert_status: status,
  occurred_at: "2026-01-01T00:00:00+00:00", acknowledged_at: null,
  acknowledged_by: null, acknowledged_by_name: null, resolved_at: null,
});
function sources(devices: ApiDevice[] = [], alerts: ApiAlert[] = []) {
  const deviceHttp = vi.fn<typeof fetch>().mockImplementation(async () =>
    new Response(JSON.stringify({ devices, total: devices.length })));
  const alertHttp = vi.fn<typeof fetch>().mockImplementation(async () =>
    new Response(JSON.stringify({ alerts, total: alerts.length })));
  return {
    deviceHttp, alertHttp,
    devices: new ApiDeviceRepository("http://localhost:8001", deviceHttp),
    alerts: new ApiAlertRepository("http://localhost:8001", alertHttp),
    orders: { load: vi.fn().mockResolvedValue([]), detail: vi.fn() },
    stores: { load: vi.fn().mockResolvedValue([]), detail: vi.fn() },
    owners: { load: vi.fn().mockResolvedValue([]), detail: vi.fn() },
  };
}
async function open(s = sources(), mockDevices = false, mockAlerts = false) {
  const repository = new MockAdminRepository();
  const acknowledge = vi.spyOn(repository, "acknowledgeAlert");
  render(<App repository={repository} deviceRepository={mockDevices ? null : s.devices}
    alertRepository={mockAlerts ? null : s.alerts} orderRepository={s.orders}
    storeRepository={s.stores} ownerRepository={s.owners} />);
  await screen.findByRole("heading", { name: "운영 요약", level: 1 });
  return { user: userEvent.setup(), acknowledge };
}
const region = (name: string) => screen.getByRole("region", { name });
const devices = () => region("기기 현황");
const alerts = () => region("알림 현황");
const nav = (name: string) => within(screen.getByRole("navigation", { name: "주요 화면" }))
  .getByRole("button", { name });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => { resolve = finish; });
  return { promise, resolve };
}

describe("dashboard shared device and alert API data", () => {
  it("shows successful empty counts without source labels", async () => {
    await open();
    await waitFor(() => expect(devices()).toHaveTextContent("등록 기기 0대"));
    expect(devices()).toHaveTextContent("활성 기기 0대 · 비활성 기기 0대");
    expect(alerts()).toHaveTextContent("전체 등록 알림 0건 · 미열람 알림 (UNREAD) 0건");
    expect(devices()).not.toHaveTextContent("기기: 실제 API");
    expect(alerts()).not.toHaveTextContent("알림: 실제 API");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("counts one active device with no last_seen without inferring offline", async () => {
    await open(sources([device()]));
    await waitFor(() => expect(devices()).toHaveTextContent("등록 기기 1대 · 활성 기기 1대 · 비활성 기기 0대"));
    expect(devices()).toHaveTextContent("연결 상태는 미확인");
    expect(devices()).not.toHaveTextContent(/(?:온라인|오프라인)\s*\d+대/);
  });

  it("counts mixed activation values without deriving connectivity from old or null times", async () => {
    await open(sources([device(1), device(2, false), device(3), device(4, false)]));
    await waitFor(() => expect(devices()).toHaveTextContent("등록 기기 4대 · 활성 기기 2대 · 비활성 기기 2대"));
    expect(devices()).not.toHaveTextContent(/(?:온라인|오프라인)\s*\d+대/);
  });

  it("counts only exact UNREAD and does not infer acknowledgement or resolution", async () => {
    await open(sources([], [
      { ...alert(1), acknowledged_at: "2026-01-02T00:00:00Z" },
      { ...alert(2), resolved_at: "2026-01-03T00:00:00Z" },
      alert(3, "NEW_STATE"), alert(4, "unread"), alert(5, "UNREAD "),
      alert(6, "acknowledged"), alert(7, "resolved"),
    ]));
    await waitFor(() => expect(alerts()).toHaveTextContent("전체 등록 알림 7건 · 미열람 알림 (UNREAD) 2건"));
    expect(alerts()).not.toHaveTextContent(/확인 완료\s*\d+건|해소\s*\d+건/);
  });

  it("shows separate pending states, then resolves devices while alerts remain pending", async () => {
    const s = sources();
    const d = deferred<Response>(), a = deferred<Response>();
    s.deviceHttp.mockReturnValue(d.promise); s.alertHttp.mockReturnValue(a.promise);
    await open(s);
    expect(devices()).toHaveTextContent("등록 기기 조회 중");
    expect(alerts()).toHaveTextContent("전체 등록 알림 조회 중");
    expect(screen.getByRole("button", { name: "새로고침 중…" })).toBeDisabled();
    expect(region("등록 매장")).toHaveTextContent("0곳");
    await act(async () => { d.resolve(new Response(JSON.stringify({ devices: [], total: 0 }))); });
    expect(devices()).toHaveTextContent("등록 기기 0대");
    expect(alerts()).toHaveTextContent("조회 중");
    await act(async () => { a.resolve(new Response(JSON.stringify({ alerts: [], total: 0 }))); });
    expect(alerts()).toHaveTextContent("전체 등록 알림 0건");
  });

  it("keeps device success independent while alerts are loading", async () => {
    const s = sources([device()]);
    const a = deferred<Response>(); s.alertHttp.mockReturnValue(a.promise);
    await open(s);
    await waitFor(() => expect(devices()).toHaveTextContent("등록 기기 1대"));
    expect(alerts()).toHaveTextContent("조회 중");
    await act(async () => { a.resolve(new Response(JSON.stringify({ alerts: [], total: 0 }))); });
    expect(alerts()).toHaveTextContent("전체 등록 알림 0건");
  });

  it("isolates device failure and retries only devices without Mock or zero fallback", async () => {
    const s = sources([device()], [alert()]);
    s.deviceHttp.mockRejectedValueOnce(new Error("unavailable"));
    const { user } = await open(s);
    await waitFor(() => expect(devices()).toHaveTextContent("등록 기기 조회 실패"));
    expect(devices()).not.toHaveTextContent(/등록 기기 \d+대/);
    expect(alerts()).toHaveTextContent("전체 등록 알림 1건");
    expect(region("최근 7일 주문")).toHaveTextContent("0건");
    await user.click(screen.getByRole("button", { name: "기기 다시 시도" }));
    await waitFor(() => expect(devices()).toHaveTextContent("등록 기기 1대"));
    expect(s.deviceHttp).toHaveBeenCalledTimes(2);
    expect(s.alertHttp).toHaveBeenCalledTimes(1);
    expect(s.orders.load).toHaveBeenCalledTimes(1);
    expect(s.stores.load).toHaveBeenCalledTimes(1);
    expect(s.owners.load).toHaveBeenCalledTimes(1);
  });

  it("isolates alert failure and retries without inferring zero or Mock counts", async () => {
    const s = sources([device()], [alert()]);
    s.alertHttp.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    const { user } = await open(s);
    await waitFor(() => expect(alerts()).toHaveTextContent("전체 등록 알림 조회 실패"));
    expect(alerts()).not.toHaveTextContent(/전체 등록 알림 \d+건/);
    expect(devices()).toHaveTextContent("등록 기기 1대");
    await user.click(screen.getByRole("button", { name: "알림 다시 시도" }));
    await waitFor(() => expect(alerts()).toHaveTextContent("전체 등록 알림 1건"));
    expect(s.alertHttp).toHaveBeenCalledTimes(2);
    expect(s.deviceHttp).toHaveBeenCalledTimes(1);
  });

  it("keeps device and alert data available during an order failure", async () => {
    const s = sources([device()], [alert()]);
    s.orders.load.mockRejectedValue(new Error("orders unavailable"));
    await open(s);
    await waitFor(() => expect(region("최근 7일 주문")).toHaveTextContent("조회 실패"));
    expect(devices()).toHaveTextContent("등록 기기 1대");
    expect(alerts()).toHaveTextContent("전체 등록 알림 1건");
  });

  it("shares device refreshes both ways and navigation never refetches lists", async () => {
    const s = sources([device()]);
    const { user } = await open(s);
    await waitFor(() => expect(devices()).toHaveTextContent("등록 기기 1대"));
    s.deviceHttp.mockResolvedValueOnce(new Response(JSON.stringify({ devices: [device(), device(2, false)], total: 2 })));
    await user.click(screen.getByRole("button", { name: "전체 새로고침" }));
    await waitFor(() => expect(devices()).toHaveTextContent("등록 기기 2대"));
    await user.click(screen.getByRole("button", { name: "기기 목록 보기" }));
    await screen.findByRole("heading", { name: "기기 목록 · 2대" });
    expect(s.deviceHttp).toHaveBeenCalledTimes(2);
    s.deviceHttp.mockResolvedValueOnce(new Response(JSON.stringify({ devices: [], total: 0 })));
    await user.click(screen.getByRole("button", { name: "새로고침" }));
    await screen.findByRole("heading", { name: "기기 목록 · 0대" });
    await user.click(nav("운영 요약"));
    expect(devices()).toHaveTextContent("등록 기기 0대");
    expect(s.deviceHttp).toHaveBeenCalledTimes(3);
    expect(s.alertHttp).toHaveBeenCalledTimes(2);
    expect(s.orders.load).toHaveBeenCalledTimes(2);
  });

  it("shares alert refreshes both ways and makes only GET list requests", async () => {
    const s = sources([], [alert()]);
    const { user, acknowledge } = await open(s);
    await waitFor(() => expect(alerts()).toHaveTextContent("전체 등록 알림 1건"));
    s.alertHttp.mockResolvedValueOnce(new Response(JSON.stringify({ alerts: [alert(), alert(2, "NEW")], total: 2 })));
    await user.click(screen.getByRole("button", { name: "전체 새로고침" }));
    await waitFor(() => expect(alerts()).toHaveTextContent("전체 등록 알림 2건"));
    expect(alerts()).toHaveTextContent("미열람 알림 (UNREAD) 1건");
    await user.click(screen.getByRole("button", { name: "알림 목록 보기" }));
    await screen.findByRole("heading", { name: "알림 목록 · 2건" });
    expect(s.alertHttp).toHaveBeenCalledTimes(2);
    s.alertHttp.mockResolvedValueOnce(new Response(JSON.stringify({ alerts: [], total: 0 })));
    await user.click(screen.getByRole("button", { name: "새로고침" }));
    await screen.findByText("등록된 장애·알림이 없습니다.");
    await user.click(nav("운영 요약"));
    expect(alerts()).toHaveTextContent("전체 등록 알림 0건");
    expect(s.alertHttp).toHaveBeenCalledTimes(3);
    expect(s.deviceHttp).toHaveBeenCalledTimes(2);
    for (const [url, init] of s.alertHttp.mock.calls) {
      expect(url).toBe("http://localhost:8001/admin/alerts");
      expect(init?.method).toBe("GET");
    }
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it.each(["device", "alert"] as const)("hides stale %s counts after refresh failure", async (source) => {
    const s = sources([device()], [alert()]);
    const { user } = await open(s);
    await waitFor(() => expect(devices()).toHaveTextContent("등록 기기 1대"));
    const http = source === "device" ? s.deviceHttp : s.alertHttp;
    http.mockRejectedValueOnce(new Error("refresh failed"));
    await user.click(screen.getByRole("button", { name: "전체 새로고침" }));
    const failed = source === "device" ? devices : alerts;
    await waitFor(() => expect(failed()).toHaveTextContent("조회 실패"));
    expect(failed()).not.toHaveTextContent(source === "device" ? "등록 기기 1대" : "전체 등록 알림 1건");
    expect(source === "device" ? alerts() : devices()).toHaveTextContent(source === "device" ? "전체 등록 알림 1건" : "등록 기기 1대");
  });

  it("keeps explicit Mock devices independent from real alerts", async () => {
    const s = sources([device()], [alert()]);
    const { user } = await open(s, true, false);
    expect(devices()).not.toHaveTextContent("기기: Mock");
    expect(devices()).toHaveTextContent("등록 기기 6대 · 온라인 3대 · 오프라인 3대");
    expect(alerts()).not.toHaveTextContent("알림: 실제 API");
    expect(alerts()).toHaveTextContent("전체 등록 알림 1건");
    expect(s.deviceHttp).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "기기 목록 보기" }));
    expect(screen.getByLabelText("연결 상태")).toBeInTheDocument();
    await user.click(nav("운영 요약"));
    expect(s.alertHttp).toHaveBeenCalledTimes(1);
  });

  it("keeps Mock acknowledgement counts separate from actual device activation", async () => {
    const s = sources([device(1, false)]);
    const { user, acknowledge } = await open(s, false, true);
    expect(devices()).not.toHaveTextContent("기기: 실제 API");
    expect(devices()).toHaveTextContent("등록 기기 1대 · 활성 기기 0대 · 비활성 기기 1대");
    expect(alerts()).not.toHaveTextContent("알림: Mock");
    const mock = await new MockAdminRepository().load();
    const before = mock.alerts.filter((a) => a.status === "unconfirmed").length;
    expect(alerts()).toHaveTextContent("미확인 알림 " + before + "건");
    expect(s.alertHttp).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "알림 목록 보기" }));
    await user.click(screen.getByRole("button", { name: "알림 상세: AL-1006" }));
    await user.click(screen.getByRole("button", { name: "확인 완료로 표시" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("확인 시각"));
    await user.keyboard("{Escape}");
    await user.click(nav("운영 요약"));
    expect(alerts()).toHaveTextContent("미확인 알림 " + (before - 1) + "건");
    expect(devices()).toHaveTextContent("비활성 기기 1대");
    expect(s.deviceHttp).toHaveBeenCalledTimes(1);
    expect(acknowledge).toHaveBeenCalledTimes(1);
  });
});
