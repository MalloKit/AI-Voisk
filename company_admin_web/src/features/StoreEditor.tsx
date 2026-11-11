import { useEffect, useRef, useState, type FormEvent } from "react";
import { PostcodeSearch } from "./PostcodeSearch";
import { LimitedInput } from "../components/LimitedInput";
import { NumberInput } from "../components/NumberInput";
import { numberDigits, validPhone, validBusiness, canonicalNumber, sameNumber } from "../data/koreanNumbers";
import { validOwnerLogin } from "../data/ownerCredentials";
import type { AsyncResult } from "../hooks/useAsync";
import type { ApiOwner, ApiStore } from "../data/models";
import type { StoreCreateInput, StoreInput, StoreRepository } from "../data/storeRepository";

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

export function StoreEditor({ store, repository, onSaved, onBusy, formId, ownersResult }: {
  store: ApiStore | null;
  repository: StoreRepository;
  onSaved(store: ApiStore): void;
  formId: string;
  onBusy(busy: boolean): void;
  ownersResult?: AsyncResult<ApiOwner[]>;
}) {
  const original = store ? storeValues(store) : undefined;
  const [values, setValues] = useState(() => storeValues(store));
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const [ownerMode, setOwnerMode] = useState<"none" | "existing" | "new">("none");
  const [ownerId, setOwnerId] = useState("");
  const [loginId, setLoginId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [searchingAddress, setSearchingAddress] = useState(false);
  const addressButton = useRef<HTMLButtonElement>(null);
  const pending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    form.current?.querySelector("input")?.focus();
    return () => controller.current?.abort();
  }, []);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending.current || searchingAddress) return;
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
    const registration: StoreCreateInput = { ...input };
    if (!store && ownersResult && ownerMode === "existing") {
      if (ownersResult.loading || ownersResult.error ||
          !ownersResult.data?.some((owner) => String(owner.id) === ownerId)) {
        setMessage("연결할 점주 계정을 선택해 주세요.");
        return;
      }
      registration.owner_connection = { kind: "existing", owner_id: Number(ownerId) };
    }
    if (!store && ownersResult && ownerMode === "new") {
      if (!validOwnerLogin(loginId)) {
        setMessage("점주 로그인 ID는 소문자 영문·숫자·마침표·밑줄·하이픈으로 4~100자를 입력해 주세요.");
        return;
      }
      if ((numberDigits(input.phone)?.length ?? 0) < 8) {
        setMessage("새 점주 계정을 연결하려면 전화번호가 숫자 8자리 이상이어야 합니다.");
        return;
      }
      registration.owner_connection = { kind: "new", login_id: loginId };
    }
    const changes = Object.fromEntries(storeFields
      .filter(([key]) => original && !unchanged(values[key], original[key], key))
      .map(([key]) => [key, input[key]])) as Partial<StoreInput>;
    if (store && !Object.keys(changes).length) { setMessage("변경된 정보가 없습니다."); return; }
    pending.current = true; setBusy(true); onBusy(true);
    const abort = new AbortController(); controller.current = abort;
    try {
      const saved = store
        ? await repository.update!(store.id, changes, abort.signal)
        : await repository.create!(registration, abort.signal);
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
  function closeAddressSearch() {
    setSearchingAddress(false);
    addressButton.current?.focus();
  }
  return <form id={formId} ref={form} className="store-form" onSubmit={save} noValidate aria-busy={busy}>
    <div className="store-form-grid">
      {storeFields.map(([key, label, limit]) => <div className="field form-field" key={key}>
        <span id={key + "-label"}>{label}{key !== "address_detail" && " *"}</span>
        {key === "phone" || key === "business_no" ? <NumberInput
          aria-labelledby={key + "-label"} name={key} value={values[key]} disabled={busy} required
          kind={key === "phone" ? "phone" : "business"} type="tel" inputMode={key === "phone" ? "tel" : "numeric"}
          aria-invalid={!!errors[key]} aria-describedby={errors[key] ? key + "-error" : undefined}
          maxDigits={key === "phone" ? 11 : 10} originalValue={original?.[key]}
          onRejected={() => setErrors((previous) => ({ ...previous, [key]: `숫자는 최대 ${key === "phone" ? 11 : 10}자리이며 지원하는 문자만 입력해 주세요.` }))}
          onValueChange={(value) => updateValue(key, value)} />
          : <div style={key === "store_code" ? { display: "flex", gap: "var(--sm)" } : undefined}><LimitedInput aria-labelledby={key + "-label"} name={key} value={values[key]} disabled={busy}
            required={key !== "address_detail"} aria-invalid={!!errors[key]}
            aria-describedby={errors[key] ? key + "-error" : undefined}
            inputMode={key === "store_code" ? "numeric" : undefined}
            rule={{ max: limit, kind: key === "store_code" ? "postcode" : "text", original: original?.[key] }}
            onRejected={() => setErrors((previous) => ({ ...previous, [key]: key === "store_code" ? "우편번호는 숫자 5자리까지 입력해 주세요." : `${limit}자 이하로 입력해 주세요.` }))}
            onValueChange={(value) => updateValue(key, value)} />
            {key === "store_code" && <button ref={addressButton} type="button"
              style={{ flexShrink: 0, whiteSpace: "nowrap" }} disabled={busy}
              aria-expanded={searchingAddress} onClick={() => setSearchingAddress(true)}>주소 검색</button>}
          </div>}
        {errors[key] && <p id={key + "-error"} className="field-error">{errors[key]}</p>}
      </div>)}
    </div>
    {searchingAddress && <PostcodeSearch onClose={closeAddressSearch} onSelect={({ zonecode, address }) => {
      setValues((previous) => ({ ...previous, store_code: zonecode, address }));
      setErrors((previous) => ({ ...previous, store_code: undefined, address: undefined }));
      closeAddressSearch();
    }} />}
    {!store && ownersResult && <fieldset className="store-form">
      <legend>점주 연결</legend>
      <label className="field"><span>연결 방식</span>
        <select value={ownerMode} disabled={busy}
          onChange={(e) => { setOwnerMode(e.target.value as typeof ownerMode); setMessage(""); }}>
          <option value="none">연결하지 않음</option>
          <option value="existing">기존 점주 계정 연결</option>
          <option value="new">새 점주 계정 생성 및 연결</option>
        </select>
      </label>
      {ownerMode === "existing" && <>
        {ownersResult.loading ? <p role="status">점주 목록을 불러오는 중…</p>
          : ownersResult.error ? <p role="alert">점주 목록을 불러올 수 없습니다. <button type="button"
            disabled={busy} onClick={ownersResult.reload}>다시 불러오기</button></p>
          : <label className="field"><span>연결할 점주</span>
            <select value={ownerId} disabled={busy} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">선택해 주세요</option>
              {ownersResult.data?.map((owner) => <option value={owner.id} key={owner.id}>{owner.loginId}</option>)}
            </select>
          </label>}
      </>}
      {ownerMode === "new" && <label className="field form-field"><span>새 점주 로그인 ID</span>
        <input value={loginId} disabled={busy} autoComplete="off" onChange={(e) => setLoginId(e.target.value)} />
        <small>시연용 초기 비밀번호는 매장 전화번호의 마지막 숫자 8자리입니다.</small>
      </label>}
    </fieldset>}
    {message && <p role="alert" className="form-feedback">{message}</p>}
    {busy && <p role="status">저장 중… 창을 닫지 마세요.</p>}
  </form>;
}
