import { useDraggable, useDroppable } from "@dnd-kit/core";
import { EyeOff, GripVertical } from "lucide-react";
import type { Menu, MenuBoard } from "../../data/models";
import { menusInCategory } from "../../data/menuDraft";
import type { DragData, DropData } from "./dnd";
import { menuLabel } from "./KioskPreview";

function HiddenMenu({
  menu,
  categoryName,
  changed,
  onSelect,
}: {
  menu: Menu;
  categoryName: string;
  changed: boolean;
  onSelect(): void;
}) {
  const label = menuLabel(menu);
  const drag = useDraggable({
    id: `hidden:${menu.id}`,
    data: { type: "hidden-menu", menuId: menu.id, label } satisfies DragData,
    attributes: { roleDescription: "끌 수 있는 숨긴 메뉴" },
  });
  return (
    <li>
      <button
        ref={drag.setNodeRef}
        {...drag.attributes}
        {...drag.listeners}
        className={`hidden-menu ${drag.isDragging ? "dragging" : ""}`}
        aria-label={`${label} (${categoryName})${changed ? " · 저장 안 됨" : ""}`}
        onClick={onSelect}
      >
        <GripVertical size={16} aria-hidden="true" />
        <span className="hidden-menu-name">{label}</span>
        <span className="muted">{categoryName}</span>
        {changed && <span className="unsaved-dot inline" aria-hidden="true" />}
      </button>
    </li>
  );
}

// 카드를 넣으면 판매 중지(is_active = FALSE), 꺼내 미리보기에 놓으면 다시 판매.
export function HiddenMenus({
  board,
  changedMenuIds,
  onSelectMenu,
}: {
  board: MenuBoard;
  changedMenuIds: Set<number>;
  onSelectMenu(id: number): void;
}) {
  const drop = useDroppable({
    id: "hidden",
    data: { type: "hidden", label: "숨긴 메뉴 상자" } satisfies DropData,
  });
  const categories = [...board.categories].sort(
    (a, b) => a.sort - b.sort || a.id - b.id,
  );
  const hidden = categories.flatMap((c) =>
    menusInCategory(board, c.id)
      .filter((m) => !m.isActive)
      .map((m) => ({ menu: m, categoryName: c.name || "(이름 없음)" })),
  );
  return (
    <section
      ref={drop.setNodeRef}
      className={`hidden-box ${drop.isOver ? "over" : ""}`}
      aria-labelledby="hidden-box-title"
    >
      <h2 id="hidden-box-title">
        <EyeOff size={18} aria-hidden="true" />
        숨긴 메뉴 {hidden.length}개
      </h2>
      <p className="muted">
        미리보기의 카드를 여기에 놓으면 판매 중지되어 키오스크에서 사라집니다.
        다시 판매하려면 메뉴를 미리보기로 끌어 놓으세요.
      </p>
      {hidden.length > 0 && (
        <ul className="hidden-list">
          {hidden.map(({ menu, categoryName }) => (
            <HiddenMenu
              key={menu.id}
              menu={menu}
              categoryName={categoryName}
              changed={changedMenuIds.has(menu.id)}
              onSelect={() => onSelectMenu(menu.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
