import { useState } from "react";
import {
  Ban,
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  RotateCcw,
} from "lucide-react";
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
  findStoppedOption,
  removeOption,
  stoppedOptions,
  updateOption,
} from "../../data/menuDraft";
import type { MenuDraft } from "./useMenuDraft";
import { Switch, TextField } from "./fields";

function OptionForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  findStopped,
  onResell,
}: {
  initial: { name: string; price: string };
  submitLabel: string;
  onSubmit(fields: { name: string; extraPrice: number }): void;
  onCancel?(): void;
  findStopped?(name: string): MenuOption | undefined;
  onResell?(option: MenuOption): void;
}) {
  const [name, setName] = useState(initial.name);
  const [price, setPrice] = useState(initial.price);
  const [touched, setTouched] = useState(false);
  const [askResell, setAskResell] = useState(false);
  const nameProblem = nameError(name, LIMITS.optionName, "옵션 이름");
  const priceResult = parseExtraPrice(price);
  // 되돌리기로 초안이 바뀌어도 맞도록 지금 초안에서 다시 찾는다.
  const stopped = askResell ? findStopped?.(name) : undefined;
  const clear = () => {
    setName(initial.name);
    setPrice(initial.price);
    setTouched(false);
    setAskResell(false);
  };
  return (
    <form
      className="option-form"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (nameProblem) return;
        if (findStopped?.(name)) {
          setAskResell(true);
          return;
        }
        if (priceResult.value === null) return;
        onSubmit({ name: name.trim(), extraPrice: priceResult.value });
        clear();
      }}
    >
      <TextField
        label="옵션 이름"
        value={name}
        onChange={(text) => {
          setName(text);
          setAskResell(false);
        }}
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
      {stopped ? (
        <div className="notice-box option-resell" role="alert">
          <p>같은 이름의 판매 중지된 옵션이 있습니다. 다시 판매할까요?</p>
          {/* 입력칸 기본값 0원으로 이전 금액을 덮어쓰지 않도록 저장된 금액을 유지한다. */}
          {priceResult.value !== stopped.extraPrice && (
            <p>
              이전 추가 금액 +{formatWon(stopped.extraPrice)}으로 돌아옵니다.
              금액은 다시 판매한 뒤 수정할 수 있습니다.
            </p>
          )}
          <div className="option-form-actions">
            <button type="button" onClick={() => setAskResell(false)}>
              취소
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => {
                onResell?.(stopped);
                clear();
              }}
            >
              다시 판매
            </button>
          </div>
        </div>
      ) : (
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
      )}
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
          aria-label={`${option.name} 판매 중지`}
          onClick={() => draft.edit((b) => removeOption(b, option.id))}
        >
          <Ban size={16} aria-hidden="true" />
          판매 중지
        </button>
      </div>
    </li>
  );
}

// 메뉴의 '숨긴 메뉴' 상자에 해당한다. 다시 판매도 초안에만 반영되고 저장 바로 저장한다.
function StoppedOptions({
  options,
  draft,
}: {
  options: MenuOption[];
  draft: MenuDraft;
}) {
  const [open, setOpen] = useState(false);
  if (!options.length) return null;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="stopped-options">
      <button
        type="button"
        className="stopped-options-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Chevron size={16} aria-hidden="true" />
        판매 중지된 옵션 ({options.length}개)
      </button>
      {open && (
        <ul className="option-list" aria-label="판매 중지된 옵션">
          {options.map((o) => {
            // 이번 초안에서 판매 중지한 옵션은 아직 저장 전이다.
            const unsaved = draft.saved.options.find(
              (s) => s.id === o.id,
            )?.isActive;
            return (
              <li
                key={o.id}
                className="option-row stopped"
                aria-label={`${o.name}${unsaved ? " · 저장 안 됨" : ""}`}
              >
                <div className="option-main">
                  <strong>
                    {o.name}
                    {unsaved && (
                      <span className="unsaved-dot inline" aria-hidden="true" />
                    )}
                  </strong>
                  <span className="muted">+{formatWon(o.extraPrice)}</span>
                </div>
                <button
                  type="button"
                  aria-label={`${o.name} 다시 판매`}
                  onClick={() =>
                    draft.edit((b) => updateOption(b, o.id, { isActive: true }))
                  }
                >
                  <RotateCcw size={16} aria-hidden="true" />
                  다시 판매
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
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
      <StoppedOptions
        options={stoppedOptions(draft.draft, menuId)}
        draft={draft}
      />
      <p className="muted">
        판매 중지한 옵션은 키오스크에 보이지 않습니다. 지난 주문 기록을 지키기
        위해 삭제하지 않으며, 언제든 다시 판매할 수 있습니다.
      </p>
      <h4>옵션 추가</h4>
      <OptionForm
        initial={{ name: "", price: "0" }}
        submitLabel="추가"
        onSubmit={(fields) => draft.edit((b) => addOption(b, menuId, fields))}
        findStopped={(name) => findStoppedOption(draft.draft, menuId, name)}
        onResell={(option) =>
          draft.edit((b) => updateOption(b, option.id, { isActive: true }))
        }
      />
    </section>
  );
}
