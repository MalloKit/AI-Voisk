import { useState } from "react";
import { X } from "lucide-react";
import type { Menu } from "../../data/models";
import { kioskView, updateMenu } from "../../data/menuDraft";
import { LIMITS, nameError, parsePrice } from "../../data/validation";
import type { MenuDraft } from "./useMenuDraft";
import { Switch, TextField } from "./fields";
import { OptionList } from "./OptionList";

export function MenuEditor({
  menu,
  draft,
  onClose,
  onCategoryChange,
}: {
  menu: Menu;
  draft: MenuDraft;
  onClose(): void;
  onCategoryChange(categoryId: number): void;
}) {
  // 가격은 입력 중인 글자를 따로 두고, 올바른 값일 때만 초안(미리보기)에 넣는다.
  const [priceText, setPriceText] = useState(String(menu.price));
  const price = parsePrice(priceText);
  const patch = (fields: Partial<Menu>) =>
    draft.edit((b) => updateMenu(b, menu.id, fields));
  const { categories } = kioskView(draft.draft);
  return (
    <section className="editor" aria-labelledby="menu-editor-title">
      <header className="editor-head">
        <div>
          <span className="eyebrow">메뉴 편집</span>
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
          note="(즉시 반영)"
          checked={menu.isSoldOut}
          disabled={draft.isPending(`menu-${menu.id}`)}
          onChange={(v) => draft.setMenuSoldOut(menu.id, v)}
        />
        {draft.soldOutError && <p role="alert">{draft.soldOutError}</p>}
      </div>
      <TextField
        label="메뉴 이름"
        value={menu.name}
        onChange={(name) => patch({ name })}
        maxLength={LIMITS.menuName}
        error={nameError(menu.name, LIMITS.menuName, "메뉴 이름")}
      />
      <TextField
        label="가격(원)"
        value={priceText}
        inputMode="numeric"
        onChange={(text) => {
          setPriceText(text);
          const next = parsePrice(text);
          if (next.value !== null) patch({ price: next.value });
        }}
        error={price.error}
        hint="1원부터 1,000,000원까지"
      />
      <TextField
        label="설명"
        value={menu.description ?? ""}
        multiline
        onChange={(text) => patch({ description: text || null })}
        maxLength={LIMITS.description}
      />
      <div className="form-field">
        <label htmlFor="menu-category">카테고리</label>
        <select
          id="menu-category"
          value={menu.categoryId}
          onChange={(e) => {
            const categoryId = Number(e.target.value);
            patch({ categoryId });
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
          판매 중지 상태라 키오스크에 보이지 않습니다. 선택을 해제하면 안내
          화면의 '판매 중지 메뉴'에서 다시 열 수 있습니다.
        </p>
      )}
      <OptionList menuId={menu.id} draft={draft} />
    </section>
  );
}
