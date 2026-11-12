import { describe, expect, it, vi } from "vitest";
import {
  LOGIN_FAILED,
  OwnerAuthError,
  PASSWORD_CHANGE_MESSAGES,
  isUnauthorized,
  validOwnerLoginId,
  validOwnerPassword,
} from "../data/ownerAuth";
import {
  ApiOwnerAuthRepository,
  MockOwnerAuthRepository,
} from "../data/ownerAuthRepository";
import { MOCK_OWNER_ACCOUNTS } from "../data/mock/mockOwnerAccounts";
import { MOCK_STORE_IDS, MockOwnerRepository } from "../data/ownerRepository";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const ownerBody = {
  owner: {
    owner_id: 7,
    login_id: "kim.owner",
    role: "owner",
    stores: [
      { store_id: 1, store_name: "본점" },
      { store_id: 4, store_name: "2호점" },
    ],
  },
};
const csrf = () => json({ csrf_token: "token-123" });

describe("점주 계정 정책 (OWNER_WRITES.md와 같음)", () => {
  it("로그인 ID는 소문자 영문·숫자·. _ - 4~100자", () => {
    for (const ok of ["abcd", "kim.owner_01-a", "a".repeat(100)])
      expect(validOwnerLoginId(ok)).toBe(true);
    for (const bad of [
      "abc",
      "a".repeat(101),
      "Kim.owner",
      " abcd",
      "abcd ",
      "김점주1234",
      "ab@cd",
    ])
      expect(validOwnerLoginId(bad)).toBe(false);
  });

  it("비밀번호는 코드 포인트 8~128자, 공백만·제어 문자는 거부", () => {
    expect(validOwnerPassword("12345678")).toBe(true);
    expect(validOwnerPassword("1234567")).toBe(false);
    expect(validOwnerPassword("a".repeat(128))).toBe(true);
    expect(validOwnerPassword("a".repeat(129))).toBe(false);
    expect(validOwnerPassword("😀".repeat(8))).toBe(true); // 이모지는 한 글자
    expect(validOwnerPassword("        ")).toBe(false);
    expect(validOwnerPassword("abcd\u0007efgh")).toBe(false);
    expect(validOwnerPassword(" pass word ")).toBe(true); // 앞뒤 공백은 그대로 둔다
  });
});

describe("서버 점주 인증 API 계약", () => {
  it("csrf를 받은 뒤 그 토큰으로 login을 보내고 점주와 매장 목록을 읽는다", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(csrf())
      .mockResolvedValueOnce(json(ownerBody));
    const repo = new ApiOwnerAuthRepository(
      "http://127.0.0.1:8001/api/",
      transport,
    );
    const owner = await repo.login({
      loginId: "kim.owner",
      password: "password1",
    });
    expect(owner).toEqual({
      ownerId: 7,
      loginId: "kim.owner",
      stores: [
        { storeId: 1, storeName: "본점" },
        { storeId: 4, storeName: "2호점" },
      ],
      // 이전 서버 응답처럼 password_change_required가 없으면 false로 본다.
      passwordChangeRequired: false,
    });
    const [[csrfUrl, csrfInit], [loginUrl, loginInit]] = transport.mock.calls;
    expect([csrfUrl, csrfInit?.method]).toEqual([
      "http://127.0.0.1:8001/api/auth/owner/csrf",
      "GET",
    ]);
    expect(loginUrl).toBe("http://127.0.0.1:8001/api/auth/owner/login");
    expect(loginInit).toMatchObject({
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": "token-123",
      },
    });
    expect(JSON.parse(String(loginInit?.body))).toEqual({
      login_id: "kim.owner",
      password: "password1",
    });
  });

  it("me는 role이 owner일 때만 받아들인다", async () => {
    const ok = new ApiOwnerAuthRepository("http://localhost:8001", async () =>
      json(ownerBody),
    );
    expect((await ok.me()).ownerId).toBe(7);
    const admin = new ApiOwnerAuthRepository(
      "http://localhost:8001",
      async () =>
        json({ owner: { ...ownerBody.owner, role: "company_admin" } }),
    );
    await expect(admin.me()).rejects.toThrow("점주 인증 응답");
    const badStore = new ApiOwnerAuthRepository(
      "http://localhost:8001",
      async () =>
        json({
          owner: {
            ...ownerBody.owner,
            stores: [{ store_id: "1", store_name: "x" }],
          },
        }),
    );
    await expect(badStore.me()).rejects.toThrow("매장 목록");
  });

  it("오류 상태를 안전한 문구로 바꾸고 401은 ID·비밀번호를 구분하지 않는다", async () => {
    const fail = (status: number) =>
      new ApiOwnerAuthRepository(
        "http://localhost:8001",
        vi
          .fn<typeof fetch>()
          .mockResolvedValueOnce(csrf())
          .mockResolvedValueOnce(new Response("{}", { status })),
      );
    const input = { loginId: "kim.owner", password: "password1" };
    await expect(fail(401).login(input)).rejects.toMatchObject({
      status: 401,
      message: LOGIN_FAILED,
    });
    await expect(fail(429).login(input)).rejects.toThrow(
      "로그인 시도가 많습니다",
    );
    await expect(fail(403).login(input)).rejects.toThrow("보안 설정");
    await expect(fail(503).login(input)).rejects.toThrow(
      "인증 서버에 연결하지 못했습니다",
    );
  });

  it("logout은 현재 세션의 csrf를 다시 받아 POST한다", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(csrf())
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await new ApiOwnerAuthRepository(
      "http://localhost:8001",
      transport,
    ).logout();
    expect(
      transport.mock.calls.map(([url, init]) => [url, init?.method]),
    ).toEqual([
      ["http://localhost:8001/auth/owner/csrf", "GET"],
      ["http://localhost:8001/auth/owner/logout", "POST"],
    ]);
    expect(transport.mock.calls[1][1]?.headers).toEqual({
      "X-CSRF-Token": "token-123",
    });
  });
});

