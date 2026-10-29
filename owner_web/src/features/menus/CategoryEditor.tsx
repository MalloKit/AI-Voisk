import { useState } from "react";
import { Trash2, X } from "lucide-react";
import type { Category } from "../../data/models";
import {
  categoryDeleteBlock,
  categoryNameError,
  menusInCategory,
  removeCategory,
  renameCategory,
} from "../../data/menuDraft";
import { LIMITS } from "../../data/validation";
import { Badge } from "../../components/ui";
import type { MenuDraft } from "./useMenuDraft";
import { TextField } from "./fields";

export function CategoryEditor({
  category,
  draft,
  onClose,
  onDeleted,
  onSelectMenu,
}: {
  category: Category;
  draft: MenuDraft;
  onClose(): void;
  onDeleted(): void;
  onSelectMenu(id: number): void;
}) {
  const [blocked, setBlocked] = useState<string | null>(null);
  const menus = menusInCategory(draft.draft, category.id);
  return (
    <section className="editor" aria-labelledby="category-editor-title">
      <header className="editor-head">
        <div>
          <span className="eyebrow">카테고리 편집</span>
          <h2 id="category-editor-title">{category.name || "(이름 없음)"}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="선택 해제"
          onClick={onClose}
        >
          <X />
        </button>
      </header>
      <TextField
        label="카테고리 이름"
        value={category.name}
        onChange={(name) =>
          draft.edit((b) => renameCategory(b, category.id, name))
        }
        maxLength={LIMITS.categoryName}
        error={categoryNameError(draft.draft, category.id, category.name)}
      />
      {!menus.some((m) => m.isActive) && (
        <p className="notice-box">
          판매 중인 메뉴가 없어 실제 키오스크에는 이 카테고리가 보이지 않습니다.
        </p>
      )}
      <section className="editor-section" aria-label="이 카테고리의 메뉴">
        <h3>이 카테고리의 메뉴 {menus.length}개</h3>
        {menus.length ? (
          <ul className="menu-links">
            {menus.map((m) => (
              <li key={m.id}>
                <button onClick={() => onSelectMenu(m.id)}>
                  {m.name || "(이름 없음)"}
                </button>
                {!m.isActive && <Badge>판매 중지</Badge>}
                {m.isActive && m.isSoldOut && (
                  <Badge tone="attention">품절</Badge>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">메뉴가 없습니다.</p>
        )}
      </section>
      <div className="danger-zone">
        <button
          onClick={() => {
            const reason = categoryDeleteBlock(draft.draft, category.id);
            if (reason) {
              setBlocked(reason);
              return;
            }
            draft.edit((b) => removeCategory(b, category.id));
            onDeleted();
          }}
        >
          <Trash2 size={16} aria-hidden="true" />
          카테고리 삭제
        </button>
        {blocked && <p role="alert">{blocked}</p>}
      </div>
    </section>
  );
}
