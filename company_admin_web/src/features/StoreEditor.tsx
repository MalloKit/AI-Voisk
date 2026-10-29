import { useEffect, useRef, useState, type FormEvent } from "react";
import { NumberInput } from "../components/NumberInput";
import { numberDigits, validPhone, validBusiness, formatNumber, canonicalNumber, sameNumber } from "../data/koreanNumbers";
import type { ApiStore } from "../data/models";
import type { StoreInput, StoreRepository } from "../data/storeRepository";

export const storeFields = [
  ["store_name", "매장명", 100], ["store_code", "우편번호", 5],
  ["store_type", "업종", 200], ["address", "주소", 200],
  ["address_detail", "상세 주소", 200], ["phone", "전화번호", 50],
  ["business_no", "사업자번호", 10], ["representative", "대표자명", 50],
] as const;
type Key = keyof StoreInput;
type Values = Record<Key, string>;
export function storeValues(store?: ApiStore | null): Values {
  return {
    store_name: store?.name ?? "", store_code: store?.storeCode ?? "",
    store_type: store?.type ?? "", address: store?.address ?? "",
    address_detail: store?.addressDetail ?? "", phone: store?.phone ?? "",
    business_no: store?.businessNo ?? "", representative: store?.representative ?? "",
  };
}
function unchanged(value: string, original: string, key: Key): boolean {
  // 원본이 비표준·공백을 포함해도 자동 정정하거나 PATCH에 포함하지 않습니다.
  return value === original || value.trim() === original ||
    ((key === "phone" || key === "business_no") && sameNumber(value, original, key === "phone" ? "phone" : "business"));
}
export function validateStore(values: Values, original?: Values): Partial<Record<Key, string>> {
  const errors: Partial<Record<Key, string>> = {};
  for (const [key, label, limit] of storeFields) {
    if (original && unchanged(values[key], original[key], key)) continue;
    const value = values[key].trim();
    if (!value && key !== "address_detail") errors[key] = label + "을(를) 입력해 주세요.";
    else if ((key === "phone" || key === "business_no") && /[\u0000-\u001f\u007f]/.test(values[key])) errors[key] = "제어 문자는 사용할 수 없습니다.";
    else if (Array.from(key === "business_no" ? numberDigits(value) ?? value : value).length > limit) errors[key] = limit + "자 이하로 입력해 주세요.";
    else if (/[\u0000-\u001f\u007f]/.test(value)) errors[key] = "제어 문자는 사용할 수 없습니다.";
    else if (key === "store_code" && !/^[0-9]{5}$/.test(value)) errors[key] = "우편번호는 숫자 5자리로 입력해 주세요.";
    else if (key === "business_no" && !validBusiness(value)) errors[key] = "사업자번호는 숫자 10자리로 입력해 주세요.";
    else if (key === "phone" && !validPhone(value)) errors[key] = "지원하는 국내 전화번호 형식과 자리수를 확인해 주세요.";
  }
  return errors;
}

