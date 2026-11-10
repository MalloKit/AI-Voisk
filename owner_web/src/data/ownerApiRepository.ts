import { notifySessionExpired } from "./ownerAuth";
import type {
  Category,
  KioskDevice,
  Menu,
  MenuBoard,
  MenuBoardChanges,
  MenuBoardSaveResult,
  MenuOption,
  Order,
  OrderHistory,
  OrderItem,
  OrderItemOption,
  OrderType,
  StoreProfile,
} from "./models";
import type { OwnerRepository } from "./ownerRepository";

// 서버 점주 API(server/OWNER_API.md) 구현. 컬럼 이름 변환은 여기서만 한다.
// 세션은 HttpOnly 쿠키에 있고, CSRF 토큰은 쓰기 직전에 받아 저장하지 않는다.

export class OwnerApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "OwnerApiError";
  }
}

// 화면에 보여 줄 문구. 예상하지 못한 오류는 화면별 기본 문구를 쓴다.
export const apiErrorMessage = (error: unknown, fallback: string) =>
  error instanceof OwnerApiError ? error.message : fallback;

const FORBIDDEN =
  "요청이 거부되었습니다. 접속 주소와 서버의 허용 출처 설정을 확인해 주세요.";
const UNAVAILABLE =
  "서버가 DB에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.";
const NO_RESPONSE =
  "서버에 연결하지 못했습니다. 서버 실행과 허용 출처 설정을 확인해 주세요.";
const NO_RESULT =
  "응답이 늦어 결과를 확인하지 못했습니다. 새로고침해 확인해 주세요.";
const BAD_RESPONSE = "서버 응답 형식을 확인해 주세요.";
const PAGE_SIZE = 200;

type Row = Record<string, unknown>;

function record(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new OwnerApiError(0, BAD_RESPONSE);
  return value as Row;
}
const rows = (value: unknown) => {
  if (!Array.isArray(value)) throw new OwnerApiError(0, BAD_RESPONSE);
  return value.map(record);
};
function int(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    throw new OwnerApiError(0, BAD_RESPONSE);
  return value;
}
function text(value: unknown) {
  if (typeof value !== "string") throw new OwnerApiError(0, BAD_RESPONSE);
  return value;
}
function bool(value: unknown) {
  if (typeof value !== "boolean") throw new OwnerApiError(0, BAD_RESPONSE);
  return value;
}
const nullable = <T>(value: unknown, read: (v: unknown) => T) =>
  value === null || value === undefined ? null : read(value);

function parseBoard(value: unknown): MenuBoard {
  const body = record(value);
  return {
    categories: rows(body.categories).map(
      (c): Category => ({
        id: int(c.category_id),
        storeId: int(c.store_id),
        name: text(c.category_name),
        sort: int(c.category_sort),
      }),
    ),
    menus: rows(body.menus).map(
      (m): Menu => ({
        id: int(m.menu_id),
        categoryId: int(m.category_id),
        name: text(m.menu_name),
        price: int(m.menu_price),
        description: nullable(m.menu_description, text),
        isActive: bool(m.is_active),
        isSoldOut: bool(m.is_sold_out),
        sort: int(m.menu_sort),
      }),
    ),
    options: rows(body.options).map(
      (o): MenuOption => ({
        id: int(o.option_id),
        menuId: int(o.menu_id),
        name: text(o.option_name),
        sort: int(o.menu_option_sort),
        isActive: bool(o.is_active),
        isSoldOut: bool(o.is_sold_out),
        extraPrice: int(o.extra_price),
      }),
    ),
  };
}

// 화면의 저장 묶음을 서버 계약으로 바꾼다. 서버가 모르는 필드를 보내면 422이므로 필드를 하나씩 옮긴다.
export function toServerChanges(changes: MenuBoardChanges) {
  return {
    categories: {
      create: changes.categories.create.map((c) => ({
        temp_id: c.tempId,
        name: c.name,
        sort: c.sort,
      })),
      update: changes.categories.update,
      remove: changes.categories.remove,
    },
    menus: {
      create: changes.menus.create.map((m) => ({
        temp_id: m.tempId,
        category_id: m.categoryId,
        name: m.name,
        price: m.price,
        description: m.description,
        is_active: m.isActive,
        is_sold_out: m.isSoldOut,
        sort: m.sort,
      })),
      update: changes.menus.update.map((m) => ({
        id: m.id,
        category_id: m.categoryId,
        name: m.name,
        price: m.price,
        description: m.description,
        is_active: m.isActive,
        sort: m.sort,
      })),
    },
    options: {
      create: changes.options.create.map((o) => ({
        temp_id: o.tempId,
        menu_id: o.menuId,
        name: o.name,
        extra_price: o.extraPrice,
        is_sold_out: o.isSoldOut,
        sort: o.sort,
      })),
      update: changes.options.update.map((o) => ({
        id: o.id,
        name: o.name,
        extra_price: o.extraPrice,
        is_active: o.isActive,
        sort: o.sort,
      })),
    },
  };
}

export class ApiOwnerRepository implements OwnerRepository {
  constructor(
    readonly baseUrl: string,
    readonly storeId: number,
    private transport: typeof fetch = (input, init) => fetch(input, init),
    private timeoutMs = 30_000,
  ) {}

