import { describe, expect, it } from "vitest";
import { MockOwnerRepository } from "../data/ownerRepository";
import type { MenuBoard } from "../data/models";
import {
  addCategory,
  menusInCategory,
  renameCategory,
  updateMenu,
} from "../data/menuDraft";
import {
  buildChanges,
  changedMenuIds,
  describeChanges,
  findProblem,
  keepSoldOut,
} from "../data/menuChanges";
import {
  resolveDrop,
  type DragData,
  type DropData,
} from "../features/menus/dnd";

const board = () => new MockOwnerRepository().getMenuBoard();
const id = (b: MenuBoard, name: string) =>
  b.menus.find((m) => m.name === name)!.id;
const cat = (b: MenuBoard, name: string) =>
  b.categories.find((c) => c.name === name)!.id;
const names = (b: MenuBoard, category: string) =>
  menusInCategory(b, cat(b, category)).map((m) => [m.name, m.sort]);

const menu = (b: MenuBoard, name: string): DragData => ({
  type: "menu",
  menuId: id(b, name),
  label: name,
});
const onCard = (b: MenuBoard, name: string): DropData => ({
  type: "menu",
  menuId: id(b, name),
  categoryId: b.menus.find((m) => m.name === name)!.categoryId,
  label: name,
});
const onCategory = (b: MenuBoard, name: string): DropData => ({
  type: "category",
  categoryId: cat(b, name),
  label: name,
});
const hidden: DropData = { type: "hidden", label: "숨긴 메뉴 상자" };
const grid: DropData = { type: "grid", label: "메뉴 영역" };

describe("드래그 결과", () => {
  it("카드를 다른 카드 앞뒤에 놓으면 순서가 바뀌고 1부터 다시 매긴다", async () => {
    const b = await board();
    const before = resolveDrop(
      b,
      menu(b, "비빔밥"),
      onCard(b, "제육덮밥"),
      "before",
      "all",
    )!;
    expect(names(before.board, "식사")).toEqual([
      ["비빔밥", 1],
      ["제육덮밥", 2],
    ]);
    const after = resolveDrop(
      b,
      menu(b, "제육덮밥"),
      onCard(b, "비빔밥"),
      "after",
      "all",
    )!;
    expect(names(after.board, "식사")).toEqual([
      ["비빔밥", 1],
      ["제육덮밥", 2],
    ]);
    // 자기 자리에 놓으면 바뀌지 않는다.
    expect(
      resolveDrop(b, menu(b, "비빔밥"), onCard(b, "비빔밥"), "before", "all"),
    ).toBeNull();
  });

  it("다른 카테고리 카드 앞에 놓으면 그 카테고리의 그 자리로 옮긴다", async () => {
    const b = await board();
    const r = resolveDrop(
      b,
      menu(b, "콜라"),
      onCard(b, "콩나물국밥"),
      "before",
      "all",
    )!;
    expect(names(r.board, "국물")).toEqual([
      ["순두부찌개", 1],
      ["콜라", 2],
      ["콩나물국밥", 3],
    ]);
    expect(names(r.board, "음료")).toEqual([["사이다", 1]]);
  });

  it("카테고리 위에 놓으면 그 카테고리 맨 뒤로 옮기고 그 카테고리를 보여 준다", async () => {
    const b = await board();
    const r = resolveDrop(
      b,
      menu(b, "콜라"),
      onCategory(b, "식사"),
      "before",
      cat(b, "음료"),
    )!;
    expect(names(r.board, "식사")).toEqual([
      ["제육덮밥", 1],
      ["비빔밥", 2],
      ["콜라", 3],
    ]);
    expect(r.view).toBe(cat(b, "식사"));
    // 전체 보기에서는 보기를 바꾸지 않는다.
    expect(
      resolveDrop(b, menu(b, "콜라"), onCategory(b, "식사"), "before", "all")!
        .view,
    ).toBeUndefined();
  });

  it("숨긴 메뉴 상자에 넣으면 판매 중지, 꺼내서 놓으면 다시 판매한다", async () => {
    const b = await board();
    const hide = resolveDrop(b, menu(b, "만두"), hidden, "before", "all")!;
    const dumpling = hide.board.menus.find((m) => m.name === "만두")!;
    expect(dumpling.isActive).toBe(false);
    const back: DragData = {
      type: "hidden-menu",
      menuId: dumpling.id,
      label: "만두",
    };
    const onTop = resolveDrop(
      hide.board,
      back,
      onCard(b, "떡볶이"),
      "before",
      "all",
    )!;
    expect(onTop.board.menus.find((m) => m.id === dumpling.id)?.isActive).toBe(
      true,
    );
    expect(names(onTop.board, "분식")).toEqual([
      ["만두", 1],
      ["떡볶이", 2],
    ]);
    // 전체 보기의 빈 곳에 놓으면 원래 카테고리 맨 뒤로 돌아온다.
    const toGrid = resolveDrop(hide.board, back, grid, "before", "all")!;
    expect(names(toGrid.board, "사이드")).toEqual([["만두", 1]]);
    expect(toGrid.board.menus.find((m) => m.id === dumpling.id)?.isActive).toBe(
      true,
    );
    // 숨긴 메뉴를 다시 상자에 넣거나 카드를 전체 보기 빈 곳에 놓으면 아무 일도 없다.
    expect(resolveDrop(hide.board, back, hidden, "before", "all")).toBeNull();
    expect(resolveDrop(b, menu(b, "만두"), grid, "before", "all")).toBeNull();
  });

  it("새 메뉴 칩을 카드 앞에 놓으면 그 자리에 빈 메뉴가 생긴다", async () => {
    const b = await board();
    const chip: DragData = { type: "new-menu", label: "새 메뉴" };
    const r = resolveDrop(b, chip, onCard(b, "비빔밥"), "before", "all")!;
    const created = r.board.menus.find((m) => m.id === r.select)!;
    expect(created).toMatchObject({
      name: "",
      price: 0,
      isActive: true,
      description: null,
    });
    expect(created.id).toBeLessThan(0);
    expect(menusInCategory(r.board, cat(b, "식사")).map((m) => m.id)).toEqual([
      id(b, "제육덮밥"),
      created.id,
      id(b, "비빔밥"),
    ]);
    // 보고 있는 카테고리의 빈 곳에 놓으면 그 카테고리 맨 뒤
    const toGrid = resolveDrop(b, chip, grid, "before", cat(b, "디저트"))!;
    expect(menusInCategory(toGrid.board, cat(b, "디저트")).at(-1)?.id).toBe(
      toGrid.select,
    );
  });

  it("카테고리끼리 끌어 순서를 바꾸고, 카테고리를 메뉴 위에는 놓을 수 없다", async () => {
    const b = await board();
    const drink: DragData = {
      type: "category",
      categoryId: cat(b, "음료"),
      label: "음료",
    };
    const r = resolveDrop(b, drink, onCategory(b, "식사"), "before", "all")!;
    expect(
      [...r.board.categories]
        .sort((x, y) => x.sort - y.sort)
        .slice(0, 3)
        .map((c) => [c.name, c.sort]),
    ).toEqual([
      ["음료", 1],
      ["식사", 2],
      ["국물", 3],
    ]);
    expect(
      resolveDrop(b, drink, onCard(b, "콜라"), "before", "all"),
    ).toBeNull();
  });
});