describe("개발용 Mock 인증", () => {
  it("없는 ID와 틀린 비밀번호를 같은 401 문구로 거절한다", async () => {
    const auth = new MockOwnerAuthRepository();
    const unknown = auth.login({
      loginId: "nobody.here",
      password: "mock-only-password",
    });
    const wrong = auth.login({
      loginId: "mock.single",
      password: "wrong-password",
    });
    for (const attempt of [unknown, wrong])
      await expect(attempt).rejects.toMatchObject({
        status: 401,
        message: LOGIN_FAILED,
      });
    await expect(
      auth.login({ loginId: "BAD", password: "x" }),
    ).rejects.toBeInstanceOf(OwnerAuthError);
  });

  it("로그인 → me → 로그아웃 → me 401", async () => {
    const auth = new MockOwnerAuthRepository();
    await expect(auth.me()).rejects.toMatchObject({ status: 401 });
    await auth.login({ loginId: "mock.multi", password: "mock-only-password" });
    expect((await auth.me()).stores.map((s) => s.storeId)).toEqual([2, 3]);
    await auth.logout();
    await expect(auth.me()).rejects.toMatchObject({ status: 401 });
  });

  it("Mock 계정의 매장은 모두 Mock 데이터가 있고, 각 매장의 점주와 일치한다", async () => {
    expect(MOCK_OWNER_ACCOUNTS.map((a) => a.stores.length)).toEqual([1, 2, 0]);
    for (const account of MOCK_OWNER_ACCOUNTS)
      for (const s of account.stores) {
        expect(MOCK_STORE_IDS).toContain(s.storeId);
        const { store } = await new MockOwnerRepository(
          s.storeId,
        ).getStoreProfile();
        expect([store.name, store.ownerId]).toEqual([
          s.storeName,
          account.ownerId,
        ]);
      }
    expect(() => new MockOwnerRepository(99)).toThrow();
  });
});

