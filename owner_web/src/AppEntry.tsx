import { useCallback, useEffect, useRef, useState } from "react";
import { App } from "./App";
import { ErrorState, Loading } from "./components/ui";
import {
  LoginPage,
  StoreSelectPage,
  type Feedback,
} from "./features/LoginPage";
import {
  MockOwnerRepository,
  type OwnerRepository,
} from "./data/ownerRepository";
import {
  ApiOwnerAuthRepository,
  MockOwnerAuthRepository,
  type OwnerAuthRepository,
} from "./data/ownerAuthRepository";
import {
  OWNER_SESSION_EXPIRED,
  OwnerAuthError,
  isUnauthorized,
  type AuthOwner,
  type OwnerLoginInput,
} from "./data/ownerAuth";
import { DEMO_NOW } from "./data/demoClock";

// 인증 출처. 서버에 점주 인증 API가 생기면 VITE_OWNER_AUTH_SOURCE=api로 바꾼다.
// 메뉴·주문 데이터는 아직 점주용 서버 API가 없어 두 경우 모두 Mock Repository를 쓴다.
const defaultAuth: OwnerAuthRepository =
  import.meta.env.VITE_OWNER_AUTH_SOURCE === "api"
    ? new ApiOwnerAuthRepository(
        import.meta.env.VITE_OWNER_API_BASE_URL || "http://127.0.0.1:8001",
      )
    : new MockOwnerAuthRepository();
const defaultCreateRepository = (storeId: number): OwnerRepository =>
  new MockOwnerRepository(storeId);

type State =
  | { phase: "checking" }
  | { phase: "login"; busy?: boolean; feedback?: Feedback; retry?: boolean }
  | { phase: "stores"; owner: AuthOwner }
  | { phase: "app"; owner: AuthOwner; storeId: number }
  | { phase: "logout"; error?: boolean };

const EXPIRED: Feedback = {
  kind: "notice",
  message: "로그인이 만료되었습니다. 다시 로그인해 주세요.",
};
const failure = (error: unknown) =>
  error instanceof OwnerAuthError
    ? error.message
    : "인증 서버에 연결하지 못했습니다. 서버 연결을 확인한 뒤 다시 시도해 주세요.";

// 매장이 하나면 바로 들어가고, 여러 개거나 없으면 매장 선택 화면으로 간다.
const enter = (owner: AuthOwner): State =>
  owner.stores.length === 1
    ? { phase: "app", owner, storeId: owner.stores[0].storeId }
    : { phase: "stores", owner };

