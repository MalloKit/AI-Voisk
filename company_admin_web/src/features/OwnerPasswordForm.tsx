import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AdminApiError } from "../data/apiSession";
import type { ApiOwner } from "../data/models";
import type { OwnerRepository } from "../data/ownerRepository";
import { useAsync } from "../hooks/useAsync";

export function OwnerPasswordForm({ repository, owner, formId, onBusy, onSaved }: {
  repository: OwnerRepository;
  owner: ApiOwner;
  formId: string;
  onBusy(busy: boolean): void;
  onSaved(): void;
}) {
  const load = useCallback((signal: AbortSignal) => repository.detail(owner.id, signal), [repository, owner.id]);
  const result = useAsync(load);
  const stores = result.data?.stores ?? [];
  const [storeId, setStoreId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const selected = stores.find((store) => String(store.id) === storeId)
    ?? (stores.length === 1 ? stores[0] : undefined);
  useEffect(() => () => controller.current?.abort(), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current || result.loading || result.error || !repository.resetPasswordFromStore) return;
    if (!selected) {
      setMessage(stores.length ? "초기화 기준 매장을 선택해 주세요." : "연결된 매장이 없어 초기화할 수 없습니다.");
      return;
    }
    setMessage("");
    pending.current = true;
    setBusy(true);
    onBusy(true);
    const abort = new AbortController();
    controller.current = abort;
    try {
      await repository.resetPasswordFromStore(owner.id, selected.id, abort.signal);
      if (!abort.signal.aborted) onSaved();
    } catch (error) {
      if (!abort.signal.aborted) {
        setMessage(error instanceof AdminApiError ? error.message
          : "비밀번호 변경 결과를 확인할 수 없습니다. 연결 상태를 확인한 후 다시 시도해 주세요.");
        if (error instanceof AdminApiError && error.status === 409) {
          setStoreId("");
          result.reload();
        }
      }
    } finally {
      if (!abort.signal.aborted) {
        pending.current = false;
        setBusy(false);
        onBusy(false);
      }
    }
  }

  return <form id={formId} className="store-form" onSubmit={submit} noValidate aria-busy={busy}>
    <label className="field form-field"><span>로그인 ID</span>
      <input value={owner.loginId} readOnly />
    </label>
    {result.loading ? <p role="status">연결 매장을 불러오는 중…</p>
      : result.error ? <p role="alert">연결 매장을 불러오지 못했습니다. <button type="button" onClick={result.reload}>다시 불러오기</button></p>
      : stores.length === 0 ? <p>연결된 매장이 없어 초기화할 수 없습니다.</p>
      : <label className="field"><span>초기화 기준 매장</span>
        <select value={selected ? String(selected.id) : ""} disabled={busy}
          onChange={(e) => { setStoreId(e.target.value); setMessage(""); }}>
          <option value="">선택해 주세요</option>
          {stores.map((store) => <option key={store.id} value={store.id}>{store.name} (#{store.id})</option>)}
        </select>
      </label>}
    <p className="muted">초기 비밀번호는 선택한 매장 전화번호의 마지막 숫자 8자리입니다. 초기화하면 이 점주의 기존 로그인 세션이 종료됩니다.</p>
    {message && <p role="alert" className="form-feedback">{message}</p>}
    {busy && <p role="status">변경 중… 창을 닫지 마세요.</p>}
  </form>;
}