  private async request(
    path: string,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const base = new URL(this.baseUrl);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      cancel();
    }, this.timeoutMs);
    try {
      let response: Response;
      try {
        response = await this.transport(
          base.origin + base.pathname.replace(/\/$/, "") + path,
          {
            ...init,
            credentials: "include",
            cache: "no-store",
            signal: controller.signal,
          },
        );
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new OwnerApiError(0, timedOut ? NO_RESULT : NO_RESPONSE);
      }
      if (response.ok)
        return response.status === 204 ? undefined : await response.json();
      if (response.status === 401) {
        if (!signal?.aborted) notifySessionExpired();
        throw new OwnerApiError(401, "로그인이 만료되었습니다.");
      }
      if (response.status === 403) throw new OwnerApiError(403, FORBIDDEN);
      // 나머지 detail은 서버가 내부 정보 없이 만든 문구다.
      const detail = await response.json().then(
        (body) => (body as { detail?: unknown })?.detail,
        () => undefined,
      );
      throw new OwnerApiError(
        response.status,
        typeof detail === "string"
          ? detail
          : response.status === 503
            ? UNAVAILABLE
            : NO_RESPONSE,
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  }

  private async write(path: string, body: unknown) {
    const csrf = record(
      await this.request("/auth/owner/csrf", { method: "GET" }),
    );
    return this.request(path, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": text(csrf.csrf_token),
      },
      body: JSON.stringify(body),
    });
  }

  private get store() {
    return `/owner/stores/${this.storeId}`;
  }

  async getStoreProfile(signal?: AbortSignal): Promise<StoreProfile> {
    const s = record(await this.request(this.store, { method: "GET" }, signal));
    return {
      store: {
        id: int(s.store_id),
        name: text(s.store_name),
        address1: text(s.address),
        address2: nullable(s.address_detail, text),
        storeCode: text(s.store_code),
        phone: text(s.phone),
        businessNo: text(s.business_no),
        representative: text(s.representative),
        storeType: text(s.store_type),
        adminId: int(s.admin_id),
        ownerId: nullable(s.owner_id, int),
      },
      owner: { id: int(s.owner_id), loginId: text(s.owner_login_id) },
    };
  }

  async getMenuBoard(signal?: AbortSignal) {
    return parseBoard(
      await this.request(`${this.store}/menu-board`, { method: "GET" }, signal),
    );
  }

  // 화면이 기간을 직접 고르므로 전체를 페이지로 나눠 받는다.
  async getOrderHistory(signal?: AbortSignal): Promise<OrderHistory> {
    const orders: Order[] = [];
    const items: OrderItem[] = [];
    const itemOptions: OrderItemOption[] = [];
    for (let offset = 0, total = 1; offset < total; offset += PAGE_SIZE) {
      const page = record(
        await this.request(
          `${this.store}/orders?limit=${PAGE_SIZE}&offset=${offset}`,
          { method: "GET" },
          signal,
        ),
      );
      total = int(page.total);
      for (const o of rows(page.orders)) {
        orders.push({
          id: int(o.order_id),
          storeId: int(o.store_id),
          deviceId: nullable(o.device_id, int),
          clientOrderId: nullable(o.client_order_id, text),
          orderType: nullable(o.order_type, text) as OrderType | null,
          tableNo: nullable(o.table_no, int),
          orderedAt: text(o.ordered_at),
        });
        for (const i of rows(o.items)) {
          items.push({
            id: int(i.item_id),
            orderId: int(o.order_id),
            menuId: int(i.menu_id),
            quantity: int(i.quantity),
            legacyOptionId: nullable(i.legacy_option_id, int),
          });
          for (const option of rows(i.options))
            itemOptions.push({
              itemId: int(i.item_id),
              optionId: int(option.option_id),
            });
        }
      }
    }
    return { orders, items, itemOptions };
  }

  // DB에는 연결 상태가 없고 last_seen_at의 갱신 주체도 정해지지 않아 온라인 여부를 판정하지 않는다.
  async getDevices(signal?: AbortSignal): Promise<KioskDevice[]> {
    const body = record(
      await this.request(`${this.store}/devices`, { method: "GET" }, signal),
    );
    return rows(body.devices).map((d) => ({
      id: int(d.device_id),
      storeId: this.storeId,
      isActive: bool(d.is_active),
      connection: "unknown",
      lastSeenAt: nullable(d.last_seen_at, text),
    }));
  }

  async setMenuSoldOut(menuId: number, isSoldOut: boolean) {
    await this.write(`/owner/menus/${menuId}/sold-out`, {
      is_sold_out: isSoldOut,
    });
  }

  async setOptionSoldOut(optionId: number, isSoldOut: boolean) {
    await this.write(`/owner/options/${optionId}/sold-out`, {
      is_sold_out: isSoldOut,
    });
  }

  async saveMenuBoard(changes: MenuBoardChanges): Promise<MenuBoardSaveResult> {
    const result = record(
      await this.write(`${this.store}/menu-board`, toServerChanges(changes)),
    );
    const ids: Record<number, number> = {};
    for (const [tempId, id] of Object.entries(record(result.ids)))
      ids[Number(tempId)] = int(id);
    return { board: parseBoard(result.board), ids };
  }
}
