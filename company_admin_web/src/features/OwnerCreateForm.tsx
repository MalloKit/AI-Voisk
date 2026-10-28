import { useEffect, useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { AdminApiError } from "../data/apiSession";
import type { ApiOwner } from "../data/models";
import type { OwnerRepository } from "../data/ownerRepository";
import { validOwnerLogin, validOwnerPassword } from "../data/ownerCredentials";

export function OwnerCreateForm({ repository, formId, onBusy, onSaved }: {
  repository: OwnerRepository; formId: string; onBusy(busy: boolean): void; onSaved(owner: ApiOwner): void;
}) {
  const [loginId, setLoginId] = useState(""), [password, setPassword] = useState(""), [confirm, setConfirm] = useState("");
  const [visible, setVisible] = useState(false), [confirmVisible, setConfirmVisible] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({}), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const pending = useRef(false), controller = useRef<AbortController | null>(null), form = useRef<HTMLFormElement>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    const next: Record<string, string> = {};
    if (!validOwnerLogin(loginId)) next.login = "소문자 영문·숫자·마침표·밑줄·하이픈으로 4~100자를 입력해 주세요.";
    if (!validOwnerPassword(password)) next.password = "8~128자를 입력해 주세요. 제어 문자는 사용할 수 없습니다.";
    if (!confirm || password !== confirm) next.confirm = "비밀번호 확인 값이 일치하지 않습니다.";
    setErrors(next); setMessage("");
    if (Object.keys(next).length) { queueMicrotask(() => form.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus()); return; }
    if (!repository.create) return;
    pending.current = true; setBusy(true); onBusy(true);
    const abort = new AbortController(); controller.current = abort;
    try {
      const saved = await repository.create({ login_id: loginId, password }, abort.signal);
      if (!abort.signal.aborted) { setPassword(""); setConfirm(""); onSaved(saved); }
    } catch (error) {
      if (!abort.signal.aborted) setMessage(error instanceof AdminApiError ? error.message : "계정 생성 결과를 확인할 수 없습니다. 목록을 새로고침해 확인한 뒤 다시 시도해 주세요.");
    } finally { if (!abort.signal.aborted) { pending.current = false; setBusy(false); onBusy(false); } }
  }
  return <form id={formId} ref={form} className="store-form" onSubmit={submit} noValidate aria-busy={busy}>
    <label className="field form-field"><span><span id={formId + "-login-label"}>로그인 ID</span> *</span>
      <input aria-labelledby={formId + "-login-label"} autoComplete="off" value={loginId} disabled={busy} required aria-invalid={!!errors.login}
        aria-describedby={formId + "-login-help"} onChange={(e) => { setLoginId(e.target.value); setMessage(""); }} />
      <small id={formId + "-login-help"}>{errors.login || "소문자 영문·숫자·마침표·밑줄·하이픈, 4~100자"}</small>
    </label>
    {([{ label: "초기 비밀번호", value: password, change: setPassword, show: visible, toggle: () => setVisible(!visible), key: "password" },
      { label: "비밀번호 확인", value: confirm, change: setConfirm, show: confirmVisible, toggle: () => setConfirmVisible(!confirmVisible), key: "confirm" }]).map((field) => <label className="field form-field" key={field.key}>
      <span><span id={formId + field.key}>{field.label}</span> *</span>
      <div className="password-control"><input aria-labelledby={formId + field.key} type={field.show ? "text" : "password"}
        value={field.value} autoComplete="new-password" disabled={busy} required aria-invalid={!!errors[field.key]}
        aria-describedby={formId + field.key + "-help"} onChange={(e) => field.change(e.target.value)} />
        <button type="button" className="icon-button" disabled={busy} aria-label={field.label + (field.show ? " 숨기기" : " 표시")}
          aria-pressed={field.show} onClick={field.toggle}>{field.show ? <EyeOff size={19} /> : <Eye size={19} />}</button>
      </div><small id={formId + field.key + "-help"}>{errors[field.key] || (field.key === "password" ? "8~128자 · 앞뒤 공백도 비밀번호에 포함됩니다." : "초기 비밀번호를 다시 입력해 주세요.")}</small>
    </label>)}
    {message && <p role="alert" className="form-feedback">{message}</p>}
    {busy && <p role="status">등록 중… 창을 닫지 마세요.</p>}
  </form>;
}
