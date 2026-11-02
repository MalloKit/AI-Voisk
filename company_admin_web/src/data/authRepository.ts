import { AdminApiError } from "./apiSession.ts";
import type { AdminLoginInput } from "../features/LoginPage";

export interface AuthAdmin {
  id: number;
  name: string;
}
export interface AuthRepository {
  me(signal?: AbortSignal): Promise<AuthAdmin>;
  login(input: AdminLoginInput, signal?: AbortSignal): Promise<AuthAdmin>;
  logout(signal?: AbortSignal): Promise<void>;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("인증 서버 응답을 확인해 주세요.");
  return value as Record<string, unknown>;
}
function admin(value: unknown): AuthAdmin {
  const row = record(record(value).admin);
  if (typeof row.admin_id !== "number" || !Number.isSafeInteger(row.admin_id) || row.admin_id < 1 ||
      typeof row.admin_name !== "string" || row.role !== "company_admin")
    throw new Error("관리자 인증 응답을 확인해 주세요.");
  return { id: row.admin_id, name: row.admin_name };
}

export class ApiAuthRepository implements AuthRepository {
  constructor(
    readonly baseUrl: string,
    private transport: typeof fetch = (input, init) => fetch(input, init),
    private timeoutMs = 20_000,
  ) {}
  private async request(path: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
    const base = new URL(this.baseUrl);
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password)
      throw new Error("인증 API 주소를 확인해 주세요.");
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(cancel, this.timeoutMs);
    try {
      const response = await this.transport(base.origin + base.pathname.replace(/\/$/, "") + path, {
        ...init, credentials: "include", cache: "no-store", signal: controller.signal,
      });
      if (!response.ok) {
        const message = response.status === 401 ? "관리자 ID 또는 비밀번호를 확인해 주세요."
          : response.status === 403 ? "인증 요청을 확인할 수 없습니다. 접속 주소와 보안 설정을 확인해 주세요."
          : response.status === 422 || response.status === 413 ? "로그인 입력 형식과 길이를 확인해 주세요."
          : response.status === 429 ? "로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요."
          : "인증 서버에 연결하지 못했습니다. 서버 상태를 확인해 주세요.";
        throw new AdminApiError(response.status, message);
      }
      return response.status === 204 ? undefined : await response.json();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  }
  private async csrf(signal?: AbortSignal): Promise<string> {
    const result = record(await this.request("/auth/admin/csrf", { method: "GET" }, signal));
    if (typeof result.csrf_token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(result.csrf_token))
      throw new Error("인증 요청 정보를 확인해 주세요.");
    return result.csrf_token;
  }
  async me(signal?: AbortSignal) {
    return admin(await this.request("/auth/admin/me", { method: "GET" }, signal));
  }
  async login(input: AdminLoginInput, signal?: AbortSignal) {
    const token = await this.csrf(signal);
    return admin(await this.request("/auth/admin/login", {
      method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      body: JSON.stringify({ admin_id: input.adminId, password: input.password }),
    }, signal));
  }
  async logout(signal?: AbortSignal) {
    const token = await this.csrf(signal);
    await this.request("/auth/admin/logout", { method: "POST", headers: { "X-CSRF-Token": token } }, signal);
  }
}
