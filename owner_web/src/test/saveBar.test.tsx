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
const card = (name: string | RegExp) =>
  within(preview()).getByRole("button", {
    name: typeof name === "string" ? new RegExp(`^${name}`) : name,
  });
const bar = () => screen.getByRole("region", { name: "저장 바" });
const barButton = (name: string) =>
  within(bar()).getByRole("button", { name: new RegExp(name) });
const nav = (name: string) =>
  within(screen.getByRole("navigation", { name: "주요 화면" })).getByRole(
    "button",
    { name: new RegExp(name) },
  );
async function rename(
  user: ReturnType<typeof userEvent.setup>,
  from: string,
  to: string,
) {
  await user.click(card(from));
  const name = screen.getByLabelText("메뉴 이름");
  await user.clear(name);
  await user.type(name, to);
}

describe("저장 바", () => {
  it("변경 건수와 주황 점을 보여 주고, 저장하면 모든 변경이 저장됨으로 바뀐다", async () => {
    const { user, repository } = await openMenus();
    expect(bar()).toHaveTextContent("모든 변경이 저장됨");
    expect(barButton("저장")).toBeDisabled();
    await rename(user, "제육덮밥", "매운 제육");
    expect(bar()).toHaveTextContent("저장 안 된 변경 1건");
    expect(card("매운 제육")).toHaveAccessibleName(
      "매운 제육 9,000원 · 저장 안 됨",
    );
    expect(card("매운 제육").querySelector(".unsaved-dot")).not.toBeNull();
    expect(card("비빔밥").querySelector(".unsaved-dot")).toBeNull();

    await user.click(barButton("^저장"));
    const dialog = screen.getByRole("dialog", { name: "변경 내용 저장" });
    expect(
      within(dialog)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["제육덮밥: 이름 변경 (→ 매운 제육)"]);
    // 확인 전에는 저장하지 않는다.
    expect((await repository.getMenuBoard()).menus[0].name).toBe("제육덮밥");
    await user.click(within(dialog).getByRole("button", { name: "저장" }));
    expect(await within(bar()).findByText("모든 변경이 저장됨")).toBeVisible();
    expect((await repository.getMenuBoard()).menus[0].name).toBe("매운 제육");
    expect(card("매운 제육").querySelector(".unsaved-dot")).toBeNull();
  });

  it("확인 창에서 이동·숨김 같은 변경 목록을 보여 주고 취소하면 저장하지 않는다", async () => {
    const { user, repository } = await openMenus();
    const spy = vi.spyOn(repository, "saveMenuBoard");
    await user.click(card("콜라"));
    await user.selectOptions(screen.getByLabelText("카테고리"), "식사");
    await user.click(card("만두"));
    await user.click(screen.getByRole("switch", { name: "키오스크에서 판매" }));
    expect(bar()).toHaveTextContent("저장 안 된 변경 2건");
    expect(
      screen.getByRole("region", { name: "숨긴 메뉴 1개" }),
    ).toHaveTextContent("만두");

    await user.click(barButton("^저장"));
    const dialog = screen.getByRole("dialog", { name: "변경 내용 저장" });
    expect(within(dialog).getByText("만두 숨김")).toBeInTheDocument();
    expect(
      within(dialog).getByText("콜라: 음료 → 식사 이동"),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    expect(bar()).toHaveTextContent("저장 안 된 변경 2건");
  });

  it("저장에 실패하면 안내하고 변경을 그대로 둔다", async () => {
    const { user, repository } = await openMenus();
    vi.spyOn(repository, "saveMenuBoard").mockRejectedValueOnce(
      new Error("실패"),
    );
    await rename(user, "만두", "고기만두");
    await user.click(barButton("^저장"));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "저장" }),
    );
    expect(await within(bar()).findByRole("alert")).toHaveTextContent(
      "저장하지 못했습니다",
    );
    expect(bar()).toHaveTextContent("저장 안 된 변경 1건");
    expect(card("고기만두")).toBeInTheDocument();
  });
});

