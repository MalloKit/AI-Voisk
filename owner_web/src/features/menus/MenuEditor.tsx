import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Menu } from "../../data/models";
import { kioskView, moveMenu, updateMenu } from "../../data/menuDraft";
import { LIMITS, nameError, parsePrice } from "../../data/validation";
import type { MenuDraft } from "./useMenuDraft";
import { Switch, TextField } from "./fields";
import { OptionList } from "./OptionList";

export interface FocusRequest {
  id: number;
  field: "name" | "price";
  // 같은 칸을 다시 요청해도 효과가 다시 돌도록 매번 바꾼다.
  serial: number;
}

const priceToText = (price: number) => (price ? String(price) : "");

export function MenuEditor({
  menu,
  draft,
  focus,
  onClose,
  onCategoryChange,
}: {
  menu: Menu;
  draft: MenuDraft;
  focus: FocusRequest | null;
  onClose(): void;
  onCategoryChange(categoryId: number): void;
}) {
  // 가격은 입력 중인 글자를 따로 두고, 올바른 값일 때만 초안(미리보기)에 넣는다.
  // 새 메뉴의 가격 0은 '입력 전'이라 빈칸으로 보인다.
  const [priceText, setPriceText] = useState(priceToText(menu.price));
  const price = parsePrice(priceText);
  // 되돌리기로 가격이 바뀌면 입력칸도 따라간다.
  useEffect(() => {
    setPriceText((text) =>
      parsePrice(text).value === menu.price ? text : priceToText(menu.price),
    );
  }, [menu.price]);

  const nameRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focus?.id !== menu.id) return;
    (focus.field === "name" ? nameRef : priceRef).current?.focus();
  }, [focus, menu.id]);

  const patch = (fields: Partial<Menu>, key?: string) =>
    draft.edit((b) => updateMenu(b, menu.id, fields), key);
  const { categories } = kioskView(draft.draft);
  const isNew = menu.id < 0;
  return (
    <section className="editor" aria-labelledby="menu-editor-title">
      <header className="editor-head">
        <div>
          <span className="eyebrow">{isNew ? "새 메뉴" : "메뉴 편집"}</span>
          <h2 id="menu-editor-title">{menu.name || "(이름 없음)"}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="선택 해제"
          onClick={onClose}
        >
          <X />
        </button>
      </header>
      <div className="immediate">
        <Switch
          label="품절"
          tone="attention"
          note={isNew ? "(새 메뉴)" : "(즉시 반영)"}
          checked={menu.isSoldOut}
          disabled={draft.isPending(`menu-${menu.id}`)}
          onChange={(v) => draft.setMenuSoldOut(menu.id, v)}
        />
        {draft.soldOutError && <p role="alert">{draft.soldOutError}</p>}
      </div>
      <TextField
        label="메뉴 이름"
        value={menu.name}
        inputRef={nameRef}
        placeholder="예: 김치볶음밥"
        onChange={(name) => patch({ name }, `menu-${menu.id}-name`)}
        maxLength={LIMITS.menuName}
        error={nameError(menu.name, LIMITS.menuName, "메뉴 이름")}
      />
      <TextField
        label="가격(원)"
        value={priceText}
        inputRef={priceRef}
        inputMode="numeric"
        placeholder="예: 8000"
        onChange={(text) => {
          setPriceText(text);
          const next = parsePrice(text);
          if (next.value !== null)
            patch({ price: next.value }, `menu-${menu.id}-price`);
        }}
        error={price.error}
        hint="1원부터 1,000,000원까지"
      />
      <TextField
        label="설명"
        value={menu.description ?? ""}
        multiline
        onChange={(text) =>
          patch({ description: text || null }, `menu-${menu.id}-description`)
        }
        maxLength={LIMITS.description}
      />
      <div className="form-field">
        <label htmlFor="menu-category">카테고리</label>
        <select
          id="menu-category"
          value={menu.categoryId}
          onChange={(e) => {
            const categoryId = Number(e.target.value);
            // 옮긴 카테고리의 맨 뒤로 간다.
            draft.edit((b) => moveMenu(b, menu.id, { categoryId }));
            onCategoryChange(categoryId);
          }}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name || "(이름 없음)"}
            </option>
          ))}
        </select>
      </div>
      <Switch
        label="키오스크에서 판매"
        checked={menu.isActive}
        onChange={(isActive) => patch({ isActive })}
      />
      {!menu.isActive && (
        <p className="notice-box">
          숨긴 메뉴라 키오스크에 보이지 않습니다. 아래 '숨긴 메뉴' 상자에서
          미리보기로 끌어 놓거나 위 스위치를 켜면 다시 판매합니다.
        </p>
      )}
      <OptionList menuId={menu.id} draft={draft} />
    </section>
  );
}
