import { adminRequest, AdminApiError } from "./apiSession.ts";
import type { ApiOwner, ApiOwnerDetail, OwnerStore } from "./models";

export interface OwnerCreateInput { login_id: string; password: string; }
export interface OwnerRepository {
  create?(input: OwnerCreateInput, signal?: AbortSignal): Promise<ApiOwner>;
  load(signal?: AbortSignal): Promise<ApiOwner[]>;
  detail(id: number, signal?: AbortSignal): Promise<ApiOwnerDetail>;
}
const invalid = () => new Error("점주 API 응답 형식을 확인해 주세요.");
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string") throw invalid();
  return value;
}
function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}
function integer(value: unknown, minimum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) throw invalid();
  return value;
}
export function parseOwner(value: unknown): ApiOwner {
  const row = record(value);
  return {
    id: integer(row.owner_id, 1),
    loginId: text(row.login_id),
    storeCount: integer(row.store_count, 0),
  };
}
export function parseOwnerDetail(value: unknown): ApiOwnerDetail {
  const row = record(value);
  const owner = parseOwner(row);
  if (!Array.isArray(row.stores)) throw invalid();
  const stores: OwnerStore[] = row.stores.map((value) => {
    const store = record(value);
    return {
      id: integer(store.store_id, 1),
      name: text(store.store_name),
      address: text(store.address),
      addressDetail: nullableText(store.address_detail) ?? "",
      adminId: integer(store.admin_id, 1),
      adminName: nullableText(store.admin_name),
    };
  });
  if (stores.length !== owner.storeCount || new Set(stores.map((s) => s.id)).size !== stores.length)
    throw invalid();
  return { ...owner, stores };
}
export class ApiOwnerRepository implements OwnerRepository {
  constructor(
    readonly baseUrl: string,
    private transport: typeof fetch = (input, init) => fetch(input, init),
    private timeoutMs = 20_000,
  ) {}
  private async get(path: string, signal?: AbortSignal, init: RequestInit = { method: "GET" }): Promise<unknown> {
    const base = new URL(this.baseUrl);
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password)
      throw new Error("점주 API 주소를 확인해 주세요.");
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(cancel, this.timeoutMs);
    try {
      const response = await adminRequest(this.transport, 
        base.origin + base.pathname.replace(/\/$/, "") + path,
        { ...init, signal: controller.signal },
      );
      if (!response.ok)
        throw new AdminApiError(response.status, response.status === 404 ? "점주 계정이 없습니다."
          : response.status === 409 ? "이미 사용 중인 로그인 ID입니다."
          : response.status === 422 || response.status === 413 ? "로그인 ID와 비밀번호의 형식·길이를 확인해 주세요."
          : init.method === "GET" ? "실제 점주 조회에 실패했습니다."
          : "계정 생성 결과를 확인할 수 없습니다. 목록을 새로고침해 확인한 뒤 다시 시도해 주세요.");
      return await response.json();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  }
  async create(input: OwnerCreateInput, signal?: AbortSignal): Promise<ApiOwner> {
    const token = record(await this.get("/auth/admin/csrf", signal)).csrf_token;
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("보안 요청 정보를 확인할 수 없습니다.");
    const owner = parseOwner(await this.get("/admin/owners", signal, {
      method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      body: JSON.stringify({ login_id: input.login_id, password: input.password }),
    }));
    if (owner.loginId !== input.login_id || owner.storeCount !== 0) throw invalid();
    return owner;
  }
  async load(signal?: AbortSignal): Promise<ApiOwner[]> {
    const result = record(await this.get("/admin/owners", signal));
    if (!Array.isArray(result.owners) || !Number.isSafeInteger(result.total) ||
        result.total !== result.owners.length) throw invalid();
    const owners = result.owners.map(parseOwner);
    if (new Set(owners.map((o) => o.id)).size !== owners.length) throw invalid();
    return owners;
  }
  async detail(ownerId: number, signal?: AbortSignal): Promise<ApiOwnerDetail> {
    integer(ownerId, 1);
    const owner = parseOwnerDetail(await this.get("/admin/owners/" + ownerId, signal));
    if (owner.id !== ownerId) throw invalid();
    return owner;
  }
}
