import { useDraggable } from "@dnd-kit/core";
import { Plus } from "lucide-react";
import type { DragData } from "./dnd";

// 미리보기 원하는 위치에 끌어 놓으면 그 자리에, 그냥 누르면 보고 있는 카테고리 맨 뒤에 새 메뉴를 만든다.
export function NewMenuChip({
  disabled,
  onCreate,
}: {
  disabled: boolean;
  onCreate(): void;
}) {
  const drag = useDraggable({
    id: "new-menu",
    data: { type: "new-menu", label: "새 메뉴" } satisfies DragData,
    disabled,
    attributes: { roleDescription: "끌 수 있는 새 메뉴" },
  });
  return (
    <div className="new-menu-row">
      <button
        ref={drag.setNodeRef}
        {...drag.attributes}
        {...drag.listeners}
        className={`new-menu-chip ${drag.isDragging ? "dragging" : ""}`}
        disabled={disabled}
        onClick={onCreate}
      >
        <Plus size={18} aria-hidden="true" />새 메뉴
      </button>
      <span className="muted">
        {disabled
          ? "카테고리를 먼저 만들어 주세요."
          : "누르면 보고 있는 카테고리 맨 뒤에, 끌어 놓으면 그 자리에 생깁니다."}
      </span>
    </div>
  );
}
