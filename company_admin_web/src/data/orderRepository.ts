import type { Order, OrderItem } from "./models";

export interface OrderRepository {
  load(signal?: AbortSignal): Promise<Order[]>;
  detail(id: number, signal?: AbortSignal): Promise<Order>;
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
  private async get(path: string, signal?: AbortSignal) {
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
      const response = await this.transport(target, {
        method: "GET",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(message);
      return record(await response.json());
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  }
  async load(signal?: AbortSignal): Promise<Order[]> {
    const orders: Order[] = [];
    let total: number;
    do {
      const result = await this.get(
        `/admin/orders?limit=200&offset=${orders.length}`,
        signal,
      );
      if (!Array.isArray(result.orders))
        throw new Error("주문 목록 형식을 확인해 주세요.");
      total = number(result.total);
      const rows = result.orders.map(parseOrder);
      orders.push(...rows);
      if (!rows.length) break;
    } while (orders.length < total);
    return orders;
  }
  async detail(id: number, signal?: AbortSignal) {
    if (!Number.isInteger(id) || id < 1)
      throw new Error("주문 ID를 확인해 주세요.");
    return parseOrder(await this.get(`/admin/orders/${id}`, signal));
  }
}
