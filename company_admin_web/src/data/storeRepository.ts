import { adminRequest, AdminApiError } from "./apiSession.ts";
import type { ApiStore } from "./models";

export interface StoreInput {
  store_name: string;
  address: string;
  address_detail: string | null;
  store_code: string;
  phone: string;
  business_no: string;
  representative: string;
  store_type: string;
}
export interface OwnerConnectionInput { owner_id: number | null; expected_owner_id: number | null; }
export interface StoreRepository {
  setOwner?(id: number, input: OwnerConnectionInput, signal?: AbortSignal): Promise<ApiStore>;
  create?(input: StoreInput, signal?: AbortSignal): Promise<ApiStore>;
  update?(id: number, input: Partial<StoreInput>, signal?: AbortSignal): Promise<ApiStore>;
  load(signal?: AbortSignal): Promise<ApiStore[]>;
  detail(id: number, signal?: AbortSignal): Promise<ApiStore>;
}
const invalid = () => new Error("매장 API 응답 형식을 확인해 주세요.");
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
function id(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw invalid();
  return value;
}
export function parseStore(value: unknown): ApiStore {
  const row = record(value);
  const ownerId = row.owner_id === null ? null : id(row.owner_id);
  const ownerLoginId = nullableText(row.owner_login_id);
  if (ownerId === null && ownerLoginId !== null) throw invalid();
  return {
    id: id(row.store_id),
    name: text(row.store_name),
    address: text(row.address),
    addressDetail: nullableText(row.address_detail) ?? "",
    storeCode: text(row.store_code),
    phone: text(row.phone),
    businessNo: text(row.business_no),
    representative: text(row.representative),
    type: text(row.store_type),
    adminId: id(row.admin_id),
    adminName: nullableText(row.admin_name),
    ownerId,
    ownerLoginId,
  };
}
export class ApiStoreRepository implements StoreRepository {
  constructor(
    readonly baseUrl: string,
    private transport: typeof fetch = (input, init) => fetch(input, init),
    private timeoutMs = 20_000,
  ) {}
  private async get(path: string, signal?: AbortSignal, init: RequestInit = { method: "GET" }): Promise<unknown> {
    const base = new URL(this.baseUrl);
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password)
      throw new Error("매장 API 주소를 확인해 주세요.");
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
      if (!response.ok) {
        throw new AdminApiError(response.status, response.status === 404 ? "매장이 없습니다."
          : response.status === 409 ? "DB 제약 또는 연결 정보가 변경되었습니다. 새로고침 후 확인해 주세요."
          : response.status === 422 ? "입력값과 허용 길이를 확인해 주세요."
          : init.method === "GET" ? "실제 매장 조회에 실패했습니다."
          : "저장 결과를 확인할 수 없습니다. 목록을 새로고침해 확인한 뒤 다시 시도해 주세요.");
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  }
  private async save(path: string, method: "POST" | "PATCH", input: Partial<StoreInput>, signal?: AbortSignal) {
    const token = record(await this.get("/auth/admin/csrf", signal)).csrf_token;
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new Error("보안 요청 정보를 확인할 수 없습니다.");
    // 허용한 기본 정보만 전송. 인증·관계 필드를 런타임에도 제외합니다.
    const keys: (keyof StoreInput)[] = ["store_name", "address", "address_detail", "store_code", "phone", "business_no", "representative", "store_type"];
    const body = Object.fromEntries(keys.filter((key) => Object.hasOwn(input, key)).map((key) => [key, input[key]]));
    return parseStore(await this.get(path, signal, {
      method, headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      body: JSON.stringify(body),
    }));
  }
  async create(input: StoreInput, signal?: AbortSignal): Promise<ApiStore> {
    return this.save("/admin/stores", "POST", input, signal);
  }
  async update(storeId: number, input: Partial<StoreInput>, signal?: AbortSignal): Promise<ApiStore> {
    id(storeId);
    const store = await this.save("/admin/stores/" + storeId, "PATCH", input, signal);
    if (store.id !== storeId) throw invalid();
    return store;
  }
  async setOwner(storeId: number, input: OwnerConnectionInput, signal?: AbortSignal): Promise<ApiStore> {
    id(storeId);
    if (input.owner_id !== null) id(input.owner_id);
    if (input.expected_owner_id !== null) id(input.expected_owner_id);
    const token = record(await this.get("/auth/admin/csrf", signal)).csrf_token;
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("보안 요청 정보를 확인할 수 없습니다.");
    const store = parseStore(await this.get("/admin/stores/" + storeId + "/owner", signal, {
      method: "PATCH", headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      body: JSON.stringify({ owner_id: input.owner_id, expected_owner_id: input.expected_owner_id }),
    }));
    if (store.id !== storeId || store.ownerId !== input.owner_id) throw invalid();
    return store;
  }
  async load(signal?: AbortSignal): Promise<ApiStore[]> {
    const result = record(await this.get("/admin/stores", signal));
    if (!Array.isArray(result.stores) || !Number.isSafeInteger(result.total) ||
        result.total !== result.stores.length) throw invalid();
    const stores = result.stores.map(parseStore);
    if (new Set(stores.map((store) => store.id)).size !== stores.length) throw invalid();
    return stores;
  }
  async detail(storeId: number, signal?: AbortSignal): Promise<ApiStore> {
    id(storeId);
    const store = parseStore(await this.get("/admin/stores/" + storeId, signal));
    if (store.id !== storeId) throw invalid();
    return store;
  }
}
