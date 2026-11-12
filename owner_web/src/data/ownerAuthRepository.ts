import {
  LOGIN_FAILED,
  OwnerAuthError,
  PASSWORD_CHANGE_MESSAGES,
  validOwnerLoginId,
  validOwnerPassword,
  type AuthOwner,
  type OwnerLoginInput,
  type OwnerPasswordChangeInput,
} from "./ownerAuth";
import {
  MOCK_OWNER_ACCOUNTS,
  type MockOwnerAccount,
} from "./mock/mockOwnerAccounts";

// 회사 관리자 인증과 같은 흐름: csrf 토큰 받기 → login → me(현재 로그인 확인) → logout.
// csrf는 구현체 안에서 login·logout 직전에 받는다. 화면은 이 인터페이스만 쓴다.
// 비밀번호·토큰·로그인 상태를 브라우저 저장소에 두지 않는다. 새로고침하면 me로 다시 확인한다.
export interface OwnerAuthRepository {
  // 로그인하지 않았거나 만료되면 OwnerAuthError(401)
  me(signal?: AbortSignal): Promise<AuthOwner>;
  // 잘못된 ID·비밀번호는 구분 없이 OwnerAuthError(401, LOGIN_FAILED)
  login(input: OwnerLoginInput, signal?: AbortSignal): Promise<AuthOwner>;
  logout(signal?: AbortSignal): Promise<void>;
  // 로그인한 점주 본인의 비밀번호 변경. 성공하면 서버가 세션을 새로 발급하고 바뀐 점주 정보를 준다.
  // 현재 비밀번호가 틀리면 OwnerAuthError(401, reason "current_password"), 로그인 만료는 OwnerAuthError(401)
  changePassword(
    input: OwnerPasswordChangeInput,
    signal?: AbortSignal,
  ): Promise<AuthOwner>;
}

const MESSAGES: Record<number, string> = {
  403: "인증 요청을 확인할 수 없습니다. 접속 주소와 보안 설정을 확인해 주세요.",
  413: "로그인 입력 형식과 길이를 확인해 주세요.",
  422: "로그인 입력 형식과 길이를 확인해 주세요.",
  429: "로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요.",
};
const SERVER_ERROR =
  "인증 서버에 연결하지 못했습니다. 서버 상태를 확인해 주세요.";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("인증 서버 응답을 확인해 주세요.");
  return value as Record<string, unknown>;
}
const positiveInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0;

// me·login·password 응답:
// { owner: { owner_id, login_id, role: "owner", stores: [{ store_id, store_name }], password_change_required } }
// password_change_required가 없는 이전 서버 응답은 false로 본다.
export function parseOwner(value: unknown): AuthOwner {
  const row = record(record(value).owner);
  if (
    !positiveInt(row.owner_id) ||
    typeof row.login_id !== "string" ||
    row.role !== "owner" ||
    !Array.isArray(row.stores) ||
    (row.password_change_required !== undefined &&
      typeof row.password_change_required !== "boolean")
  )
    throw new Error("점주 인증 응답을 확인해 주세요.");
  return {
    ownerId: row.owner_id,
    loginId: row.login_id,
    stores: row.stores.map((value) => {
      const store = record(value);
      if (!positiveInt(store.store_id) || typeof store.store_name !== "string")
        throw new Error("점주 매장 목록을 확인해 주세요.");
      return { storeId: store.store_id, storeName: store.store_name };
    }),
    passwordChangeRequired: row.password_change_required === true,
  };
}

// 비밀번호 변경 실패를 상태 코드별 문구로 바꾼다. 401은 호출한 쪽에서 만료 여부를 따로 확인한다.
function passwordChangeError(error: unknown): unknown {
  if (!(error instanceof OwnerAuthError)) return error;
  if (error.status === 413)
    return new OwnerAuthError(413, PASSWORD_CHANGE_MESSAGES[422]);
  if (error.status === 403 || error.status === 422 || error.status === 429)
    return new OwnerAuthError(
      error.status,
      PASSWORD_CHANGE_MESSAGES[error.status],
    );
  return error;
}