describe("비밀번호 변경 API 계약", () => {
  const input = { currentPassword: "old-password", newPassword: "new-password" };

  it("csrf를 받아 current_password·new_password만 보내고 새 점주 정보를 읽는다", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(csrf())
      .mockResolvedValueOnce(
        json({ owner: { ...ownerBody.owner, password_change_required: false } }),
      );
    const owner = await new ApiOwnerAuthRepository(
      "http://localhost:8001",
      transport,
    ).changePassword(input);
    expect(owner.passwordChangeRequired).toBe(false);
    const [, [url, init]] = transport.mock.calls;
    expect(url).toBe("http://localhost:8001/auth/owner/password");
    expect(init).toMatchObject({
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": "token-123",
      },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      current_password: "old-password",
      new_password: "new-password",
    });
  });

  it("me·login 응답의 password_change_required를 읽고 boolean이 아니면 거부한다", async () => {
    const required = new ApiOwnerAuthRepository("http://localhost:8001", async () =>
      json({ owner: { ...ownerBody.owner, password_change_required: true } }),
    );
    expect((await required.me()).passwordChangeRequired).toBe(true);
    const bad = new ApiOwnerAuthRepository("http://localhost:8001", async () =>
      json({ owner: { ...ownerBody.owner, password_change_required: "yes" } }),
    );
    await expect(bad.me()).rejects.toThrow("점주 인증 응답");
  });

  it("401은 me로 세션을 확인해 현재 비밀번호 틀림과 로그인 만료를 구분한다", async () => {
    const wrong = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(csrf())
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(json(ownerBody));
    const error = await new ApiOwnerAuthRepository(
      "http://localhost:8001",
      wrong,
    )
      .changePassword(input)
      .catch((e) => e);
    expect(error).toMatchObject({
      status: 401,
      reason: "current_password",
      message: "현재 비밀번호가 올바르지 않습니다.",
    });
    expect(isUnauthorized(error)).toBe(false);
    expect(wrong.mock.calls[2][0]).toBe("http://localhost:8001/auth/owner/me");

    const expired = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(csrf())
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response("{}", { status: 401 }));
    const gone = await new ApiOwnerAuthRepository(
      "http://localhost:8001",
      expired,
    )
      .changePassword(input)
      .catch((e) => e);
    expect(isUnauthorized(gone)).toBe(true);
  });

  it("403·422·429를 서로 다른 문구로 바꾼다", async () => {
    const fail = (status: number) =>
      new ApiOwnerAuthRepository(
        "http://localhost:8001",
        vi
          .fn<typeof fetch>()
          .mockResolvedValueOnce(csrf())
          .mockResolvedValueOnce(new Response("{}", { status })),
      ).changePassword(input);
    await expect(fail(403)).rejects.toMatchObject({
      status: 403,
      message: PASSWORD_CHANGE_MESSAGES[403],
    });
    await expect(fail(422)).rejects.toMatchObject({
      status: 422,
      message: PASSWORD_CHANGE_MESSAGES[422],
    });
    await expect(fail(429)).rejects.toMatchObject({
      status: 429,
      message: PASSWORD_CHANGE_MESSAGES[429],
    });
    expect(
      new Set(Object.values(PASSWORD_CHANGE_MESSAGES)).size,
    ).toBe(4);
  });
});

describe("Mock 비밀번호 변경", () => {
  it("임시 비밀번호 계정은 변경 전까지 passwordChangeRequired이고, 바꾼 비밀번호로 다시 로그인된다", async () => {
    const auth = new MockOwnerAuthRepository();
    const owner = await auth.login({ loginId: "mock.temp", password: "12345678" });
    expect(owner.passwordChangeRequired).toBe(true);
    const changed = await auth.changePassword({
      currentPassword: "12345678",
      newPassword: "brand-new-pass",
    });
    expect(changed.passwordChangeRequired).toBe(false);
    expect((await auth.me()).passwordChangeRequired).toBe(false);
    await auth.logout();
    await expect(
      auth.login({ loginId: "mock.temp", password: "12345678" }),
    ).rejects.toMatchObject({ status: 401 });
    expect(
      (await auth.login({ loginId: "mock.temp", password: "brand-new-pass" }))
        .passwordChangeRequired,
    ).toBe(false);
    // 원본 계정 목록은 바꾸지 않는다.
    expect(MOCK_OWNER_ACCOUNTS[2].password).toBe("12345678");
  });

  it("현재 비밀번호 틀림·정책 위반·같은 비밀번호·로그인 안 함·시도 제한", async () => {
    let now = 0;
    const auth = new MockOwnerAuthRepository(MOCK_OWNER_ACCOUNTS, () => now);
    await expect(
      auth.changePassword({ currentPassword: "x", newPassword: "new-password" }),
    ).rejects.toMatchObject({ status: 401, reason: undefined });
    await auth.login({ loginId: "mock.single", password: "mock-only-password" });
    await expect(
      auth.changePassword({
        currentPassword: "mock-only-password",
        newPassword: "short",
      }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      auth.changePassword({
        currentPassword: "mock-only-password",
        newPassword: "mock-only-password",
      }),
    ).rejects.toMatchObject({ status: 422 });
    // 로그인 1회 + 틀린 현재 비밀번호 4회 = 1분 5회
    for (let i = 0; i < 4; i++)
      await expect(
        auth.changePassword({
          currentPassword: "wrong-password",
          newPassword: "new-password",
        }),
      ).rejects.toMatchObject({ status: 401, reason: "current_password" });
    await expect(
      auth.changePassword({
        currentPassword: "mock-only-password",
        newPassword: "new-password",
      }),
    ).rejects.toMatchObject({ status: 429 });
    now += 60_001;
    await expect(
      auth.changePassword({
        currentPassword: "mock-only-password",
        newPassword: "new-password",
      }),
    ).resolves.toMatchObject({ loginId: "mock.single" });
  });
});
