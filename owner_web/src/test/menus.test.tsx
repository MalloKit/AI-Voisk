import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { MockOwnerRepository } from "../data/ownerRepository";

async function openMenus(repository = new MockOwnerRepository()) {
  const user = userEvent.setup();
  render(<App repository={repository} />);
  await screen.findByRole("heading", { level: 1, name: "오늘 현황" });
  await user.click(
    within(screen.getByRole("navigation", { name: "주요 화면" })).getByRole(
      "button",
      { name: /메뉴 관리/ },
    ),
  );
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

  it("판매를 끄면 미리보기에서 사라지고 숨긴 메뉴 상자에서 다시 열 수 있다", async () => {
    const { user } = await openMenus();
    await user.click(card("콜라"));
    await user.click(screen.getByRole("switch", { name: "키오스크에서 판매" }));
    expect(
      within(preview()).queryByRole("button", { name: /^콜라/ }),
    ).toBeNull();
    expect(
      screen.getByText(/숨긴 메뉴라 키오스크에 보이지 않습니다/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "선택 해제" }));
    const hidden = screen.getByRole("region", { name: "숨긴 메뉴 1개" });
    await user.click(
      within(hidden).getByRole("button", { name: /^콜라 \(음료\)/ }),
    );
    expect(screen.getByLabelText("메뉴 이름")).toHaveValue("콜라");
  });
});

