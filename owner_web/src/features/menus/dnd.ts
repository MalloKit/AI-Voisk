import {
  closestCenter,
  pointerWithin,
  type Announcements,
  type CollisionDetection,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import type { MenuBoard } from "../../data/models";
import {
  addMenu,
  kioskView,
  moveCategory,
  moveMenu,
  updateMenu,
  type MenuPlace,
  type Side,
} from "../../data/menuDraft";

// 끄는 것과 놓는 곳. label은 스크린리더 안내에 쓴다.
export type DragData =
  | { type: "menu"; menuId: number; label: string }
  | { type: "hidden-menu"; menuId: number; label: string }
  | { type: "new-menu"; label: string }
  | { type: "category"; categoryId: number; label: string };
export type DropData =
  | { type: "menu"; menuId: number; categoryId: number; label: string }
  | { type: "category"; categoryId: number; label: string }
  | { type: "hidden"; label: string }
  | { type: "grid"; label: string };
export type CategoryFilter = number | "all";

const ACCEPTS: Record<DragData["type"], DropData["type"][]> = {
  menu: ["menu", "category", "hidden", "grid"],
  "hidden-menu": ["menu", "category", "grid"],
  "new-menu": ["menu", "category", "grid"],
  category: ["category"],
};
export const accepts = (drag?: string, drop?: string) =>
  !!drag &&
  !!drop &&
  ACCEPTS[drag as DragData["type"]]?.includes(drop as DropData["type"]);

// 놓았을 때의 결과. 바뀌지 않으면 null.
// select: 새로 만든 메뉴, view: 미리보기에서 보여 줄 카테고리
export function resolveDrop(
  board: MenuBoard,
  drag: DragData,
  drop: DropData,
  side: Side,
  view: CategoryFilter,
): { board: MenuBoard; select?: number; view?: CategoryFilter } | null {
  if (!accepts(drag.type, drop.type)) return null;
  if (drag.type === "category") {
    if (drop.type !== "category") return null;
    const next = moveCategory(board, drag.categoryId, drop.categoryId, side);
    return next === board ? null : { board: next };
  }
  if (drop.type === "hidden") {
    if (drag.type !== "menu") return null;
    return { board: updateMenu(board, drag.menuId, { isActive: false }) };
  }

  let place: MenuPlace;
  if (drop.type === "menu")
    place = { categoryId: drop.categoryId, anchorId: drop.menuId, side };
  else if (drop.type === "category") place = { categoryId: drop.categoryId };
  else if (view !== "all") place = { categoryId: view };
  else if (drag.type === "menu")
    return null; // 전체 보기의 빈 곳: 움직이지 않음
  else if (drag.type === "hidden-menu")
    place = {
      categoryId: board.menus.find((m) => m.id === drag.menuId)!.categoryId,
    };
  else {
    const first = kioskView(board).categories[0];
    if (!first) return null;
    place = { categoryId: first.id };
  }
  // 카테고리 위에 놓으면 그 카테고리를 보여 줘서 옮긴 결과가 보이게 한다.
  const nextView =
    drop.type === "category" && view !== "all" ? drop.categoryId : undefined;

  if (drag.type === "new-menu") {
    const { board: next, id } = addMenu(board, place);
    return { board: next, select: id, view: nextView };
  }
  const next = moveMenu(
    board,
    drag.menuId,
    place,
    drag.type === "hidden-menu" ? { isActive: true } : {},
  );
  return next === board ? null : { board: next, view: nextView };
}

// 포인터는 정확히 그 아래, 키보드는 가장 가까운 곳. 카드·카테고리가 메뉴 영역보다 우선이다.
export const collisionDetection: CollisionDetection = (args) => {
  const type = args.active.data.current?.type;
  const scoped = {
    ...args,
    droppableContainers: args.droppableContainers.filter((c) =>
      accepts(type, c.data.current?.type),
    ),
  };
  const hits = args.pointerCoordinates
    ? pointerWithin(scoped)
    : closestCenter(scoped);
  const specific = hits.filter(
    (h) => h.data?.droppableContainer?.data.current?.type !== "grid",
  );
  return specific.length ? specific : hits;
};

const ARROWS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
// 화살표 방향으로 가장 가까운 놓을 곳의 가운데로 옮긴다.
export const keyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { context: { active, collisionRect, droppableRects, droppableContainers } },
) => {
  if (!ARROWS.includes(event.code)) return undefined;
  event.preventDefault();
  if (!active || !collisionRect) return undefined;
  const type = active.data.current?.type;
  const cx = collisionRect.left + collisionRect.width / 2;
  const cy = collisionRect.top + collisionRect.height / 2;
  let best: { x: number; y: number; score: number } | null = null;
  for (const container of droppableContainers.getEnabled()) {
    const dropType = container.data.current?.type;
    if (dropType === "grid" || !accepts(type, dropType)) continue;
    const rect = droppableRects.get(container.id);
    if (!rect) continue;
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const dx = x - cx;
    const dy = y - cy;
    const along = {
      ArrowRight: dx,
      ArrowLeft: -dx,
      ArrowDown: dy,
      ArrowUp: -dy,
    }[event.code as "ArrowRight"];
    const across =
      event.code === "ArrowLeft" || event.code === "ArrowRight" ? dy : dx;
    if (along < 1) continue;
    const score = along + Math.abs(across) * 2;
    if (!best || score < best.score) best = { x, y, score };
  }
  return best
    ? {
        x: best.x - collisionRect.width / 2,
        y: best.y - collisionRect.height / 2,
      }
    : undefined;
};

const labelOf = (data: unknown) =>
  (data as { label?: string } | undefined)?.label ?? "항목";
export const announcements: Announcements = {
  onDragStart: ({ active }) =>
    `${labelOf(active.data.current)} 이동을 시작했습니다.`,
  onDragOver: ({ over }) =>
    over
      ? `${labelOf(over.data.current)} 위에 있습니다.`
      : "놓을 수 있는 곳이 아닙니다.",
  onDragEnd: ({ active, over }) =>
    over
      ? `${labelOf(active.data.current)}: ${labelOf(over.data.current)}에 놓았습니다.`
      : `${labelOf(active.data.current)}: 옮기지 않았습니다.`,
  onDragCancel: ({ active }) =>
    `${labelOf(active.data.current)} 이동을 취소했습니다.`,
};
export const screenReaderInstructions = {
  draggable:
    "Space로 집고 화살표 키로 옮긴 뒤 Space로 놓습니다. Esc로 취소합니다. Enter로 편집을 엽니다.",
};
