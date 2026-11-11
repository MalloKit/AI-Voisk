import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { ApiOwnerAiRepository, MockOwnerAiRepository } from "../data/aiRepository";
import { OwnerApiError } from "../data/ownerApiRepository";
import { MockOwnerRepository } from "../data/ownerRepository";
import { parseLabels } from "../features/AiPage";
import { StaffCallAlert } from "../components/StaffCallAlert";

async function open(page: string, ai = new MockOwnerAiRepository()) {
  const user = userEvent.setup();
  render(<App repository={new MockOwnerRepository()} aiRepository={ai} />);
  await screen.findByRole("heading", { level: 1, name: "오늘 현황" });
  await user.click(
    within(screen.getByRole("navigation", { name: "주요 화면" })).getByRole("button", { name: new RegExp(page) }),
  );
  return { user, ai };
}

describe("AI 추천·음성", () => {
  it("정책 슬라이더와 스위치를 바꿔 저장하고 되돌리기를 비활성화한다", async () => {
    const { user, ai } = await open("AI 추천·음성");
    await screen.findByRole("heading", { level: 1, name: "AI 추천·음성" });
    const save = await screen.findByRole("button", { name: "설정 저장" });
    expect(save).toBeDisabled();
    const slider = screen.getByLabelText("추천 순서 기준");
    // jsdom은 range 키보드 조작을 구현하지 않아 값 변경 이벤트로 바꿉니다.
    fireEvent.change(slider, { target: { value: "40" } });
    await user.click(screen.getByRole("switch", { name: /^추가 제안/ }));
    await user.selectOptions(screen.getByLabelText("기본 사용자 모드"), "senior");
    expect(save).toBeEnabled();
    await user.click(save);
    expect(await screen.findByText(/^저장했습니다\./)).toBeInTheDocument();
    expect(ai.settings).toMatchObject({ policyProfit: 40, upsellEnabled: false, defaultMode: "senior" });
    expect(screen.getByRole("button", { name: "설정 저장" })).toBeDisabled();
  });

  it("메뉴 원가율·태그·동의어를 고친 메뉴만 저장한다", async () => {
    const ai = new MockOwnerAiRepository();
    const saveSpy = vi.spyOn(ai, "saveMenuAi");
    const { user } = await open("AI 추천·음성", ai);
    const tags = await screen.findByLabelText("콜라 상황 태그");
    await user.type(tags, "시원한, 탄산 ,시원한");
    const cost = screen.getByLabelText("콜라 원가율");
    await user.type(cost, "3a0");
    expect(cost).toHaveValue("30");
    await user.click(screen.getByRole("switch", { name: "콜라 매장 우선" }));
    const button = screen.getByRole("button", { name: /메뉴 추천 정보 저장/ });
    await user.click(button);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    const sent = saveSpy.mock.calls[0][0];
    expect(sent.map((m) => m.menuName)).toEqual(["콜라"]);
    const cola = sent.find((m) => m.menuName === "콜라")!;
    expect(cola).toMatchObject({ costRate: 30, tags: ["시원한", "탄산"], isStorePick: true });
    expect(await screen.findByText(/메뉴 1개를 저장했습니다/)).toBeInTheDocument();
  });

  it("잘못된 태그는 저장을 막고 이유를 보여 준다", async () => {
    const { user } = await open("AI 추천·음성");
    const tags = await screen.findByLabelText("콜라 상황 태그");
    await user.type(tags, "가".repeat(21));
    expect(screen.getByRole("alert")).toHaveTextContent("20자 이하");
    expect(screen.getByRole("button", { name: /메뉴 추천 정보 저장/ })).toBeDisabled();
  });

  it("사진을 올리고 지울 수 있다", async () => {
    const ai = new MockOwnerAiRepository();
    const { user } = await open("AI 추천·음성", ai);
    await screen.findByLabelText("콜라 상황 태그");
    await user.click(screen.getByRole("button", { name: "콜라 사진 올리기" }));
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], "cola.jpg", { type: "image/jpeg" });
    await user.upload(screen.getByLabelText("메뉴 사진 파일"), file);
    expect(await screen.findByAltText("콜라 사진")).toHaveAttribute("src", expect.stringMatching(/^\/media\/menu\/6_/));
    await user.click(screen.getByRole("button", { name: "콜라 사진 지우기" }));
    await waitFor(() => expect(screen.queryByAltText("콜라 사진")).toBeNull());
  });

  it("사진을 바꾸거나 지워도 다른 메뉴의 저장 안 된 입력은 그대로 남는다", async () => {
    const ai = new MockOwnerAiRepository();
    const { user } = await open("AI 추천·음성", ai);
    const colaTags = await screen.findByLabelText("콜라 상황 태그");
    await user.type(colaTags, "시원한");
    await user.clear(screen.getByLabelText("순두부찌개 원가율"));
    await user.type(screen.getByLabelText("순두부찌개 원가율"), "28");
    expect(screen.getByText("저장 안 된 메뉴 2개")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "제육덮밥 사진 올리기" }));
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], "a.jpg", { type: "image/jpeg" });
    await user.upload(screen.getByLabelText("메뉴 사진 파일"), file);
    expect(await screen.findByAltText("제육덮밥 사진")).toBeInTheDocument();
    expect(screen.getByLabelText("콜라 상황 태그")).toHaveValue("시원한");
    expect(screen.getByLabelText("순두부찌개 원가율")).toHaveValue("28");
    // 사진은 이미 저장되었으므로 저장 안 된 메뉴로 세지 않는다.
    expect(screen.getByText("저장 안 된 메뉴 2개")).toBeInTheDocument();

    // 입력 중인 그 메뉴의 사진을 바꿔도 입력은 남는다.
    await user.click(screen.getByRole("button", { name: "콜라 사진 올리기" }));
    await user.upload(screen.getByLabelText("메뉴 사진 파일"), file);
    expect(await screen.findByAltText("콜라 사진")).toBeInTheDocument();
    expect(screen.getByLabelText("콜라 상황 태그")).toHaveValue("시원한");

    await user.click(screen.getByRole("button", { name: "제육덮밥 사진 지우기" }));
    await waitFor(() => expect(screen.queryByAltText("제육덮밥 사진")).toBeNull());
    expect(screen.getByLabelText("콜라 상황 태그")).toHaveValue("시원한");
    expect(screen.getByText("저장 안 된 메뉴 2개")).toBeInTheDocument();

    // 저장하면 서버 값으로 다시 채운다.
    await user.click(screen.getByRole("button", { name: /메뉴 추천 정보 저장/ }));
    expect(await screen.findByText(/메뉴 2개를 저장했습니다/)).toBeInTheDocument();
    expect(screen.queryByText(/저장 안 된 메뉴/)).toBeNull();
    expect(screen.getByLabelText("콜라 상황 태그")).toHaveValue("시원한");
  });

  it("추천 순서 기준 빠른 선택은 슬라이더 값을 바꾸고, 값이 같은 버튼만 선택 상태로 보인다", async () => {
    const { user, ai } = await open("AI 추천·음성");
    const slider = await screen.findByLabelText("추천 순서 기준");
    const group = screen.getByRole("group", { name: "추천 순서 기준 빠른 선택" });
    const pressed = () =>
      within(group)
        .getAllByRole("button")
        .filter((b) => b.getAttribute("aria-pressed") === "true")
        .map((b) => b.textContent);
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "고객 적합 우선",
      "균형",
      "매장 이익 우선",
    ]);
    expect(slider).toHaveValue("30");
    expect(pressed()).toEqual([]);

    await user.click(within(group).getByRole("button", { name: "균형" }));
    expect(slider).toHaveValue("50");
    expect(pressed()).toEqual(["균형"]);
    await user.click(within(group).getByRole("button", { name: "고객 적합 우선" }));
    expect(slider).toHaveValue("0");
    expect(pressed()).toEqual(["고객 적합 우선"]);

    fireEvent.change(slider, { target: { value: "100" } });
    expect(pressed()).toEqual(["매장 이익 우선"]);
    fireEvent.change(slider, { target: { value: "95" } });
    expect(pressed()).toEqual([]);

    await user.click(within(group).getByRole("button", { name: "매장 이익 우선" }));
    await user.click(screen.getByRole("button", { name: "설정 저장" }));
    expect(await screen.findByText(/^저장했습니다\./)).toBeInTheDocument();
    expect(ai.settings.policyProfit).toBe(100);
  });

  it("태그 입력은 공백을 정리하고 중복을 없앤다", () => {
    expect(parseLabels(" 해장 ,  든든한,해장,, ", 20)).toEqual({ labels: ["해장", "든든한"], error: null });
    expect(parseLabels(Array.from({ length: 11 }, (_, i) => `t${i}`).join(","), 20).error).toContain("10개");
  });
});

