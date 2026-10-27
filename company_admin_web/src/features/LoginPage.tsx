import { useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import { Card, Heading } from "../components/ui";

export interface AdminLoginInput {
  adminId: number;
  password: string;
}

/** 현재 정책은 양수 MySQL INT입니다. 인증 요청과 별도로 교체할 수 있습니다. */
export function parseAdminLoginId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isInteger(id) && id <= 2_147_483_647 ? id : null;
}

export function AdminLoginForm({
  onSubmit,
  feedback,
}: {
  onSubmit(input: AdminLoginInput): void;
  feedback?: { kind: "notice" | "error"; message: string };
}) {
  const [adminId, setAdminId] = useState(""),
    [password, setPassword] = useState(""),
    [visible, setVisible] = useState(false),
    [errors, setErrors] = useState<{ adminId?: string; password?: string }>({});
  const idRef = useRef<HTMLInputElement>(null),
    passwordRef = useRef<HTMLInputElement>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = parseAdminLoginId(adminId.trim());
    const next = {
      adminId: id === null ? "관리자 ID는 1~2147483647 범위의 정수로 입력해 주세요." : undefined,
      password: password.length === 0 ? "비밀번호를 입력해 주세요." : undefined,
    };
    setErrors(next);
    if (next.adminId || next.password) {
      (next.adminId ? idRef : passwordRef).current?.focus();
      return;
    }
    // 미리보기에서는 부모가 전송하지 않습니다. 후속 인증 연결도 이 경계에서 처리합니다.
    onSubmit({ adminId: id!, password });
    setPassword("");
    setVisible(false);
  }

  return (
    <form className="login-form" onSubmit={submit} noValidate aria-label="관리자 로그인 입력">
      <label className="field form-field" htmlFor="admin-id">
        <span>관리자 ID</span>
        <input id="admin-id" ref={idRef} name="admin_id" type="text" inputMode="numeric"
          autoComplete="username" required value={adminId}
          aria-invalid={!!errors.adminId}
          aria-describedby={errors.adminId ? "admin-id-help admin-id-error" : "admin-id-help"}
          onChange={(e) => { setAdminId(e.target.value); setErrors((prev) => ({ ...prev, adminId: undefined })); }} />
      </label>
      <p id="admin-id-help" className="field-help">현재 관리자 ID는 숫자형 admin_id를 사용합니다.</p>
      {errors.adminId && <p id="admin-id-error" className="field-error" role="alert">{errors.adminId}</p>}
      <label className="field form-field" htmlFor="admin-password">
        <span>비밀번호</span>
        <span className="password-control">
          <input id="admin-password" ref={passwordRef} name="password" type={visible ? "text" : "password"}
            autoComplete="current-password" required value={password}
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? "admin-password-error" : undefined}
            onChange={(e) => { setPassword(e.target.value); setErrors((prev) => ({ ...prev, password: undefined })); }} />
          <button type="button" className="icon-button" aria-label={visible ? "비밀번호 숨기기" : "비밀번호 표시"}
            aria-pressed={visible} aria-controls="admin-password" onClick={() => setVisible((value) => !value)}>
            {visible ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
          </button>
        </span>
      </label>
      {errors.password && <p id="admin-password-error" className="field-error" role="alert">{errors.password}</p>}
      <button type="submit" className="button-primary">로그인</button>
      {feedback && <p className={feedback.kind === "error" ? "form-feedback error-text" : "form-feedback"}
        role={feedback.kind === "error" ? "alert" : "status"}>{feedback.message}</p>}
    </form>
  );
}

export function LoginPage() {
  const [submitted, setSubmitted] = useState(false);
  return (
    <main className="login-page">
      <div className="login-panel">
        <a className="login-brand" href="/" aria-label="AI-Voisk 관리자 화면">
          <ShieldCheck size={30} aria-hidden="true" />
          <span>AI-Voisk<small>회사 관리자 웹</small></span>
        </a>
        <Card>
          <Heading title="관리자 로그인">운영 관리 화면을 위한 로그인 UI 미리보기입니다.</Heading>
          <p className="notice login-notice">
            인증 API 미연동 · 현재 로그인할 수 없습니다.
            이 화면은 관리자 화면의 접근을 제한하지 않습니다.
          </p>
          <AdminLoginForm onSubmit={() => setSubmitted(true)}
            feedback={submitted ? {
              kind: "notice",
              message: "인증 API가 아직 연결되지 않아 로그인할 수 없습니다. 입력한 비밀번호는 전송하거나 저장하지 않습니다.",
            } : undefined} />
          <a className="login-preview-link" href="/">기존 관리자 화면 보기 (인증 없음)</a>
        </Card>
        <p className="login-caption">계정 인증·세션·권한 검사는 후속 작업입니다.</p>
      </div>
    </main>
  );
}