export function StoreEditor({ store, repository, onSaved, onBusy, formId }: {
  store: ApiStore | null;
  repository: StoreRepository;
  onSaved(store: ApiStore): void;
  formId: string;
  onBusy(busy: boolean): void;
}) {
  const original = store ? storeValues(store) : undefined;
  const [values, setValues] = useState(() => {
    const initial = storeValues(store);
    if (validPhone(initial.phone)) initial.phone = formatNumber(initial.phone, "phone");
    if (validBusiness(initial.business_no)) initial.business_no = formatNumber(initial.business_no, "business");
    return initial;
  });
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    form.current?.querySelector("input")?.focus();
    return () => controller.current?.abort();
  }, []);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    const next = validateStore(values, original);
    setErrors(next); setMessage("");
    if (Object.keys(next).length) {
      form.current?.querySelector<HTMLInputElement>('[name="' + Object.keys(next)[0] + '"]')?.focus();
      return;
    }
    const cleaned = { ...values };
    for (const [key] of storeFields) cleaned[key] = values[key].trim();
    // Only changed values are sent on edit; legacy values are never normalized into PATCH.
    if (validPhone(cleaned.phone)) cleaned.phone = canonicalNumber(cleaned.phone, "phone");
    if (validBusiness(cleaned.business_no)) cleaned.business_no = canonicalNumber(cleaned.business_no, "business");
    const input: StoreInput = { ...cleaned, address_detail: cleaned.address_detail || null };
    const changes = Object.fromEntries(storeFields
      .filter(([key]) => original && !unchanged(values[key], original[key], key))
      .map(([key]) => [key, input[key]])) as Partial<StoreInput>;
    if (store && !Object.keys(changes).length) { setMessage("변경된 정보가 없습니다."); return; }
    pending.current = true; setBusy(true); onBusy(true);
    const abort = new AbortController(); controller.current = abort;
    try {
      const saved = store
        ? await repository.update!(store.id, changes, abort.signal)
        : await repository.create!(input, abort.signal);
      if (!abort.signal.aborted) onSaved(saved);
    } catch (error) {
      if (!abort.signal.aborted) setMessage(error instanceof Error && error.name === "AdminApiError"
        ? error.message
        : "저장 결과를 확인할 수 없습니다. 폼을 닫고 목록을 새로고침해 확인한 뒤 다시 시도해 주세요.");
    } finally {
      if (!abort.signal.aborted) { pending.current = false; setBusy(false); onBusy(false); }
    }
  }
  function updateValue(key: Key, value: string) {
    const next = { ...values, [key]: value };
    setValues(next);
    setErrors((previous) => ({ ...previous, [key]: previous[key] ? validateStore(next, original)[key] : undefined }));
  }
  return <form id={formId} ref={form} className="store-form" onSubmit={save} noValidate aria-busy={busy}>
    {store && <p className="form-feedback">* 필수 항목 · 우편번호와 사업자번호 중복을 허용합니다.
      변경한 항목만 검증·저장하며 기존 값은 자동 정정하지 않습니다. 담당 관리자·점주 연결은 유지합니다.</p>}
    <div className="store-form-grid">
      {storeFields.map(([key, label, limit]) => <label className="field form-field" key={key}>
        <span id={key + "-label"}>{label}{key !== "address_detail" && " *"}</span>
        {key === "phone" || key === "business_no" ? <NumberInput
          aria-labelledby={key + "-label"} name={key} value={values[key]} disabled={busy} required
          kind={key === "phone" ? "phone" : "business"} type="tel" inputMode={key === "phone" ? "tel" : "numeric"}
          aria-invalid={!!errors[key]} aria-describedby={errors[key] ? key + "-error" : store ? key + "-format" : undefined}
          onValueChange={(value) => updateValue(key, value)} />
          : <input aria-labelledby={key + "-label"} name={key} value={values[key]} disabled={busy}
            required={key !== "address_detail"} aria-invalid={!!errors[key]}
            aria-describedby={errors[key] ? key + "-error" : undefined}
            inputMode={key === "store_code" ? "numeric" : undefined}
            onChange={(event) => updateValue(key, event.target.value)} />}
        {errors[key] && <p id={key + "-error"} className="field-error">{errors[key]}</p>}
        {store && key !== "phone" && key !== "business_no" && <small className="field-help">최대 {limit}자</small>}
        {store && key === "business_no" && <small id="business_no-format" className="field-help">숫자 10자리 · 000-00-00000 자동 표시</small>}
        {store && key === "phone" && <small id="phone-format" className="field-help">010·02·070 등 · 하이픈 자동 표시</small>}
      </label>)}
    </div>
    {message && <p role="alert" className="form-feedback">{message}</p>}
    {busy && <p role="status">저장 중… 창을 닫지 마세요.</p>}
  </form>;
}