describe("저장 묶음", () => {
  it("menu_sort는 카테고리별, category_sort는 전체에서 1부터 빈틈없이 보낸다", async () => {
    const b = await board();
    let draft = resolveDrop(
      b,
      menu(b, "콜라"),
      onCategory(b, "식사"),
      "before",
      "all",
    )!.board;
    const created = addCategory(draft, 1);
    draft = renameCategory(created.board, created.id, "주류");
    const changes = buildChanges(b, draft);

    expect(changes.categories.create).toEqual([
      { tempId: created.id, name: "주류", sort: 12 },
    ]);
    expect(changes.categories.update).toEqual([]);
    // 시드의 menu_sort(매장 전체 1~14)가 카테고리별 번호로 바뀐다.
    const sorts = new Map(changes.menus.update.map((m) => [m.id, m.sort]));
    expect(sorts.get(id(b, "콜라"))).toBe(3);
    expect(sorts.get(id(b, "사이다"))).toBe(1);
    for (const m of changes.menus.update)
      expect(m).not.toHaveProperty("isSoldOut");

    const repository = new MockOwnerRepository();
    const { board: saved, ids } = await repository.saveMenuBoard(changes);
    for (const c of saved.categories) {
      const list = menusInCategory(saved, c.id).map((m) => m.sort);
      expect(list).toEqual(list.map((_, i) => i + 1));
    }
    expect(saved.categories.map((c) => c.sort).sort((x, y) => x - y)).toEqual(
      saved.categories.map((_, i) => i + 1),
    );
    expect(saved.categories.find((c) => c.id === ids[created.id])?.name).toBe(
      "주류",
    );
    expect(names(saved, "식사").map(([n]) => n)).toEqual([
      "제육덮밥",
      "비빔밥",
      "콜라",
    ]);
  });

  it("새 카테고리와 그 안의 새 메뉴·옵션을 임시 id로 한 번에 저장한다", async () => {
    const repository = new MockOwnerRepository();
    const b = await repository.getMenuBoard();
    const c = addCategory(b, 1);
    let draft = renameCategory(c.board, c.id, "주류");
    const chip: DragData = { type: "new-menu", label: "새 메뉴" };
    const r = resolveDrop(
      draft,
      chip,
      { type: "category", categoryId: c.id, label: "주류" },
      "before",
      "all",
    )!;
    draft = updateMenu(r.board, r.select!, { name: "막걸리", price: 6000 });
    draft = {
      ...draft,
      options: [
        ...draft.options,
        {
          id: -99,
          menuId: r.select!,
          name: "큰 병",
          sort: 1,
          isActive: true,
          isSoldOut: false,
          extraPrice: 3000,
        },
      ],
    };
    const { board: saved, ids } = await repository.saveMenuBoard(
      buildChanges(b, draft),
    );
    const makgeolli = saved.menus.find((m) => m.id === ids[r.select!])!;
    expect(makgeolli).toMatchObject({
      name: "막걸리",
      price: 6000,
      categoryId: ids[c.id],
      sort: 1,
    });
    expect(saved.options.find((o) => o.id === ids[-99])).toMatchObject({
      menuId: makgeolli.id,
      name: "큰 병",
    });
  });

  it("중간에 하나라도 실패하면 아무것도 바꾸지 않는다", async () => {
    const repository = new MockOwnerRepository();
    const b = await repository.getMenuBoard();
    const draft = updateMenu(b, id(b, "콜라"), { name: "제로 콜라" });
    const changes = buildChanges(b, draft);
    changes.categories.remove.push(cat(b, "식사")); // 메뉴가 남아 있어 거부된다
    await expect(repository.saveMenuBoard(changes)).rejects.toThrow(
      /메뉴가 남아/,
    );
    const after = await repository.getMenuBoard();
    expect(after.menus.find((m) => m.id === id(b, "콜라"))?.name).toBe("콜라");
    expect(after.categories).toHaveLength(11);
  });
});

