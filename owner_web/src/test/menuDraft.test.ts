import { describe, expect, it } from "vitest";
import { MockOwnerRepository } from "../data/ownerRepository";
import {
  addCategory,
  addOption,
  categoryDeleteBlock,
  categoryNameError,
  kioskView,
  removeCategory,
  removeOption,
  updateMenu,
} from "../data/menuDraft";
import { formatWon, parseExtraPrice, parsePrice } from "../data/validation";

const board = () => new MockOwnerRepository().getMenuBoard();

describe("키오스크 노출 규칙", () => {
  it("판매 중지 메뉴를 빼고 category_sort, menu_sort 순서로 보여 준다", async () => {
    let b = await board();
    b = updateMenu(b, 2, { isActive: false }); // 비빔밥
    b = {
      ...b,
      categories: b.categories.map((c) =>
        c.name === "음료" ? { ...c, sort: 0 } : c,
      ),
    };
    b = updateMenu(b, 7, { sort: 0 }); // 사이다를 콜라 앞으로
    const names = kioskView(b).menus.map((m) => m.name);
    expect(names.slice(0, 3)).toEqual(["사이다", "콜라", "제육덮밥"]);
    expect(names).not.toContain("비빔밥");
    expect(names).toHaveLength(13);
  });
});

describe("카테고리 초안", () => {
  it("새 카테고리는 음수 임시 id와 마지막 순서를 받는다", async () => {
    const before = await board();
    const { board: after, id } = addCategory(before, 1);
    expect(id).toBeLessThan(0);
    expect(after.categories.at(-1)).toMatchObject({ id, name: "", sort: 12 });
    expect(before.categories).toHaveLength(11);
  });

  it("메뉴가 남아 있으면 판매 중지 메뉴라도 삭제를 막는다", async () => {
    let b = await board();
    const meal = b.categories.find((c) => c.name === "식사")!.id;
    expect(categoryDeleteBlock(b, meal)).toMatch(/메뉴 2개가 남아 있어/);
    expect(removeCategory(b, meal).categories).toHaveLength(11);
    const salad = b.categories.find((c) => c.name === "샐러드")!.id;
    b = updateMenu(b, 12, { isActive: false });
    expect(categoryDeleteBlock(b, salad)).toMatch(/ON DELETE/);
    b = updateMenu(b, 12, { categoryId: meal });
    expect(categoryDeleteBlock(b, salad)).toBeNull();
    expect(removeCategory(b, salad).categories).toHaveLength(10);
  });

  it("빈 이름, 100자 초과, 같은 이름을 막는다", async () => {
    const b = await board();
    expect(categoryNameError(b, 1, " ")).toBe("카테고리 이름을 입력해 주세요.");
    expect(categoryNameError(b, 1, "가".repeat(101))).toMatch(/100자/);
    expect(categoryNameError(b, 1, "음료")).toMatch(/같은 이름/);
    expect(categoryNameError(b, 1, "식사")).toBeNull();
  });
});

describe("옵션 초안", () => {
  it("추가한 옵션은 메뉴의 마지막 순서이고, 저장된 옵션 삭제는 판매 중지로 바꾼다", async () => {
    let b = addOption(await board(), 1, { name: "곱빼기", extraPrice: 1500 });
    const added = b.options.at(-1)!;
    expect(added).toMatchObject({
      menuId: 1,
      sort: 4,
      isActive: true,
      isSoldOut: false,
    });
    expect(added.id).toBeLessThan(0);
    b = removeOption(b, added.id);
    expect(b.options.some((o) => o.id === added.id)).toBe(false);
    b = removeOption(b, 1);
    expect(b.options.find((o) => o.id === 1)?.isActive).toBe(false);
  });
});

describe("입력 검증", () => {
  it("가격은 1~1,000,000원 정수, 추가 금액은 0원 이상", () => {
    expect(parsePrice("12,000").value).toBe(12000);
    expect(parsePrice("1000000").value).toBe(1_000_000);
    for (const bad of ["0", "1000001", "-1", "1.5", "", "abc"])
      expect(parsePrice(bad).error).not.toBeNull();
    expect(parseExtraPrice("0").value).toBe(0);
    expect(parseExtraPrice("-500").error).not.toBeNull();
    expect(formatWon(12000)).toBe("12,000원");
  });
});
