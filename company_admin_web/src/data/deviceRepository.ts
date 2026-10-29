import { adminRequest, AdminApiError } from "./apiSession.ts";
import type { ApiDevice } from "./models";

export interface DeviceCreateInput { device_code: string; store_id: number; }
export interface DeviceStatusInput { is_active: boolean; expected_is_active: boolean; }
export const validDeviceCode = (value: string) => value.length >= 1 && value.length <= 50 && !/[^A-Za-z0-9_-]/.test(value);
export interface DeviceRepository {
  create?(input: DeviceCreateInput, signal?: AbortSignal): Promise<ApiDevice>;
  setStatus?(id: number, input: DeviceStatusInput, signal?: AbortSignal): Promise<ApiDevice>;
  load(signal?: AbortSignal): Promise<ApiDevice[]>;
  detail(id: number, signal?: AbortSignal): Promise<ApiDevice>;
}
const invalid = () => new Error("기기 API 응답 형식을 확인해 주세요.");
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
function timestamp(value: unknown): string {
  const result = text(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(result) ||
      !Number.isFinite(new Date(result).getTime())) throw invalid();
  return result;
}
function nullableTimestamp(value: unknown): string | null {
  return value === null ? null : timestamp(value);
}
export function parseDevice(value: unknown): ApiDevice {
  const row = record(value);
  if (typeof row.is_active !== "boolean") throw invalid();
  return {
    device_id: id(row.device_id),
    device_code: text(row.device_code),
    store_id: id(row.store_id),
    store_name: text(row.store_name),
    store_address: text(row.store_address),
    store_address_detail: nullableText(row.store_address_detail),
    is_active: row.is_active,
    registered_at: timestamp(row.registered_at),
    app_version: nullableText(row.app_version),
    last_seen_at: nullableTimestamp(row.last_seen_at),
    last_synced_at: nullableTimestamp(row.last_synced_at),
  };
}
export class ApiDeviceRepository implements DeviceRepository {
  constructor(
    readonly baseUrl: string,
    private transport: typeof fetch = (input, init) => fetch(input, init),
    private timeoutMs = 20_000,
  ) {}
  private async get(path: string, signal?: AbortSignal, init: RequestInit = { method: "GET" }): Promise<unknown> {
    const base = new URL(this.baseUrl);
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password)
      throw new Error("기기 API 주소를 확인해 주세요.");
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
        throw new AdminApiError(response.status, response.status === 404 ? (init.method === "GET" ? "기기가 없습니다." : "기기 또는 매장이 없습니다.")
          : response.status === 409 ? "기기 코드가 중복되거나 상태가 변경되었습니다. 최신 목록과 상세를 확인해 주세요."
          : response.status === 422 ? "기기 입력 형식과 허용 길이를 확인해 주세요."
          : init.method === "GET" ? "실제 기기 조회에 실패했습니다."
          : "기기 저장 결과를 확인할 수 없습니다. 목록과 상세를 새로 조회한 뒤 확인해 주세요.");
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  }
  private async write(path: string, method: "POST" | "PATCH", input: object, signal?: AbortSignal) {
    const token = record(await this.get("/auth/admin/csrf", signal)).csrf_token;
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("보안 요청 정보를 확인할 수 없습니다.");
    return parseDevice(await this.get(path, signal, { method,
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token }, body: JSON.stringify(input) }));
  }
  async create(input: DeviceCreateInput, signal?: AbortSignal): Promise<ApiDevice> {
    if (!validDeviceCode(input.device_code)) throw new Error("기기 코드 형식을 확인해 주세요.");
    id(input.store_id);
    const saved = await this.write("/admin/devices", "POST", { device_code: input.device_code, store_id: input.store_id }, signal);
    if (saved.device_code !== input.device_code || saved.store_id !== input.store_id || saved.is_active !== false) throw invalid();
    return saved;
  }
  async setStatus(deviceId: number, input: DeviceStatusInput, signal?: AbortSignal): Promise<ApiDevice> {
    id(deviceId);
    if (typeof input.is_active !== "boolean" || typeof input.expected_is_active !== "boolean") throw invalid();
    const saved = await this.write("/admin/devices/" + deviceId + "/status", "PATCH",
      { is_active: input.is_active, expected_is_active: input.expected_is_active }, signal);
    if (saved.device_id !== deviceId || saved.is_active !== input.is_active) throw invalid();
    return saved;
  }
  async load(signal?: AbortSignal): Promise<ApiDevice[]> {
    const result = record(await this.get("/admin/devices", signal));
    if (!Array.isArray(result.devices) || !Number.isSafeInteger(result.total) ||
        result.total !== result.devices.length) throw invalid();
    const devices = result.devices.map(parseDevice);
    if (new Set(devices.map((device) => device.device_id)).size !== devices.length) throw invalid();
    return devices;
  }
  async detail(deviceId: number, signal?: AbortSignal): Promise<ApiDevice> {
    id(deviceId);
    const device = parseDevice(await this.get("/admin/devices/" + deviceId, signal));
    if (device.device_id !== deviceId) throw invalid();
    return device;
  }
}
