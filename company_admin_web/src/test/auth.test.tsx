import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppEntry } from "../AppEntry";
import { ApiAuthRepository, type AuthRepository } from "../data/authRepository";
import { AdminApiError, adminRequest, localAdminBaseUrl, SESSION_EXPIRED } from "../data/apiSession.ts";
import { ApiDeviceRepository } from "../data/deviceRepository";

const identity = { id: 12, name: "격리 관리자" };
const rawIdentity = { admin: { admin_id: identity.id, admin_name: identity.name, role: "company_admin" } };
const csrf = () => crypto.randomUUID().replaceAll("-", "") + "a".repeat(11);
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const unauthorized = () => new AdminApiError(401, "관리자 ID 또는 비밀번호를 확인해 주세요.");
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => { resolve = finish; });
  return { promise, resolve };
}
function auth(connected = true) {
  return {
    me: vi.fn<AuthRepository["me"]>().mockImplementation(async () => {
      if (!connected) throw unauthorized();
      return identity;
    }),
    login: vi.fn<AuthRepository["login"]>().mockResolvedValue(identity),
    logout: vi.fn<AuthRepository["logout"]>().mockResolvedValue(undefined),
  };
}
const mockSources = {
  orderRepository: null, storeRepository: null, ownerRepository: null,
  deviceRepository: null, alertRepository: null,
};
async function credentials(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("ID", { exact: true }), "12");
  await user.type(screen.getByLabelText("비밀번호", { exact: true }), crypto.randomUUID());
}
const dashboard = () => screen.findByRole("heading", { name: "운영 요약", level: 1 });
const loginHeading = () => screen.findByRole("heading", { name: "관리자 로그인", level: 1 });

afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

describe("authentication HTTP contract", () => {
  it("uses cookie credentials, bound CSRF headers and safe identity projections", async () => {
    const token = csrf();
    const http = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ csrf_token: token }))
      .mockResolvedValueOnce(response(rawIdentity))
      .mockResolvedValueOnce(response(rawIdentity))
      .mockResolvedValueOnce(response({ csrf_token: csrf() }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const repository = new ApiAuthRepository("http://localhost:8001", http);
    const password = crypto.randomUUID();
    expect(await repository.login({ adminId: 12, password })).toEqual(identity);
    expect(await repository.me()).toEqual(identity);
    await repository.logout();
    expect(http.mock.calls.map(([url]) => url)).toEqual([
      "http://localhost:8001/auth/admin/csrf", "http://localhost:8001/auth/admin/login",
      "http://localhost:8001/auth/admin/me", "http://localhost:8001/auth/admin/csrf",
      "http://localhost:8001/auth/admin/logout",
    ]);
    const init = http.mock.calls[1][1]!;
    expect(JSON.parse(String(init.body)).admin_id).toBe(12);
    expect(JSON.parse(String(init.body)).password === password).toBe(true);
    expect(new Headers(init.headers).get("X-CSRF-Token") === token).toBe(true);
    for (const [, options] of http.mock.calls) {
      expect(options?.credentials).toBe("include");
      expect(options?.cache).toBe("no-store");
    }
  });

  it.each([401, 403, 413, 422, 429, 503])("preserves safe authentication failure status %s without reflecting backend data", async (status) => {
    const privateValue = crypto.randomUUID();
    const http = vi.fn<typeof fetch>().mockResolvedValue(response({ detail: privateValue }, status));
    const repository = new ApiAuthRepository("http://localhost:8001", http);
    let caught: unknown;
    try { await repository.me(); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(AdminApiError);
    expect((caught as AdminApiError).status).toBe(status);
    expect((caught as Error).message.includes(privateValue)).toBe(false);
  });

  it("rejects wrong roles, malformed identity and malformed CSRF before posting credentials", async () => {
    const http = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ admin: { ...rawIdentity.admin, role: "owner" } }))
      .mockResolvedValueOnce(response({ admin: { ...rawIdentity.admin, admin_id: "12" } }))
      .mockResolvedValueOnce(response({ csrf_token: "invalid" }));
    const repository = new ApiAuthRepository("http://localhost:8001", http);
    await expect(repository.me()).rejects.toThrow();
    await expect(repository.me()).rejects.toThrow();
    await expect(repository.login({ adminId: 12, password: crypto.randomUUID() })).rejects.toThrow();
    expect(http.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("cancels timed-out and already aborted authentication requests", async () => {
    const http = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      if (init?.signal?.aborted) reject(new Error("aborted"));
      else init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const repository = new ApiAuthRepository("http://localhost:8001", http, 5);
    await expect(repository.me()).rejects.toThrow("aborted");
    const controller = new AbortController(); controller.abort();
    await expect(repository.me(controller.signal)).rejects.toThrow("aborted");
  });

  it("notifies expiration only for active protected requests, distinguishing 403 and DB errors", async () => {
    const expired = vi.fn();
    window.addEventListener(SESSION_EXPIRED, expired);
    try {
      const http = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(response({}, 401))
        .mockResolvedValueOnce(response({}, 403))
        .mockResolvedValueOnce(response({}, 503))
        .mockResolvedValueOnce(response({}, 401));
      await expect(adminRequest(http, "/admin/devices", { method: "GET" })).rejects.toMatchObject({ status: 401 });
      expect(expired).toHaveBeenCalledTimes(1);
      await expect(adminRequest(http, "/admin/devices", { method: "GET" })).rejects.toMatchObject({ status: 403 });
      expect((await adminRequest(http, "/admin/devices", { method: "GET" })).status).toBe(503);
      const controller = new AbortController(); controller.abort();
      await expect(adminRequest(http, "/admin/devices", { method: "GET", signal: controller.signal })).rejects.toThrow();
      expect(expired).toHaveBeenCalledTimes(1);
    } finally { window.removeEventListener(SESSION_EXPIRED, expired); }
  });

  it("normalizes only local HTTP aliases and preserves remote API configuration", () => {
    expect(new URL(localAdminBaseUrl("http://127.0.0.1:8001")).hostname).toBe(window.location.hostname);
    expect(localAdminBaseUrl("https://api.example/base")).toBe("https://api.example/base");
  });
});