// 서버 점주 인증 API 구현. 기본 인증 출처이고, VITE_OWNER_AUTH_SOURCE=mock이 아니면 이 구현을 쓴다.
// 세션은 서버의 HttpOnly 쿠키에만 있으므로 credentials: include로 요청한다.
export class ApiOwnerAuthRepository implements OwnerAuthRepository {
  constructor(
    readonly baseUrl: string,
    private transport: typeof fetch = (input, init) => fetch(input, init),
    private timeoutMs = 20_000,
  ) {}
  private async request(
    path: string,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const base = new URL(this.baseUrl);
    if (
      !["http:", "https:"].includes(base.protocol) ||
      base.username ||
      base.password
    )
      throw new Error("인증 API 주소를 확인해 주세요.");
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(cancel, this.timeoutMs);
    try {
      const response = await this.transport(
        base.origin + base.pathname.replace(/\/$/, "") + path,
        {
          ...init,
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        },
      );
      if (!response.ok)
        throw new OwnerAuthError(
          response.status,
          response.status === 401
            ? LOGIN_FAILED
            : (MESSAGES[response.status] ?? SERVER_ERROR),
        );
      return response.status === 204 ? undefined : await response.json();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  }
  private async csrf(signal?: AbortSignal) {
    const result = record(
      await this.request("/auth/owner/csrf", { method: "GET" }, signal),
    );
    if (typeof result.csrf_token !== "string" || !result.csrf_token)
      throw new Error("인증 요청 정보를 확인해 주세요.");
    return result.csrf_token;
  }
  async me(signal?: AbortSignal) {
    return parseOwner(
      await this.request("/auth/owner/me", { method: "GET" }, signal),
    );
  }
  async login(input: OwnerLoginInput, signal?: AbortSignal) {
    const token = await this.csrf(signal);
    return parseOwner(
      await this.request(
        "/auth/owner/login",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": token,
          },
          body: JSON.stringify({
            login_id: input.loginId,
            password: input.password,
          }),
        },
        signal,
      ),
    );
  }
  async logout(signal?: AbortSignal) {
    const token = await this.csrf(signal);
    await this.request(
      "/auth/owner/logout",
      { method: "POST", headers: { "X-CSRF-Token": token } },
      signal,
    );
  }
  async changePassword(input: OwnerPasswordChangeInput, signal?: AbortSignal) {
    try {
      const token = await this.csrf(signal);
      return parseOwner(
        await this.request(
          "/auth/owner/password",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": token,
            },
            // 서버는 이 두 필드만 받는다. 확인 값은 보내지 않는다.
            body: JSON.stringify({
              current_password: input.currentPassword,
              new_password: input.newPassword,
            }),
          },
          signal,
        ),
      );
    } catch (error) {
      if (!(error instanceof OwnerAuthError) || error.status !== 401)
        throw passwordChangeError(error);
    }
    // 401은 현재 비밀번호가 틀렸거나 로그인이 만료된 경우다. me로 세션이 살아 있는지 확인해 구분한다.
    // me가 401이면 그 오류(로그인 만료)를 그대로 던진다.
    await this.me(signal);
    throw new OwnerAuthError(
      401,
      PASSWORD_CHANGE_MESSAGES[401],
      "current_password",
    );
  }
}

// 임시 비밀번호 계정이면 처음 비밀번호(매장 전화번호 초기화 값 역할)를 돌려준다.
const mockResetPasswords = (account: MockOwnerAccount) =>
  account.temporaryPassword ? [account.password] : [];