describe("통계", () => {
  it("음성 주문 비율·추천 선택률·추천 경유 매출을 보여 주고 기간을 바꾼다", async () => {
    const ai = new MockOwnerAiRepository();
    const spy = vi.spyOn(ai, "getStats");
    const { user } = await open("통계", ai);
    await screen.findByRole("heading", { level: 1, name: "통계" });
    expect(await screen.findByText("46.0%")).toBeInTheDocument(); // 29/63
    expect(screen.getByText("추천 63회 중 29회 선택")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "날짜별 주문 수" }).children).toHaveLength(7);
    await user.selectOptions(screen.getByLabelText("기간"), "30");
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith(30, expect.anything()));
  });
});

describe("직원 호출 알림", () => {
  it("모든 화면 위에 띄우고 처리 완료하면 사라진다", async () => {
    const { user, ai } = await open("주문 내역");
    const alert = await screen.findByRole("region", { name: "직원 호출" });
    expect(alert).toHaveTextContent("K-001");
    await user.click(within(alert).getByRole("button", { name: "처리 완료" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "직원 호출" })).toBeNull());
    expect(ai.calls.recent[0].status).toBe("RESOLVED");
  });

  const poll = () => act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  }

  it("처리 완료에 실패하면 호출을 남기고 이유를 보여 준다", async () => {
    const ai = new MockOwnerAiRepository();
    vi.spyOn(ai, "resolveStaffCall").mockRejectedValueOnce(new OwnerApiError(503, "DB 연결을 확인해 주세요."));
    const user = userEvent.setup();
    render(<StaffCallAlert repository={ai} pollMs={60_000} />);
    const alert = await screen.findByRole("region", { name: "직원 호출" });
    await user.click(within(alert).getByRole("button", { name: "처리 완료" }));
    expect(await within(alert).findByRole("alert")).toHaveTextContent("DB 연결을 확인해 주세요.");
    expect(alert).toHaveTextContent("K-001");
    expect(within(alert).getByRole("button", { name: "처리 완료" })).toBeEnabled();

    // 다시 누르면 문구를 지우고 처리한다.
    await user.click(within(alert).getByRole("button", { name: "처리 완료" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "직원 호출" })).toBeNull());
  });

  it("처리 전에 출발한 조회가 늦게 와도 방금 처리한 호출을 다시 띄우지 않는다", async () => {
    const ai = new MockOwnerAiRepository();
    const user = userEvent.setup();
    render(<StaffCallAlert repository={ai} pollMs={60_000} />);
    const alert = await screen.findByRole("region", { name: "직원 호출" });
    expect(document.hidden).toBe(false);

    // 처리 완료를 누르기 전에 출발해 처리 전 목록을 들고 있는 조회
    const stale = deferred<Awaited<ReturnType<typeof ai.getStaffCalls>>>();
    const before = structuredClone(ai.calls);
    const spy = vi.spyOn(ai, "getStaffCalls").mockReturnValueOnce(stale.promise);
    await poll();
    await user.click(within(alert).getByRole("button", { name: "처리 완료" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "직원 호출" })).toBeNull());
    await act(async () => stale.resolve(before));
    expect(screen.queryByRole("region", { name: "직원 호출" })).toBeNull();

    // 처리 뒤에 시작한 조회가 성공하면 숨김을 풀어, 같은 호출이 다시 열리면 보인다.
    await poll();
    expect(spy).toHaveBeenCalledTimes(2);
    ai.calls.open = before.open;
    await poll();
    expect(await screen.findByRole("region", { name: "직원 호출" })).toHaveTextContent("K-001");
  });
});

