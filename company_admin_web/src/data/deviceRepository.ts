import { adminRequest } from "./apiSession.ts";
import type { ApiDevice } from "./models";

export interface DeviceRepository {
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
  private async get(path: string, signal?: AbortSignal): Promise<unknown> {
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
        { method: "GET", signal: controller.signal },
      );
      if (!response.ok) {
        throw new Error(response.status === 404 ? "기기가 없습니다." : "실제 기기 조회에 실패했습니다.");
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
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