describe("새 메뉴", () => {
  it("칩을 누르면 보고 있는 카테고리 맨 뒤에 빈 메뉴가 생기고 이름 칸에 커서가 간다", async () => {
    const { user } = await openMenus();
    await user.click(within(rail()).getByRole("button", { name: "분식" }));
    await user.click(screen.getByRole("button", { name: "새 메뉴" }));
    const cards = within(preview())
      .getAllByRole("button")
      .filter((b) => b.classList.contains("kiosk-card"));
    expect(cards.map((c) => c.getAttribute("aria-label"))).toEqual([
      "떡볶이 5,000원",
      "이름 입력 가격 입력 · 저장 안 됨",
    ]);
    expect(cards[1]).toHaveTextContent("이름 입력가격 입력");
    expect(cards[1]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("메뉴 이름")).toHaveFocus();
    expect(screen.getByLabelText("가격(원)")).toHaveValue("");
    expect(bar()).toHaveTextContent("저장 안 된 변경 1건");
  });

  it("이름이나 가격이 비어 있으면 저장을 막고 그 칸으로 안내한다", async () => {
    const { user, repository } = await openMenus();
    const spy = vi.spyOn(repository, "saveMenuBoard");
    await user.click(within(rail()).getByRole("button", { name: "분식" }));
    await user.click(screen.getByRole("button", { name: "새 메뉴" }));
    await user.click(within(rail()).getByRole("button", { name: "전체" }));

    await user.click(barButton("^저장"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(bar()).getByRole("alert")).toHaveTextContent(
      "이름이 빈 메뉴가 있습니다",
    );
    expect(screen.getByLabelText("메뉴 이름")).toHaveFocus();
    expect(card("이름 입력")).toHaveAttribute("aria-pressed", "true");

    await user.type(screen.getByLabelText("메뉴 이름"), "김밥");
    expect(within(bar()).queryByRole("alert")).toBeNull();
    await user.click(barButton("^저장"));
    expect(within(bar()).getByRole("alert")).toHaveTextContent(
      "'김밥'의 가격을 입력해 주세요",
    );
    expect(screen.getByLabelText("가격(원)")).toHaveFocus();

    await user.type(screen.getByLabelText("가격(원)"), "4000");
    await user.click(barButton("^저장"));
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText("새 메뉴: 김밥 (분식)"),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "저장" }));
    await within(bar()).findByText("모든 변경이 저장됨");
    expect(spy).toHaveBeenCalledTimes(1);
    const saved = await repository.getMenuBoard();
    const gimbap = saved.menus.find((m) => m.name === "김밥")!;
    expect(gimbap).toMatchObject({ price: 4000, sort: 2, isActive: true });
    // 저장 뒤에도 같은 메뉴가 선택된 채로 남는다.
    expect(card("김밥")).toHaveAttribute("aria-pressed", "true");
  });

  it("이름이 빈 카테고리가 있으면 저장을 막고 그 카테고리를 연다", async () => {
    const { user } = await openMenus();
    await user.click(
      within(rail()).getByRole("button", { name: "카테고리 추가" }),
    );
    await user.type(within(rail()).getByRole("textbox"), "주류{Enter}");
    await user.clear(screen.getByLabelText("카테고리 이름"));
    await user.click(within(rail()).getByRole("button", { name: "전체" }));
    await user.click(barButton("^저장"));
    expect(within(bar()).getByRole("alert")).toHaveTextContent(
      "이름이 빈 카테고리가 있습니다",
    );
    expect(screen.getByLabelText("카테고리 이름")).toHaveFocus();
  });
});