describe("server validated admin entry and lifecycle", () => {
  it("does not load any management data while session verification is pending", async () => {
    const session = deferred<typeof identity>();
    const a = auth(); a.me.mockReturnValue(session.promise);
    const orders = { load: vi.fn().mockResolvedValue([]), detail: vi.fn() };
    render(<AppEntry authRepository={a} {...mockSources} orderRepository={orders} />);
    expect(screen.getByRole("status")).toHaveTextContent("세션");
    expect(orders.load).not.toHaveBeenCalled();
    await act(async () => session.resolve(identity));
    await dashboard();
    expect(orders.load).toHaveBeenCalledTimes(1);
  });

  it("restores the server session on /login and shows actual administrator identity", async () => {
    window.history.replaceState(null, "", "/login");
    const a = auth();
    render(<AppEntry authRepository={a} {...mockSources} />);
    await dashboard();
    expect(window.location.pathname).toBe("/");
    expect(screen.getAllByText("격리 관리자")).toHaveLength(1);
    expect(screen.getByText("격리 관리자").closest(".sidebar-account")).toHaveTextContent("관리자 #12");
    expect(screen.getByText("격리 관리자").closest("aside")).toBeInTheDocument();
    expect(a.me).toHaveBeenCalledTimes(1);
  });

  it("blocks even explicit all-Mock mode before login and enters only after server success", async () => {
    const a = auth(false), pending = deferred<typeof identity>();
    a.login.mockReturnValue(pending.promise);
    render(<AppEntry authRepository={a} {...mockSources} />);
    await loginHeading();
    const user = userEvent.setup();
    await credentials(user);
    await user.click(screen.getByRole("button", { name: "로그인" }));
    expect(screen.getByRole("button", { name: "로그인 중…" })).toBeDisabled();
    expect(screen.getByLabelText("ID", { exact: true })).toBeDisabled();
    expect(screen.queryByRole("heading", { name: "운영 요약" })).not.toBeInTheDocument();
    await act(async () => pending.resolve(identity));
    await dashboard();
    expect(a.login).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/");
  });

  it("keeps rejected credentials on the login screen with safe errors", async () => {
    const a = auth(false); a.login.mockRejectedValue(unauthorized());
    render(<AppEntry authRepository={a} {...mockSources} />);
    await loginHeading();
    const user = userEvent.setup();
    await credentials(user);
    await user.click(screen.getByRole("button", { name: "로그인" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("비밀번호");
    expect(screen.queryByRole("heading", { name: "운영 요약" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("비밀번호", { exact: true })).toHaveValue("");
  });

  it("separates a server connection failure from wrong credentials and retries session verification", async () => {
    const a = auth(); a.me.mockRejectedValueOnce(new Error("network unavailable"));
    render(<AppEntry authRepository={a} {...mockSources} />);
    await loginHeading();
    expect(screen.getByRole("alert")).toHaveTextContent("서버에 연결하지 못했습니다");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "세션 다시 확인" }));
    await dashboard();
    expect(a.me).toHaveBeenCalledTimes(2);
  });

  it("blocks a server permission failure without loading data", async () => {
    const a = auth(); a.me.mockRejectedValue(new AdminApiError(403, "관리자 권한이 필요합니다."));
    const orders = { load: vi.fn(), detail: vi.fn() };
    render(<AppEntry authRepository={a} {...mockSources} orderRepository={orders} />);
    await loginHeading();
    expect(screen.getByRole("alert")).toHaveTextContent("관리자 권한");
    expect(orders.load).not.toHaveBeenCalled();
  });

  it("unmounts cached views on logout and fetches fresh data after the next login", async () => {
    const a = auth();
    const orders = { load: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{
      order_id: 456, store_id: 1, store_name: "다음 세션 매장", ordered_at: new Date().toISOString(),
      table_no: null, quantity: 1, items: [],
    }]), detail: vi.fn() };
    render(<AppEntry authRepository={a} {...mockSources} orderRepository={orders} />);
    await dashboard();
    const user = userEvent.setup();
    await user.click(within(screen.getByRole("navigation")).getByRole("button", { name: "주문 조회" }));
    await screen.findByRole("heading", { name: "주문 목록 · 0건" });
    await user.click(screen.getByRole("button", { name: "로그아웃" }));
    await loginHeading();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    await credentials(user);
    await user.click(screen.getByRole("button", { name: "로그인" }));
    await dashboard();
    await screen.findByText("다음 세션 매장");
    expect(orders.load).toHaveBeenCalledTimes(2);
    expect(a.logout).toHaveBeenCalledTimes(1);
  });

  it("discards the App on a protected API 401 and does not fall back to Mock devices", async () => {
    const a = auth();
    const http = vi.fn<typeof fetch>().mockResolvedValue(response({}, 401));
    render(<AppEntry authRepository={a} {...mockSources}
      deviceRepository={new ApiDeviceRepository("http://localhost:8001", http)} />);
    await loginHeading();
    expect(screen.getByRole("status")).toHaveTextContent("세션");
    expect(screen.queryByRole("heading", { name: "운영 요약" })).not.toBeInTheDocument();
    expect(http.mock.calls[0][1]?.credentials).toBe("include");
  });

  it("clears cached data when periodic verification reports expiration", async () => {
    vi.useFakeTimers();
    const a = auth();
    await act(async () => { render(<AppEntry authRepository={a} {...mockSources} />); });
    expect(screen.getByRole("heading", { name: "운영 요약" })).toBeInTheDocument();
    a.me.mockRejectedValueOnce(unauthorized());
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByRole("heading", { name: "관리자 로그인" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/login");
  });

  it("revalidates on focus without refetching shared lists when the session is still valid", async () => {
    const a = auth();
    const orders = { load: vi.fn().mockResolvedValue([]), detail: vi.fn() };
    render(<AppEntry authRepository={a} {...mockSources} orderRepository={orders} />);
    await dashboard();
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(a.me).toHaveBeenCalledTimes(2);
    expect(orders.load).toHaveBeenCalledTimes(1);
  });

  it("hides data while logout completion is uncertain and retries server logout", async () => {
    const a = auth(); a.logout.mockRejectedValueOnce(new Error("network unavailable"));
    render(<AppEntry authRepository={a} {...mockSources} />);
    await dashboard();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "로그아웃" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("로그아웃 완료를 확인하지 못했습니다");
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    await loginHeading();
    expect(a.logout).toHaveBeenCalledTimes(2);
  });

  it("treats an already expired session during logout as signed out", async () => {
    const a = auth(); a.logout.mockRejectedValueOnce(unauthorized());
    render(<AppEntry authRepository={a} {...mockSources} />);
    await dashboard();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "로그아웃" }));
    await loginHeading();
    expect(screen.getByRole("status")).toHaveTextContent("세션이 종료");
  });

  it("ignores a late successful login after the operation has been invalidated", async () => {
    const a = auth(false), pending = deferred<typeof identity>();
    a.login.mockReturnValue(pending.promise);
    render(<AppEntry authRepository={a} {...mockSources} />);
    await loginHeading();
    const user = userEvent.setup();
    await credentials(user);
    await user.click(screen.getByRole("button", { name: "로그인" }));
    await act(async () => { window.dispatchEvent(new Event(SESSION_EXPIRED)); pending.resolve(identity); });
    expect(screen.getByRole("heading", { name: "관리자 로그인" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
});
