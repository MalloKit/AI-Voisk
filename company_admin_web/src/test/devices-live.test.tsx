import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { MockAdminRepository } from "../data/adminRepository";
import type { ApiDevice } from "../data/models";
import { ApiDeviceRepository, parseDevice, type DeviceRepository } from "../data/deviceRepository";

const raw = (id = 101, storeId = 1, active = true) => ({
  device_id: id, device_code: "DB-" + id, store_id: storeId,
  store_name: "DB 매장 " + storeId, store_address: "실제 주소",
  store_address_detail: null, is_active: active,
  registered_at: "2026-10-27T00:00:00+00:00",
  app_version: null, last_seen_at: null, last_synced_at: null,
});
const device = (id = 101, storeId = 1, active = true): ApiDevice => parseDevice(raw(id, storeId, active));
const nav = (name: string) => within(screen.getByRole("navigation", { name: "주요 화면" }))
  .getByRole("button", { name });
async function open(repository: DeviceRepository, admin = new MockAdminRepository()) {
  const user = userEvent.setup();
  render(<App alertRepository={null} repository={admin} orderRepository={null} storeRepository={null}
    ownerRepository={null} deviceRepository={repository} />);
  await screen.findByRole("heading", { name: "운영 요약", level: 1 });
  expect(screen.getByText(/기기·알림: Mock/)).toBeInTheDocument();
  await user.click(nav("기기 관리"));
  return user;
}

describe("실제 기기 Repository 계약", () => {
  it("정수 ID·NULL·명시적 오프셋을 보존하고 모호한 시각과 활성화 값을 거부한다", () => {
    const result = parseDevice(raw());
    expect(result.device_id).toBe(101);
    expect(result.app_version).toBeNull();
    expect(result.last_seen_at).toBeNull();
    expect(result.registered_at).toBe(raw().registered_at);
    for (const patch of [
      { device_id: "101" }, { is_active: 1 }, { app_version: undefined },
      { last_seen_at: "2026-10-27T09:00:00" }, { registered_at: null },
    ]) expect(() => parseDevice({ ...raw(), ...patch })).toThrow();
  });
  it("기기 전용 GET만 호출하고 상세 ID 불일치를 거부한다", async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ devices: [raw()], total: 1 })))
      .mockResolvedValueOnce(new Response(JSON.stringify(raw())))
      .mockResolvedValueOnce(new Response(JSON.stringify(raw(102))));
    const repository = new ApiDeviceRepository("http://localhost:8001/base/", transport);
    await repository.load();
    await repository.detail(101);
    await expect(repository.detail(101)).rejects.toThrow();
    expect(transport.mock.calls.map(([url]) => url)).toEqual([
      "http://localhost:8001/base/admin/devices",
      "http://localhost:8001/base/admin/devices/101",
      "http://localhost:8001/base/admin/devices/101",
    ]);
    for (const [, init] of transport.mock.calls) expect(init?.method).toBe("GET");
  });
});

