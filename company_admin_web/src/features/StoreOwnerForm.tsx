import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ApiOwner, ApiStore } from "../data/models";
import type { StoreRepository } from "../data/storeRepository";
import type { AsyncResult } from "../hooks/useAsync";
import { AdminApiError } from "../data/apiSession";
import { ErrorState, Loading } from "../components/ui";

export function StoreOwnerForm({ store, repository, ownersResult, formId, onBusy, onSaved }: {
  store: ApiStore; repository: StoreRepository; ownersResult: AsyncResult<ApiOwner[]>; formId: string;
  onBusy(busy: boolean): void; onSaved(store: ApiStore): void;
}) {
  const [selected, setSelected] = useState(String(store.ownerId ?? "")), [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [conflict, setConflict] = useState(false);
  const pending = useRef(false), controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const owners = ownersResult.data ?? [], ownerId = selected === "" ? null : Number(selected);
  const changed = ownerId !== store.ownerId, needsConfirmation = changed && store.ownerId !== null;
  const target = owners.find((o) => o.id === ownerId);
  const currentLabel = store.ownerId === null ? "미연결" : `${store.ownerLoginId ?? "로그인 ID 정보 없음"} · 점주 #${store.ownerId}`;
  const action = ownerId === null ? "연결 해제" : store.ownerId === null ? "연결" : "점주 변경";
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current || conflict || ownersResult.loading || ownersResult.error) return;
    if (!changed) { setMessage("변경할 점주를 선택해 주세요."); return; }
    if (ownerId !== null && !target) { setMessage("점주 목록을 새로 조회하고 대상을 확인해 주세요."); return; }
    if (needsConfirmation && !confirmed) { setMessage("현재 연결에 영향을 주는 변경 내용을 확인해 주세요."); return; }
    if (!repository.setOwner) return;
    pending.current = true; setBusy(true); onBusy(true); setMessage("");
    const abort = new AbortController(); controller.current = abort;
    try {
      const saved = await repository.setOwner(store.id, { owner_id: ownerId, expected_owner_id: store.ownerId }, abort.signal);
      if (!abort.signal.aborted) onSaved(saved);
    } catch (error) {
      if (!abort.signal.aborted) {
        const stale = error instanceof AdminApiError && [404, 409].includes(error.status);
        setConflict(stale);
        setMessage(stale ? "매장 또는 점주 정보가 변경되었습니다. 취소 후 매장 상세를 다시 조회해 주세요."
          : error instanceof AdminApiError ? error.message : "저장 결과를 확인할 수 없습니다. 취소 후 목록과 상세를 다시 조회해 주세요.");
      }
    } finally { if (!abort.signal.aborted) { pending.current = false; setBusy(false); onBusy(false); } }
  }
  return <form id={formId} className="store-form owner-connection-form" onSubmit={submit} aria-busy={busy}>
    <p><strong>{store.name}</strong><br />현재 점주: {currentLabel}</p>
    {ownersResult.loading ? <Loading text="점주 목록을 불러오는 중…" /> : ownersResult.error ?
      <ErrorState message="점주 목록 조회에 실패했습니다." onRetry={ownersResult.reload} /> : <>
      {!owners.length && <p className="form-feedback">등록된 점주 계정이 없습니다. 점주 계정 화면에서 계정을 먼저 생성해 주세요.</p>}
      <label className="field form-field"><span>연결할 점주</span>
        <select value={selected} disabled={busy || conflict} onChange={(e) => { setSelected(e.target.value); setConfirmed(false); setMessage(""); }}>
          <option value="">미연결 (연결 해제)</option>
          {store.ownerId !== null && !owners.some((o) => o.id === store.ownerId) && <option value={store.ownerId}>{currentLabel}</option>}
          {owners.map((o) => <option key={o.id} value={o.id}>{o.loginId} · 점주 #{o.id} · {o.storeCount}곳 연결</option>)}
        </select>
      </label>
      {changed && <p className="form-feedback">예정 작업: {action} · {currentLabel} → {target ? `${target.loginId} · 점주 #${target.id}` : "미연결"}</p>}
      {needsConfirmation && <label className="owner-confirm"><input type="checkbox" checked={confirmed} disabled={busy || conflict}
        onChange={(e) => { setConfirmed(e.target.checked); setMessage(""); }} />기존 점주 연결이 변경·해제되는 것을 확인했습니다.</label>}
    </>}
    {message && <p role="alert" className="form-feedback">{message}</p>}
    {busy && <p role="status">저장 중… 창을 닫지 마세요.</p>}
  </form>;
}
