import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import {
  MockAdminRepository,
  type AdminRepository,
} from "../data/adminRepository";
import {
  ApiOrderRepository,
  type OrderRepository,
} from "../data/orderRepository";
import type { Order } from "../data/models";
import { parseOrder } from "../data/orderRepository";

const row = (id: number, type = "takeaway", table: number | null = null) =>
  parseOrder({
    order_id: id,
    store_id: 1,
    store_name: "실제 매장",
    ordered_at: new Date().toISOString(),
    order_type: type,
    table_no: table,
    quantity: 2,
  });
const detail = (id: number): Order => ({
  ...row(id),
  items: [
    {
      item_id: 1,
      menu_id: 1,
      menu_name: "제육덮밥",
      quantity: 2,
      options: [
        { option_id: 1, name: "밥 추가" },
        { option_id: 2, name: "계란 추가" },
      ],
    },
  ],
});
async function open(
  repository: AdminRepository = new MockAdminRepository(),
  orders: OrderRepository | null = null,
) {
  const user = userEvent.setup();
  render(<App deviceRepository={null} ownerRepository={null} storeRepository={null} repository={repository} orderRepository={orders} />);
  await screen.findByRole("heading", { level: 1, name: "운영 요약" });
  return user;
}
const nav = (name: string) =>
  within(screen.getByRole("navigation", { name: "주요 화면" })).getByRole(
    "button",
    { name },
  );
const search = () => screen.getByRole("textbox");

