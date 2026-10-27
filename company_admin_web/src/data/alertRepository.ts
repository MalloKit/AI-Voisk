import { adminRequest } from "./apiSession.ts";
import type { ApiAlert } from "./models";

export interface AlertRepository {
  load(signal?: AbortSignal): Promise<ApiAlert[]>;
  detail(id: number, signal?: AbortSignal): Promise<ApiAlert>;
}
const invalid = () => new Error("알림 API 응답 형식을 확인해 주세요.");
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
export function parseAlert(value: unknown): ApiAlert {
  const row = record(value);
  return {
    alert_id: id(row.alert_id),
    device_id: id(row.device_id),
    device_code: text(row.device_code),
    store_id: id(row.store_id),
    store_name: text(row.store_name),
    alert_type: text(row.alert_type),
    severity: text(row.severity),
    message: text(row.message),
    alert_status: text(row.alert_status),
    occurred_at: timestamp(row.occurred_at),
    acknowledged_at: nullableTimestamp(row.acknowledged_at),
    acknowledged_by: row.acknowledged_by === null ? null : id(row.acknowledged_by),
    acknowledged_by_name: nullableText(row.acknowledged_by_name),
    resolved_at: nullableTimestamp(row.resolved_at),
  };
}

/** 확인된 기본값만 설명하고 새로운 값은 원문으로 표시합니다. */
export function apiAlertStatusLabel(value: string): string {
  return value === "UNREAD" ? "읽지 않음 (UNREAD)" : value;
}
export class ApiAlertRepository implements AlertRepository {
  constructor(
    readonly baseUrl: string,
    private transport: typeof fetch = (input, init) => fetch(input, init),
    private timeoutMs = 20_000,
  ) {}
  private async get(path: string, signal?: AbortSignal): Promise<unknown> {
    const base = new URL(this.baseUrl);
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password)
      throw new Error("알림 API 주소를 확인해 주세요.");
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
        throw new Error(response.status === 404 ? "알림이 없습니다." : "실제 알림 조회에 실패했습니다.");
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  }
  async load(signal?: AbortSignal): Promise<ApiAlert[]> {
    const result = record(await this.get("/admin/alerts", signal));
    if (!Array.isArray(result.alerts) || !Number.isSafeInteger(result.total) ||
        result.total !== result.alerts.length) throw invalid();
    const alerts = result.alerts.map(parseAlert);
    if (new Set(alerts.map((alert) => alert.alert_id)).size !== alerts.length) throw invalid();
    return alerts;
  }
  async detail(alertId: number, signal?: AbortSignal): Promise<ApiAlert> {
    id(alertId);
    const alert = parseAlert(await this.get("/admin/alerts/" + alertId, signal));
    if (alert.alert_id !== alertId) throw invalid();
    return alert;
  }
}
