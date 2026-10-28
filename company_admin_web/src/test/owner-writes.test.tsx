import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { MockAdminRepository } from "../data/adminRepository";
import { ApiOwnerRepository } from "../data/ownerRepository";
import { ApiStoreRepository } from "../data/storeRepository";
import { validOwnerLogin, validOwnerPassword } from "../data/ownerCredentials";

const password = crypto.randomUUID();
function fixture() {
  const owners = [{ owner_id: 7, login_id: "existing-owner" }, { owner_id: 8, login_id: "second-owner" }];
  const stores = [10, 11].map((id) => ({ store_id: id, store_name: "검증 매장 " + id, address: "부산", address_detail: null,
    store_code: "T0001", phone: "legacy", business_no: "legacy", representative: "대표", store_type: "카페",
    admin_id: 2, admin_name: "담당 관리자", owner_id: id === 10 ? null : 7 as number | null, owner_login_id: null as string | null }));
  const order = { load: vi.fn().mockResolvedValue([]), detail: vi.fn() };
  const device = { load: vi.fn().mockResolvedValue([]), detail: vi.fn() };
  const alert = { load: vi.fn().mockResolvedValue([]), detail: vi.fn() };
  const requests: { path: string; method: string }[] = [];
  let failWrite = 0, failOwners = false, hold: Promise<Response> | undefined;
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
  const storeView = (row: typeof stores[number]) => ({ ...row, owner_login_id: owners.find((o) => o.owner_id === row.owner_id)?.login_id ?? null });
  const ownerView = (row: typeof owners[number]) => ({ ...row, store_count: stores.filter((s) => s.owner_id === row.owner_id).length });
  const http = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const path = new URL(String(input)).pathname, method = init?.method ?? "GET";
    requests.push({ path, method });
    if (path === "/auth/admin/csrf") return json({ csrf_token: "c".repeat(43) });
    if (method !== "GET") {
      if (failWrite) return json({ detail: password }, failWrite);
      if (hold) return hold;
      const body = JSON.parse(String(init?.body));
      if (path === "/admin/owners") {
        if (owners.some((o) => o.login_id.toLowerCase() === body.login_id.toLowerCase())) return json({}, 409);
        const row = { owner_id: owners.length + 7, login_id: body.login_id }; owners.push(row);
        return json(ownerView(row), 201);
      }
      const row = stores.find((s) => s.store_id === Number(path.split("/")[3]))!;
      if (row.owner_id !== body.expected_owner_id) return json({},409);
      row.owner_id = body.owner_id;
      return json(storeView(row));
    }
    if (path === "/admin/stores") return json({ stores: stores.map(storeView), total: stores.length });
    if (path === "/admin/owners") return failOwners ? json({},503) : json({ owners: owners.map(ownerView), total: owners.length });
    if (path.startsWith("/admin/stores/")) return json(storeView(stores.find((s) => s.store_id === Number(path.split("/")[3]))!));
    const row = owners.find((o) => o.owner_id === Number(path.split("/")[3]))!;
    return json({ ...ownerView(row), stores: stores.filter((s) => s.owner_id === row.owner_id).map((s) => ({
      store_id: s.store_id, store_name: s.store_name, address: s.address, address_detail: s.address_detail,
      admin_id: s.admin_id, admin_name: s.admin_name })) });
  });
  return { owners, stores, order, device, alert, http, requests,
    ownersRepo: new ApiOwnerRepository("http://localhost:8001", http), storesRepo: new ApiStoreRepository("http://localhost:8001", http),
    fail(status: number) { failWrite = status; }, failOwnerList(value: boolean) { failOwners = value; },
    hold(promise: Promise<Response>) { hold = promise; }, json };
}
async function open(f = fixture(), mockOwners = false) {
  render(<App repository={new MockAdminRepository()} orderRepository={f.order} storeRepository={f.storesRepo}
    ownerRepository={mockOwners ? null : f.ownersRepo} deviceRepository={f.device} alertRepository={f.alert} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "전체 새로고침" })).toBeEnabled());
  return userEvent.setup();
}
const nav = (name: string) => within(screen.getByRole("navigation", { name: "주요 화면" })).getByRole("button", { name });
async function createForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(nav("점주 계정")); await user.click(screen.getByRole("button", { name: "점주 계정 생성" }));
}
async function fill(user: ReturnType<typeof userEvent.setup>, login = "new-owner") {
  await user.type(within(screen.getByRole("dialog")).getByRole("textbox", { name: /로그인 ID/ }), login);
  await user.click(screen.getByLabelText("초기 비밀번호")); await user.paste(password);
  await user.click(screen.getByLabelText("비밀번호 확인")); await user.paste(password);
}
async function connectionForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(nav("매장 관리")); await user.click(await screen.findByRole("button", { name: "매장 상세: 검증 매장 10" }));
  await user.click(await screen.findByRole("button", { name: "점주 연결 관리" }));
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { resolve, promise }; }
const writes = (f: ReturnType<typeof fixture>) => f.requests.filter((r) => r.method !== "GET");

