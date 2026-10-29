import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { MenuOption } from "../../data/models";
import {
  LIMITS,
  formatWon,
  nameError,
  parseExtraPrice,
} from "../../data/validation";
import {
  activeOptions,
  addOption,
  removeOption,
  updateOption,
} from "../../data/menuDraft";
import type { MenuDraft } from "./useMenuDraft";
import { Switch, TextField } from "./fields";

function OptionForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: { name: string; price: string };
  submitLabel: string;
  onSubmit(fields: { name: string; extraPrice: number }): void;
  onCancel?(): void;
}) {
  const [name, setName] = useState(initial.name);
  const [price, setPrice] = useState(initial.price);
  const [touched, setTouched] = useState(false);
  const nameProblem = nameError(name, LIMITS.optionName, "옵션 이름");
  const priceResult = parseExtraPrice(price);
  return (
    <form
      className="option-form"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (nameProblem || priceResult.value === null) return;
        onSubmit({ name: name.trim(), extraPrice: priceResult.value });
        setName(initial.name);
        setPrice(initial.price);
        setTouched(false);
      }}
    >
      <TextField
        label="옵션 이름"
        value={name}
        onChange={setName}
        maxLength={LIMITS.optionName}
        error={touched ? nameProblem : null}
      />
      <TextField
        label="추가 금액(원)"
        value={price}
        onChange={setPrice}
        inputMode="numeric"
        error={touched ? priceResult.error : null}
      />
      <div className="option-form-actions">
        {onCancel && (
          <button type="button" onClick={onCancel}>
            취소
          </button>
        )}
        <button type="submit" className="primary">
          {submitLabel === "추가" && <Plus size={16} aria-hidden="true" />}
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

function OptionRow({
  option,
  draft,
}: {
  option: MenuOption;
  draft: MenuDraft;
}) {
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <li className="option-row editing" aria-label={`${option.name} 수정`}>
        <OptionForm
          initial={{ name: option.name, price: String(option.extraPrice) }}
          submitLabel="수정 완료"
          onCancel={() => setEditing(false)}
          onSubmit={(fields) => {
            draft.edit((b) => updateOption(b, option.id, fields));
            setEditing(false);
          }}
        />
      </li>
    );
  return (
    <li className="option-row" aria-label={option.name}>
      <div className="option-main">
        <strong>{option.name}</strong>
        <span className="muted">+{formatWon(option.extraPrice)}</span>
      </div>
      <Switch
        label="품절"
        tone="attention"
        note={option.id < 0 ? "(새 옵션)" : "(즉시 반영)"}
        checked={option.isSoldOut}
        disabled={draft.isPending(`option-${option.id}`)}
        onChange={(v) => draft.setOptionSoldOut(option.id, v)}
      />
      <div className="option-actions">
        <button
          className="icon-button"
          aria-label={`${option.name} 수정`}
          onClick={() => setEditing(true)}
        >
          <Pencil size={18} />
        </button>
        <button
          className="icon-button"
          aria-label={`${option.name} 삭제`}
          onClick={() => draft.edit((b) => removeOption(b, option.id))}
        >
          <Trash2 size={18} />
        </button>
      </div>
    </li>
  );
}

export function OptionList({
  menuId,
  draft,
}: {
  menuId: number;
  draft: MenuDraft;
}) {
  const options = activeOptions(draft.draft, menuId);
  return (
    <section className="editor-section" aria-label="옵션">
      <h3>옵션</h3>
      {options.length ? (
        <ul className="option-list">
          {options.map((o) => (
            <OptionRow key={o.id} option={o} draft={draft} />
          ))}
        </ul>
      ) : (
        <p className="muted">등록된 옵션이 없습니다.</p>
      )}
      <p className="muted">
        이미 저장된 옵션을 삭제하면 지난 주문 기록을 지키기 위해 판매 중지로
        처리됩니다.
      </p>
      <h4>옵션 추가</h4>
      <OptionForm
        initial={{ name: "", price: "0" }}
        submitLabel="추가"
        onSubmit={(fields) => draft.edit((b) => addOption(b, menuId, fields))}
      />
    </section>
  );
}