describe("변경 취소와 되돌리기", () => {
  it("변경 취소는 마지막 저장 상태로 돌리지만 품절은 되돌리지 않는다", async () => {
    const { user, repository } = await openMenus();
    await rename(user, "콜라", "제로 콜라");
    await user.click(screen.getByRole("switch", { name: "품절 (즉시 반영)" }));
    expect(card("제로 콜라")).toHaveTextContent("품절");
    expect(bar()).toHaveTextContent("저장 안 된 변경 1건");

    await user.click(barButton("변경 취소"));
    expect(bar()).toHaveTextContent("모든 변경이 저장됨");
    expect(screen.getByLabelText("메뉴 이름")).toHaveValue("콜라");
    expect(card("콜라")).toHaveTextContent("품절");
    expect(
      screen.getByRole("switch", { name: "품절 (즉시 반영)" }),
    ).toBeChecked();
    expect(
      (await repository.getMenuBoard()).menus.find((m) => m.id === 6),
    ).toMatchObject({ name: "콜라", isSoldOut: true });
    expect(screen.getByLabelText("품절 2개")).toBeInTheDocument();
  });

  it("되돌리기 버튼과 Ctrl+Z로 한 단계씩 되돌린다", async () => {
    const { user } = await openMenus();
    expect(barButton("되돌리기")).toBeDisabled();
    // 이름은 글자마다가 아니라 한 번에 되돌린다.
    await rename(user, "만두", "고기만두");
    await user.click(screen.getByRole("switch", { name: "키오스크에서 판매" }));
    expect(
      within(preview()).queryByRole("button", { name: /^고기만두/ }),
    ).toBeNull();

    await user.click(barButton("되돌리기"));
    expect(card("고기만두")).toBeInTheDocument();

    // 입력칸 안의 Ctrl+Z는 브라우저 기본 동작에 맡긴다.
    screen.getByLabelText("메뉴 이름").focus();
    await user.keyboard("{Control>}z{/Control}");
    expect(card("고기만두")).toBeInTheDocument();

    card("고기만두").focus();
    await user.keyboard("{Control>}z{/Control}");
    expect(card("만두")).toBeInTheDocument();
    expect(bar()).toHaveTextContent("모든 변경이 저장됨");
    expect(barButton("되돌리기")).toBeDisabled();
  });

  it("되돌려도 즉시 반영한 품절은 그대로다", async () => {
    const { user } = await openMenus();
    await rename(user, "콜라", "제로 콜라");
    await user.click(screen.getByRole("switch", { name: "품절 (즉시 반영)" }));
    await user.click(barButton("되돌리기"));
    expect(card("콜라")).toHaveTextContent("품절");
  });
});

describe("나가기 경고", () => {
  it("저장 안 한 채 다른 메뉴를 누르면 확인창을 띄운다", async () => {
    const { user, repository } = await openMenus();
    await rename(user, "만두", "고기만두");
    await user.click(nav("오늘 현황"));
    const dialog = screen.getByRole("dialog", {
      name: "저장하지 않은 변경이 있습니다",
    });
    expect(dialog).toHaveTextContent("저장 안 된 변경 1건");

    await user.click(within(dialog).getByRole("button", { name: "계속 편집" }));
    expect(
      screen.getByRole("heading", { level: 1, name: "메뉴 관리" }),
    ).toBeInTheDocument();
    expect(card("고기만두")).toBeInTheDocument();

    await user.click(nav("주문 내역"));
    await user.click(screen.getByRole("button", { name: "버리고 이동" }));
    expect(
      screen.getByRole("heading", { level: 1, name: "주문 내역" }),
    ).toBeInTheDocument();
    await user.click(nav("메뉴 관리"));
    expect(card("만두")).toBeInTheDocument();
    expect((await repository.getMenuBoard()).menus[4].name).toBe("만두");
  });

  it("저장하고 이동하면 저장한 뒤 이동한다", async () => {
    const { user, repository } = await openMenus();
    await rename(user, "만두", "고기만두");
    await user.click(nav("매장 정보"));
    await user.click(screen.getByRole("button", { name: "저장하고 이동" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "매장 정보" }),
    ).toBeInTheDocument();
    expect((await repository.getMenuBoard()).menus[4].name).toBe("고기만두");
  });

  it("저장이 막히면 이동하지 않고 그 항목을 안내한다", async () => {
    const { user } = await openMenus();
    await user.click(screen.getByRole("button", { name: "새 메뉴" }));
    await user.click(nav("오늘 현황"));
    await user.click(screen.getByRole("button", { name: "저장하고 이동" }));
    expect(
      screen.getByRole("heading", { level: 1, name: "메뉴 관리" }),
    ).toBeInTheDocument();
    expect(within(bar()).getByRole("alert")).toHaveTextContent(
      "이름이 빈 메뉴가 있습니다",
    );
  });

  it("변경이 없으면 바로 이동한다", async () => {
    const { user } = await openMenus();
    await user.click(nav("오늘 현황"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("heading", { level: 1, name: "오늘 현황" }),
    ).toBeInTheDocument();
  });

  it("새로고침·탭 닫기에는 저장 안 된 변경이 있을 때만 경고한다", async () => {
    const { user } = await openMenus();
    const unload = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(unload()).toBe(false);
    await rename(user, "만두", "고기만두");
    expect(unload()).toBe(true);
    await user.click(barButton("변경 취소"));
    expect(unload()).toBe(false);
  });
});
