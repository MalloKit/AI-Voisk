import { act, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { MockAdminRepository } from "../data/adminRepository";
import { parseAlert, apiAlertStatusLabel, type AlertRepository } from "../data/alertRepository";
import type { ApiAlert } from "../data/models";

const raw = (id = 101) => ({
  alert_id: id, device_id: id === 103 ? 2 : 1, device_code: id === 103 ? "DB-2" : "DB-1",
  store_id: id === 103 ? 2 : 1, store_name: id === 103 ? "DB 매장 2" : "DB 매장 1",
  alert_type: id === 103 ? "전체" : "NEW_TYPE",
  severity: id === 103 ? "*" : "FUTURE_LEVEL",
  message: "DB 알림 내용 " + id, alert_status: id === 103 ? "WAITING_REVIEW" : "UNREAD",
  occurred_at: id === 101 ? "2026-10-27T01:00:00+00:00" : "2026-10-27T02:00:00+00:00",
  acknowledged_at: null, acknowledged_by: null, acknowledged_by_name: null, resolved_at: null,
});
const alert = (id = 101): ApiAlert => parseAlert(raw(id));
const nav = (name: string) => within(screen.getByRole("navigation", { name: "주요 화면" }))
  .getByRole("button", { name });
async function open(repository: AlertRepository, admin = new MockAdminRepository()) {
  const user = userEvent.setup();
  render(<App repository={admin} orderRepository={null} storeRepository={null}
    ownerRepository={null} deviceRepository={null} alertRepository={repository} />);
  await screen.findByRole("heading", { name: "운영 요약", level: 1 });
  expect(screen.getByText(/기기: Mock · 알림: 실제 API/)).toBeInTheDocument();
  await user.click(nav("장애/알림"));
  return user;
}

describe("실제 알림 조회", () => {
  it("0건을 정상 빈 목록으로 표시한다", async () => {
    await open({ load: async () => [], detail: vi.fn() });
    await screen.findByText("알림 목록 · 0건");
    expect(screen.getByText("등록된 장애·알림이 없습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("여러 기기·매장·같은 기기의 알림을 최신 시각과 ID 내림차순으로 표시한다", async () => {
    await open({ load: async () => [alert(101),alert(102),alert(103)], detail: vi.fn() });
    await screen.findByText("알림 목록 · 3건");
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[0].textContent)).toEqual(["103","102","101"]);
    expect(screen.getByRole("table")).toHaveTextContent("DB-1");
    expect(screen.getByRole("table")).toHaveTextContent("DB-2");
    expect(screen.getByRole("table")).toHaveTextContent("WAITING_REVIEW");
    expect(screen.getByText("실제 알림 API")).toBeInTheDocument();
  });

  it("검색과 원본 유형·심각도·상태 필터를 결합하고 초기화한다", async () => {
    const user = await open({ load: async () => [alert(101),alert(102),alert(103)], detail: vi.fn() });
    await screen.findByText("알림 목록 · 3건");
    const search = screen.getByRole("textbox");
    for (const query of ["103","2","db-2","DB 매장 2"]) {
      await user.clear(search);
      await user.type(search,query);
      expect(screen.getByRole("table")).toHaveTextContent("DB-2");
    }
    await user.clear(search);
    await user.selectOptions(screen.getByLabelText("알림 유형"),JSON.stringify("전체"));
    await user.selectOptions(screen.getByLabelText("심각도"),JSON.stringify("*"));
    await user.selectOptions(screen.getByLabelText("DB 원본 상태"),JSON.stringify("WAITING_REVIEW"));
    expect(screen.getByText("알림 목록 · 1건")).toBeInTheDocument();
    await user.type(search,"없는 값");
    expect(screen.getByText(/조건에 맞는 결과/)).toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"초기화"}));
    expect(screen.getByText("알림 목록 · 3건")).toBeInTheDocument();
  });

  it("목록 로딩·조회 실패를 0건과 구분하고 재시도·새로고침한다", async () => {
    let fail!: (reason: Error) => void;
    const repository: AlertRepository = {
      load: vi.fn().mockImplementationOnce(() => new Promise((_resolve,reject) => { fail=reject; }))
        .mockResolvedValueOnce([alert()]).mockResolvedValueOnce([]),
      detail: vi.fn(),
    };
    const user = await open(repository);
    expect(screen.getByRole("status")).toHaveTextContent("실제 알림");
    await act(async () => { fail(new Error("offline")); });
    await screen.findByRole("alert");
    expect(screen.queryByText("등록된 장애·알림이 없습니다.")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"다시 시도"}));
    await screen.findByText("알림 목록 · 1건");
    await user.click(screen.getByRole("button",{name:"새로고침"}));
    await screen.findByText("알림 목록 · 0건");
    expect(repository.load).toHaveBeenCalledTimes(3);
  });

  it("상세 로딩·실패·재시도를 처리하고 목록 값으로 상세를 대체하지 않는다", async () => {
    let fail!: (reason: Error) => void;
    const repository: AlertRepository = {
      load: async () => [alert()],
      detail: vi.fn().mockImplementationOnce(() => new Promise((_resolve,reject) => { fail=reject; }))
        .mockResolvedValueOnce(alert()),
    };
    const user = await open(repository);
    await user.click(await screen.findByRole("button",{name:"알림 상세: #101"}));
    expect(screen.getByRole("status")).toHaveTextContent("실제 알림 상세");
    await act(async () => { fail(new Error("404")); });
    await screen.findByRole("alert");
    expect(screen.getByRole("dialog")).not.toHaveTextContent("DB 알림 내용");
    await user.click(screen.getByRole("button",{name:"다시 시도"}));
    await within(screen.getByRole("dialog")).findByText("DB 알림 내용 101");
    expect(repository.detail).toHaveBeenCalledWith(101,expect.any(AbortSignal));
  });

  it("관리자 확인과 해소 기록을 독립적으로 표시하고 NULL을 보존한다", async () => {
    const acknowledged = { ...alert(101), acknowledged_at:"2026-10-27T01:01:00+00:00",
      acknowledged_by:7, acknowledged_by_name:"DB 확인자" };
    const resolved = { ...alert(103), resolved_at:"2026-10-27T03:00:00+00:00" };
    const repository: AlertRepository = {
      load: async () => [acknowledged,resolved],
      detail: vi.fn().mockImplementation(async (id: number) => id === 101 ? acknowledged : resolved),
    };
    const user = await open(repository);
    await user.click(await screen.findByRole("button",{name:"알림 상세: #101"}));
    let dialog = screen.getByRole("dialog");
    await within(dialog).findByText("DB 확인자 (ID: 7)");
    expect(within(dialog).getByText("장애 해소 시각").nextElementSibling).toHaveTextContent("기록 없음");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button",{name:"알림 상세: #103"}));
    dialog = screen.getByRole("dialog");
    await within(dialog).findByText("WAITING_REVIEW");
    expect(within(dialog).getByText("관리자 확인 시각").nextElementSibling).toHaveTextContent("기록 없음");
    expect(within(dialog).getByText("장애 해소 시각").nextElementSibling).not.toHaveTextContent("기록 없음");
    expect(apiAlertStatusLabel("WAITING_REVIEW")).toBe("WAITING_REVIEW");
    expect(apiAlertStatusLabel("UNREAD")).toBe("읽지 않음 (UNREAD)");
  });

  it("같은 ID의 Mock 데이터와 혼합하지 않고 본문을 텍스트로만 렌더링하며 확인 버튼이 없다", async () => {
    const admin = new MockAdminRepository();
    const snapshot = await admin.load();
    snapshot.devices.push({ ...snapshot.devices[0],id:"1" });
    snapshot.alerts.push({ ...snapshot.alerts[0],id:"101",deviceId:"1",description:"가짜 알림" });
    vi.spyOn(admin,"load").mockResolvedValue(snapshot);
    const acknowledge = vi.spyOn(admin,"acknowledgeAlert");
    const message = '<img src=x onerror="alert(1)"><script>bad()</script>';
    const real = { ...alert(),message };
    const user = await open({ load: async () => [real],detail: async () => real },admin);
    await screen.findByText(message);
    expect(screen.getByRole("table").querySelector("img,script")).toBeNull();
    await user.click(screen.getByRole("button",{name:"알림 상세: #101"}));
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByText(message);
    expect(dialog.querySelector("img,script")).toBeNull();
    expect(dialog).toHaveTextContent("DB 매장 1");
    expect(dialog).not.toHaveTextContent(snapshot.stores[0].name);
    expect(dialog).not.toHaveTextContent("가짜 알림");
    expect(screen.queryByRole("button",{name:"확인 완료로 표시"})).not.toBeInTheDocument();
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it("알림 실패가 다른 공유 조회를 실패시키지 않고 페이지 이동 시 목록을 중복 호출하지 않는다", async () => {
    const repository: AlertRepository = {
      load: vi.fn().mockRejectedValue(new Error("alerts unavailable")),detail:vi.fn(),
    };
    const user = userEvent.setup();
    render(<App repository={new MockAdminRepository()} orderRepository={{load:async()=>[],detail:vi.fn()}}
      storeRepository={{load:async()=>[],detail:vi.fn()}} ownerRepository={{load:async()=>[],detail:vi.fn()}}
      deviceRepository={{load:async()=>[],detail:vi.fn()}} alertRepository={repository} />);
    await screen.findByRole("heading",{name:"운영 요약",level:1});
    await waitFor(() => expect(screen.getByRole("region",{name:"등록 매장"})).toHaveTextContent("0곳"));
    expect(screen.getByRole("region",{name:"점주 계정"})).toHaveTextContent("0개");
    expect(screen.getByRole("region",{name:"최근 7일 주문"})).toHaveTextContent("0건");
    await user.click(nav("장애/알림"));
    await screen.findByRole("alert");
    await user.click(nav("기기 관리"));
    await screen.findByText("기기 목록 · 0대");
    await user.click(nav("장애/알림"));
    await screen.findByRole("alert");
    expect(repository.load).toHaveBeenCalledTimes(1);
  });
});
