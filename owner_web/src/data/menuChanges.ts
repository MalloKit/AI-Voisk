import type { Menu, MenuBoard, MenuBoardChanges, MenuOption } from "./models";
import { categoryNameError, menusInCategory, renumber } from "./menuDraft";
import { LIMITS, formatWon, nameError } from "./validation";

// 저장된 상태(saved)와 초안(draft)을 비교해 저장 묶음, 변경 목록, 저장을 막는 문제를 만든다.

const byId = <T extends { id: number }>(items: T[]) =>
  new Map(items.map((x) => [x.id, x]));
const label = (name: string) => name.trim() || "(이름 없음)";
const differs = <T extends object>(a: T, b: T, keys: (keyof T)[]) =>
  keys.some((k) => a[k] !== b[k]);
const MENU_KEYS: (keyof Menu)[] = [
  "categoryId",
  "name",
  "price",
  "description",
  "isActive",
  "sort",
];
const OPTION_KEYS: (keyof MenuOption)[] = [
  "name",
  "extraPrice",
  "sort",
  "isActive",
];

export function buildChanges(
  saved: MenuBoard,
  draft: MenuBoard,
): MenuBoardChanges {
  const next = renumber(draft);
  const old = {
    categories: byId(saved.categories),
    menus: byId(saved.menus),
    options: byId(saved.options),
  };
  const kept = new Set(next.categories.map((c) => c.id));
  return {
    categories: {
      create: next.categories
        .filter((c) => c.id < 0)
        .map((c) => ({ tempId: c.id, name: c.name.trim(), sort: c.sort })),
      update: next.categories
        .filter(
          (c) =>
            c.id > 0 && differs(c, old.categories.get(c.id)!, ["name", "sort"]),
        )
        .map((c) => ({ id: c.id, name: c.name.trim(), sort: c.sort })),
      remove: saved.categories.filter((c) => !kept.has(c.id)).map((c) => c.id),
    },
    menus: {
      create: next.menus
        .filter((m) => m.id < 0)
        .map(({ id, ...m }) => ({ ...m, tempId: id, name: m.name.trim() })),
      update: next.menus
        .filter((m) => m.id > 0 && differs(m, old.menus.get(m.id)!, MENU_KEYS))
        .map(({ isSoldOut: _, ...m }) => ({ ...m, name: m.name.trim() })),
    },
    options: {
      create: next.options
        .filter((o) => o.id < 0 && o.isActive)
        .map(({ id, isActive: _, ...o }) => ({ ...o, tempId: id })),
      update: next.options
        .filter(
          (o) => o.id > 0 && differs(o, old.options.get(o.id)!, OPTION_KEYS),
        )
        .map(({ isSoldOut: _, ...o }) => o),
    },
  };
}

// 양쪽에 모두 있는 항목의 상대 순서가 바뀌었는지. 들어오고 나간 항목은 '이동'으로 따로 센다.
function orderChanged<T extends { id: number }>(before: T[], after: T[]) {
  const inAfter = new Set(after.map((x) => x.id));
  const inBefore = new Set(before.map((x) => x.id));
  const a = before.filter((x) => inAfter.has(x.id)).map((x) => x.id);
  const b = after.filter((x) => inBefore.has(x.id)).map((x) => x.id);
  return a.some((id, i) => id !== b[i]);
}
const sortedCategories = (board: MenuBoard) =>
  [...board.categories].sort((a, b) => a.sort - b.sort || a.id - b.id);

// 저장 확인 창에 보여 줄 변경 목록. '저장 안 된 변경 N건'도 이 목록 길이로 센다.
export function describeChanges(saved: MenuBoard, draft: MenuBoard) {
  const lines: string[] = [];
  const oldCategories = byId(saved.categories);
  const newCategories = byId(draft.categories);
  const categoryName = (id: number) =>
    label((newCategories.get(id) ?? oldCategories.get(id))?.name ?? "");

  for (const c of sortedCategories(draft)) {
    const before = oldCategories.get(c.id);
    if (!before) lines.push(`카테고리 추가: ${label(c.name)}`);
    else if (before.name !== c.name)
      lines.push(`카테고리 이름 변경: ${before.name} → ${label(c.name)}`);
  }
  for (const c of saved.categories)
    if (!newCategories.has(c.id)) lines.push(`카테고리 삭제: ${c.name}`);
  if (orderChanged(sortedCategories(saved), sortedCategories(draft)))
    lines.push("카테고리 순서 변경");

  const oldMenus = byId(saved.menus);
  for (const m of draft.menus) {
    const before = oldMenus.get(m.id);
    const name = label(m.name);
    if (!before) {
      lines.push(`새 메뉴: ${name} (${categoryName(m.categoryId)})`);
      continue;
    }
    if (before.categoryId !== m.categoryId)
      lines.push(
        `${name}: ${categoryName(before.categoryId)} → ${categoryName(m.categoryId)} 이동`,
      );
    if (before.isActive !== m.isActive)
      lines.push(m.isActive ? `${name} 다시 판매` : `${name} 숨김`);
    if (before.name !== m.name)
      lines.push(`${before.name}: 이름 변경 (→ ${name})`);
    if (before.price !== m.price)
      lines.push(
        `${name}: 가격 변경 (${formatWon(before.price)} → ${m.price ? formatWon(m.price) : "입력 전"})`,
      );
    if ((before.description ?? "") !== (m.description ?? ""))
      lines.push(`${name}: 설명 변경`);
  }
  for (const c of sortedCategories(draft))
    if (
      oldCategories.has(c.id) &&
      orderChanged(menusInCategory(saved, c.id), menusInCategory(draft, c.id))
    )
      lines.push(`${categoryName(c.id)} 메뉴 순서 변경`);

  const oldOptions = byId(saved.options);
  const menuName = (id: number) =>
    label(
      (draft.menus.find((m) => m.id === id) ?? oldMenus.get(id))?.name ?? "",
    );
  for (const o of draft.options) {
    const before = oldOptions.get(o.id);
    if (!before) {
      if (o.isActive)
        lines.push(`${menuName(o.menuId)}: 옵션 추가 (${o.name})`);
    } else if (before.isActive && !o.isActive)
      lines.push(`${menuName(o.menuId)}: 옵션 삭제 (${before.name})`);
    else if (before.name !== o.name || before.extraPrice !== o.extraPrice)
      lines.push(`${menuName(o.menuId)}: 옵션 변경 (${o.name})`);
  }
  return lines;
}