describe("owner account and store connection writes", () => {
  it("validates policy boundaries without normalizing existing values or password whitespace", () => {
    for (const value of ["abcd", "a._-", "a".repeat(100)]) expect(validOwnerLogin(value)).toBe(true);
    for (const value of ["abc", "Upper", "owner ", "owner\n", "한글아이디", "a".repeat(101)]) expect(validOwnerLogin(value)).toBe(false);
    for (const value of [" ".repeat(15), "\u0085".repeat(15), "\ufeff ".repeat(15)]) expect(validOwnerPassword(value)).toBe(false);
    expect(validOwnerPassword("🙂".repeat(15))).toBe(true);
    for (const value of ["x".repeat(14), "x".repeat(129), password + "\n", password + "\ud800"]) expect(validOwnerPassword(value)).toBe(false);
  });

  it("validates required inputs, matching values and password visibility before sending anything", async () => {
    const f = fixture(), user = await open(f); await createForm(user);
    await user.click(screen.getByRole("button", { name: "등록" }));
    expect(writes(f)).toHaveLength(0);
    expect(screen.getByText(/확인 값이 일치하지/)).toBeInTheDocument();
    await fill(user,"Upper");
    await user.click(screen.getByRole("button", { name: "등록" }));
    expect(writes(f)).toHaveLength(0);
    expect(screen.getByLabelText("초기 비밀번호")).toHaveAttribute("type","password");
    await user.click(screen.getByRole("button", { name: "초기 비밀번호 표시" }));
    expect(screen.getByLabelText("초기 비밀번호")).toHaveAttribute("type","text");
    await user.click(screen.getByRole("button", { name: "초기 비밀번호 숨기기" }));
    await user.clear(screen.getByLabelText("비밀번호 확인"));
    await user.click(screen.getByRole("button", { name: "등록" }));
    expect(writes(f)).toHaveLength(0);
  });

  it("creates an account, sends only two fields, refreshes owners and opens its actual detail", async () => {
    const f = fixture(), user = await open(f); await createForm(user); await fill(user);
    await user.click(screen.getByRole("button", { name: "등록" }));
    await screen.findByText(/점주 계정을 생성했습니다/);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const call = f.http.mock.calls.find(([,init]) => init?.method === "POST")!;
    const body = JSON.parse(String(call[1]?.body));
    expect(Object.keys(body)).toEqual(["login_id","password"]);
    expect(body.password === password).toBe(true);
    expect(call[1]?.credentials).toBe("include");
    expect(call[1]?.headers).toHaveProperty("X-CSRF-Token");
    await user.click(await screen.findByRole("button", { name: "연결 매장: new-owner" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("new-owner"));
    expect(screen.getByRole("dialog").textContent?.includes(password)).toBe(false);
    expect(f.requests.filter((r) => r.path === "/admin/owners" && r.method === "GET")).toHaveLength(2);
    expect(f.requests.filter((r) => r.path === "/admin/stores" && r.method === "GET")).toHaveLength(1);
    for (const source of [f.order,f.device,f.alert]) expect(source.load).toHaveBeenCalledTimes(1);
  });

  it.each([409,422,503])("keeps the form and sanitizes a server %i failure without automatic retry", async (status) => {
    const f = fixture(), user = await open(f); f.fail(status); await createForm(user); await fill(user);
    await user.click(screen.getByRole("button", { name: "등록" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("alert").textContent?.includes(password)).toBe(false);
    expect(writes(f)).toHaveLength(1);
    expect(f.owners).toHaveLength(2);
    if (status === 409) {
      await user.clear(within(screen.getByRole("dialog")).getByRole("textbox", { name: "로그인 ID" }));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(writes(f)).toHaveLength(1);
    }
    await user.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.getByRole("button", { name: "점주 계정 생성" })).toHaveFocus();
  });

  it("blocks duplicate account submits and closing while the response is pending", async () => {
    const f = fixture(), user = await open(f), pending = deferred<Response>(); f.hold(pending.promise);
    await createForm(user); await fill(user);
    const button = screen.getByRole("button", { name: "등록" });
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    await waitFor(() => expect(writes(f)).toHaveLength(1));
    expect(button).toBeDisabled(); expect(screen.getByRole("button", { name: "취소" })).toBeDisabled();
    await user.keyboard("{Escape}"); fireEvent.mouseDown(document.querySelector(".modal-backdrop")!);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => pending.resolve(f.json({ owner_id: 9, login_id: "new-owner", store_count: 0 },201)));
    await screen.findByText(/점주 계정을 생성했습니다/);
    expect(writes(f)).toHaveLength(1);
  });

  it.each(["connect","change","disconnect"])("%s preserves basic fields and refreshes shared owners, stores and dashboard only", async (operation) => {
    const f = fixture(); if (operation !== "connect") f.stores[0].owner_id = 7;
    const user = await open(f); await connectionForm(user);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(operation === "connect" ? "현재 점주: 미연결" : "existing-owner · 점주 #7");
    await user.selectOptions(screen.getByRole("combobox", { name: "연결할 점주" }), operation === "disconnect" ? "" : operation === "change" ? "8" : "7");
    if (operation !== "connect") {
      await user.click(screen.getByRole("button", { name: "저장" }));
      expect(writes(f)).toHaveLength(0);
      expect(screen.getByRole("alert")).toHaveTextContent("변경");
      await user.click(screen.getByRole("checkbox"));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    }
    await user.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText("점주 연결 정보를 저장했습니다. 목록과 운영 요약은 최신 조회 결과로 갱신합니다.");
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent(operation === "disconnect" ? "미연결" : operation === "change" ? "second-owner" : "existing-owner"));
    expect(screen.getByRole("dialog")).toHaveTextContent("담당 관리자");
    expect(screen.getByRole("dialog")).toHaveTextContent("대표");
    expect(f.stores[0].store_code).toBe("T0001");
    expect(f.stores[0].phone).toBe("legacy");
    expect(f.stores[0].admin_id).toBe(2);
    expect(f.stores[1].owner_id).toBe(7);
    const [,init] = f.http.mock.calls.find(([,init]) => init?.method === "PATCH")!;
    expect(JSON.parse(String(init?.body))).toEqual({ owner_id: operation === "disconnect" ? null : operation === "change" ? 8 : 7,
      expected_owner_id: operation === "connect" ? null : 7 });
    await user.keyboard("{Escape}"); await user.click(nav("운영 요약"));
    expect(screen.getByRole("region", { name: "점주 미연결 매장" })).toHaveTextContent(operation === "disconnect" ? "1곳" : "0곳");
    expect(screen.getByRole("region", { name: "등록 매장" })).toHaveTextContent("2곳");
    expect(screen.queryByRole("button", { name: "매장 상세: 검증 매장 10" })).toBe(operation === "disconnect" ? screen.getByRole("button", { name: "매장 상세: 검증 매장 10" }) : null);
    await user.click(nav("점주 계정"));
    await user.click(await screen.findByRole("button", { name: "연결 매장: existing-owner" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("검증 매장 11"));
    expect(screen.getByRole("dialog").textContent?.includes("검증 매장 10")).toBe(operation === "connect");
    expect(f.requests.filter((r) => r.path === "/admin/stores" && r.method === "GET")).toHaveLength(2);
    expect(f.requests.filter((r) => r.path === "/admin/owners" && r.method === "GET")).toHaveLength(2);
    for (const source of [f.order,f.device,f.alert]) expect(source.load).toHaveBeenCalledTimes(1);
  });

  it("prevents stale relationship resubmission and reloads fresh detail on cancellation", async () => {
    const f = fixture(), user = await open(f); await connectionForm(user);
    f.stores[0].owner_id = 8;
    await user.selectOptions(screen.getByRole("combobox", { name: "연결할 점주" }),"7");
    await user.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText(/취소 후 매장 상세를 다시 조회/);
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(writes(f)).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "취소" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("second-owner"));
    expect(screen.getByRole("button", { name: "점주 연결 관리" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "점주 연결 관리" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("second-owner · 점주 #8");
  });

  it("prevents duplicate relationship writes and closing while saving", async () => {
    const f = fixture(), user = await open(f), pending = deferred<Response>();
    await connectionForm(user); f.hold(pending.promise);
    await user.selectOptions(screen.getByRole("combobox", { name: "연결할 점주" }),"7");
    const button = screen.getByRole("button", { name: "저장" });
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    await waitFor(() => expect(writes(f)).toHaveLength(1));
    expect(button).toBeDisabled(); await user.keyboard("{Escape}");
    fireEvent.mouseDown(document.querySelector(".modal-backdrop")!);
    expect(screen.getByRole("dialog")).toHaveAccessibleName("점주 연결 관리");
    f.stores[0].owner_id = 7;
    await act(async () => pending.resolve(f.json({ ...f.stores[0], owner_login_id: "existing-owner" })));
    await screen.findByText(/점주 연결 정보를 저장했습니다/);
  });

  it("keeps a failed relationship unchanged, displays no server secret and supports owner-list retry", async () => {
    const f = fixture(), user = await open(f); f.failOwnerList(true);
    // Refresh only owners through its management page before opening the shared connection form.
    await user.click(nav("점주 계정")); await user.click(screen.getByRole("button", { name: "새로고침" }));
    await screen.findByRole("alert"); await connectionForm(user);
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    f.failOwnerList(false); await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "다시 시도" }));
    await user.selectOptions(await screen.findByRole("combobox", { name: "연결할 점주" }),"7");
    f.fail(503); await user.click(screen.getByRole("button", { name: "저장" }));
    await within(screen.getByRole("dialog")).findByRole("alert");
    expect(screen.getByRole("dialog").textContent?.includes(password)).toBe(false);
    expect(f.stores[0].owner_id).toBeNull(); expect(writes(f)).toHaveLength(1);
  });

  it("explains an empty owner list without inventing an account", async () => {
    const f = fixture(); f.owners.splice(0); f.stores.forEach((s) => { s.owner_id = null; });
    const user = await open(f); await connectionForm(user);
    expect(screen.getByText(/계정을 먼저 생성해 주세요/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(writes(f)).toHaveLength(0);
  });

  it("does not connect actual stores to Mock owners or expose Mock account creation", async () => {
    const f = fixture(), user = await open(f,true);
    await user.click(nav("점주 계정"));
    expect(screen.queryByRole("button", { name: "점주 계정 생성" })).not.toBeInTheDocument();
    await user.click(nav("매장 관리")); await user.click(screen.getByRole("button", { name: "매장 상세: 검증 매장 10" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("담당 관리자"));
    expect(screen.queryByRole("button", { name: "점주 연결 관리" })).not.toBeInTheDocument();
    expect(writes(f)).toHaveLength(0);
  });
  it("allows only credential and relationship request fields and rejects mismatched saved identities", async () => {
    const f = fixture();
    const credentials = { login_id: "wire-owner", password, password_confirm: password, role: "company_admin" };
    const created = await f.ownersRepo.create(credentials);
    expect(created.loginId).toBe("wire-owner");
    const posted = JSON.parse(String(f.http.mock.calls.find(([,init]) => init?.method === "POST")![1]!.body));
    expect(Object.keys(posted)).toEqual(["login_id","password"]);
    const relationship = { owner_id: 7, expected_owner_id: null, admin_id: 999, representative: "changed" };
    const saved = await f.storesRepo.setOwner(10,relationship);
    expect(saved.adminId).toBe(2); expect(saved.representative).toBe("대표");
    const patched = JSON.parse(String(f.http.mock.calls.find(([,init]) => init?.method === "PATCH")![1]!.body));
    expect(patched).toEqual({ owner_id: 7, expected_owner_id: null });
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(f.json({ csrf_token: "c".repeat(43) }))
      .mockResolvedValueOnce(f.json({ owner_id: 99, login_id: "different", store_count: 0 }));
    const repository = new ApiOwnerRepository("http://localhost:8001",http);
    await expect(repository.create(credentials)).rejects.toThrow("응답 형식");
    const bad = vi.fn<typeof fetch>();
    await expect(new ApiStoreRepository("http://localhost:8001",bad).setOwner(0,relationship)).rejects.toThrow();
    expect(bad).not.toHaveBeenCalled();
  });

});
