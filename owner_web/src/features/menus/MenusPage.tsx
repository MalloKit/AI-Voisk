import { useState } from "react";
import type { MenuBoard } from "../../data/models";
import type { OwnerRepository } from "../../data/ownerRepository";
import {
  addCategory,
  menusInCategory,
  removeCategory,
  renameCategory,
} from "../../data/menuDraft";
import { Card, Heading } from "../../components/ui";
import { useMenuDraft } from "./useMenuDraft";
import { KioskPreview, type CategoryFilter } from "./KioskPreview";
import { MenuEditor } from "./MenuEditor";
import { CategoryEditor } from "./CategoryEditor";
import { MenuGuide } from "./MenuGuide";

type Selection =
  { kind: "menu"; id: number } | { kind: "category"; id: number } | null;

export function MenusPage({
  repository,
  storeId,
  board,
  onBoardChange,
}: {
  repository: OwnerRepository;
  storeId: number;
  board: MenuBoard;
  onBoardChange(update: (board: MenuBoard) => MenuBoard): void;
}) {
  const draft = useMenuDraft({
    saved: board,
    repository,
    onSavedChange: onBoardChange,
  });
  const [selection, setSelection] = useState<Selection>(null);
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(
    null,
  );
  const menu =
    selection?.kind === "menu"
      ? draft.draft.menus.find((m) => m.id === selection.id)
      : undefined;
  const selectedCategory =
    selection?.kind === "category"
      ? draft.draft.categories.find((c) => c.id === selection.id)
      : undefined;

  function showAll() {
    setCategory("all");
    setSelection(null);
  }
  function selectCategory(next: CategoryFilter) {
    setCategory(next);
    setSelection(next === "all" ? null : { kind: "category", id: next });
  }
  function selectMenu(id: number) {
    setSelection({ kind: "menu", id });
  }
  function startCategory() {
    const { board: next, id } = addCategory(draft.draft, storeId);
    draft.edit(() => next);
    setEditingCategoryId(id);
    selectCategory(id);
  }
  // 이름 없이 끝낸 새 카테고리는 만들지 않은 것으로 본다.
  function finishCategory(id: number) {
    setEditingCategoryId(null);
    const target = draft.draft.categories.find((c) => c.id === id);
    if (
      id < 0 &&
      target &&
      !target.name.trim() &&
      !menusInCategory(draft.draft, id).length
    ) {
      draft.edit((b) => removeCategory(b, id));
      showAll();
    }
  }

  return (
    <>
      <Heading title="메뉴 관리">
        키오스크 미리보기에서 메뉴나 카테고리를 눌러 편집합니다.
      </Heading>
      <div className="menus-layout">
        <Card className="menus-panel">
          {menu ? (
            <MenuEditor
              key={menu.id}
              menu={menu}
              draft={draft}
              onClose={() => setSelection(null)}
              onCategoryChange={(id) => {
                if (category !== "all") setCategory(id);
              }}
            />
          ) : selectedCategory ? (
            <CategoryEditor
              key={selectedCategory.id}
              category={selectedCategory}
              draft={draft}
              onClose={() => setSelection(null)}
              onDeleted={showAll}
              onSelectMenu={selectMenu}
            />
          ) : (
            <MenuGuide board={draft.draft} onSelectMenu={selectMenu} />
          )}
        </Card>
        <KioskPreview
          board={draft.draft}
          category={category}
          selectedMenuId={menu?.id ?? null}
          editingCategoryId={editingCategoryId}
          onSelectCategory={selectCategory}
          onSelectMenu={selectMenu}
          onAddCategory={startCategory}
          onRenameCategory={(id, name) =>
            draft.edit((b) => renameCategory(b, id, name))
          }
          onFinishCategory={finishCategory}
        />
      </div>
    </>
  );
}
