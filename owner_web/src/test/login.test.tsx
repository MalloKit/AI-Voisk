import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppEntry } from "../AppEntry";
import { MockOwnerAuthRepository } from "../data/ownerAuthRepository";
import {
  LOGIN_FAILED,
  OWNER_SESSION_EXPIRED,
  OwnerAuthError,
} from "../data/ownerAuth";
import { MOCK_OWNER_ACCOUNTS } from "../data/mock/mockOwnerAccounts";

const PASSWORD = "mock-only-password";
type User = ReturnType<typeof userEvent.setup>;

async function start(auth = new MockOwnerAuthRepository()) {
  const user = userEvent.setup();
  const view = render(<AppEntry authRepository={auth} />);
  await screen.findByRole("heading", { name: "점주 로그인" });
  return { user, auth, view };
}
async function signIn(user: User, loginId: string, password = PASSWORD) {
  await user.type(screen.getByLabelText("로그인 ID"), loginId);
  await user.type(screen.getByLabelText("비밀번호"), password);
  await user.click(screen.getByRole("button", { name: "로그인" }));
}
const sidebar = () =>
  screen.getByRole("complementary", { name: "점주 관리자 메뉴" });
const brand = () => sidebar().querySelector(".brand span")!;

describe("로그인 전", () => {
  it("로그인 화면만 보이고 개발용 Mock 계정을 분명히 표시한다", async () => {
    await start();
    expect(screen.queryByRole("navigation", { name: "주요 화면" })).toBeNull();
    const dev = screen.getByRole("region", { name: "개발용 Mock 계정" });
    expect(dev).toHaveTextContent("Mock 모드에서만 동작합니다");
    expect(dev).toHaveTextContent("mock.single");
    expect(dev).toHaveTextContent("mock.multi");
  });

  it("형식이 틀리면 요청하지 않고 첫 오류 칸으로 보낸다", async () => {
    const { user, auth } = await start();
    const spy = vi.spyOn(auth, "login");
    await user.click(screen.getByRole("button", { name: "로그인" }));
    expect(screen.getByText(/로그인 ID는 소문자 영문/)).toBeInTheDocument();
    expect(
      screen.getByText("비밀번호는 8~128자로 입력해 주세요."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("로그인 ID")).toHaveFocus();

    await user.type(screen.getByLabelText("로그인 ID"), "Mock.Single");
    await user.type(screen.getByLabelText("비밀번호"), PASSWORD);
    await user.click(screen.getByRole("button", { name: "로그인" }));
    expect(screen.getByLabelText("로그인 ID")).toHaveAttribute(
      "aria-invalid",
      "true",
    );

    await user.clear(screen.getByLabelText("로그인 ID"));
    await user.type(screen.getByLabelText("로그인 ID"), "mock.single");
    await user.clear(screen.getByLabelText("비밀번호"));
    await user.type(screen.getByLabelText("비밀번호"), "short");
    await user.click(screen.getByRole("button", { name: "로그인" }));
    expect(screen.getByLabelText("비밀번호")).toHaveFocus();
    expect(spy).not.toHaveBeenCalled();
  });

  it("비밀번호 표시·숨기기", async () => {
    const { user } = await start();
    const password = screen.getByLabelText("비밀번호");
    expect(password).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "비밀번호 표시" }));
    expect(password).toHaveAttribute("type", "text");
  });

  it("없는 ID와 틀린 비밀번호에 같은 문구를 보이고 비밀번호 칸을 비운다", async () => {
    const { user } = await start();
    await signIn(user, "nobody.here");
    expect(await screen.findByRole("alert")).toHaveTextContent(LOGIN_FAILED);
    expect(screen.getByLabelText("비밀번호")).toHaveValue("");
    await user.clear(screen.getByLabelText("로그인 ID"));
    await signIn(user, "mock.single", "wrong-password");
    expect(await screen.findByRole("alert")).toHaveTextContent(LOGIN_FAILED);
  });

  it("처음 세션 확인이 서버 오류로 실패하면 다시 확인할 수 있다", async () => {
    const auth = new MockOwnerAuthRepository();
    vi.spyOn(auth, "me").mockRejectedValueOnce(
      new OwnerAuthError(503, "인증 서버에 연결하지 못했습니다."),
    );
    const { user } = await start(auth);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "인증 서버에 연결하지 못했습니다.",
    );
    await user.click(
      screen.getByRole("button", { name: "로그인 상태 다시 확인" }),
    );
    expect(
      await screen.findByRole("heading", { name: "점주 로그인" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("로그인 후 매장 진입", () => {
  it("매장이 1개면 바로 들어가고 사이드바에 로그인 ID와 로그아웃이 있다", async () => {
    const { user } = await start();
    await signIn(user, "mock.single");
    expect(
      await screen.findByRole("heading", { level: 1, name: "오늘 현황" }),
    ).toBeInTheDocument();
    expect(brand()).toHaveTextContent("점주 · 보이스크 테스트 매장");
    const account = within(sidebar()).getByRole("group", {
      name: "로그인 정보",
    });
    expect(account).toHaveTextContent("mock.single");
    expect(
      within(account).getByRole("button", { name: "로그아웃" }),
    ).toBeInTheDocument();
    expect(
      within(account).queryByRole("button", { name: "매장 바꾸기" }),
    ).toBeNull();
  });

  it("매장이 여러 개면 고르고, 매장 바꾸기로 다른 매장을 연다", async () => {
    const { user } = await start();
    await signIn(user, "mock.multi");
    expect(
      await screen.findByRole("heading", { name: "매장 선택" }),
    ).toBeInTheDocument();
    const choices = screen.getByRole("list", { name: "연결된 매장" });
    expect(
      within(choices)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual([
      "보이스크 Mock 카페매장 번호 2",
      "보이스크 Mock 분식매장 번호 3",
    ]);
    await user.click(
      within(choices).getByRole("button", { name: /Mock 분식/ }),
    );
    await screen.findByRole("heading", { level: 1, name: "오늘 현황" });
    expect(brand()).toHaveTextContent("보이스크 Mock 분식");

    await user.click(
      within(sidebar()).getByRole("button", { name: "매장 바꾸기" }),
    );
    await user.click(screen.getByRole("button", { name: /Mock 카페/ }));
    await screen.findByRole("heading", { level: 1, name: "오늘 현황" });
    expect(brand()).toHaveTextContent("보이스크 Mock 카페");
    expect(await screen.findByText("오늘 주문")).toBeInTheDocument();
    expect(document.querySelector(".metrics")).toHaveTextContent(
      "오늘 주문2건",
    );
  });

  it("연결된 매장이 없으면 안내하고 로그아웃할 수 있다", async () => {
    const auth = new MockOwnerAuthRepository([
      {
        ownerId: 9,
        loginId: "mock.none",
        password: PASSWORD,
        stores: [],
        note: "매장 없음",
      },
    ]);
    const { user } = await start(auth);
    await signIn(user, "mock.none");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "연결된 매장이 없습니다. 회사 관리자에게 문의해 주세요.",
    );
    expect(screen.queryByRole("navigation", { name: "주요 화면" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "로그아웃" }));
    expect(
      await screen.findByRole("heading", { name: "점주 로그인" }),
    ).toBeInTheDocument();
  });

  it("새로고침하면 저장소가 아니라 me로 로그인을 다시 확인한다", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const { user, auth, view } = await start();
    await signIn(user, "mock.single");
    await screen.findByRole("heading", { level: 1, name: "오늘 현황" });
    expect(setItem).not.toHaveBeenCalled();
    expect([localStorage.length, sessionStorage.length]).toEqual([0, 0]);
    view.unmount();
    // 같은 세션(서버 쿠키 역할)으로 다시 열면 로그인 화면 없이 들어간다.
    const me = vi.spyOn(auth, "me");
    render(<AppEntry authRepository={auth} />);
    expect(
      await screen.findByRole("heading", { level: 1, name: "오늘 현황" }),
    ).toBeInTheDocument();
    expect(me).toHaveBeenCalled();
  });
});

describe("로그아웃과 만료", () => {
  it("로그아웃하면 로그인 화면으로 가고 세션이 끝난다", async () => {
    const { user, auth } = await start();
    await signIn(user, "mock.single");
    await screen.findByRole("heading", { level: 1, name: "오늘 현황" });
    await user.click(
      within(sidebar()).getByRole("button", { name: "로그아웃" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "로그아웃되었습니다.",
    );
    expect(
      screen.getByRole("heading", { name: "점주 로그인" }),
    ).toBeInTheDocument();
    await expect(auth.me()).rejects.toMatchObject({ status: 401 });
  });

  it("로그아웃 완료를 확인하지 못하면 화면을 숨긴 채 다시 시도한다", async () => {
    const { user, auth } = await start();
    await signIn(user, "mock.single");
    await screen.findByRole("heading", { level: 1, name: "오늘 현황" });
    vi.spyOn(auth, "logout").mockRejectedValueOnce(
      new OwnerAuthError(503, "오류"),
    );
    await user.click(
      within(sidebar()).getByRole("button", { name: "로그아웃" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "로그아웃 완료를 확인하지 못했습니다",
    );
    expect(screen.queryByRole("navigation", { name: "주요 화면" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(
      await screen.findByRole("heading", { name: "점주 로그인" }),
    ).toBeInTheDocument();
  });

  it("창으로 돌아왔을 때 세션이 만료(401)됐으면 다시 로그인하라고 안내한다", async () => {
    const { user, auth } = await start();
    await signIn(user, "mock.single");
    await screen.findByRole("heading", { level: 1, name: "오늘 현황" });
    auth.expireSession();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "다시 로그인해 주세요",
    );
    expect(
      screen.getByRole("heading", { name: "점주 로그인" }),
    ).toBeInTheDocument();
  });

  it("데이터 API의 401 이벤트를 받으면 로그인 화면으로 보낸다", async () => {
    const { user } = await start();
    await signIn(user, "mock.single");
    await screen.findByRole("heading", { level: 1, name: "오늘 현황" });
    await act(async () => {
      window.dispatchEvent(new Event(OWNER_SESSION_EXPIRED));
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "로그인이 만료되었습니다. 다시 로그인해 주세요.",
    );
  });
});

describe("저장 안 한 변경 경고", () => {
  async function editMenu(user: User) {
    await user.click(
      within(screen.getByRole("navigation", { name: "주요 화면" })).getByRole(
        "button",
        { name: /메뉴 관리/ },
      ),
    );
    const preview = screen.getByRole("region", { name: "키오스크 미리보기" });
    await user.click(
      within(preview)
        .getAllByRole("button")
        .find((b) => b.classList.contains("kiosk-card"))!,
    );
    const name = screen.getByLabelText("메뉴 이름");
    await user.clear(name);
    await user.type(name, "바뀐 이름");
  }

  it("로그아웃 전에 확인하고, 계속 편집하거나 버리고 로그아웃한다", async () => {
    const { user, auth } = await start();
    await signIn(user, "mock.single");
    await screen.findByRole("heading", { level: 1, name: "오늘 현황" });
    await editMenu(user);
    await user.click(
      within(sidebar()).getByRole("button", { name: "로그아웃" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "저장하지 않은 변경이 있습니다",
    });
    expect(
      within(dialog)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["계속 편집", "버리고 로그아웃", "저장하고 로그아웃"]);
    await user.click(within(dialog).getByRole("button", { name: "계속 편집" }));
    expect(screen.getByLabelText("메뉴 이름")).toHaveValue("바뀐 이름");
    await expect(auth.me()).resolves.toBeTruthy();

    await user.click(
      within(sidebar()).getByRole("button", { name: "로그아웃" }),
    );
    await user.click(screen.getByRole("button", { name: "버리고 로그아웃" }));
    expect(
      await screen.findByRole("heading", { name: "점주 로그인" }),
    ).toBeInTheDocument();
  });

  it("매장을 바꾸기 전에 확인하고, 저장하고 바꾸면 저장된 채로 남는다", async () => {
    const { user } = await start();
    await signIn(user, "mock.multi");
    await user.click(await screen.findByRole("button", { name: /Mock 카페/ }));
    await screen.findByRole("heading", { level: 1, name: "오늘 현황" });
    await editMenu(user);
    await user.click(
      within(sidebar()).getByRole("button", { name: "매장 바꾸기" }),
    );
    await user.click(
      screen.getByRole("button", { name: "저장하고 매장 바꾸기" }),
    );
    expect(
      await screen.findByRole("heading", { name: "매장 선택" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Mock 카페/ }));
    await screen.findByRole("heading", { level: 1, name: "오늘 현황" });
    await user.click(
      within(screen.getByRole("navigation", { name: "주요 화면" })).getByRole(
        "button",
        { name: /메뉴 관리/ },
      ),
    );
    expect(
      within(
        screen.getByRole("region", { name: "키오스크 미리보기" }),
      ).getByRole("button", {
        name: /^바뀐 이름/,
      }),
    ).toBeInTheDocument();
  });

  it("변경이 없으면 바로 로그아웃한다", async () => {
    const { user } = await start();
    await signIn(user, "mock.single");
    await screen.findByRole("heading", { level: 1, name: "오늘 현황" });
    await user.click(
      within(sidebar()).getByRole("button", { name: "로그아웃" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      await screen.findByRole("heading", { name: "점주 로그인" }),
    ).toBeInTheDocument();
  });
});

it("개발용 Mock 계정 2개는 매장 1개·2개 연결이다", () => {
  expect(MOCK_OWNER_ACCOUNTS.map((a) => [a.loginId, a.stores.length])).toEqual([
    ["mock.single", 1],
    ["mock.multi", 2],
  ]);
});