// 서버(또는 Mock) 세션을 확인한 뒤에만 점주 화면을 그린다.
// 로그인 상태는 브라우저 저장소에 두지 않고, 새로고침하면 me로 다시 확인한다.
export function AppEntry({
  authRepository = defaultAuth,
  createRepository = defaultCreateRepository,
  now = DEMO_NOW,
}: {
  authRepository?: OwnerAuthRepository;
  createRepository?(storeId: number): OwnerRepository;
  now?: string;
}) {
  const [state, setState] = useState<State>({ phase: "checking" });
  const [checkVersion, setCheckVersion] = useState(0);
  const operation = useRef<AbortController | null>(null);
  // 로그인한 동안 매장별 Repository를 유지한다. 로그아웃·만료 때 비운다.
  const repositories = useRef(new Map<number, OwnerRepository>());

  const expire = useCallback(() => {
    operation.current?.abort();
    repositories.current.clear();
    setState({ phase: "login", feedback: EXPIRED });
  }, []);

  // 처음 열 때와 '다시 확인'을 누를 때 현재 로그인을 확인한다.
  useEffect(() => {
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setState({ phase: "checking" });
    authRepository.me(controller.signal).then(
      (owner) => {
        if (!controller.signal.aborted) setState(enter(owner));
      },
      (error) => {
        if (controller.signal.aborted) return;
        setState(
          isUnauthorized(error)
            ? { phase: "login" }
            : {
                phase: "login",
                feedback: { kind: "error", message: failure(error) },
                retry: true,
              },
        );
      },
    );
    return () => controller.abort();
  }, [authRepository, checkVersion]);

  // 데이터 API가 401을 받으면 보내는 이벤트
  useEffect(() => {
    window.addEventListener(OWNER_SESSION_EXPIRED, expire);
    return () => window.removeEventListener(OWNER_SESSION_EXPIRED, expire);
  }, [expire]);

  // 로그인한 동안 60초마다, 그리고 창으로 돌아올 때 세션을 다시 확인한다.
  const signedIn = state.phase === "app" || state.phase === "stores";
  useEffect(() => {
    if (!signedIn) return;
    let controller: AbortController | undefined;
    let stopped = false;
    const verify = () => {
      if (controller || document.visibilityState === "hidden") return;
      const current = (controller = new AbortController());
      authRepository
        .me(current.signal)
        .then(
          (owner) => {
            if (stopped || current.signal.aborted) return;
            setState((s) => {
              if (s.phase === "app")
                return owner.stores.some((x) => x.storeId === s.storeId)
                  ? { ...s, owner }
                  : { phase: "stores", owner };
              return s.phase === "stores" ? { phase: "stores", owner } : s;
            });
          },
          (error) => {
            if (stopped || current.signal.aborted) return;
            if (isUnauthorized(error)) expire();
          },
        )
        .finally(() => {
          controller = undefined;
        });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") verify();
    };
    const timer = window.setInterval(verify, 60_000);
    window.addEventListener("focus", verify);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      controller?.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", verify);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [signedIn, authRepository, expire]);

  useEffect(() => () => operation.current?.abort(), []);

  async function login(input: OwnerLoginInput) {
    if (state.phase !== "login" || state.busy) return;
    operation.current?.abort();
    const controller = (operation.current = new AbortController());
    setState({ phase: "login", busy: true });
    try {
      const owner = await authRepository.login(input, controller.signal);
      if (!controller.signal.aborted) {
        repositories.current.clear();
        setState(enter(owner));
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setState({
          phase: "login",
          feedback: { kind: "error", message: failure(error) },
        });
    }
  }

  async function logout() {
    operation.current?.abort();
    const controller = (operation.current = new AbortController());
    // 화면을 바로 내려 진행 중인 조회와 편집 상태를 버린다.
    setState({ phase: "logout" });
    repositories.current.clear();
    try {
      await authRepository.logout(controller.signal);
      if (!controller.signal.aborted)
        setState({
          phase: "login",
          feedback: { kind: "notice", message: "로그아웃되었습니다." },
        });
    } catch (error) {
      if (controller.signal.aborted) return;
      setState(
        isUnauthorized(error)
          ? { phase: "login", feedback: EXPIRED }
          : { phase: "logout", error: true },
      );
    }
  }

  if (state.phase === "checking")
    return (
      <div className="app-state">
        <Loading text="로그인 상태를 확인하는 중…" />
      </div>
    );
  if (state.phase === "logout")
    return (
      <div className="app-state">
        {state.error ? (
          <ErrorState
            message="로그아웃 완료를 확인하지 못했습니다. 다시 시도해 주세요."
            onRetry={() => void logout()}
          />
        ) : (
          <Loading text="로그아웃하는 중…" />
        )}
      </div>
    );
  if (state.phase === "login")
    return (
      <LoginPage
        onLogin={(input) => void login(input)}
        busy={state.busy}
        feedback={state.feedback}
        devAccounts={
          authRepository instanceof MockOwnerAuthRepository
            ? authRepository.devAccounts
            : undefined
        }
        onRetrySession={
          state.retry ? () => setCheckVersion((v) => v + 1) : undefined
        }
      />
    );
  if (state.phase === "stores")
    return (
      <StoreSelectPage
        owner={state.owner}
        onSelect={(storeId) => setState({ ...state, phase: "app", storeId })}
        onLogout={() => void logout()}
      />
    );

  // me가 돌려준 매장만 열 수 있다.
  const { owner, storeId } = state;
  let repository = repositories.current.get(storeId);
  if (!repository) {
    try {
      repository = createRepository(storeId);
      repositories.current.set(storeId, repository);
    } catch {
      return (
        <div className="app-state">
          <ErrorState message="이 매장의 데이터를 열 수 없습니다. 회사 관리자에게 문의해 주세요." />
        </div>
      );
    }
  }
  return (
    <App
      key={`${owner.ownerId}-${storeId}`}
      repository={repository}
      now={now}
      account={{
        loginId: owner.loginId,
        storeCount: owner.stores.length,
        onLogout: () => void logout(),
        onSwitchStore: () => setState({ phase: "stores", owner }),
      }}
    />
  );
}
