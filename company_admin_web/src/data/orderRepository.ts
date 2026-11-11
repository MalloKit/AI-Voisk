import { adminRequest } from "./apiSession.ts";
import type { Order, OrderItem } from "./models";

export interface OrderRepository {
  load(signal?: AbortSignal): Promise<Order[]>;
  detail(id: number, signal?: AbortSignal): Promise<Order>;
  confirmCash?(id: number): Promise<void>;
}
const message = "실제 주문을 조회하지 못했습니다. 서버 연결을 확인해 주세요.";
const record = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("주문 API 응답 형식을 확인해 주세요.");
  return v as Record<string, unknown>;
};
const number = (v: unknown) => {
  if (typeof v !== "number" || !Number.isInteger(v))
    throw new Error("주문 API 숫자 형식을 확인해 주세요.");
  return v;
};
const string = (v: unknown) => {
  if (typeof v !== "string")
    throw new Error("주문 API 문자열 형식을 확인해 주세요.");
  return v;
};
export function parseOrder(raw: unknown): Order {
  const r = record(raw);
  const date = string(r.ordered_at);
  if (!Number.isFinite(new Date(date).getTime()))
    throw new Error("주문 시각 형식을 확인해 주세요.");
  const cash = r.cash_payment == null ? null : record(r.cash_payment);
  if (cash && typeof cash.received !== "boolean")
    throw new Error("현금 수납 상태를 확인해 주세요.");
  let items: OrderItem[] = [];
  if (r.items !== undefined) {
    if (!Array.isArray(r.items))
      throw new Error("주문 품목 형식을 확인해 주세요.");
    items = r.items.map((rawItem) => {
      const i = record(rawItem);
      if (!Array.isArray(i.options))
        throw new Error("주문 옵션 형식을 확인해 주세요.");
      return {
        item_id: number(i.item_id),
        menu_id: number(i.menu_id),
        menu_name: string(i.menu_name),
        quantity: number(i.quantity),
        options: i.options.map((rawOption) => {
          const o = record(rawOption);
          return { option_id: number(o.option_id), name: string(o.name) };
        }),
      };
    });
  }
  return {
    ...(cash ? { cash_payment: { amount: number(cash.amount), received: cash.received === true } } : {}),
    order_id: number(r.order_id),
    store_id: number(r.store_id),
    store_name: string(r.store_name),
    ordered_at: date,
    table_no:
      r.table_no === null || r.table_no === undefined
        ? null
        : number(r.table_no),
    order_type: r.order_type == null ? null : string(r.order_type),
    device_id: r.device_id == null ? null : number(r.device_id),
    quantity:
      r.quantity === undefined
        ? items.reduce((n, i) => n + i.quantity, 0)
        : number(r.quantity),
    items,
  };
}

export class ApiOrderRepository implements OrderRepository {
  constructor(
    public readonly baseUrl: string,
    private transport: typeof fetch = (input, init) => fetch(input, init),
    private timeoutMs = 20_000,
  ) {}
  private async request(path: string, signal?: AbortSignal, init: RequestInit = { method: "GET" }) {
    let url: URL;
    try {
      url = new URL(this.baseUrl);
    } catch {
      throw new Error("주문 API 주소를 확인해 주세요.");
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error("주문 API 주소를 확인해 주세요.");
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(cancel, this.timeoutMs);
    try {
      // Preserve an optional base path, like the Flutter repository.
      const target = `${url.origin}${url.pathname.replace(/\/$/, "")}${path}`;
      const response = await adminRequest(this.transport, target, {
        ...init,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(message);
      return record(await response.json());
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  }
  private get(path: string, signal?: AbortSignal) {
    return this.request(path, signal);
  }

  async confirmCash(id: number) {
    if (!Number.isInteger(id) || id < 1)
      throw new Error("주문 ID를 확인해 주세요.");
    const token = (await this.get("/auth/admin/csrf")).csrf_token;
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new Error("보안 요청 정보를 확인해 주세요.");
    const result = await this.request(`/admin/orders/${id}/cash/confirm`, undefined, {
      method: "POST", headers: { "X-CSRF-Token": token },
    });
    if (result.order_id !== id || result.received !== true)
      throw new Error("현금 수납 결과를 확인해 주세요.");
  }
  async load(signal?: AbortSignal): Promise<Order[]> {
    const orders = new Map<number, Order>();
    let offset = 0;
    let total: number | undefined;
    do {
      const result = await this.get(
        `/admin/orders?limit=200&offset=${offset}`,
        signal,
      );
      if (!Array.isArray(result.orders))
        throw new Error("주문 목록 형식을 확인해 주세요.");
      const reportedTotal = number(result.total);
      if (!Number.isSafeInteger(reportedTotal) || reportedTotal < 0)
        throw new Error("주문 목록 건수를 확인해 주세요.");
      // Bound this load by its first total instead of chasing a growing order stream.
      total ??= reportedTotal;
      const rows = result.orders.map(parseOrder);
      // OFFSET counts received rows, not unique IDs. Keep the first occurrence and its ordering.
      offset += rows.length;
      for (const order of rows) if (!orders.has(order.order_id)) orders.set(order.order_id, order);
      if (!rows.length) break;
    } while (offset < total);
    return [...orders.values()];
  }

  async detail(id: number, signal?: AbortSignal) {
    if (!Number.isInteger(id) || id < 1)
      throw new Error("주문 ID를 확인해 주세요.");
    return parseOrder(await this.get(`/admin/orders/${id}`, signal));
  }
}
