import { useEffect, useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { AdminApiError } from "../data/apiSession";
import type { ApiOwner } from "../data/models";
import type { OwnerRepository } from "../data/ownerRepository";
import { validOwnerPassword } from "../data/ownerCredentials";

export function OwnerPasswordForm({ repository, owner, formId, onBusy, onSaved }: {
  repository: OwnerRepository; owner: ApiOwner; formId: string; onBusy(busy: boolean): void; onSaved(): void;
}) {
  const [password, setPassword] = useState(""), [confirm, setConfirm] = useState("");
  const [visible, setVisible] = useState(false), [confirmVisible, setConfirmVisible] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({}), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const pending = useRef(false), controller = useRef<AbortController | null>(null), form = useRef<HTMLFormElement>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    const next: Record<string, string> = {};
    if (!validOwnerPassword(password)) next.password = "8~128자를 입력해 주세요. 제어 문자는 사용할 수 없습니다.";
    if (!confirm || password !== confirm) next.confirm = "비밀번호 확인 값이 일치하지 않습니다.";
    setErrors(next); setMessage("");
    if (Object.keys(next).length) { queueMicrotask(() => form.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus()); return; }
    if (!repository.resetPassword) return;
    pending.current = true; setBusy(true); onBusy(true);
    const abort = new AbortController(); controller.current = abort;
    try {
      await repository.resetPassword(owner.id, password, abort.signal);
      if (!abort.signal.aborted) { setPassword(""); setConfirm(""); onSaved(); }
    } catch (error) {
      if (!abort.signal.aborted) setMessage(error instanceof AdminApiError ? error.message : "비밀번호 변경 결과를 확인할 수 없습니다. 연결 상태를 확인한 후 다시 시도해 주세요.");
    } finally { if (!abort.signal.aborted) { pending.current = false; setBusy(false); onBusy(false); } }
  }
  return <form id={formId} ref={form} className="store-form" onSubmit={submit} noValidate aria-busy={busy}>
    <label className="field form-field"><span>로그인 ID</span>
      <input value={owner.loginId} readOnly autoComplete="off" />
    </label>
    {([{ label: "새 비밀번호", value: password, change: setPassword, show: visible, toggle: () => setVisible(!visible), key: "password" },
      { label: "비밀번호 확인", value: confirm, change: setConfirm, show: confirmVisible, toggle: () => setConfirmVisible(!confirmVisible), key: "confirm" }]).map((field) => <label className="field form-field" key={field.key}>
      <span><span id={formId + field.key}>{field.label}</span> *</span>
      <div className="password-control"><input aria-labelledby={formId + field.key} type={field.show ? "text" : "password"}
        value={field.value} autoComplete="new-password" disabled={busy} required aria-invalid={!!errors[field.key]}
        aria-describedby={formId + field.key + "-help"} onChange={(e) => field.change(e.target.value)} />
        <button type="button" className="icon-button" disabled={busy} aria-label={field.label + (field.show ? " 숨기기" : " 표시")}
          aria-pressed={field.show} onClick={field.toggle}>{field.show ? <EyeOff size={19} /> : <Eye size={19} />}</button>
      </div><small id={formId + field.key + "-help"}>{errors[field.key] || (field.key === "password" ? "8~128자 · 앞뒤 공백도 비밀번호에 포함됩니다." : "새 비밀번호를 다시 입력해 주세요.")}</small>
    </label>)}
    {message && <p role="alert" className="form-feedback">{message}</p>}
    {busy && <p role="status">변경 중… 창을 닫지 마세요.</p>}
  </form>;
}