describe("six screens and Flutter behaviour parity", () => {
  it("shows all metrics and opens dashboard Mock order/store details and destination filters", async () => {
    const user = await open();
    expect(screen.getByText("6곳")).toBeInTheDocument();
    expect(screen.getByText("최근 7일 주문")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "주문 상세: #1008" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("옵션: 샷 추가");
    await user.keyboard("{Escape}");
    await user.click(
      screen.getByRole("button", { name: "매장 상세: 온기 분식" }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("담당자 및 점주 연결");
    await user.click(screen.getByRole("button", { name: "닫기" }));
    await user.click(screen.getByRole("button", { name: "미연결 매장 보기" }));
    expect(
      screen.getByRole("heading", { name: "매장 목록 · 2곳" }),
    ).toBeInTheDocument();
  });
  it("combines store searches and type/connection filters, details, empty state, reset and paging", async () => {
    const user = await open();
    await user.click(nav("매장 관리"));
    await user.click(screen.getByRole("button", { name: "다음 페이지" }));
    expect(screen.getByText("6–6 / 6건")).toBeInTheDocument();
    await user.type(search(), "말로 카페 성수");
    expect(screen.getByText("1–1 / 1건")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "매장 상세: 말로 카페 성수" }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("mallo_cafe");
    expect(screen.getByRole("dialog")).toHaveTextContent("04782");
    await user.keyboard("{Escape}");
    await user.clear(search());
    await user.type(search(), "없는 매장");
    expect(screen.getByText(/조건에 맞는 결과가 없습니다/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "초기화" }));
    await user.selectOptions(screen.getByLabelText("업종"), "카페");
    expect(screen.getByText("매장 목록 · 2곳")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("점주 연결"), "미연결");
    expect(screen.getByText(/조건에 맞는 결과/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "초기화" }));
    await user.type(search(), "0000000001");
    expect(screen.getByText("매장 목록 · 1곳")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "검색어 지우기" }));
    expect(screen.getByText("매장 목록 · 6곳")).toBeInTheDocument();
  });
  it("keeps one owner with multiple stores and owner without connected stores", async () => {
    const user = await open();
    await user.click(nav("점주 계정"));
    await user.type(search(), "mallo_cafe");
    await user.click(
      screen.getByRole("button", { name: "연결 매장: mallo_cafe" }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("연결 매장 · 2곳");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "초기화" }));
    await user.selectOptions(screen.getByLabelText("매장 연결"), "미연결");
    await user.click(
      screen.getByRole("button", { name: "연결 매장: new_owner" }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "연결된 매장이 없습니다.",
    );
  });
  it("keeps fixed Mock order periods, combined store/search filters and single-option details", async () => {
    const user = await open();
    await user.click(nav("주문 조회"));
    await screen.findByText("주문 목록 · 6건");
    await user.selectOptions(screen.getByLabelText("조회 기간"), "1");
    expect(screen.getByText("주문 목록 · 3건")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("매장"), "2");
    expect(screen.getByText("주문 목록 · 1건")).toBeInTheDocument();
    await user.type(search(), "1008");
    expect(screen.getByText(/조건에 맞는 결과/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "초기화" }));
    await user.type(search(), "1008");
    await user.click(screen.getByRole("button", { name: "주문 상세: #1008" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("아메리카노 · 2개");
    expect(screen.getByRole("dialog")).toHaveTextContent("옵션: 샷 추가");
  });
  it("keeps device search/filter combinations, empty state, no connection history and related alerts", async () => {
    const user = await open();
    await user.click(nav("기기 관리"));
    await user.selectOptions(screen.getByLabelText("연결 상태"), "오프라인");
    expect(screen.getByText("기기 목록 · 3대")).toBeInTheDocument();
    await user.type(search(), "VK-SEO-006");
    expect(screen.getByText("연결 이력 없음")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "기기 상세: VK-SEO-006" }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("AL-1001");
    await user.keyboard("{Escape}");
    await user.selectOptions(screen.getByLabelText("설치 매장"), "1");
    expect(screen.getByText(/조건에 맞는 결과/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "초기화" }));
    expect(screen.getByText("기기 목록 · 6대")).toBeInTheDocument();
  });
  it("combines alert filters and resets results", async () => {
    const user = await open();
    await user.click(nav("장애/알림"));
    await user.selectOptions(
      screen.getByLabelText("알림 유형"),
      "updateRequired",
    );
    expect(screen.getByText("알림 목록 · 1건")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("확인 상태"), "resolved");
    expect(screen.getByText(/조건에 맞는 결과/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "초기화" }));
    expect(screen.getByText("알림 목록 · 6건")).toBeInTheDocument();
  });
  it("acknowledges in memory across navigation without changing device connectivity or resolving the alert", async () => {
    const user = await open();
    await user.click(nav("장애/알림"));
    await user.type(search(), "AL-1006");
    await user.click(
      screen.getByRole("button", { name: "알림 상세: AL-1006" }),
    );
    await user.click(screen.getByRole("button", { name: "확인 완료로 표시" }));
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toHaveTextContent("확인 시각"),
    );
    expect(
      screen.queryByRole("button", { name: "확인 완료로 표시" }),
    ).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(nav("기기 관리"));
    await user.type(search(), "VK-SEO-002");
    expect(screen.getByRole("table")).toHaveTextContent("오프라인");
    await user.click(nav("장애/알림"));
    await user.type(search(), "AL-1006");
    expect(screen.getByRole("table")).toHaveTextContent("확인 완료");
  });
  it("shows acknowledgement failure and permits retry", async () => {
    const repository = new MockAdminRepository();
    const ack = vi
      .spyOn(repository, "acknowledgeAlert")
      .mockRejectedValueOnce(new Error("fail"));
    const user = await open(repository);
    await user.click(nav("장애/알림"));
    await user.type(search(), "AL-1006");
    await user.click(
      screen.getByRole("button", { name: "알림 상세: AL-1006" }),
    );
    await user.click(screen.getByRole("button", { name: "확인 완료로 표시" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "확인 처리에 실패",
    );
    await user.click(screen.getByRole("button", { name: "확인 완료로 표시" }));
    await screen.findByText("확인 시각");
    expect(ack).toHaveBeenCalledTimes(2);
  });
  it("handles Mock repository load failures, retry and asynchronous loading", async () => {
    const repository = new MockAdminRepository();
    vi.spyOn(repository, "load").mockRejectedValueOnce(new Error("fail"));
    const user = userEvent.setup();
    render(<App deviceRepository={null} ownerRepository={null} storeRepository={null} repository={repository} orderRepository={null} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    await screen.findByText("데이터를 불러오지 못했습니다.");
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    await screen.findByRole("heading", { level: 1, name: "운영 요약" });
  });
  it("opens mobile menu, closes it on navigation and modal Escape restores focus", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "메뉴 열기" }));
    expect(screen.getByRole("button", { name: "메뉴 열기" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await user.click(nav("매장 관리"));
    expect(screen.getByRole("button", { name: "메뉴 열기" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    const button = screen.getByRole("button", {
      name: "매장 상세: 말로 카페 성수",
    });
    await user.click(button);
    await user.keyboard("{Escape}");
    expect(button).toHaveFocus();
  });
});

describe("live order UI, no Mock substitution", () => {
  it("uses actual Repository data, filters by time/store/id and displays multiple options and legacy types", async () => {
    const repo: OrderRepository = {
      load: vi
        .fn()
        .mockResolvedValue([
          row(1),
          row(2, "dine_in", 3),
          {
            ...row(3),
            store_id: 2,
            store_name: "다른 매장",
            ordered_at: new Date(Date.now() - 10 * 86400000).toISOString(),
          },
        ]),
      detail: vi.fn().mockResolvedValue(detail(1)),
    };
    const user = await open(new MockAdminRepository(), repo);
    await user.click(nav("주문 조회"));
    await screen.findByText("실제 주문 목록 · 2건");
    expect(screen.getByText("실제 주문 API")).toBeInTheDocument();
    expect(screen.getByText("매장 식사 / 테이블 3번")).toBeInTheDocument();
    await user.type(search(), "1");
    await user.click(screen.getByRole("button", { name: "주문 상세: #1" }));
    await screen.findByText("옵션: 밥 추가, 계란 추가");
    expect(repo.detail).toHaveBeenCalledWith(1, expect.any(AbortSignal));
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "초기화" }));
    await user.selectOptions(screen.getByLabelText("조회 기간"), "0");
    expect(screen.getByText("실제 주문 목록 · 3건")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("매장"), "2");
    expect(screen.getByText("실제 주문 목록 · 1건")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "새로고침" }));
    await waitFor(() => expect(repo.load).toHaveBeenCalledTimes(2));
  });
  it("supports NULL table dine-in without displaying an invented table number", async () => {
    const repo: OrderRepository = {
      load: async () => [row(4, "dine_in")],
      detail: async () => ({ ...detail(4), order_type: "dine_in" }),
    };
    const user = await open(new MockAdminRepository(), repo);
    await user.click(nav("주문 조회"));
    await screen.findByText("실제 주문 목록 · 1건");
    expect(screen.getByRole("table")).toHaveTextContent("매장 식사");
    expect(screen.getByRole("table")).not.toHaveTextContent("테이블 null");
  });
  it("shows API loading, failure and retry instead of Mock orders", async () => {
    const repo: OrderRepository = {
      load: vi
        .fn()
        .mockRejectedValueOnce(new Error("fail"))
        .mockResolvedValue([]),
      detail: async () => detail(1),
    };
    const user = await open(new MockAdminRepository(), repo);
    await user.click(nav("주문 조회"));
    await screen.findByRole("alert");
    expect(screen.queryByText("#1008")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Mock 데이터로 대체하지 않습니다",
    );
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    await screen.findByText("실제 주문 목록 · 0건");
    expect(screen.getByText(/조건에 맞는 결과/)).toBeInTheDocument();
  });
  it("shows detail loading/failure and permits retry", async () => {
    let finish!: (value: Order) => void;
    const repo: OrderRepository = {
      load: async () => [row(1)],
      detail: vi
        .fn()
        .mockRejectedValueOnce(new Error("fail"))
        .mockImplementationOnce(
          () =>
            new Promise<Order>((resolve) => {
              finish = resolve;
            }),
        ),
    };
    const user = await open(new MockAdminRepository(), repo);
    await user.click(nav("주문 조회"));
    await screen.findByText("실제 주문 목록 · 1건");
    await user.click(screen.getByRole("button", { name: "주문 상세: #1" }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(screen.getByRole("status")).toHaveTextContent("주문 상세");
    finish(detail(1));
    await screen.findByText("옵션: 밥 추가, 계란 추가");
  });
  it("connects UI to fetch GET list/detail requests with the unmodified FastAPI JSON contract", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ orders: [row(1)], total: 1 })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(detail(1))));
    const user = await open(
      new MockAdminRepository(),
      new ApiOrderRepository("http://localhost:8001", transport),
    );
    await user.click(nav("주문 조회"));
    await screen.findByText("실제 주문 목록 · 1건");
    await user.click(screen.getByRole("button", { name: "주문 상세: #1" }));
    await screen.findByText("옵션: 밥 추가, 계란 추가");
    expect(transport.mock.calls.map((c) => c[0])).toEqual([
      "http://localhost:8001/admin/orders?limit=200&offset=0",
      "http://localhost:8001/admin/orders/1",
    ]);
  });
});
