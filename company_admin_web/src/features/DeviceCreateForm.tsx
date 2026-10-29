import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ApiDevice, ApiStore } from "../data/models";
import { validDeviceCode, type DeviceRepository } from "../data/deviceRepository";
import { AdminApiError } from "../data/apiSession";
import type { AsyncResult } from "../hooks/useAsync";
import { ErrorState, Loading } from "../components/ui";

export function DeviceCreateForm({ repository, storesResult, formId, onBusy, onSaved }: {
  repository: DeviceRepository; storesResult: AsyncResult<ApiStore[]>; formId: string;
  onBusy(value: boolean): void; onSaved(device: ApiDevice): void;
}) {
  const [code, setCode] = useState(""), [store, setStore] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({}), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const pending = useRef(false), controller = useRef<AbortController | null>(null), form = useRef<HTMLFormElement>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current || storesResult.loading || storesResult.error) return;
    const next: Record<string, string> = {};
    if (!validDeviceCode(code)) next.code = "영문 대·소문자, 숫자, 하이픈, 밑줄로 1~50자를 입력해 주세요.";
    if (!storesResult.data?.some((s) => s.id === Number(store))) next.store = "실제 설치 매장을 선택해 주세요.";
    setErrors(next); setMessage("");
    if (Object.keys(next).length) { queueMicrotask(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); return; }
    if (!repository.create) return;
    pending.current = true; setBusy(true); onBusy(true);
    const abort = new AbortController(); controller.current = abort;
    try {
      const saved = await repository.create({ device_code: code, store_id: Number(store) }, abort.signal);
      if (!abort.signal.aborted) onSaved(saved);
    } catch (error) {
      if (!abort.signal.aborted) setMessage(error instanceof AdminApiError ? error.message : "등록 결과를 확인할 수 없습니다. 목록을 새로 조회해 확인해 주세요.");
    } finally { if (!abort.signal.aborted) { pending.current = false; setBusy(false); onBusy(false); } }
  }
  return <form ref={form} id={formId} className="store-form" onSubmit={submit} noValidate aria-busy={busy}>
    <p>새 기기는 비활성 상태로 등록됩니다. 등록은 기기 인증이나 온라인 연결 성공을 의미하지 않습니다.</p>
    <label className="field form-field"><span>기기 코드 *</span>
      <input aria-label="기기 코드" autoComplete="off" required disabled={busy} value={code} aria-invalid={!!errors.code}
        aria-describedby={formId + "-code"} onChange={(e) => { setCode(e.target.value); setMessage(""); }} />
      <small id={formId + "-code"}>{errors.code || "영문 대·소문자·숫자·하이픈·밑줄, 1~50자 · 공백 불가"}</small>
    </label>
    {storesResult.loading ? <Loading text="설치 매장을 불러오는 중…" /> : storesResult.error ?
      <ErrorState message="실제 매장 조회에 실패했습니다." onRetry={storesResult.reload} /> : <>
      {!storesResult.data?.length && <p className="form-feedback">등록된 매장이 없습니다. 매장을 먼저 등록해 주세요.</p>}
      <label className="field form-field"><span>설치 매장 *</span>
        <select aria-label="설치 매장" value={store} required disabled={busy} aria-invalid={!!errors.store}
          aria-describedby={formId + "-store"} onChange={(e) => setStore(e.target.value)}>
          <option value="">매장 선택</option>
          {storesResult.data?.map((s) => <option key={s.id} value={s.id}>{s.name} · 매장 #{s.id}</option>)}
        </select><small id={formId + "-store"}>{errors.store}</small>
      </label>
    </>}
    {message && <p role="alert" className="form-feedback">{message}</p>}
    {busy && <p role="status">등록 중… 창을 닫지 마세요.</p>}
  </form>;
}
