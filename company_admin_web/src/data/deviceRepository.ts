import { adminRequest, AdminApiError } from "./apiSession.ts";
import type { ApiDevice } from "./models";

export interface DeviceCreateInput { device_code: string; store_id: number; }
export interface DeviceStatusInput { is_active: boolean; expected_is_active: boolean; }
export const validDeviceCode = (value: string) => value.length >= 1 && value.length <= 50 && !/[^A-Za-z0-9_-]/.test(value);
// 키오스크가 60초마다 상태를 보고한다(/kiosk/heartbeat). 3분 안에 보고가 있으면 연결로 본다.
export function liveConnection(lastSeenAt: string | null, now = Date.now()): "연결" | "연결 끊김" | "미확인" {
  if (!lastSeenAt) return "미확인";
  const seen = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(seen)) return "미확인";
  return now - seen <= 3 * 60_000 ? "연결" : "연결 끊김";
}
export interface DeviceToken { device_id: number; store_id: number; token: string; }
export interface DeviceRepository {
  create?(input: DeviceCreateInput, signal?: AbortSignal): Promise<ApiDevice>;
  // 키오스크 기기 토큰을 새로 발급한다. 이전 토큰은 무효가 되고, 원문은 이 응답에서만 볼 수 있다.
  issueToken?(id: number, signal?: AbortSignal): Promise<DeviceToken>;
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
// 메뉴 버전은 나중에 추가된 필드라 이전 서버 응답에는 없을 수 있습니다. 없으면 미확인(null)으로 읽습니다.
function menuVersion(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw invalid();
  return value;
}
// 키오스크 메뉴 버전 상태. 점주 웹 menuVersionStatus와 같은 규칙이며, 둘 중 하나라도 모르면 최신이라고 하지 않습니다.
export function menuVersionStatus(device: Pick<ApiDevice, "current_menu_version" | "applied_menu_version">): string {
  const { current_menu_version: current, applied_menu_version: applied } = device;
  if (current === null || applied === null) return "미확인";
  return applied >= current ? "최신" : `반영 대기 (적용 ${applied} / 최신 ${current})`;
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
    current_menu_version: menuVersion(row.current_menu_version),
    applied_menu_version: menuVersion(row.applied_menu_version),
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
  async issueToken(deviceId: number, signal?: AbortSignal): Promise<DeviceToken> {
    id(deviceId);
    const csrf = record(await this.get("/auth/admin/csrf", signal)).csrf_token;
    if (typeof csrf !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(csrf)) throw new Error("보안 요청 정보를 확인할 수 없습니다.");
    const body = record(await this.get("/admin/devices/" + deviceId + "/token", signal,
      { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: "{}" }));
    const token = text(body.token);
    if (id(body.device_id) !== deviceId || !/^[A-Za-z0-9_-]{20,200}$/.test(token)) throw invalid();
    return { device_id: deviceId, store_id: id(body.store_id), token };
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