describe("옵션 편집", () => {
  it("옵션을 추가하고 수정하고 판매 중지한다", async () => {
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
      within(options).getByRole("button", { name: "소스 추가 판매 중지" }),
    );
    await user.click(
      within(options).getByRole("button", { name: "만두 2개 추가 판매 중지" }),
    );
    expect(
      within(options).getByText("등록된 옵션이 없습니다."),
    ).toBeInTheDocument();
  });

  const optionsRegion = () => screen.getByRole("region", { name: "옵션" });
  const saveBar = () => screen.getByRole("region", { name: "저장 바" });
  async function saveChanges(user: ReturnType<typeof userEvent.setup>) {
    await user.click(within(saveBar()).getByRole("button", { name: /^저장/ }));
    const dialog = screen.getByRole("dialog", { name: "변경 내용 저장" });
    const lines = within(dialog)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    await user.click(within(dialog).getByRole("button", { name: "저장" }));
    await within(saveBar()).findByText("모든 변경이 저장됨");
    return lines;
  }
  async function stopEgg(user: ReturnType<typeof userEvent.setup>) {
    await user.click(card("제육덮밥"));
    await user.click(
      within(optionsRegion()).getByRole("button", {
        name: "계란 추가 판매 중지",
      }),
    );
  }

  it("판매 중지 옵션을 접어 보여 주고 다시 판매도 저장 바로 저장한다", async () => {
    const { user, repository } = await openMenus();
    const spy = vi.spyOn(repository, "saveMenuBoard");
    const egg = async () =>
      (await repository.getMenuBoard()).options.find(
        (o) => o.name === "계란 추가",
      )!;
    await user.click(card("제육덮밥"));
    expect(
      within(optionsRegion()).queryByRole("button", {
        name: /판매 중지된 옵션/,
      }),
    ).toBeNull();
    await stopEgg(user);
    expect(await saveChanges(user)).toEqual([
      "제육덮밥: 옵션 판매 중지 (계란 추가)",
    ]);
    expect((await egg()).isActive).toBe(false);

    // 처음에는 접혀 있고, 눌러야 [다시 판매]가 보인다.
    const toggle = within(optionsRegion()).getByRole("button", {
      name: "판매 중지된 옵션 (1개)",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(
      within(optionsRegion()).queryByRole("button", {
        name: "계란 추가 다시 판매",
      }),
    ).toBeNull();
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    spy.mockClear();
    await user.click(
      within(optionsRegion()).getByRole("button", {
        name: "계란 추가 다시 판매",
      }),
    );
    // 즉시 저장하지 않는다. 옵션은 판매 목록으로 돌아오고 상자는 사라진다.
    expect(spy).not.toHaveBeenCalled();
    expect((await egg()).isActive).toBe(false);
    expect(saveBar()).toHaveTextContent("저장 안 된 변경 1건");
    expect(card("제육덮밥").querySelector(".unsaved-dot")).not.toBeNull();
    expect(
      within(optionsRegion()).getByRole("listitem", { name: "계란 추가" }),
    ).toBeInTheDocument();
    expect(
      within(optionsRegion()).queryByRole("button", {
        name: /판매 중지된 옵션/,
      }),
    ).toBeNull();

    expect(await saveChanges(user)).toEqual([
      "제육덮밥 옵션 '계란 추가' 다시 판매",
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].options.update).toEqual([
      expect.objectContaining({ name: "계란 추가", isActive: true }),
    ]);
    expect(spy.mock.calls[0][0].options.create).toEqual([]);
    expect((await egg()).isActive).toBe(true);
  });

  it("판매 중지 후 저장 전에 다시 판매하면 변경이 남지 않는다", async () => {
    const { user } = await openMenus();
    await stopEgg(user);
    expect(saveBar()).toHaveTextContent("저장 안 된 변경 1건");
    await user.click(
      within(optionsRegion()).getByRole("button", {
        name: "판매 중지된 옵션 (1개)",
      }),
    );
    expect(
      within(optionsRegion()).getByRole("listitem", {
        name: "계란 추가 · 저장 안 됨",
      }),
    ).toBeInTheDocument();
    await user.click(
      within(optionsRegion()).getByRole("button", {
        name: "계란 추가 다시 판매",
      }),
    );
    expect(saveBar()).toHaveTextContent("모든 변경이 저장됨");
  });

  it("판매 중지 옵션과 같은 이름을 추가하면 새로 만들지 않고 다시 판매를 안내한다", async () => {
    const { user } = await openMenus();
    await stopEgg(user);
    const region = within(optionsRegion());
    const addName = region.getAllByLabelText("옵션 이름").at(-1)!;
    await user.type(addName, " 계란 추가 ");
    await user.click(region.getByRole("button", { name: "추가" }));

    const notice = region.getByRole("alert");
    expect(notice).toHaveTextContent(
      "같은 이름의 판매 중지된 옵션이 있습니다. 다시 판매할까요?",
    );
    // 입력칸 기본값 0원과 달라 이전 금액을 알린다.
    expect(notice).toHaveTextContent("이전 추가 금액 +1,000원");

    // 취소하면 아무것도 바뀌지 않고 입력은 그대로 남는다.
    await user.click(within(notice).getByRole("button", { name: "취소" }));
    expect(region.queryByRole("alert")).toBeNull();
    expect(addName).toHaveValue(" 계란 추가 ");
    expect(saveBar()).toHaveTextContent("저장 안 된 변경 1건");

    // 이름을 바꾸면 안내가 사라지고 다른 이름은 그대로 추가된다.
    await user.click(region.getByRole("button", { name: "추가" }));
    expect(region.getByRole("alert")).toBeInTheDocument();
    await user.type(addName, "x");
    expect(region.queryByRole("alert")).toBeNull();
    await user.clear(addName);
    await user.type(addName, "계란 추가");
    await user.click(region.getByRole("button", { name: "추가" }));

    await user.click(
      within(region.getByRole("alert")).getByRole("button", {
        name: "다시 판매",
      }),
    );
    expect(region.queryByRole("alert")).toBeNull();
    expect(addName).toHaveValue("");
    const restored = region.getByRole("listitem", { name: "계란 추가" });
    expect(restored).toHaveTextContent("+1,000원");
    // 저장본과 같아졌으므로 새 행도, 저장할 변경도 없다.
    expect(saveBar()).toHaveTextContent("모든 변경이 저장됨");
  });
});

describe("옵션 그룹", () => {
  const optionsRegion = () => screen.getByRole("region", { name: "옵션" });
  const saveBar = () => screen.getByRole("region", { name: "저장 바" });
  const listNames = (name: string) =>
    within(within(optionsRegion()).getByRole("list", { name }))
      .getAllByRole("listitem")
      .map((li) => li.getAttribute("aria-label"));
  async function addOption(
    user: ReturnType<typeof userEvent.setup>,
    name: string,
    group: string,
  ) {
    const region = within(optionsRegion());
    await user.type(region.getAllByLabelText("옵션 이름").at(-1)!, name);
    if (group)
      await user.type(region.getAllByLabelText("옵션 그룹").at(-1)!, group);
    await user.click(region.getByRole("button", { name: "추가" }));
  }
  async function saveLines(user: ReturnType<typeof userEvent.setup>) {
    await user.click(within(saveBar()).getByRole("button", { name: /^저장/ }));
    const dialog = screen.getByRole("dialog", { name: "변경 내용 저장" });
    const lines = within(dialog)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    await user.click(within(dialog).getByRole("button", { name: "저장" }));
    await within(saveBar()).findByText("모든 변경이 저장됨");
    return lines;
  }

  it("같은 그룹 옵션을 묶어 보여 주고, 하나뿐인 그룹은 안내하며 그룹과 함께 저장한다", async () => {
    const { user, repository } = await openMenus();
    const spy = vi.spyOn(repository, "saveMenuBoard");
    await user.click(card("만두"));
    expect(
      within(optionsRegion()).getByLabelText("옵션 그룹"),
    ).toHaveAttribute("placeholder", "예: 맵기, 사이즈 (비우면 선택 추가 옵션)");

    await addOption(user, "순한맛", " 맵기 ");
    expect(listNames("맵기 그룹 옵션")).toEqual(["순한맛"]);
    expect(listNames("선택 추가 옵션")).toEqual(["소스 추가"]);
    // 필수 그룹이 선택 추가 옵션보다 앞에 온다.
    expect(
      within(optionsRegion())
        .getAllByRole("heading", { level: 4 })
        .map((h) => h.textContent),
    ).toEqual([
      "맵기필수, 1개 선택",
      "선택 추가 옵션고르지 않거나 여러 개 선택",
      "옵션 추가",
    ]);
    expect(optionsRegion()).toHaveTextContent(
      "'맵기' 그룹에 판매 중인 옵션이 1개뿐입니다.",
    );

    // 입력 제안에 이 메뉴의 그룹 이름이 나온다.
    const groupInput = within(optionsRegion()).getByLabelText("옵션 그룹");
    const datalist = document.getElementById(
      groupInput.getAttribute("list")!,
    )!;
    expect(
      [...datalist.querySelectorAll("option")].map((o) => o.value),
    ).toEqual(["맵기"]);

    await addOption(user, "매운맛", "맵기");
    expect(listNames("맵기 그룹 옵션")).toEqual(["순한맛", "매운맛"]);
    expect(optionsRegion()).not.toHaveTextContent("1개뿐입니다");

    expect(await saveLines(user)).toEqual([
      "만두: 옵션 추가 (맵기 · 순한맛)",
      "만두: 옵션 추가 (맵기 · 매운맛)",
    ]);
    expect(
      spy.mock.calls[0][0].options.create.map((o) => [o.name, o.optionGroup]),
    ).toEqual([
      ["순한맛", "맵기"],
      ["매운맛", "맵기"],
    ]);
    expect(
      (await repository.getMenuBoard()).options
        .filter((o) => o.optionGroup === "맵기")
        .map((o) => o.name),
    ).toEqual(["순한맛", "매운맛"]);
  });

  it("그룹만 바꿔도 저장할 변경으로 세고, 비우면 선택 추가 옵션으로 돌아간다", async () => {
    const { user, repository } = await openMenus();
    const spy = vi.spyOn(repository, "saveMenuBoard");
    await user.click(card("만두"));
    const region = within(optionsRegion());
    await user.click(region.getByRole("button", { name: "소스 추가 수정" }));
    const editing = within(
      region.getByRole("listitem", { name: "소스 추가 수정" }),
    );
    await user.type(editing.getByLabelText("옵션 그룹"), "소스");
    await user.click(editing.getByRole("button", { name: "수정 완료" }));
    expect(saveBar()).toHaveTextContent("저장 안 된 변경 1건");
    expect(listNames("소스 그룹 옵션")).toEqual(["소스 추가"]);

    expect(await saveLines(user)).toEqual([
      "만두: 옵션 그룹 변경 (소스 추가: 선택 추가 → 소스)",
    ]);
    expect(spy.mock.calls[0][0].options.update).toEqual([
      expect.objectContaining({ name: "소스 추가", optionGroup: "소스" }),
    ]);

    await user.click(region.getByRole("button", { name: "소스 추가 수정" }));
    const again = within(
      region.getByRole("listitem", { name: "소스 추가 수정" }),
    );
    expect(again.getByLabelText("옵션 그룹")).toHaveValue("소스");
    await user.clear(again.getByLabelText("옵션 그룹"));
    await user.type(again.getByLabelText("옵션 그룹"), "   ");
    await user.click(again.getByRole("button", { name: "수정 완료" }));
    expect(listNames("선택 추가 옵션")).toEqual(["소스 추가"]);
    expect(await saveLines(user)).toEqual([
      "만두: 옵션 그룹 변경 (소스 추가: 소스 → 선택 추가)",
    ]);
    expect(spy.mock.calls[1][0].options.update).toEqual([
      expect.objectContaining({ name: "소스 추가", optionGroup: null }),
    ]);
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
    await user.click(
      within(screen.getByRole("navigation", { name: "주요 화면" })).getByRole(
        "button",
        { name: /메뉴 관리/ },
      ),
    );
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