// 저장 안 된 변경이 있는 메뉴(카드의 주황 점). 순서는 카테고리 안 상대 위치가 바뀐 것만 센다.
export function changedMenuIds(saved: MenuBoard, draft: MenuBoard) {
  const oldMenus = byId(saved.menus);
  const newMenus = byId(draft.menus);
  const changed = new Set<number>();
  // 저장본과 초안 모두 같은 카테고리에 있는 메뉴끼리의 위치. 옆 메뉴가 나가거나 들어온 것은 세지 않는다.
  const stays = (id: number) =>
    oldMenus.get(id)?.categoryId === newMenus.get(id)?.categoryId;
  const position = (board: MenuBoard, m: Menu) =>
    menusInCategory(board, m.categoryId)
      .filter((x) => stays(x.id))
      .findIndex((x) => x.id === m.id);
  for (const m of draft.menus) {
    const before = oldMenus.get(m.id);
    if (
      !before ||
      differs(
        m,
        before,
        MENU_KEYS.filter((k) => k !== "sort"),
      ) ||
      (before.categoryId === m.categoryId &&
        position(saved, before) !== position(draft, m))
    )
      changed.add(m.id);
  }
  const oldOptions = byId(saved.options);
  for (const o of draft.options) {
    const before = oldOptions.get(o.id);
    if (before ? differs(o, before, OPTION_KEYS) : o.isActive)
      changed.add(o.menuId);
  }
  return changed;
}

export type Problem =
  | { kind: "category"; id: number; message: string }
  | { kind: "menu"; id: number; field: "name" | "price"; message: string };

// 저장을 막는 첫 문제. 화면은 이 항목을 선택하고 해당 입력칸으로 안내한다.
export function findProblem(draft: MenuBoard): Problem | null {
  const categories = sortedCategories(draft);
  for (const c of categories) {
    const error = categoryNameError(draft, c.id, c.name);
    if (error)
      return {
        kind: "category",
        id: c.id,
        message: c.name.trim()
          ? `카테고리 '${c.name}': ${error}`
          : "이름이 빈 카테고리가 있습니다. 카테고리 이름을 입력해 주세요.",
      };
  }
  for (const c of categories)
    for (const m of menusInCategory(draft, c.id)) {
      if (nameError(m.name, LIMITS.menuName, "메뉴 이름"))
        return {
          kind: "menu",
          id: m.id,
          field: "name",
          message: "이름이 빈 메뉴가 있습니다. 메뉴 이름을 입력해 주세요.",
        };
      if (m.price < LIMITS.minPrice || m.price > LIMITS.maxPrice)
        return {
          kind: "menu",
          id: m.id,
          field: "price",
          message: `'${m.name}'의 가격을 입력해 주세요. 1원부터 1,000,000원까지입니다.`,
        };
    }
  return null;
}

// 되돌리기·변경 취소 때도 품절은 이미 키오스크에 반영된 값이라 지금 값을 유지한다.
export function keepSoldOut(
  snapshot: MenuBoard,
  current: MenuBoard,
): MenuBoard {
  const menus = byId(current.menus);
  const options = byId(current.options);
  return {
    ...snapshot,
    menus: snapshot.menus.map((m) =>
      menus.has(m.id) ? { ...m, isSoldOut: menus.get(m.id)!.isSoldOut } : m,
    ),
    options: snapshot.options.map((o) =>
      options.has(o.id) ? { ...o, isSoldOut: options.get(o.id)!.isSoldOut } : o,
    ),
  };
}