describe("변경 목록", () => {
  it("사람이 읽는 문장으로 변경을 알려 준다", async () => {
    const b = await board();
    let draft = resolveDrop(
      b,
      menu(b, "콜라"),
      onCategory(b, "식사"),
      "before",
      "all",
    )!.board;
    draft = resolveDrop(
      draft,
      menu(draft, "만두"),
      hidden,
      "before",
      "all",
    )!.board;
    draft = resolveDrop(
      draft,
      menu(draft, "비빔밥"),
      onCard(draft, "제육덮밥"),
      "before",
      "all",
    )!.board;
    draft = updateMenu(draft, id(b, "불고기"), {
      name: "양념 불고기",
      price: 13000,
    });
    const drink: DragData = {
      type: "category",
      categoryId: cat(b, "디저트"),
      label: "디저트",
    };
    draft = resolveDrop(
      draft,
      drink,
      onCategory(draft, "식사"),
      "before",
      "all",
    )!.board;
    expect(describeChanges(b, draft)).toEqual([
      "카테고리 순서 변경",
      "만두 숨김",
      "콜라: 음료 → 식사 이동",
      "불고기: 이름 변경 (→ 양념 불고기)",
      "양념 불고기: 가격 변경 (12,000원 → 13,000원)",
      "식사 메뉴 순서 변경",
    ]);
    const changed = changedMenuIds(b, draft);
    for (const name of ["콜라", "만두", "제육덮밥", "비빔밥", "양념 불고기"])
      expect(changed.has(id(draft, name))).toBe(true);
    expect(changed.has(id(b, "사이다"))).toBe(false);
  });

  it("되돌려 놓은 순서는 변경으로 세지 않는다", async () => {
    const b = await board();
    let draft = resolveDrop(
      b,
      menu(b, "비빔밥"),
      onCard(b, "제육덮밥"),
      "before",
      "all",
    )!.board;
    draft = resolveDrop(
      draft,
      menu(draft, "제육덮밥"),
      onCard(draft, "비빔밥"),
      "before",
      "all",
    )!.board;
    expect(describeChanges(b, draft)).toEqual([]);
    expect(changedMenuIds(b, draft).size).toBe(0);
  });
});

describe("저장 막기", () => {
  it("빈 카테고리 이름, 빈 메뉴 이름, 빈 가격 순서로 알려 준다", async () => {
    const b = await board();
    const chip: DragData = { type: "new-menu", label: "새 메뉴" };
    const r = resolveDrop(b, chip, onCategory(b, "분식"), "before", "all")!;
    expect(findProblem(r.board)).toMatchObject({
      kind: "menu",
      id: r.select,
      field: "name",
    });
    const named = updateMenu(r.board, r.select!, { name: "김밥" });
    expect(findProblem(named)).toMatchObject({
      kind: "menu",
      id: r.select,
      field: "price",
    });
    const c = addCategory(updateMenu(named, r.select!, { price: 4000 }), 1);
    expect(findProblem(c.board)).toMatchObject({ kind: "category", id: c.id });
    expect(findProblem(renameCategory(c.board, c.id, "주류"))).toBeNull();
  });

  it("되돌리기에도 품절은 지금 값을 유지한다", async () => {
    const b = await board();
    const current = updateMenu(updateMenu(b, 6, { name: "변경" }), 6, {
      isSoldOut: true,
    });
    const restored = keepSoldOut(b, current);
    expect(restored.menus.find((m) => m.id === 6)).toMatchObject({
      name: "콜라",
      isSoldOut: true,
    });
  });
});
