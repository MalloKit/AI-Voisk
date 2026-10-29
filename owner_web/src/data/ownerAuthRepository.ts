import {
  LOGIN_FAILED,
  OwnerAuthError,
  validOwnerLoginId,
  validOwnerPassword,
  type AuthOwner,
  type OwnerLoginInput,
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

// me·login 응답: { owner: { owner_id, login_id, role: "owner", stores: [{ store_id, store_name }] } }
export function parseOwner(value: unknown): AuthOwner {
  const row = record(record(value).owner);
  if (
    !positiveInt(row.owner_id) ||
    typeof row.login_id !== "string" ||
    row.role !== "owner" ||
    !Array.isArray(row.stores)
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
  };
}

// 서버 점주 인증 API 구현. 서버에 API가 생기면 AppEntry의 기본값을 이것으로 바꾼다.
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
}

// 개발용 Mock 인증. 세션은 이 객체의 메모리에만 있어 페이지를 새로고침하면 로그아웃된다.
// 서버와 같은 순서(csrf → login/logout)로 동작하고, 실패 응답도 서버 계약과 같게 만든다.
export class MockOwnerAuthRepository implements OwnerAuthRepository {
  private session: MockOwnerAccount | null = null;
  private csrfToken: string | null = null;
  constructor(readonly devAccounts: MockOwnerAccount[] = MOCK_OWNER_ACCOUNTS) {}

  private issueCsrf() {
    this.csrfToken = crypto.randomUUID();
    return this.csrfToken;
  }
  private useCsrf(token: string) {
    if (!this.csrfToken || token !== this.csrfToken)
      throw new OwnerAuthError(403, MESSAGES[403]);
    this.csrfToken = null;
  }
  private view(account: MockOwnerAccount): AuthOwner {
    return {
      ownerId: account.ownerId,
      loginId: account.loginId,
      stores: structuredClone(account.stores),
    };
  }
  async me() {
    if (!this.session) throw new OwnerAuthError(401, "로그인이 필요합니다.");
    return this.view(this.session);
  }
  async login(input: OwnerLoginInput) {
    this.useCsrf(this.issueCsrf());
    if (
      !validOwnerLoginId(input.loginId) ||
      !validOwnerPassword(input.password)
    )
      throw new OwnerAuthError(422, MESSAGES[422]);
    const account = this.devAccounts.find(
      (a) => a.loginId === input.loginId && a.password === input.password,
    );
    if (!account) throw new OwnerAuthError(401, LOGIN_FAILED);
    this.session = account;
    return this.view(account);
  }
  async logout() {
    this.useCsrf(this.issueCsrf());
    if (!this.session) throw new OwnerAuthError(401, "로그인이 필요합니다.");
    this.session = null;
  }
  // 개발·테스트용: 서버 세션 만료를 흉내 낸다.
  expireSession() {
    this.session = null;
  }
}
