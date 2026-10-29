import type { Category, Menu, MenuBoard, MenuOption } from "./models";
import { LIMITS, nameError } from "./validation";

// 메뉴 관리 초안을 바꾸는 순수 함수. 아직 저장하지 않은 새 항목은 음수 임시 id를 쓴다.
// 매번 새 MenuBoard를 돌려주고 인자는 바꾸지 않는다.

const byOrder = (
  a: { sort: number; id: number },
  b: { sort: number; id: number },
) => a.sort - b.sort || a.id - b.id;

// 서버 GET /stores/{id}/menus와 같은 규칙: is_active 메뉴만,
// category_sort, category_id, menu_sort, menu_id 순서.
export function kioskView(board: MenuBoard) {
  const categories = [...board.categories].sort(byOrder);
  const rank = new Map(categories.map((c, i) => [c.id, i]));
  const menus = board.menus
    .filter((m) => m.isActive && rank.has(m.categoryId))
    .sort(
      (a, b) =>
        rank.get(a.categoryId)! - rank.get(b.categoryId)! || byOrder(a, b),
    );
  return { categories, menus };
}

// 판매 중지 메뉴도 포함한다. FK 때문에 이런 메뉴가 있어도 카테고리를 지울 수 없다.
export const menusInCategory = (board: MenuBoard, categoryId: number) =>
  board.menus.filter((m) => m.categoryId === categoryId).sort(byOrder);

export const activeOptions = (board: MenuBoard, menuId: number) =>
  board.options.filter((o) => o.menuId === menuId && o.isActive).sort(byOrder);

export const nextTempId = (board: MenuBoard) =>
  Math.min(
    0,
    ...board.categories.map((c) => c.id),
    ...board.options.map((o) => o.id),
  ) - 1;

export function updateMenu(board: MenuBoard, id: number, patch: Partial<Menu>) {
  return {
    ...board,
    menus: board.menus.map((m) => (m.id === id ? { ...m, ...patch } : m)),
  };
}

export function addCategory(board: MenuBoard, storeId: number) {
  const category: Category = {
    id: nextTempId(board),
    storeId,
    name: "",
    sort: Math.max(0, ...board.categories.map((c) => c.sort)) + 1,
  };
  return {
    board: { ...board, categories: [...board.categories, category] },
    id: category.id,
  };
}

export function renameCategory(board: MenuBoard, id: number, name: string) {
  return {
    ...board,
    categories: board.categories.map((c) => (c.id === id ? { ...c, name } : c)),
  };
}

// 키오스크는 카테고리를 이름으로 묶으므로 같은 이름을 막는다.
export function categoryNameError(board: MenuBoard, id: number, name: string) {
  const error = nameError(name, LIMITS.categoryName, "카테고리 이름");
  if (error) return error;
  const same = board.categories.some(
    (c) => c.id !== id && c.name.trim() === name.trim(),
  );
  return same ? "같은 이름의 카테고리가 이미 있습니다." : null;
}

export function categoryDeleteBlock(board: MenuBoard, id: number) {
  const count = menusInCategory(board, id).length;
  return count
    ? `메뉴 ${count}개가 남아 있어 삭제할 수 없습니다. 메뉴를 다른 카테고리로 옮긴 뒤 삭제해 주세요. DB에 ON DELETE 규칙이 없어 실제로도 삭제가 거부됩니다.`
    : null;
}

export function removeCategory(board: MenuBoard, id: number) {
  if (categoryDeleteBlock(board, id)) return board;
  return { ...board, categories: board.categories.filter((c) => c.id !== id) };
}

export function addOption(
  board: MenuBoard,
  menuId: number,
  fields: Pick<MenuOption, "name" | "extraPrice">,
) {
  const option: MenuOption = {
    id: nextTempId(board),
    menuId,
    ...fields,
    sort:
      Math.max(
        0,
        ...board.options.filter((o) => o.menuId === menuId).map((o) => o.sort),
      ) + 1,
    isActive: true,
    isSoldOut: false,
  };
  return { ...board, options: [...board.options, option] };
}

export function updateOption(
  board: MenuBoard,
  id: number,
  patch: Partial<MenuOption>,
) {
  return {
    ...board,
    options: board.options.map((o) => (o.id === id ? { ...o, ...patch } : o)),
  };
}

// 저장된 옵션은 주문 기록이 참조할 수 있어 지우지 않고 판매 중지로 바꾼다.
export function removeOption(board: MenuBoard, id: number) {
  return id < 0
    ? { ...board, options: board.options.filter((o) => o.id !== id) }
    : updateOption(board, id, { isActive: false });
}
