import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import { App } from "./App";
import { LoginPage, type AdminLoginInput } from "./features/LoginPage";
import { ErrorState, Loading } from "./components/ui";
import { ApiAuthRepository, type AuthAdmin, type AuthRepository } from "./data/authRepository";
import { AdminApiError, localAdminBaseUrl, SESSION_EXPIRED } from "./data/apiSession.ts";

const defaultAuth = new ApiAuthRepository(localAdminBaseUrl(
  import.meta.env.VITE_ADMIN_AUTH_API_BASE_URL || import.meta.env.VITE_ORDER_API_BASE_URL || "http://127.0.0.1:8001",
));
type State =
  | { phase: "checking" }
  | { phase: "login"; busy?: boolean; message?: string; retry?: boolean; notice?: boolean }
  | { phase: "authenticated"; admin: AuthAdmin }
  | { phase: "logout"; error?: boolean };

function route(path: string) {
  if (window.location.pathname !== path) window.history.replaceState(null, "", path);
}
function failure(error: unknown): string {
  return error instanceof AdminApiError ? error.message
    : "인증 서버에 연결하지 못했습니다. 서버 연결을 확인한 뒤 다시 시도해 주세요.";
}

/** 서버 확인 이후에만 조회 앱을 마운트합니다. Mock 출처도 같은 인증을 거칩니다. */
export function AppEntry({
  authRepository = defaultAuth, ...appProps
}: ComponentProps<typeof App> & { authRepository?: AuthRepository }) {
  const [state, setState] = useState<State>({ phase: "checking" });
  const operation = useRef<AbortController | null>(null);
  const [checkVersion, setCheckVersion] = useState(0);

  const expire = useCallback(() => {
    operation.current?.abort();
    route("/login");
    setState({ phase: "login", message: "관리자 세션이 만료되었습니다. 다시 로그인해 주세요.", notice: true });
  }, []);

  useEffect(() => {
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setState({ phase: "checking" });
    authRepository.me(controller.signal).then(
      (admin) => {
        if (!controller.signal.aborted) {
          route("/");
          setState({ phase: "authenticated", admin });
        }
      },
      (error) => {
        if (!controller.signal.aborted) {
          route("/login");
          setState(error instanceof AdminApiError && error.status === 401
            ? { phase: "login" }
            : { phase: "login", message: failure(error), retry: true });
        }
      },
    );
    return () => controller.abort();
  }, [authRepository, checkVersion]);

  useEffect(() => {
    window.addEventListener(SESSION_EXPIRED, expire);
    return () => window.removeEventListener(SESSION_EXPIRED, expire);
  }, [expire]);

  useEffect(() => {
    if (state.phase !== "authenticated") return;
    let controller: AbortController | undefined;
    let stopped = false;
    const verify = () => {
      if (controller || document.visibilityState === "hidden") return;
      controller = new AbortController();
      const current = controller;
      authRepository.me(current.signal).then(
        (admin) => {
          if (!stopped && !current.signal.aborted) setState({ phase: "authenticated", admin });
        },
        (error) => {
          if (!stopped && !current.signal.aborted) {
            if (error instanceof AdminApiError && error.status === 401) expire();
            else {
              route("/login");
              setState({ phase: "login", message: failure(error), retry: true });
            }
          }
        },
      ).finally(() => { controller = undefined; });
    };
    const visible = () => { if (document.visibilityState === "visible") verify(); };
    const timer = window.setInterval(verify, 60_000);
    window.addEventListener("focus", verify);
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopped = true;
      controller?.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", verify);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [state.phase, authRepository, expire]);

  useEffect(() => () => operation.current?.abort(), []);

  async function login(input: AdminLoginInput) {
    if (state.phase !== "login" || state.busy) return;
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setState({ phase: "login", busy: true });
    try {
      const admin = await authRepository.login(input, controller.signal);
      if (!controller.signal.aborted) {
        route("/");
        setState({ phase: "authenticated", admin });
      }
    } catch (error) {
      if (!controller.signal.aborted) setState({ phase: "login", message: failure(error) });
    }
  }

  async function logout() {
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    // App을 즉시 내리므로 공유 목록·상세·진행 중 조회는 모두 폐기됩니다.
    setState({ phase: "logout" });
    try {
      await authRepository.logout(controller.signal);
      if (!controller.signal.aborted) {
        route("/login");
        setState({ phase: "login", message: "로그아웃되었습니다.", notice: true });
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof AdminApiError && error.status === 401) {
        route("/login");
        setState({ phase: "login", message: "세션이 종료되었습니다. 다시 로그인해 주세요.", notice: true });
      } else setState({ phase: "logout", error: true });
    }
  }

  if (state.phase === "checking")
    return <div className="app-state"><Loading text="관리자 세션을 확인하는 중…" /></div>;
  if (state.phase === "logout")
    return <div className="app-state">{state.error
      ? <ErrorState message="로그아웃 완료를 확인하지 못했습니다. 다시 시도해 주세요." onRetry={logout} />
      : <Loading text="로그아웃하는 중…" />}</div>;
  if (state.phase === "login")
    return <LoginPage onLogin={login} busy={state.busy} feedback={state.message
      ? { kind: state.notice ? "notice" : "error", message: state.message } : undefined}
      onRetrySession={state.retry ? () => setCheckVersion((value) => value + 1) : undefined} />;
  return <App key={state.admin.id} {...appProps} admin={state.admin} onLogout={logout} />;
}
