import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockOwnerAuthRepository } from "../data/ownerAuthRepository";

// 출처는 AppEntry를 불러올 때 정해지므로 환경값을 바꾼 뒤 모듈을 다시 불러온다.
// 실제 서버에 접속하지 않도록 fetch를 막고 어디로 요청했는지만 본다.
const SERVER = "http://127.0.0.1:8001";

function stubSources(auth?: string, data?: string) {
  vi.stubEnv("VITE_OWNER_AUTH_SOURCE", auth);
  vi.stubEnv("VITE_OWNER_DATA_SOURCE", data);
  vi.stubEnv("VITE_OWNER_API_BASE_URL", undefined);
}
async function loadAppEntry() {
  vi.resetModules();
  return (await import("../AppEntry")).AppEntry;
}
const requestedUrls = (transport: ReturnType<typeof vi.fn>) =>
  transport.mock.calls.map(([url]) => String(url));

describe("인증·데이터 출처", () => {
  let transport: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    transport = vi.fn(async () => new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", transport);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("설정이 없으면 인증은 기본 주소의 서버 API를 쓰고 Mock 계정을 보이지 않는다", async () => {
    stubSources();
    const AppEntry = await loadAppEntry();
    render(<AppEntry />);
    await screen.findByRole("heading", { name: "점주 로그인" });
    expect(requestedUrls(transport)).toContain(`${SERVER}/auth/owner/me`);
    expect(
      screen.queryByRole("region", { name: "개발용 Mock 계정" }),
    ).toBeNull();
  });

  it("설정이 없으면 데이터도 기본 주소의 서버 API로 읽는다", async () => {
    stubSources();
    const AppEntry = await loadAppEntry();
    const auth = new MockOwnerAuthRepository();
    await auth.login({
      loginId: "mock.single",
      password: "mock-only-password",
    });
    render(<AppEntry authRepository={auth} />);
    await waitFor(() =>
      expect(
        requestedUrls(transport).some((url) =>
          url.startsWith(`${SERVER}/owner/`),
        ),
      ).toBe(true),
    );
  });

  it("서버에 연결하지 못해도 Mock으로 자동 전환하지 않는다", async () => {
    stubSources();
    transport.mockRejectedValue(new TypeError("Failed to fetch"));
    const AppEntry = await loadAppEntry();
    render(<AppEntry />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "인증 서버에 연결하지 못했습니다",
    );
    expect(
      screen.queryByRole("region", { name: "개발용 Mock 계정" }),
    ).toBeNull();
  });

  it("mock을 명시하면 서버에 요청하지 않고 Mock으로 동작한다", async () => {
    stubSources("mock", "mock");
    const AppEntry = await loadAppEntry();
    const user = userEvent.setup();
    render(<AppEntry />);
    await screen.findByRole("region", { name: "개발용 Mock 계정" });
    await user.type(screen.getByLabelText("로그인 ID"), "mock.single");
    await user.type(screen.getByLabelText("비밀번호"), "mock-only-password");
    await user.click(screen.getByRole("button", { name: "로그인" }));
    await screen.findByRole("heading", { level: 1, name: "오늘 현황" });
    expect(await screen.findByText("오늘 주문")).toBeInTheDocument();
    expect(transport).not.toHaveBeenCalled();
  });
});
