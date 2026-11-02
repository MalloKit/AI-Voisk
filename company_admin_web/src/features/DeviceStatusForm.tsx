import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ApiDevice } from "../data/models";
import type { DeviceRepository } from "../data/deviceRepository";
import { AdminApiError } from "../data/apiSession";

export function DeviceStatusForm({ device, repository, formId, onBusy, onSaved }: {
  device: ApiDevice; repository: DeviceRepository; formId: string;
  onBusy(value: boolean): void; onSaved(device: ApiDevice): void;
}) {
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [conflict, setConflict] = useState(false), [message, setMessage] = useState("");
  const pending = useRef(false), controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current || conflict) return;
    if (!confirmed) { setMessage("상태 변경 내용을 확인해 주세요."); return; }
    if (!repository.setStatus) return;
    pending.current = true; setBusy(true); onBusy(true); setMessage("");
    const abort = new AbortController(); controller.current = abort;
    try {
      const saved = await repository.setStatus(device.device_id, { is_active: !device.is_active, expected_is_active: device.is_active }, abort.signal);
      if (!abort.signal.aborted) onSaved(saved);
    } catch (error) {
      if (!abort.signal.aborted) {
        const stale = error instanceof AdminApiError && [404, 409].includes(error.status);
        setConflict(stale);
        setMessage(stale ? "기기 정보가 변경되었습니다. 취소 후 실제 상세를 다시 조회해 주세요."
          : error instanceof AdminApiError ? error.message : "변경 결과를 확인할 수 없습니다. 취소 후 목록과 상세를 새로 조회해 주세요.");
      }
    } finally { if (!abort.signal.aborted) { pending.current = false; setBusy(false); onBusy(false); } }
  }
  return <form id={formId} className="store-form owner-connection-form" onSubmit={submit} aria-busy={busy}>
    <p><strong>{device.device_code}</strong> · {device.store_name}<br />현재 상태: {device.is_active ? "활성" : "비활성"}</p>
    <p>{device.is_active ? "이 기기를 비활성화하면 신규 주문이 제한됩니다. 이미 처리된 주문은 취소되지 않습니다."
      : "이 기기를 활성화하면 신규 주문이 허용될 수 있습니다."}</p>
    <p>활성 상태는 온라인 연결 상태가 아닙니다. 연결 상태는 미확인입니다.</p>
    <label className="owner-confirm"><input type="checkbox" disabled={busy || conflict} checked={confirmed}
      onChange={(e) => { setConfirmed(e.target.checked); setMessage(""); }} />상태 변경 내용을 확인했습니다.</label>
    {message && <p role="alert" className="form-feedback">{message}</p>}
    {busy && <p role="status">저장 중… 창을 닫지 마세요.</p>}
  </form>;
}