// 개발용 Mock 인증. 세션은 이 객체의 메모리에만 있어 페이지를 새로고침하면 로그아웃된다.
// 서버와 같은 순서(csrf → login/logout)로 동작하고, 실패 응답도 서버 계약과 같게 만든다.
// 비밀번호 변경도 서버와 같은 규칙(현재 비밀번호 확인, 정책, 같은 값·초기화 값 거부, 1분 5회 제한)으로 흉내 낸다.
// 바꾼 비밀번호는 이 객체의 메모리에만 있고 브라우저 저장소에 두지 않는다.
export class MockOwnerAuthRepository implements OwnerAuthRepository {
  private session: { account: MockOwnerAccount; temporary: boolean } | null =
    null;
  private csrfToken: string | null = null;
  // 로그인 ID → 현재 비밀번호. devAccounts 원본은 바꾸지 않는다.
  private passwords: Map<string, string>;
  private attempts: number[] = [];
  constructor(
    readonly devAccounts: MockOwnerAccount[] = MOCK_OWNER_ACCOUNTS,
    private clock: () => number = () => Date.now(),
  ) {
    this.passwords = new Map(devAccounts.map((a) => [a.loginId, a.password]));
  }
  // 서버 AttemptLimiter와 같은 1분 5회 제한
  private checkAttempts() {
    const now = this.clock();
    this.attempts = this.attempts.filter((t) => t > now - 60_000);
    if (this.attempts.length >= 5)
      throw new OwnerAuthError(429, MESSAGES[429]);
    this.attempts.push(now);
  }

  private issueCsrf() {
    this.csrfToken = crypto.randomUUID();
    return this.csrfToken;
  }
  private useCsrf(token: string) {
    if (!this.csrfToken || token !== this.csrfToken)
      throw new OwnerAuthError(403, MESSAGES[403]);
    this.csrfToken = null;
  }
  private view(account: MockOwnerAccount, temporary: boolean): AuthOwner {
    return {
      ownerId: account.ownerId,
      loginId: account.loginId,
      stores: structuredClone(account.stores),
      passwordChangeRequired: temporary,
    };
  }
  async me() {
    if (!this.session) throw new OwnerAuthError(401, "로그인이 필요합니다.");
    return this.view(this.session.account, this.session.temporary);
  }
  async login(input: OwnerLoginInput) {
    this.useCsrf(this.issueCsrf());
    if (
      !validOwnerLoginId(input.loginId) ||
      !validOwnerPassword(input.password)
    )
      throw new OwnerAuthError(422, MESSAGES[422]);
    this.checkAttempts();
    const account = this.devAccounts.find(
      (a) =>
        a.loginId === input.loginId &&
        this.passwords.get(a.loginId) === input.password,
    );
    if (!account) throw new OwnerAuthError(401, LOGIN_FAILED);
    const temporary = mockResetPasswords(account).includes(input.password);
    this.session = { account, temporary };
    return this.view(account, temporary);
  }
  async logout() {
    this.useCsrf(this.issueCsrf());
    if (!this.session) throw new OwnerAuthError(401, "로그인이 필요합니다.");
    this.session = null;
  }
  async changePassword(input: OwnerPasswordChangeInput) {
    this.useCsrf(this.issueCsrf());
    if (!this.session) throw new OwnerAuthError(401, "로그인이 필요합니다.");
    const { account } = this.session;
    if (
      !input.currentPassword ||
      !validOwnerPassword(input.newPassword) ||
      input.newPassword === input.currentPassword
    )
      throw new OwnerAuthError(422, PASSWORD_CHANGE_MESSAGES[422]);
    this.checkAttempts();
    if (this.passwords.get(account.loginId) !== input.currentPassword)
      throw new OwnerAuthError(
        401,
        PASSWORD_CHANGE_MESSAGES[401],
        "current_password",
      );
    // 서버처럼 초기화 값(매장 전화번호 값)은 새 비밀번호로 받지 않는다.
    if (mockResetPasswords(account).includes(input.newPassword))
      throw new OwnerAuthError(422, PASSWORD_CHANGE_MESSAGES[422]);
    this.passwords.set(account.loginId, input.newPassword);
    this.session = { account, temporary: false };
    return this.view(account, false);
  }
  // 개발·테스트용: 서버 세션 만료를 흉내 낸다.
  expireSession() {
    this.session = null;
  }
}
