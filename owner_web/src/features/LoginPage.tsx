import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Eye, EyeOff, FlaskConical, LogOut, Store } from "lucide-react";
import { Card } from "../components/ui";
import {
  OWNER_LOGIN_ID_MAX,
  OWNER_LOGIN_ID_MIN,
  OWNER_PASSWORD_MAX,
  OWNER_PASSWORD_MIN,
  validOwnerLoginId,
  validOwnerPassword,
  type AuthOwner,
  type OwnerLoginInput,
} from "../data/ownerAuth";
import type { MockOwnerAccount } from "../data/mock/mockOwnerAccounts";

export type Feedback = { kind: "notice" | "error"; message: string };

function AuthLayout({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="login-page">
      <div className="login-panel">
        <div className="login-brand">
          <Store size={28} aria-hidden="true" />
          <span>AI-Voisk 점주</span>
        </div>
        <Card>
          <h1>{title}</h1>
          {children}
        </Card>
      </div>
    </main>
  );
}

function FeedbackText({ feedback }: { feedback?: Feedback }) {
  if (!feedback) return null;
  return feedback.kind === "error" ? (
    <p className="form-feedback error-text" role="alert">
      {feedback.message}
    </p>
  ) : (
    <p className="form-feedback notice-feedback" role="status">
      {feedback.message}
    </p>
  );
}

// 개발용 Mock 계정 안내. Mock 인증일 때만 보인다.
function DevAccounts({ accounts }: { accounts: MockOwnerAccount[] }) {
  return (
    <section className="dev-accounts" aria-labelledby="dev-accounts-title">
      <h2 id="dev-accounts-title">
        <FlaskConical size={18} aria-hidden="true" />
        개발용 Mock 계정
      </h2>
      <p>
        서버에 점주 인증 API가 생기기 전 Mock 모드에서만 동작합니다. 실제 운영
        계정이 아닙니다.
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">로그인 ID</th>
            <th scope="col">비밀번호</th>
            <th scope="col">연결 매장</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.loginId}>
              <td>
                <code>{a.loginId}</code>
              </td>
              <td>
                <code>{a.password}</code>
              </td>
              <td>{a.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function LoginPage({
  onLogin,
  busy = false,
  feedback,
  devAccounts,
  onRetrySession,
}: {
  onLogin(input: OwnerLoginInput): void;
  busy?: boolean;
  feedback?: Feedback;
  devAccounts?: MockOwnerAccount[];
  onRetrySession?(): void;
}) {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [errors, setErrors] = useState<{ loginId?: string; password?: string }>(
    {},
  );
  const idRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const next = {
      loginId: validOwnerLoginId(loginId)
        ? undefined
        : `로그인 ID는 소문자 영문·숫자·마침표(.)·밑줄(_)·하이픈(-)으로 ${OWNER_LOGIN_ID_MIN}~${OWNER_LOGIN_ID_MAX}자입니다.`,
      password: validOwnerPassword(password)
        ? undefined
        : `비밀번호는 ${OWNER_PASSWORD_MIN}~${OWNER_PASSWORD_MAX}자로 입력해 주세요.`,
    };
    setErrors(next);
    if (next.loginId || next.password) {
      (next.loginId ? idRef : passwordRef).current?.focus();
      return;
    }
    // 입력값은 부모의 인증 요청에만 넘기고 어디에도 저장하지 않는다.
    onLogin({ loginId, password });
    setPassword("");
    setVisible(false);
  }

  return (
    <AuthLayout title="점주 로그인">
      <form
        className="login-form"
        onSubmit={submit}
        noValidate
        aria-busy={busy}
        aria-label="점주 로그인 입력"
      >
        <div className="form-field">
          <label htmlFor="owner-login-id">로그인 ID</label>
          <input
            id="owner-login-id"
            ref={idRef}
            name="login_id"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            disabled={busy}
            value={loginId}
            aria-invalid={!!errors.loginId}
            aria-describedby={
              errors.loginId ? "owner-login-id-error" : undefined
            }
            onChange={(e) => {
              setLoginId(e.target.value);
              setErrors((prev) => ({ ...prev, loginId: undefined }));
            }}
          />
          {errors.loginId && (
            <p id="owner-login-id-error" className="error-text field-error">
              {errors.loginId}
            </p>
          )}
        </div>
        <div className="form-field">
          <label htmlFor="owner-password">비밀번호</label>
          <span className="password-control">
            <input
              id="owner-password"
              ref={passwordRef}
              name="password"
              type={visible ? "text" : "password"}
              autoComplete="current-password"
              disabled={busy}
              value={password}
              aria-invalid={!!errors.password}
              aria-describedby={
                errors.password ? "owner-password-error" : undefined
              }
              onChange={(e) => {
                setPassword(e.target.value);
                setErrors((prev) => ({ ...prev, password: undefined }));
              }}
            />
            <button
              type="button"
              className="icon-button"
              disabled={busy}
              aria-label={visible ? "비밀번호 숨기기" : "비밀번호 표시"}
              aria-pressed={visible}
              aria-controls="owner-password"
              onClick={() => setVisible((v) => !v)}
            >
              {visible ? (
                <EyeOff size={20} aria-hidden="true" />
              ) : (
                <Eye size={20} aria-hidden="true" />
              )}
            </button>
          </span>
          {errors.password && (
            <p id="owner-password-error" className="error-text field-error">
              {errors.password}
            </p>
          )}
        </div>
        <button type="submit" className="primary login-submit" disabled={busy}>
          {busy ? "로그인 중…" : "로그인"}
        </button>
        <FeedbackText feedback={feedback} />
        {onRetrySession && (
          <button type="button" onClick={onRetrySession} disabled={busy}>
            로그인 상태 다시 확인
          </button>
        )}
      </form>
      {devAccounts && <DevAccounts accounts={devAccounts} />}
    </AuthLayout>
  );
}

// 로그인한 점주의 매장이 여러 개면 고르고, 없으면 안내한다.
export function StoreSelectPage({
  owner,
  onSelect,
  onLogout,
}: {
  owner: AuthOwner;
  onSelect(storeId: number): void;
  onLogout(): void;
}) {
  return (
    <AuthLayout title={owner.stores.length ? "매장 선택" : "연결된 매장 없음"}>
      <p className="muted">{owner.loginId} 계정으로 로그인했습니다.</p>
      {owner.stores.length ? (
        <ul className="store-choices" aria-label="연결된 매장">
          {owner.stores.map((s) => (
            <li key={s.storeId}>
              <button onClick={() => onSelect(s.storeId)}>
                <Store size={20} aria-hidden="true" />
                <span>{s.storeName}</span>
                <span className="muted">매장 번호 {s.storeId}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="notice-box" role="status">
          연결된 매장이 없습니다. 회사 관리자에게 문의해 주세요.
        </p>
      )}
      <button className="logout-button" onClick={onLogout}>
        <LogOut size={16} aria-hidden="true" />
        로그아웃
      </button>
    </AuthLayout>
  );
}