describe("실제 기기 관리", () => {
  it("같은 매장의 복수 기기와 여러 매장을 표시하고 검색·필터·초기화를 결합한다", async () => {
    const repository: DeviceRepository = {
      load: vi.fn().mockResolvedValue([device(), device(102, 1, false), device(103, 2)]),
      detail: vi.fn().mockResolvedValue(device()),
    };
    const user = await open(repository);
    await screen.findByText("기기 목록 · 3대");
    expect(screen.getByText("실제 기기 API")).toBeInTheDocument();
    expect(screen.queryByLabelText("연결 상태")).not.toBeInTheDocument();
    const search = screen.getByRole("textbox");
    await user.type(search, "103");
    expect(screen.getByText("기기 목록 · 1대")).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveTextContent("DB 매장 2");
    await user.clear(search);
    await user.type(search, "db-102");
    expect(screen.getByRole("table")).toHaveTextContent("비활성");
    await user.clear(search);
    await user.selectOptions(screen.getByLabelText("설치 매장"), "1");
    expect(screen.getByText("기기 목록 · 2대")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("활성화 상태"), "비활성");
    expect(screen.getByText("기기 목록 · 1대")).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveTextContent("DB-102");
    await user.selectOptions(screen.getByLabelText("활성화 상태"), "활성");
    expect(screen.getByRole("table")).toHaveTextContent("DB-101");
    await user.click(screen.getByRole("button", { name: "초기화" }));
    expect(screen.getByText("기기 목록 · 3대")).toBeInTheDocument();
  });
  it("정상적인 기기 0개와 조회 실패를 구분한다", async () => {
    await open({ load: async () => [], detail: vi.fn() });
    await screen.findByText("기기 목록 · 0대");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(/조건에 맞는 결과/)).toBeInTheDocument();
  });
  it("로딩·실패·재시도와 새로고침을 처리하며 Mock 기기로 대체하지 않는다", async () => {
    let fail!: (error: Error) => void;
    const repository: DeviceRepository = {
      load: vi.fn().mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }))
        .mockResolvedValueOnce([device()]).mockResolvedValueOnce([]),
      detail: vi.fn(),
    };
    const user = await open(repository);
    expect(screen.getByRole("status")).toHaveTextContent("실제 기기");
    fail(new Error("offline"));
    await screen.findByRole("alert");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("기기 목록 · 0대")).not.toBeInTheDocument();
    expect(screen.queryByText("VK-SEO-001")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    await screen.findByText("기기 목록 · 1대");
    await user.click(screen.getByRole("button", { name: "새로고침" }));
    await screen.findByText("기기 목록 · 0대");
    expect(repository.load).toHaveBeenCalledTimes(3);
  });
  it("같은 ID의 Mock 매장·기기·알림을 상세에 연결하지 않고 NULL을 미수집으로 표시한다", async () => {
    const admin = new MockAdminRepository();
    const snapshot = await admin.load();
    snapshot.devices.push({ ...snapshot.devices[0], id: "101" });
    snapshot.alerts.push({ ...snapshot.alerts[0], id: "MOCK-ONLY", deviceId: "101", description: "가짜 장애 내용" });
    vi.spyOn(admin, "load").mockResolvedValue(snapshot);
    const repository: DeviceRepository = {
      load: async () => [device()],
      detail: vi.fn().mockResolvedValue(device()),
    };
    const user = await open(repository, admin);
    await user.click(await screen.findByRole("button", { name: "기기 상세: DB-101" }));
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByText("DB 매장 1 (ID: 1)");
    expect(dialog).toHaveTextContent("실제 주소");
    expect(dialog).toHaveTextContent("활성");
    expect(dialog).toHaveTextContent("미확인");
    expect(within(dialog).getAllByText("미수집")).toHaveLength(3);
    expect(dialog).toHaveTextContent("알림 조회 미연동");
    expect(dialog).not.toHaveTextContent("가짜 장애 내용");
    expect(dialog).not.toHaveTextContent("MOCK-ONLY");
    expect(dialog).not.toHaveTextContent(snapshot.stores[0].name);
    expect(repository.detail).toHaveBeenCalledWith(101, expect.any(AbortSignal));
  });
  it("상세 404를 Mock으로 대체하지 않고 재시도한다", async () => {
    const repository: DeviceRepository = {
      load: async () => [device()],
      detail: vi.fn().mockRejectedValueOnce(new Error("404")).mockResolvedValueOnce(device()),
    };
    const user = await open(repository);
    await user.click(await screen.findByRole("button", { name: "기기 상세: DB-101" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("dialog")).not.toHaveTextContent("실제 주소");
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    await within(screen.getByRole("dialog")).findByText("실제 주소");
  });
  it("페이지 이동만으로 기기 목록을 중복 호출하지 않는다", async () => {
    const repository: DeviceRepository = {
      load: vi.fn().mockResolvedValue([device()]), detail: vi.fn(),
    };
    const user = await open(repository);
    await screen.findByText("기기 목록 · 1대");
    await user.click(nav("매장 관리"));
    await screen.findByRole("heading", { name: "매장 관리", level: 1 });
    await user.click(nav("기기 관리"));
    await screen.findByText("기기 목록 · 1대");
    expect(repository.load).toHaveBeenCalledTimes(1);
  });
});
