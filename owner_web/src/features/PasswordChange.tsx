import { useRef, useState, type FormEvent, type RefObject } from "react";
import { Eye, EyeOff, LogOut } from "lucide-react";
import {
  OWNER_PASSWORD_MAX,
  OWNER_PASSWORD_MIN,
  OwnerAuthError,
  PASSWORD_CHANGED,
  isUnauthorized,
  validOwnerPassword,
  type OwnerPasswordChangeInput,
} from "../data/ownerAuth";
import { AuthLayout, FeedbackText, type Feedback } from "./LoginPage";

export const TEMPORARY_NOTICE =
  "임시 비밀번호로 로그인했습니다. 새 비밀번호로 바꿔 주세요.";
const NETWORK_ERROR =
  "인증 서버에 연결하지 못했습니다. 서버 연결을 확인한 뒤 다시 시도해 주세요.";

type Field = "current" | "next" | "confirm";

function PasswordField({
  id,
  label,
  value,
  error,
  autoComplete,
  disabled,
  inputRef,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  autoComplete: string;
  disabled: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange(value: string): void;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <span className="password-control">
        <input
          id={id}
          ref={inputRef}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          disabled={disabled}
          value={value}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="icon-button"
          disabled={disabled}
          aria-label={visible ? `${label} 숨기기` : `${label} 표시`}
          aria-pressed={visible}
          aria-controls={id}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? (
            <EyeOff size={20} aria-hidden="true" />
          ) : (
            <Eye size={20} aria-hidden="true" />
          )}
        </button>
      </span>
      {error && (
        <p id={`${id}-error`} className="error-text field-error">
          {error}
        </p>
      )}
    </div>
  );
}

// 현재 비밀번호·새 비밀번호·새 비밀번호 확인 입력. 확인 값은 여기서만 비교하고 onChange에 넘기지 않는다.
// 입력값은 컴포넌트 상태에만 있고 브라우저 저장소에 두지 않는다.
export function PasswordChangeForm({
  onChange,
  onExpired,
  onChanged,
}: {
  // 성공하면 resolve, 실패하면 OwnerAuthError를 던진다.
  onChange(input: OwnerPasswordChangeInput): Promise<unknown>;
  // 로그인 만료(401)면 호출한다. 부모가 로그인 화면으로 보낸다.
  onExpired?(): void;
  onChanged?(): void;
}) {
  const [values, setValues] = useState({ current: "", next: "", confirm: "" });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();
  const refs = {
    current: useRef<HTMLInputElement>(null),
    next: useRef<HTMLInputElement>(null),
    confirm: useRef<HTMLInputElement>(null),
  };

  function update(field: Field, value: string) {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
    setFeedback(undefined);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const { current, next, confirm } = values;
    const found: Partial<Record<Field, string>> = {
      current: current ? undefined : "현재 비밀번호를 입력해 주세요.",
      next: !validOwnerPassword(next)
        ? `새 비밀번호는 ${OWNER_PASSWORD_MIN}~${OWNER_PASSWORD_MAX}자로 입력해 주세요. 공백만 쓰거나 줄바꿈 같은 제어 문자는 넣을 수 없습니다.`
        : next === current
          ? "새 비밀번호는 현재 비밀번호와 달라야 합니다."
          : undefined,
      confirm:
        confirm === next ? undefined : "새 비밀번호 확인이 일치하지 않습니다.",
    };
    setErrors(found);
    setFeedback(undefined);
    const first = (["current", "next", "confirm"] as const).find(
      (f) => found[f],
    );
    if (first) {
      refs[first].current?.focus();
      return;
    }
    setBusy(true);
    try {
      await onChange({ currentPassword: current, newPassword: next });
      setValues({ current: "", next: "", confirm: "" });
      setFeedback({ kind: "notice", message: PASSWORD_CHANGED });
      onChanged?.();
    } catch (error) {
      if (isUnauthorized(error)) {
        onExpired?.();
        return;
      }
      if (error instanceof OwnerAuthError && error.status === 401)
        setValues((v) => ({ ...v, current: "" }));
      setFeedback({
        kind: "error",
        message:
          error instanceof OwnerAuthError ? error.message : NETWORK_ERROR,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="login-form password-change-form"
      onSubmit={(e) => void submit(e)}
      noValidate
      aria-busy={busy}
      aria-label="비밀번호 변경 입력"
    >
      <PasswordField
        id="owner-current-password"
        label="현재 비밀번호"
        autoComplete="current-password"
        value={values.current}
        error={errors.current}
        disabled={busy}
        inputRef={refs.current}
        onChange={(v) => update("current", v)}
      />
      <PasswordField
        id="owner-new-password"
        label="새 비밀번호"
        autoComplete="new-password"
        value={values.next}
        error={errors.next}
        disabled={busy}
        inputRef={refs.next}
        onChange={(v) => update("next", v)}
      />
      <PasswordField
        id="owner-new-password-confirm"
        label="새 비밀번호 확인"
        autoComplete="new-password"
        value={values.confirm}
        error={errors.confirm}
        disabled={busy}
        inputRef={refs.confirm}
        onChange={(v) => update("confirm", v)}
      />
      <p className="muted password-rule">
        {OWNER_PASSWORD_MIN}~{OWNER_PASSWORD_MAX}자. 현재 비밀번호와 매장
        전화번호로 만든 값은 쓸 수 없습니다. 바꾸면 다른 기기의 로그인은
        끊깁니다.
      </p>
      <button type="submit" className="primary login-submit" disabled={busy}>
        {busy ? "변경 중…" : "비밀번호 변경"}
      </button>
      <FeedbackText feedback={feedback} />
    </form>
  );
}

// 임시 비밀번호로 로그인했을 때 다른 화면 대신 보이는 화면. 로그아웃은 할 수 있다.
export function TemporaryPasswordPage({
  loginId,
  changed,
  onChange,
  onExpired,
  onContinue,
  onLogout,
}: {
  loginId: string;
  changed: boolean;
  onChange(input: OwnerPasswordChangeInput): Promise<unknown>;
  onExpired(): void;
  onContinue(): void;
  onLogout(): void;
}) {
  return (
    <AuthLayout title="비밀번호 변경">
      <p className="muted">{loginId} 계정으로 로그인했습니다.</p>
      {changed ? (
        <>
          <p className="form-feedback notice-feedback" role="status">
            {PASSWORD_CHANGED}
          </p>
          <button className="primary login-submit" onClick={onContinue}>
            매장 화면으로 이동
          </button>
        </>
      ) : (
        <>
          <p className="notice-box" role="note">
            {TEMPORARY_NOTICE}
          </p>
          <PasswordChangeForm onChange={onChange} onExpired={onExpired} />
        </>
      )}
      <button className="logout-button" onClick={onLogout}>
        <LogOut size={16} aria-hidden="true" />
        로그아웃
      </button>
    </AuthLayout>
  );
}
