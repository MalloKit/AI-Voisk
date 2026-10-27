import { adminRequest } from "./apiSession.ts";
import type { ApiStore } from "./models";

export interface StoreRepository {
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
  private async get(path: string, signal?: AbortSignal): Promise<unknown> {
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
        { method: "GET", signal: controller.signal },
      );
      if (!response.ok) {
        throw new Error(response.status === 404 ? "매장이 없습니다." : "실제 매장 조회에 실패했습니다.");
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
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
