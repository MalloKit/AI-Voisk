import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { MockOwnerRepository } from "../data/ownerRepository";

const sidebar = () => screen.getByRole("navigation", { name: "주요 화면" });
async function open(page?: string, repository = new MockOwnerRepository()) {
  const user = userEvent.setup();
  render(<App repository={repository} />);
  await screen.findByRole("heading", { level: 1, name: "오늘 현황" });
  if (page)
    await user.click(
      within(sidebar()).getByRole("button", { name: new RegExp(page) }),
    );
  return { user, repository };
}

describe("오늘 현황", () => {
  it("오늘 주문·매출·품절·판매 중지 숫자를 보여 준다", async () => {
    await open();
    const metrics = await screen.findByText("오늘 주문");
    const cards = metrics.closest(".metrics")!;
    expect(cards).toHaveTextContent("오늘 주문4건포장 2건 · 매장 식사 2건");
    expect(cards).toHaveTextContent("오늘 매출53,500원어제 22,000원");
    expect(cards).toHaveTextContent("판매 중지 메뉴0개");
    const soldOut = screen.getByRole("button", {
      name: "품절 메뉴 1개, 메뉴 관리로 이동",
    });
    expect(soldOut).toHaveClass("attention");
  });

  it("품절 카드를 누르면 메뉴 관리로 간다", async () => {
    const { user } = await open();
    await user.click(
      await screen.findByRole("button", { name: /품절 메뉴 1개/ }),
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "메뉴 관리" }),
    ).toBeInTheDocument();
  });

  it("키오스크가 끊기면 빨간 강조로 알려 준다", async () => {
    await open();
    const list = await screen.findByRole("list", { name: "키오스크 목록" });
    const card = list.closest(".card")!;
    expect(card).toHaveClass("attention-card");
    expect(card).toHaveTextContent("연결 끊김 1대");
    expect(within(list).getAllByRole("listitem")[1]).toHaveTextContent(
      "키오스크 2번연결 끊김마지막 연결 10:30",
    );
  });

  it("모든 키오스크가 연결되면 정상으로 보인다", async () => {
    const repository = new MockOwnerRepository();
    const devices = await repository.getDevices();
    vi.spyOn(repository, "getDevices").mockResolvedValue(
      devices.map((d) => ({ ...d, connection: "online" as const })),
    );
    await open(undefined, repository);
    const list = await screen.findByRole("list", { name: "키오스크 목록" });
    expect(list.closest(".card")).not.toHaveClass("attention-card");
    expect(list.closest(".card")).toHaveTextContent("모두 정상 (2대)");
  });

  it("품절 메뉴와 옵션을 판매 재개하면 즉시 반영된다", async () => {
    const repository = new MockOwnerRepository();
    await repository.setOptionSoldOut(10, true); // 만두 · 소스 추가
    const { user } = await open(undefined, repository);
    const list = await screen.findByRole("list", { name: "품절 목록" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["메뉴사이다판매 재개", "옵션만두 · 소스 추가판매 재개"]);

    await user.click(screen.getByRole("button", { name: "사이다 판매 재개" }));
    expect(
      (await repository.getMenuBoard()).menus.find((m) => m.name === "사이다")
        ?.isSoldOut,
    ).toBe(false);
    expect(within(sidebar()).queryByLabelText(/품절/)).toBeNull();
    expect(
      screen.getByRole("button", { name: /품절 메뉴 0개/ }),
    ).not.toHaveClass("attention");

    await user.click(
      screen.getByRole("button", { name: "만두 · 소스 추가 판매 재개" }),
    );
    expect(
      (await repository.getMenuBoard()).options.find((o) => o.id === 10)
        ?.isSoldOut,
    ).toBe(false);
    expect(
      screen.getByText("지금 품절인 메뉴와 옵션이 없습니다."),
    ).toBeInTheDocument();
  });

  it("오늘 많이 팔린 메뉴 TOP 5를 수량과 매출로 보여 준다", async () => {
    await open();
    const top = await screen.findByRole("list", {
      name: "오늘 많이 팔린 메뉴 TOP 5",
    });
    expect(
      within(top)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([
      "1순두부찌개2개22,000원",
      "2콜라2개4,000원",
      "3제육덮밥1개11,000원",
      "4콩나물국밥1개7,500원",
      "5떡볶이1개5,000원",
    ]);
  });

  it("최근 주문 5건을 보여 주고 전체 보기로 주문 내역에 간다", async () => {
    const { user } = await open();
    const recent = await screen.findByRole("list", { name: "최근 주문 5건" });
    expect(
      within(recent)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual([
      "주문 #20 상세",
      "주문 #19 상세",
      "주문 #18 상세",
      "주문 #17 상세",
      "주문 #16 상세",
    ]);
    await user.click(
      within(recent).getByRole("button", { name: "주문 #18 상세" }),
    );
    expect(screen.getByRole("dialog", { name: "주문 #18" })).toHaveTextContent(
      "15,000원",
    );
    await user.click(screen.getByRole("button", { name: "닫기" }));
    await user.click(screen.getByRole("button", { name: "전체 보기" }));
    expect(
      screen.getByRole("heading", { level: 1, name: "주문 내역" }),
    ).toBeInTheDocument();
  });
});

describe("주문 내역", () => {
  const summary = () => document.querySelector(".result-summary");
  const rows = () =>
    within(screen.getByRole("table"))
      .getAllByRole<HTMLTableRowElement>("row")
      .slice(1);

  it("기본은 최근 7일이고 건수와 합계, 표 칸을 보여 준다", async () => {
    await open("주문 내역");
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(summary()).toHaveTextContent("9건 · 합계 130,000원");
    expect(
      within(screen.getByRole("table"))
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual(["주문번호", "주문 시각", "구분", "메뉴", "수량", "금액"]);
    expect(rows()[2]).toHaveTextContent(
      "#182026-10-29 10:05매장 식사제육덮밥 외 1건2개15,000원",
    );
  });

  it("기간, 구분, 주문번호로 걸러 낸다", async () => {
    const { user } = await open("주문 내역");
    await screen.findByRole("table");
    await user.selectOptions(screen.getByLabelText("기간"), "오늘");
    expect(summary()).toHaveTextContent("4건 · 합계 53,500원");
    await user.selectOptions(screen.getByLabelText("구분"), "포장");
    expect(summary()).toHaveTextContent("2건 · 합계 16,500원");
    expect(rows().map((r) => r.cells[0].textContent)).toEqual(["#20", "#17"]);

    await user.selectOptions(screen.getByLabelText("기간"), "전체");
    await user.selectOptions(screen.getByLabelText("구분"), "전체");
    await user.type(screen.getByLabelText("주문번호 검색"), "#3");
    expect(summary()).toHaveTextContent("2건");
    expect(rows().map((r) => r.cells[0].textContent)).toEqual(["#13", "#3"]);

    await user.clear(screen.getByLabelText("주문번호 검색"));
    await user.type(screen.getByLabelText("주문번호 검색"), "999");
    expect(summary()).toHaveTextContent("0건 · 합계 0원");
    expect(screen.getByText(/조건에 맞는 주문이 없습니다/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "초기화" }));
    expect(summary()).toHaveTextContent("9건");
    expect(screen.getByLabelText("주문번호 검색")).toHaveValue("");
  });

  it("행을 누르면 품목·옵션·합계 상세와 가격 기준 안내를 보여 준다", async () => {
    const { user } = await open("주문 내역");
    await screen.findByRole("table");
    await user.click(rows()[2]); // #18
    const dialog = screen.getByRole("dialog", { name: "주문 #18" });
    expect(dialog).toHaveTextContent("주문 시각2026-10-29 10:05");
    expect(dialog).toHaveTextContent("구분매장 식사");
    const items = within(dialog).getByRole("list", { name: "주문 품목" });
    const [first, second] = within(items)
      .getAllByRole("listitem")
      .filter((li) => li.parentElement === items);
    expect(first).toHaveTextContent("제육덮밥× 111,000원");
    expect(first).toHaveTextContent(
      "메뉴 가격9,000원+ 밥 추가1,000원+ 계란 추가1,000원",
    );
    expect(second).toHaveTextContent("만두× 14,000원");
    expect(dialog).toHaveTextContent("합계 (2개)15,000원");
    expect(dialog).toHaveTextContent("현재 메뉴 가격 기준");
  });

  it("주문번호 버튼으로도 상세를 연다(키보드)", async () => {
    const { user } = await open("주문 내역");
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "주문 #20 상세" }));
    expect(
      screen.getByRole("dialog", { name: "주문 #20" }),
    ).toBeInTheDocument();
  });

  it("불러오기에 실패하면 다시 시도할 수 있다", async () => {
    const repository = new MockOwnerRepository();
    const spy = vi
      .spyOn(repository, "getOrderHistory")
      .mockRejectedValue(new Error("실패"));
    const { user } = await open("주문 내역", repository);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "주문 내역을 불러오지 못했습니다.",
    );
    spy.mockRestore();
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });
});

describe("매장 정보", () => {
  it("매장 기본 정보를 보기 전용으로 보여 준다", async () => {
    await open("매장 정보");
    const info = screen.getByRole("heading", { level: 1, name: "매장 정보" })
      .parentElement!.parentElement!;
    for (const [label, value] of [
      ["매장 이름", "보이스크 테스트 매장"],
      ["업종", "음식점"],
      ["매장 코드", "T0001"],
      ["대표자", "테스트점주"],
      ["전화번호", "000-0000-0000"],
      ["사업자등록번호", "000-00-00000"],
      ["주소", "테스트 주소"],
    ])
      expect(
        within(info).getByText(label).nextElementSibling,
      ).toHaveTextContent(value);
    expect(within(info).queryByRole("textbox")).toBeNull();
    expect(info).toHaveTextContent(
      "정보 변경은 회사 관리자에게 요청해 주세요.",
    );
    expect(info).toHaveTextContent(
      "키오스크는 매장 번호(store_id) 1로 이 매장의 메뉴를 불러옵니다.",
    );
  });
});
