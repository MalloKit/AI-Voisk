import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { MockAdminRepository } from "../data/adminRepository";
import type { ApiDevice } from "../data/models";
import { ApiDeviceRepository, menuVersionStatus, parseDevice, type DeviceRepository } from "../data/deviceRepository";

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
  expect(screen.queryByText(/기기: 실제 API · 알림: Mock/)).not.toBeInTheDocument();
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
  it("메뉴 버전은 정수로 읽고, 없는 필드는 미확인(null)으로 두며 잘못된 값은 거부한다", () => {
    expect(parseDevice({ ...raw(), current_menu_version: 12, applied_menu_version: 11 })).toMatchObject({
      current_menu_version: 12, applied_menu_version: 11,
    });
    expect(parseDevice(raw())).toMatchObject({ current_menu_version: null, applied_menu_version: null });
    expect(parseDevice({ ...raw(), current_menu_version: null, applied_menu_version: 0 })).toMatchObject({
      current_menu_version: null, applied_menu_version: 0,
    });
    for (const patch of [
      { current_menu_version: "12" }, { applied_menu_version: 1.5 }, { applied_menu_version: -1 },
    ]) expect(() => parseDevice({ ...raw(), ...patch })).toThrow();
  });
  it("메뉴 버전 상태는 둘 다 알 때만 최신·반영 대기로 판정한다(점주 웹과 같은 규칙)", () => {
    const status = (applied: number | null, current: number | null) =>
      menuVersionStatus({ applied_menu_version: applied, current_menu_version: current });
    expect(status(12, 12)).toBe("최신");
    expect(status(13, 12)).toBe("최신");
    expect(status(11, 12)).toBe("반영 대기 (적용 11 / 최신 12)");
    expect(status(0, 1)).toBe("반영 대기 (적용 0 / 최신 1)");
    expect(status(null, 12)).toBe("미확인");
    expect(status(12, null)).toBe("미확인");
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
    expect(screen.queryByText("실제 기기 API")).not.toBeInTheDocument();
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
  it("목록과 상세에 메뉴 버전 상태를 보여 준다", async () => {
    const pending = parseDevice({ ...raw(), current_menu_version: 12, applied_menu_version: 11,
      app_version: "1.2.0+5", last_synced_at: "2026-10-29T01:20:00+00:00" });
    const latest = parseDevice({ ...raw(102), current_menu_version: 12, applied_menu_version: 12 });
    const repository: DeviceRepository = {
      load: vi.fn().mockResolvedValue([pending, latest, device(103)]),
      detail: vi.fn().mockResolvedValue(pending),
    };
    const user = await open(repository);
    await screen.findByText("기기 목록 · 3대");
    const cells = (code: string) => within(screen.getByRole("cell", { name: code }).closest("tr")!)
      .getAllByRole("cell").map((c) => c.textContent);
    expect(cells("DB-101")).toContain("반영 대기 (적용 11 / 최신 12)");
    expect(cells("DB-102")).toContain("최신");
    expect(cells("DB-103")).toContain("미확인");
    await user.click(screen.getByRole("button", { name: "기기 상세: DB-101" }));
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByText("DB 매장 1 (ID: 1)");
    expect(within(dialog).getByText("메뉴 버전 상태").closest("div")).toHaveTextContent("반영 대기 (적용 11 / 최신 12)");
    expect(dialog).toHaveTextContent("1.2.0+5");
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


it("scopes the pinned action layout to the live device table after pagination and filtering", async () => {
  const rows = Array.from({ length: 6 }, (_, i) => device(101 + i));
  const repository: DeviceRepository = { load: vi.fn().mockResolvedValue(rows), detail: vi.fn().mockResolvedValue(rows[5]) };
  const user = await open(repository);
  const table = screen.getByRole("table", { name: "기기 목록" });
  expect(table.closest(".table-card")).toHaveClass("devices-table");
  expect(within(table).getAllByRole("columnheader")).toHaveLength(8);
  expect(within(table).getByRole("columnheader", { name: "등록일" })).toBeInTheDocument();
  expect(within(table).getByRole("columnheader", { name: "메뉴 버전" })).toBeInTheDocument();
  for (const name of ["앱 버전", "마지막 확인", "마지막 동기화"]) expect(within(table).queryByRole("columnheader", { name })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "다음 페이지" }));
  await user.click(screen.getByRole("button", { name: "기기 상세: DB-106" }));
  expect(await within(screen.getByRole("dialog")).findByText("DB-106")).toBeInTheDocument();
  const dialog = screen.getByRole("dialog");
  for (const name of ["앱 버전", "마지막 확인 시각 (DB 기록)", "마지막 동기화 시각 (DB 기록)"]) expect(within(dialog).getByText(name)).toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(screen.getByRole("button", { name: "기기 상세: DB-106" })).toHaveFocus();
  await user.type(screen.getByRole("textbox"), "DB-101");
  expect(screen.getByRole("table").closest(".table-card")).toHaveClass("devices-table");
  expect(screen.getByRole("button", { name: "기기 상세: DB-101" })).toBeInTheDocument();
  await user.click(nav("점주 계정"));
  expect(screen.getByRole("table").closest(".table-card")).not.toHaveClass("devices-table");
});
