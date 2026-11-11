import { useId, type ReactNode, type Ref } from "react";

// 편집 폼 공통 입력. 오류 문구는 aria-describedby로 입력과 연결한다.
export function TextField({
  label,
  value,
  onChange,
  maxLength,
  error,
  multiline = false,
  inputMode,
  hint,
  placeholder,
  inputRef,
  list,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  maxLength?: number;
  error?: string | null;
  multiline?: boolean;
  inputMode?: "numeric";
  hint?: ReactNode;
  placeholder?: string;
  inputRef?: Ref<HTMLInputElement>;
  // 입력 제안 목록(<datalist>)의 id. 한 줄 입력에만 쓴다.
  list?: string;
}) {
  const id = useId();
  const props = {
    id,
    value,
    maxLength,
    placeholder,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": `${id}-help`,
  };
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea
          {...props}
          rows={3}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          {...props}
          ref={inputRef}
          inputMode={inputMode}
          list={list}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      <div id={`${id}-help`} className="form-help">
        {error ? (
          <span className="error-text">{error}</span>
        ) : (
          <span>{hint}</span>
        )}
        {maxLength !== undefined && (
          <span className="counter">
            {value.length}/{maxLength}
          </span>
        )}
      </div>
    </div>
  );
}

export function Switch({
  label,
  checked,
  onChange,
  disabled,
  note,
  tone = "brand",
}: {
  label: string;
  checked: boolean;
  onChange(checked: boolean): void;
  disabled?: boolean;
  note?: ReactNode;
  tone?: "brand" | "attention";
}) {
  return (
    <label className={`switch ${tone}`}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        {note ? `${label} ` : label}
        {note && <span className="switch-note">{note}</span>}
      </span>
    </label>
  );
}
