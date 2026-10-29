import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { MockOwnerRepository } from "../data/ownerRepository";

async function openMenus(repository = new MockOwnerRepository()) {
  const user = userEvent.setup();
  render(<App repository={repository} />);
  await screen.findByRole("heading", { level: 1, name: "오늘 현황" });
  await user.click(screen.getByRole("button", { name: /메뉴 관리/ }));
  return { user, repository };
}
const preview = () => screen.getByRole("region", { name: "키오스크 미리보기" });
const rail = () =>
  within(preview()).getByRole("navigation", { name: "키오스크 카테고리" });
const card = (name: string) =>
  within(preview()).getByRole("button", { name: new RegExp(`^${name}`) });

describe("메뉴 관리 미리보기", () => {
  it("판매 중인 메뉴를 순서대로 그리고 품절 카드를 표시한다", async () => {
    await openMenus();
    const cards = within(preview())
      .getAllByRole("button", { pressed: false })
      .filter((b) => b.classList.contains("kiosk-card"));
    expect(cards).toHaveLength(14);
    expect(cards[0]).toHaveTextContent("제육덮밥9,000원");
    expect(card("사이다")).toHaveTextContent("품절");
    expect(card("사이다")).toHaveClass("sold-out");
    expect(within(preview()).getByText("전체 메뉴")).toBeInTheDocument();
    expect(
      within(preview()).getByText("메뉴를 눌러 수량을 선택해 주세요."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "메뉴를 선택해 주세요" }),
    ).toBeInTheDocument();
  });

  it("카테고리를 누르면 그 카테고리 메뉴만 보이고 카테고리 편집이 열린다", async () => {
    const { user } = await openMenus();
    await user.click(within(rail()).getByRole("button", { name: "국물" }));
    expect(
      within(rail()).getByRole("button", { name: "국물" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(preview())
        .getAllByRole("button")
        .filter((b) => b.classList.contains("kiosk-card"))
        .map((b) => b.textContent),
    ).toEqual(["순두부찌개8,500원", "콩나물국밥7,500원"]);
    expect(screen.getByLabelText("카테고리 이름")).toHaveValue("국물");
  });
});

describe("메뉴 편집", () => {
  it("카드를 누르면 선택 표시와 편집 폼이 열린다", async () => {
    const { user } = await openMenus();
    await user.click(card("제육덮밥"));
    expect(card("제육덮밥")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("메뉴 이름")).toHaveValue("제육덮밥");
    expect(screen.getByLabelText("가격(원)")).toHaveValue("9000");
    expect(screen.getByLabelText("설명")).toHaveValue(
      "매콤한 제육과 따뜻한 밥",
    );
    expect(screen.getByLabelText("카테고리")).toHaveDisplayValue("식사");
    expect(
      screen.getByRole("switch", { name: "키오스크에서 판매" }),
    ).toBeChecked();
    await user.click(screen.getByRole("button", { name: "선택 해제" }));
    expect(card("제육덮밥")).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("heading", { name: "메뉴를 선택해 주세요" }),
    ).toBeInTheDocument();
  });

  it("이름과 가격을 입력하는 대로 미리보기 카드가 바뀐다", async () => {
    const { user, repository } = await openMenus();
    await user.click(card("제육덮밥"));
    const name = screen.getByLabelText("메뉴 이름");
    await user.clear(name);
    await user.type(name, "매운 제육");
    expect(card("매운 제육")).toHaveTextContent("매운 제육9,000원");
    const price = screen.getByLabelText("가격(원)");
    await user.clear(price);
    await user.type(price, "12,500");
    expect(card("매운 제육")).toHaveTextContent("12,500원");
    // 잘못된 가격은 오류를 보이고 미리보기는 마지막 올바른 값을 유지한다.
    await user.clear(price);
    await user.type(price, "0");
    expect(price).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByText(/1원부터 1,000,000원까지 숫자로/),
    ).toBeInTheDocument();
    expect(card("매운 제육")).toHaveTextContent("12,500원");
    // 품절 외 편집은 아직 저장하지 않는다(3단계 저장 바).
    expect((await repository.getMenuBoard()).menus[0].name).toBe("제육덮밥");
  });

  it("메뉴 이름은 50자, 설명은 500자를 넘지 않고 빈 이름은 오류를 보인다", async () => {
    const { user } = await openMenus();
    await user.click(card("만두"));
    const name = screen.getByLabelText("메뉴 이름");
    await user.clear(name);
    expect(screen.getByText("메뉴 이름을 입력해 주세요.")).toBeInTheDocument();
    await user.click(name);
    await user.paste("가".repeat(60));
    expect(name).toHaveValue("가".repeat(50));
    expect(screen.getByText("50/50")).toBeInTheDocument();
    expect(screen.getByLabelText("설명")).toHaveAttribute("maxLength", "500");
  });

  it("카테고리를 바꾸면 미리보기에서 그 카테고리로 옮겨 간다", async () => {
    const { user } = await openMenus();
    await user.click(within(rail()).getByRole("button", { name: "사이드" }));
    await user.click(card("만두"));
    await user.selectOptions(screen.getByLabelText("카테고리"), "분식");
    expect(
      within(rail()).getByRole("button", { name: "분식" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(card("만두")).toHaveAttribute("aria-pressed", "true");
    expect(preview().querySelector(".kiosk-heading strong")).toHaveTextContent(
      "분식",
    );
    expect(card("떡볶이")).toBeInTheDocument();
  });

  it("판매를 끄면 미리보기에서 사라지고 판매 중지 목록에서 다시 열 수 있다", async () => {
    const { user } = await openMenus();
    await user.click(card("콜라"));
    await user.click(screen.getByRole("switch", { name: "키오스크에서 판매" }));
    expect(
      within(preview()).queryByRole("button", { name: /^콜라/ }),
    ).toBeNull();
    expect(
      screen.getByText(/판매 중지 상태라 키오스크에 보이지 않습니다/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "선택 해제" }));
    const stopped = screen.getByRole("region", { name: "판매 중지 메뉴" });
    await user.click(within(stopped).getByRole("button", { name: "콜라" }));
    expect(screen.getByLabelText("메뉴 이름")).toHaveValue("콜라");
  });
});

describe("옵션 편집", () => {
  it("옵션을 추가하고 수정하고 삭제한다", async () => {
    const { user } = await openMenus();
    await user.click(card("만두"));
    const options = screen.getByRole("region", { name: "옵션" });
    expect(
      within(options)
        .getAllByRole("listitem")
        .map((li) => li.getAttribute("aria-label")),
    ).toEqual(["소스 추가"]);

    const addName = within(options).getAllByLabelText("옵션 이름").at(-1)!;
    const addPrice = within(options).getAllByLabelText("추가 금액(원)").at(-1)!;
    await user.click(within(options).getByRole("button", { name: "추가" }));
    expect(
      within(options).getByText("옵션 이름을 입력해 주세요."),
    ).toBeInTheDocument();
    await user.type(addName, "만두 추가");
    await user.clear(addPrice);
    await user.type(addPrice, "-1");
    await user.click(within(options).getByRole("button", { name: "추가" }));
    expect(
      within(options).getByText(/추가 금액은 0원부터/),
    ).toBeInTheDocument();
    await user.clear(addPrice);
    await user.type(addPrice, "2000");
    await user.click(within(options).getByRole("button", { name: "추가" }));
    const added = within(options).getByRole("listitem", { name: "만두 추가" });
    expect(added).toHaveTextContent("+2,000원");
    expect(within(added).getByRole("switch")).toHaveAccessibleName(
      "품절 (새 옵션)",
    );
    expect(addName).toHaveValue("");

    await user.click(
      within(options).getByRole("button", { name: "만두 추가 수정" }),
    );
    const editing = within(options).getByRole("listitem", {
      name: "만두 추가 수정",
    });
    const editName = within(editing).getByLabelText("옵션 이름");
    await user.clear(editName);
    await user.type(editName, "만두 2개 추가");
    await user.click(
      within(editing).getByRole("button", { name: "수정 완료" }),
    );
    expect(
      within(options).getByRole("listitem", { name: "만두 2개 추가" }),
    ).toBeInTheDocument();

    await user.click(
      within(options).getByRole("button", { name: "소스 추가 삭제" }),
    );
    await user.click(
      within(options).getByRole("button", { name: "만두 2개 추가 삭제" }),
    );
    expect(
      within(options).getByText("등록된 옵션이 없습니다."),
    ).toBeInTheDocument();
  });
});

describe("카테고리 추가와 삭제", () => {
  it("＋를 누르면 레일에서 바로 이름을 입력해 새 카테고리를 만든다", async () => {
    const { user } = await openMenus();
    await user.click(
      within(rail()).getByRole("button", { name: "카테고리 추가" }),
    );
    const input = within(rail()).getByRole("textbox", {
      name: "새 카테고리 이름",
    });
    expect(input).toHaveFocus();
    await user.type(input, "주류{Enter}");
    const created = within(rail()).getByRole("button", { name: "주류" });
    expect(created).toHaveAttribute("aria-pressed", "true");
    expect(created).toHaveClass("empty");
    expect(
      within(preview()).getByText("등록된 메뉴가 없습니다."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("카테고리 이름")).toHaveValue("주류");
    expect(
      screen.getByText(/실제 키오스크에는 이 카테고리가 보이지 않습니다/),
    ).toBeInTheDocument();
    // 메뉴 편집의 카테고리 선택에도 나온다.
    await user.click(within(rail()).getByRole("button", { name: "전체" }));
    await user.click(card("콜라"));
    expect(
      within(screen.getByLabelText("카테고리")).getByRole("option", {
        name: "주류",
      }),
    ).toBeInTheDocument();
  });

  it("이름 없이 끝내면 새 카테고리를 만들지 않는다", async () => {
    const { user } = await openMenus();
    await user.click(
      within(rail()).getByRole("button", { name: "카테고리 추가" }),
    );
    await user.keyboard("{Escape}");
    expect(within(rail()).queryByRole("textbox")).toBeNull();
    expect(within(rail()).getAllByRole("button")).toHaveLength(13); // 전체 + 11개 + ＋
    expect(
      within(rail()).getByRole("button", { name: "전체" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("메뉴가 남은 카테고리는 삭제를 막고 이유를 알려 준다", async () => {
    const { user } = await openMenus();
    await user.click(within(rail()).getByRole("button", { name: "식사" }));
    await user.click(screen.getByRole("button", { name: "카테고리 삭제" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "메뉴 2개가 남아 있어 삭제할 수 없습니다.",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("ON DELETE");
    expect(
      within(rail()).getByRole("button", { name: "식사" }),
    ).toBeInTheDocument();
  });

  it("빈 카테고리는 삭제할 수 있다", async () => {
    const { user } = await openMenus();
    await user.click(
      within(rail()).getByRole("button", { name: "카테고리 추가" }),
    );
    await user.type(within(rail()).getByRole("textbox"), "임시{Enter}");
    await user.click(screen.getByRole("button", { name: "카테고리 삭제" }));
    expect(within(rail()).queryByRole("button", { name: "임시" })).toBeNull();
    expect(
      screen.getByRole("heading", { name: "메뉴를 선택해 주세요" }),
    ).toBeInTheDocument();
  });
});

describe("품절 즉시 반영", () => {
  it("품절 스위치는 누르는 즉시 repository와 사이드바 배지에 반영된다", async () => {
    const { user, repository } = await openMenus();
    const spy = vi.spyOn(repository, "setMenuSoldOut");
    await user.click(card("콜라"));
    const toggle = screen.getByRole("switch", { name: "품절 (즉시 반영)" });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    expect(spy).toHaveBeenCalledWith(6, true);
    expect(toggle).toBeChecked();
    expect(card("콜라")).toHaveTextContent("품절");
    expect(
      (await repository.getMenuBoard()).menus.find((m) => m.id === 6)
        ?.isSoldOut,
    ).toBe(true);
    expect(screen.getByLabelText("품절 2개")).toBeInTheDocument();
    await user.click(toggle);
    expect(
      (await repository.getMenuBoard()).menus.find((m) => m.id === 6)
        ?.isSoldOut,
    ).toBe(false);
    expect(screen.getByLabelText("품절 1개")).toBeInTheDocument();
  });

  it("다른 화면에 다녀와도 즉시 반영한 품절은 유지된다", async () => {
    const { user } = await openMenus();
    await user.click(card("사이다"));
    await user.click(screen.getByRole("switch", { name: "품절 (즉시 반영)" }));
    await user.click(screen.getByRole("button", { name: "오늘 현황" }));
    expect(screen.queryByLabelText(/품절 \d개/)).toBeNull();
    await user.click(screen.getByRole("button", { name: /메뉴 관리/ }));
    expect(card("사이다")).not.toHaveTextContent("품절");
  });

  it("저장된 옵션 품절도 즉시 반영된다", async () => {
    const { user, repository } = await openMenus();
    await user.click(card("만두"));
    const row = screen.getByRole("listitem", { name: "소스 추가" });
    await user.click(
      within(row).getByRole("switch", { name: "품절 (즉시 반영)" }),
    );
    expect(
      (await repository.getMenuBoard()).options.find((o) => o.id === 10)
        ?.isSoldOut,
    ).toBe(true);
  });

  it("반영에 실패하면 오류를 보이고 상태를 바꾸지 않는다", async () => {
    const repository = new MockOwnerRepository();
    vi.spyOn(repository, "setMenuSoldOut").mockRejectedValueOnce(
      new Error("실패"),
    );
    const { user } = await openMenus(repository);
    await user.click(card("콜라"));
    const toggle = screen.getByRole("switch", { name: "품절 (즉시 반영)" });
    await user.click(toggle);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "품절 상태를 바꾸지 못했습니다.",
    );
    expect(toggle).not.toBeChecked();
    expect(card("콜라")).not.toHaveTextContent("품절");
    expect(screen.getByLabelText("품절 1개")).toBeInTheDocument();
  });
});