describe("ApiOwnerAiRepository", () => {
  const BASE = "http://127.0.0.1:8001";
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("설정 저장은 CSRF 토큰과 서버 이름(snake_case)으로 보낸다", async () => {
    const transport = vi.fn<typeof fetch>(async (input) =>
      String(input).endsWith("/auth/owner/csrf")
        ? json({ csrf_token: "csrf-1" })
        : json({ ai_ready: true, settings: { policy_profit: 70, pick_weight: 10, fit_threshold: 60, upsell_enabled: false,
            default_mode: "senior", speech_rate: 80, voice_enabled: true } }),
    );
    const repository = new ApiOwnerAiRepository(BASE, 5, transport);
    const saved = await repository.saveAiSettings({ policyProfit: 70, pickWeight: 10, fitThreshold: 60, upsellEnabled: false,
      defaultMode: "senior", speechRate: 80, voiceEnabled: true });
    expect(saved.defaultMode).toBe("senior");
    const [url, init] = transport.mock.calls[1];
    expect(url).toBe(`${BASE}/owner/stores/5/ai-settings`);
    expect(init?.method).toBe("PATCH");
    expect((init?.headers as Record<string, string>)["X-CSRF-Token"]).toBe("csrf-1");
    expect(JSON.parse(String(init?.body))).toEqual({ policy_profit: 70, pick_weight: 10, fit_threshold: 60,
      upsell_enabled: false, default_mode: "senior", speech_rate: 80, voice_enabled: true });
  });

  it("사진은 바이트 그대로 PUT하고 사진 주소를 서버 기준으로 바꾼다", async () => {
    const transport = vi.fn<typeof fetch>(async (input) =>
      String(input).endsWith("/auth/owner/csrf") ? json({ csrf_token: "c" }) : json({ menu_id: 6, image_url: "/media/menu/6_abc.jpg" }),
    );
    const repository = new ApiOwnerAiRepository(`${BASE}/`, 5, transport);
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
    expect(await repository.uploadMenuImage(6, blob)).toBe("/media/menu/6_abc.jpg");
    const [, init] = transport.mock.calls[1];
    expect(init?.method).toBe("PUT");
    expect(init?.body).toBe(blob);
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("image/jpeg");
    expect(repository.imageSrc("/media/menu/6_abc.jpg")).toBe(`${BASE}/media/menu/6_abc.jpg`);
  });
});
