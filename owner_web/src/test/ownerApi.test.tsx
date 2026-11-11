import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import type { MenuBoardChanges } from "../data/models";
import { OWNER_SESSION_EXPIRED } from "../data/ownerAuth";
import {
  ApiOwnerRepository,
  OwnerApiError,
  apiErrorMessage,
  deviceConnection,
  toServerChanges,
} from "../data/ownerApiRepository";
import { MockOwnerRepository } from "../data/ownerRepository";
import { DEMO_NOW } from "../data/demoClock";

const BASE = "http://127.0.0.1:8001";
const noVersion = {
  appVersion: null,
  lastSyncedAt: null,
  currentMenuVersion: null,
  appliedMenuVersion: null,
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

const boardBody = {
  categories: [
    { category_id: 1, store_id: 5, category_name: "식사", category_sort: 1 },
  ],
  menus: [
    {
      menu_id: 10,
      category_id: 1,
      menu_name: "덮밥",
      menu_price: 9000,
      menu_description: null,
      is_active: false,
      is_sold_out: true,
      menu_sort: 2,
      image_url: "/media/menu/10_abc.jpg",
    },
  ],
  options: [
    {
      option_id: 100,
      menu_id: 10,
      option_name: "곱빼기",
      extra_price: 1000,
      is_active: false,
      is_sold_out: false,
      menu_option_sort: 3,
      option_group: "양",
    },
  ],
};

function repositoryWith(...responses: (() => Response)[]) {
  const transport = vi.fn<typeof fetch>();
  for (const response of responses)
    transport.mockImplementationOnce(async () => response());
  return { transport, repository: new ApiOwnerRepository(BASE, 5, transport) };
}
const call = (transport: ReturnType<typeof vi.fn>, index: number) => {
  const [url, init] = transport.mock.calls[index] as [string, RequestInit];
  return { url, init };
};

afterEach(() => vi.restoreAllMocks());

describe("ApiOwnerRepository 조회", () => {
  it("쿠키를 포함해 매장 정보를 읽고 화면 모델로 바꾼다", async () => {
    const { repository, transport } = repositoryWith(() =>
      json({
        store_id: 5,
        store_name: "본점",
        address: "부산",
        address_detail: null,
        store_code: "T0005",
        phone: "051",
        business_no: "1234567890",
        representative: "대표",
        store_type: "분식",
        admin_id: 1,
        owner_id: 7,
        owner_login_id: "kim.owner",
      }),
    );
    expect(await repository.getStoreProfile()).toEqual({
      store: {
        id: 5,
        name: "본점",
        address1: "부산",
        address2: null,
        storeCode: "T0005",
        phone: "051",
        businessNo: "1234567890",
        representative: "대표",
        storeType: "분식",
        adminId: 1,
        ownerId: 7,
      },
      owner: { id: 7, loginId: "kim.owner" },
    });
    const { url, init } = call(transport, 0);
    expect(url).toBe(`${BASE}/owner/stores/5`);
    expect(init.credentials).toBe("include");
    expect(init.cache).toBe("no-store");
  });

  it("판매 중지 항목과 sort를 그대로 메뉴판으로 읽는다", async () => {
    const { repository } = repositoryWith(() => json(boardBody));
    expect(await repository.getMenuBoard()).toEqual({
      categories: [{ id: 1, storeId: 5, name: "식사", sort: 1 }],
      menus: [
        {
          id: 10,
          categoryId: 1,
          name: "덮밥",
          price: 9000,
          description: null,
          isActive: false,
          isSoldOut: true,
          sort: 2,
          imageUrl: "/media/menu/10_abc.jpg",
        },
      ],
      options: [
        {
          id: 100,
          menuId: 10,
          name: "곱빼기",
          sort: 3,
          isActive: false,
          isSoldOut: false,
          extraPrice: 1000,
          optionGroup: "양",
        },
      ],
    });
  });

  it("option_group이 없거나 null이면 그룹 없는 선택 추가 옵션으로 읽는다", async () => {
    const { option_group: _, ...noGroup } = boardBody.options[0];
    const { repository } = repositoryWith(() =>
      json({
        ...boardBody,
        options: [noGroup, { ...noGroup, option_id: 101, option_group: null }],
      }),
    );
    expect(
      (await repository.getMenuBoard()).options.map((o) => o.optionGroup),
    ).toEqual([null, null]);
  });

  it("주문을 페이지로 끝까지 받아 품목과 옵션으로 나눈다", async () => {
    const order = (id: number) => ({
      order_id: id,
      store_id: 5,
      ordered_at: "2026-10-29T01:00:00+00:00",
      table_no: null,
      order_type: "takeaway",
      device_id: 70,
      client_order_id: `uuid-${id}`,
      quantity: 2,
      items: [
        {
          item_id: id * 10,
          menu_id: 10,
          menu_name: "덮밥",
          quantity: 2,
          legacy_option_id: 99,
          options: [{ option_id: 100, name: "곱빼기", extra_price: 1000 }],
        },
      ],
    });
    const { repository, transport } = repositoryWith(
      () => json({ orders: [order(1)], total: 201, limit: 200, offset: 0 }),
      () => json({ orders: [order(2)], total: 201, limit: 200, offset: 200 }),
    );
    const history = await repository.getOrderHistory();
    expect(call(transport, 0).url).toBe(
      `${BASE}/owner/stores/5/orders?limit=200&offset=0`,
    );
    expect(call(transport, 1).url).toBe(
      `${BASE}/owner/stores/5/orders?limit=200&offset=200`,
    );
    expect(transport).toHaveBeenCalledTimes(2);
    expect(history.orders.map((o) => o.id)).toEqual([1, 2]);
    expect(history.items[0]).toEqual({
      id: 10,
      orderId: 1,
      menuId: 10,
      quantity: 2,
      legacyOptionId: 99,
    });
    expect(history.itemOptions[1]).toEqual({ itemId: 20, optionId: 100 });
  });

  it("빈 주문 목록은 한 번만 요청한다", async () => {
    const { repository, transport } = repositoryWith(() =>
      json({ orders: [], total: 0, limit: 200, offset: 0 }),
    );
    expect((await repository.getOrderHistory()).orders).toEqual([]);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  // 키오스크가 60초마다 상태를 보고하므로(/kiosk/heartbeat) 3분 기준으로 연결 상태를 판정한다.
  it("기기 연결 상태는 마지막 보고 시각으로 판정한다", () => {
    const now = Date.parse("2026-11-11T03:00:00Z");
    expect(deviceConnection("2026-11-11T02:58:30+00:00", now)).toBe("online");
    expect(deviceConnection("2026-11-11T02:56:59+00:00", now)).toBe("offline");
    expect(deviceConnection(null, now)).toBe("unknown");
    expect(deviceConnection("not-a-date", now)).toBe("unknown");
  });

  it("오래전 보고만 있는 기기는 연결 끊김으로 본다", async () => {
    const { repository } = repositoryWith(() =>
      json({
        devices: [
          {
            device_id: 70,
            device_code: "K-70",
            is_active: true,
            last_seen_at: "2026-10-29T01:00:00+00:00",
            app_version: "1.2.0+5",
            last_synced_at: "2026-10-29T00:50:00+00:00",
            current_menu_version: 12,
            applied_menu_version: 11,
          },
        ],
      }),
    );
    expect(await repository.getDevices()).toEqual([
      {
        id: 70,
        storeId: 5,
        isActive: true,
        connection: "offline",
        lastSeenAt: "2026-10-29T01:00:00+00:00",
        appVersion: "1.2.0+5",
        lastSyncedAt: "2026-10-29T00:50:00+00:00",
        currentMenuVersion: 12,
        appliedMenuVersion: 11,
      },
    ]);
  });

  it("버전·동기화 필드가 없는 응답은 미확인(null)으로 읽고 잘못된 형식은 거부한다", async () => {
    const device = {
      device_id: 70,
      device_code: "K-70",
      is_active: true,
      last_seen_at: null,
    };
    const { repository } = repositoryWith(
      () => json({ devices: [device] }),
      () => json({ devices: [{ ...device, applied_menu_version: "11" }] }),
    );
    expect(await repository.getDevices()).toEqual([
      expect.objectContaining({
        appVersion: null,
        lastSyncedAt: null,
        currentMenuVersion: null,
        appliedMenuVersion: null,
      }),
    ]);
    await expect(repository.getDevices()).rejects.toThrow(OwnerApiError);
  });
});

describe("ApiOwnerRepository 쓰기", () => {
  const changes: MenuBoardChanges = {
    categories: {
      create: [{ tempId: -1, name: "새", sort: 1 }],
      update: [{ id: 1, name: "식사", sort: 2 }],
      remove: [3],
    },
    menus: {
      create: [
        {
          tempId: -2,
          categoryId: -1,
          name: "새 메뉴",
          price: 1000,
          description: null,
          isActive: true,
          isSoldOut: false,
          sort: 1,
        },
      ],
      update: [
        {
          id: 10,
          categoryId: -1,
          name: "덮밥",
          price: 9000,
          description: "설명",
          isActive: false,
          sort: 2,
        },
      ],
    },
    options: {
      create: [
        {
          tempId: -3,
          menuId: -2,
          name: "옵션",
          sort: 1,
          isSoldOut: false,
          extraPrice: 0,
          optionGroup: " 맵기 ",
        },
      ],
      update: [
        {
          id: 100,
          menuId: 10,
          name: "곱빼기",
          sort: 1,
          isActive: false,
          extraPrice: 500,
          optionGroup: "",
        },
      ],
    },
  };

  it("서버가 받는 필드만 보낸다. 기존 행의 품절·소속 메뉴는 보내지 않는다", () => {
    expect(toServerChanges(changes)).toEqual({
      categories: {
        create: [{ temp_id: -1, name: "새", sort: 1 }],
        update: [{ id: 1, name: "식사", sort: 2 }],
        remove: [3],
      },
      menus: {
        create: [
          {
            temp_id: -2,
            category_id: -1,
            name: "새 메뉴",
            price: 1000,
            description: null,
            is_active: true,
            is_sold_out: false,
            sort: 1,
          },
        ],
        update: [
          {
            id: 10,
            category_id: -1,
            name: "덮밥",
            price: 9000,
            description: "설명",
            is_active: false,
            sort: 2,
          },
        ],
      },
      options: {
        create: [
          {
            temp_id: -3,
            menu_id: -2,
            name: "옵션",
            extra_price: 0,
            is_sold_out: false,
            sort: 1,
            // 앞뒤 공백을 빼고, 빈 그룹은 null(그룹 없음)로 보낸다.
            group: "맵기",
          },
        ],
        update: [
          {
            id: 100,
            name: "곱빼기",
            extra_price: 500,
            is_active: false,
            sort: 1,
            group: null,
          },
        ],
      },
    });
  });

  it("CSRF 토큰을 받아 PATCH로 저장하고 임시 id 대응표를 읽는다", async () => {
    const { repository, transport } = repositoryWith(
      () => json({ csrf_token: "token-123" }),
      () =>
        json({
          board: boardBody,
          ids: { "-1": 2, "-2": 11, "-3": 101 },
          devices_updated: 1,
        }),
    );
    const result = await repository.saveMenuBoard(changes);
    expect(call(transport, 0).url).toBe(`${BASE}/auth/owner/csrf`);
    const { url, init } = call(transport, 1);
    expect(url).toBe(`${BASE}/owner/stores/5/menu-board`);
    expect(init.method).toBe("PATCH");
    expect(init.credentials).toBe("include");
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      "X-CSRF-Token": "token-123",
    });
    expect(JSON.parse(init.body as string)).toEqual(toServerChanges(changes));
    expect(result.ids).toEqual({ [-1]: 2, [-2]: 11, [-3]: 101 });
    expect(result.board.menus[0].id).toBe(10);
  });

  it("품절은 메뉴·옵션 경로로 즉시 보낸다", async () => {
    const { repository, transport } = repositoryWith(
      () => json({ csrf_token: "a" }),
      () => json({ menu_id: 10, is_sold_out: true }),
      () => json({ csrf_token: "b" }),
      () => json({ option_id: 100, is_sold_out: false }),
    );
    await repository.setMenuSoldOut(10, true);
    await repository.setOptionSoldOut(100, false);
    expect(call(transport, 1).url).toBe(`${BASE}/owner/menus/10/sold-out`);
    expect(JSON.parse(call(transport, 1).init.body as string)).toEqual({
      is_sold_out: true,
    });
    expect(call(transport, 3).url).toBe(`${BASE}/owner/options/100/sold-out`);
    expect(call(transport, 3).init.headers).toMatchObject({
      "X-CSRF-Token": "b",
    });
  });
});

describe("ApiOwnerRepository 오류 구분", () => {
  const failure = async (repository: ApiOwnerRepository) =>
    repository.getMenuBoard().then(
      () => {
        throw new Error("실패해야 합니다.");
      },
      (error: unknown) => error as OwnerApiError,
    );

  it("401은 세션 만료 이벤트를 보내 로그인 화면으로 돌린다", async () => {
    const expired = vi.fn();
    window.addEventListener(OWNER_SESSION_EXPIRED, expired);
    const { repository } = repositoryWith(() =>
      json({ detail: "점주 로그인이 필요합니다." }, 401),
    );
    expect((await failure(repository)).status).toBe(401);
    expect(expired).toHaveBeenCalledTimes(1);
    window.removeEventListener(OWNER_SESSION_EXPIRED, expired);
  });

  it("403과 503은 로그인을 유지하고 서로 다른 문구를 보여 준다", async () => {
    const expired = vi.fn();
    window.addEventListener(OWNER_SESSION_EXPIRED, expired);
    const forbidden = await failure(
      repositoryWith(() => json({ detail: "x" }, 403)).repository,
    );
    expect(forbidden.status).toBe(403);
    expect(forbidden.message).toContain("허용 출처");
    const unavailable = await failure(
      repositoryWith(() => json({ detail: "조회 실패." }, 503)).repository,
    );
    expect(unavailable.status).toBe(503);
    expect(unavailable.message).toBe("조회 실패.");
    const noDetail = await failure(
      repositoryWith(() => new Response("", { status: 503 })).repository,
    );
    expect(noDetail.message).toContain("DB에 연결하지 못했습니다");
    expect(expired).not.toHaveBeenCalled();
    window.removeEventListener(OWNER_SESSION_EXPIRED, expired);
  });

  it("저장 거부(409·422)는 서버 문구를 그대로 보여 준다", async () => {
    const { repository } = repositoryWith(
      () => json({ csrf_token: "a" }),
      () =>
        json({ detail: "메뉴가 남아 있는 카테고리는 삭제할 수 없습니다." }, 409),
    );
    await expect(
      repository.setMenuSoldOut(1, true).catch((e: unknown) => {
        throw new Error(apiErrorMessage(e, "기본"));
      }),
    ).rejects.toThrow("메뉴가 남아 있는 카테고리");
  });

  it("연결 실패는 서버 확인 문구, 응답 형식 오류도 OwnerApiError다", async () => {
    const transport = vi.fn<typeof fetch>().mockRejectedValue(new TypeError());
    const down = await failure(new ApiOwnerRepository(BASE, 5, transport));
    expect(down.message).toContain("서버에 연결하지 못했습니다");
    const bad = await failure(
      repositoryWith(() => json({ categories: "x" })).repository,
    );
    expect(bad).toBeInstanceOf(OwnerApiError);
  });

  it("호출자가 취소하면 오류 문구로 바꾸지 않고 만료도 알리지 않는다", async () => {
    const expired = vi.fn();
    window.addEventListener(OWNER_SESSION_EXPIRED, expired);
    const abort = new AbortController();
    const transport = vi.fn<typeof fetch>(async () => {
      abort.abort();
      throw new DOMException("취소", "AbortError");
    });
    const repository = new ApiOwnerRepository(BASE, 5, transport);
    const error = await repository.getMenuBoard(abort.signal).catch((e) => e);
    expect(error).not.toBeInstanceOf(OwnerApiError);
    expect(expired).not.toHaveBeenCalled();
    window.removeEventListener(OWNER_SESSION_EXPIRED, expired);
  });

  it("예상하지 못한 오류는 화면 기본 문구를 쓴다", () => {
    expect(apiErrorMessage(new Error("내부"), "기본")).toBe("기본");
  });
});

describe("실제 API 데이터의 화면 표시", () => {
  it("매장 조회가 503이면 서버 문구와 다시 시도를 보여 준다", async () => {
    const repository = new MockOwnerRepository();
    vi.spyOn(repository, "getStoreProfile").mockRejectedValue(
      new OwnerApiError(503, "조회 실패. 서버 연결과 DB 설정을 확인해 주세요."),
    );
    render(<App repository={repository} />);
    expect(
      await screen.findByText(/조회 실패\. 서버 연결과 DB 설정/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /다시 시도/ }),
    ).toBeInTheDocument();
  });

  it("연결 상태를 모르는 기기는 정상으로 표시하지 않는다", async () => {
    const repository = new MockOwnerRepository();
    vi.spyOn(repository, "getDevices").mockResolvedValue([
      {
        id: 70,
        storeId: 1,
        isActive: true,
        connection: "unknown",
        lastSeenAt: "2026-10-29T01:00:00+00:00",
        ...noVersion,
      },
      {
        id: 71,
        storeId: 1,
        isActive: true,
        connection: "unknown",
        lastSeenAt: null,
        ...noVersion,
      },
    ]);
    render(<App repository={repository} now={DEMO_NOW} />);
    const list = await screen.findByRole("list", { name: "키오스크 목록" });
    const card = list.closest(".card")!;
    expect(card).toHaveTextContent("연결 상태 미확인 (2대)");
    expect(card).not.toHaveTextContent("모두 정상");
    const rows = within(list as HTMLElement).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("미확인마지막 확인 2026-10-29 10:00");
    expect(rows[1]).toHaveTextContent("연결 기록 없음");
  });
});
