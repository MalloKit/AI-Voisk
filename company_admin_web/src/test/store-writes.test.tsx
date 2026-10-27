import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { MockAdminRepository } from "../data/adminRepository";
import { ApiStoreRepository, parseStore, type StoreInput, type StoreRepository } from "../data/storeRepository";
import { SESSION_EXPIRED, AdminApiError } from "../data/apiSession";

const input: StoreInput = { store_name: "등록 매장", address: "부산", address_detail: null,
  store_code: "00123", phone: "051-123", business_no: "0000000001", representative: "대표", store_type: "카페" };
const raw = (id = 41) => ({ ...input, store_id: id, admin_id: 1, admin_name: "실제 담당",
  owner_id: null, owner_login_id: null });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const csrf = () => json({ csrf_token: "t".repeat(43) });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => { resolve = finish; });
  return { promise, resolve };
}

describe("store mutation HTTP contract", () => {
  it("creates and patches with fresh CSRF and credential cookies; excludes relation fields", async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(csrf()).mockResolvedValueOnce(json(raw(), 201))
      .mockResolvedValueOnce(csrf()).mockResolvedValueOnce(json({ ...raw(), store_name: "수정" }));
    const repo = new ApiStoreRepository("http://localhost:8001", transport);
    const sent = { ...input, admin_id: 999, owner_id: 7, store_id: 8 };
    expect((await repo.create(sent)).id).toBe(41);
    expect((await repo.update(41, { store_name: "수정" })).name).toBe("수정");
    expect(transport.mock.calls.map(([url]) => url)).toEqual([
      "http://localhost:8001/auth/admin/csrf", "http://localhost:8001/admin/stores",
      "http://localhost:8001/auth/admin/csrf", "http://localhost:8001/admin/stores/41",
    ]);
    const post = transport.mock.calls[1][1]!;
    expect(JSON.parse(post.body as string)).toEqual(input);
    expect(post.headers).toMatchObject({ "X-CSRF-Token": "t".repeat(43) });
    expect(post.method).toBe("POST");
    expect(transport.mock.calls[3][1]?.method).toBe("PATCH");
    expect(JSON.parse(transport.mock.calls[3][1]?.body as string)).toEqual({ store_name: "수정" });
    for (const [, init] of transport.mock.calls) expect(init).toMatchObject({ credentials: "include", cache: "no-store" });
  });
  it.each([404, 409, 422, 503])("rejects HTTP %i without success, internal error reflection or automatic resubmit", async (status) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(csrf())
      .mockResolvedValueOnce(json({ detail: "private SQL" }, status));
    await expect(new ApiStoreRepository("http://localhost:8001", transport).create(input)).rejects.toThrow(AdminApiError);
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("fails closed for malformed CSRF, bad ID, mismatched response and unsafe URL", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ csrf_token: "bad" }));
    await expect(new ApiStoreRepository("http://localhost:8001", transport).create(input)).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
    await expect(new ApiStoreRepository("http://localhost:8001", transport).update(0, {})).rejects.toThrow();
    await expect(new ApiStoreRepository("file:///tmp", transport).create(input)).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
    const wrong = vi.fn<typeof fetch>().mockResolvedValueOnce(csrf()).mockResolvedValueOnce(json(raw(42)));
    await expect(new ApiStoreRepository("http://localhost:8001", wrong).update(41, { store_name: "수정" })).rejects.toThrow();
  });
  it("expires the app session on mutation 401 and preserves cancellation", async () => {
    const expired = vi.fn();
    window.addEventListener(SESSION_EXPIRED, expired);
    try {
      const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(csrf()).mockResolvedValueOnce(json({}, 401));
      await expect(new ApiStoreRepository("http://localhost:8001", transport).create(input)).rejects.toThrow("세션");
      expect(expired).toHaveBeenCalledTimes(1);
      const controller = new AbortController();
      const pending = vi.fn<typeof fetch>().mockResolvedValueOnce(csrf()).mockImplementationOnce((_url, init) =>
        new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))));
      const saving = new ApiStoreRepository("http://localhost:8001", pending).create(input, controller.signal);
      await waitFor(() => expect(pending).toHaveBeenCalledTimes(2));
      controller.abort();
      await expect(saving).rejects.toThrow("aborted");
    } finally { window.removeEventListener(SESSION_EXPIRED, expired); }
  });
});

function repositories(initial = [] as ReturnType<typeof parseStore>[]) {
  let rows = initial;
  return {
    load: vi.fn<StoreRepository["load"]>().mockImplementation(async () => rows),
    detail: vi.fn<StoreRepository["detail"]>().mockImplementation(async (id) => rows.find((row) => row.id === id)!),
    create: vi.fn<NonNullable<StoreRepository["create"]>>().mockImplementation(async (value) => {
      const saved = parseStore({ ...raw(), ...value }); rows = [...rows, saved]; return saved;
    }),
    update: vi.fn<NonNullable<StoreRepository["update"]>>().mockImplementation(async (id, value) => {
      const old = rows.find((row) => row.id === id)!;
      const saved = parseStore({ ...raw(id), store_name: old.name, ...value });
      rows = rows.map((row) => row.id === id ? saved : row); return saved;
    }),
  };
}
const nav = (label: string) => within(screen.getByRole("navigation", { name: "주요 화면" })).getByRole("button", { name: label });
async function open(repo = repositories()) {
  render(<App repository={new MockAdminRepository()} orderRepository={null} ownerRepository={null}
    deviceRepository={null} alertRepository={null} storeRepository={repo} />);
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "운영 요약", level: 1 });
  await user.click(nav("매장 관리"));
  await screen.findByText(/매장 목록 ·/);
  return { user, repo };
}
async function openAfterFailure(repo: ReturnType<typeof repositories>) {
  render(<App repository={new MockAdminRepository()} orderRepository={null} ownerRepository={null}
    deviceRepository={null} alertRepository={null} storeRepository={repo} />);
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "운영 요약", level: 1 });
  await user.click(nav("매장 관리"));
  await screen.findByRole("alert");
  return { user };
}
function fill() {
  const dialog = within(screen.getByRole("dialog"));
  const fields = { "매장명": "등록 매장", "주소": "부산", "우편번호": "00123", "업종": "카페",
    "전화번호": "051-123", "사업자번호": "0000000001", "대표자명": "대표" };
  for (const [name, value] of Object.entries(fields))
    fireEvent.change(dialog.getByRole("textbox", { name: name + " *" }), { target: { value } });
}

describe("live store registration and editing", () => {
  it("validates required fields and focuses the first failure before sending", async () => {
    const { user, repo } = await open();
    await user.click(screen.getByRole("button", { name: "매장 등록" }));
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(repo.create).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "매장명 *" })).toHaveFocus();
    expect(screen.getByText("매장명을(를) 입력해 주세요.")).toBeInTheDocument();
    fill();
    fireEvent.change(screen.getByRole("textbox", { name: "우편번호 *" }), { target: { value: "abcde" } });
    fireEvent.change(screen.getByRole("textbox", { name: "사업자번호 *" }), { target: { value: "123-456" } });
    fireEvent.change(screen.getByRole("textbox", { name: "매장명 *" }), { target: { value: "가".repeat(101) } });
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByText("100자 이하로 입력해 주세요.")).toBeInTheDocument();
    expect(screen.getByText(/우편번호는 숫자 5자리/)).toBeInTheDocument();
    expect(repo.create).not.toHaveBeenCalled();
  });
  it("creates then refreshes real details, list and dashboard shared counts without extra navigation fetches", async () => {
    const { user, repo } = await open();
    await user.click(screen.getByRole("button", { name: "매장 등록" }));
    fill(); await user.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText(/매장을 등록했습니다/);
    expect(repo.create).toHaveBeenCalledWith(input, expect.any(AbortSignal));
    await within(screen.getByRole("dialog")).findByText("실제 담당");
    expect(screen.getByRole("dialog")).not.toHaveTextContent("말로 카페");
    await user.click(screen.getByRole("button", { name: "닫기" }));
    await screen.findByText("매장 목록 · 1곳");
    await user.click(nav("운영 요약"));
    expect(screen.getByRole("region", { name: "등록 매장" })).toHaveTextContent("1곳");
    expect(screen.getByRole("region", { name: "점주 미연결 매장" })).toHaveTextContent("1곳");
    await user.click(nav("매장 관리"));
    expect(repo.load).toHaveBeenCalledTimes(2);
  });
  it("edits from freshly fetched detail, submits only changed basic fields and refreshes detail", async () => {
    const repo = repositories([parseStore(raw())]);
    const { user } = await open(repo);
    const search = screen.getByRole("textbox");
    await user.type(search, "등록");
    await user.click(screen.getByRole("button", { name: "매장 상세: 등록 매장" }));
    await user.click(await screen.findByRole("button", { name: "매장 정보 수정" }));
    expect(screen.getByRole("textbox", { name: "매장명 *" })).toHaveValue("등록 매장");
    expect(within(screen.getByRole("dialog")).getAllByRole("textbox")).toHaveLength(8);
    fireEvent.change(screen.getByRole("textbox", { name: "매장명 *" }), { target: { value: "등록 수정" } });
    await user.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText(/매장 정보를 저장했습니다/);
    expect(repo.update).toHaveBeenCalledWith(41, { store_name: "등록 수정" }, expect.any(AbortSignal));
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveAttribute("aria-label", "등록 수정"));
    await user.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.getByRole("textbox")).toHaveValue("등록");
    expect(screen.getByText("등록 수정")).toBeInTheDocument();
    expect(repo.detail).toHaveBeenCalledTimes(2);
  });
  it("locks duplicate submits, close, backdrop, Escape and all inputs while saving", async () => {
    const pending = deferred<ReturnType<typeof parseStore>>();
    const repo = repositories(); repo.create.mockReturnValue(pending.promise);
    const { user } = await open(repo);
    await user.click(screen.getByRole("button", { name: "매장 등록" })); fill();
    const form = screen.getByRole("button", { name: "저장" }).closest("form")!;
    fireEvent.submit(form); fireEvent.submit(form);
    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "취소" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "닫기" })).toBeDisabled();
    for (const field of within(screen.getByRole("dialog")).getAllByRole("textbox")) expect(field).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => pending.resolve(parseStore(raw())));
    await screen.findByText(/매장을 등록했습니다/);
  });
  it("keeps failed saves in the form without success or Mock fallback and allows retry", async () => {
    const repo = repositories(); repo.create.mockRejectedValueOnce(new AdminApiError(422, "입력값을 확인해 주세요."));
    const { user } = await open(repo);
    await user.click(screen.getByRole("button", { name: "매장 등록" })); fill();
    await user.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByRole("alert");
    expect(screen.queryByText(/매장을 등록했습니다/)).not.toBeInTheDocument();
    expect(repo.load).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("textbox", { name: "매장명 *" })).toHaveValue("등록 매장");
    await user.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText(/매장을 등록했습니다/);
    expect(repo.create).toHaveBeenCalledTimes(2);
  });
  it("shows uncertain network saves honestly and does not retry automatically", async () => {
    const repo = repositories(); repo.create.mockRejectedValue(new TypeError("private network"));
    const { user } = await open(repo);
    await user.click(screen.getByRole("button", { name: "매장 등록" })); fill();
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("저장 결과를 확인할 수 없습니다");
    expect(screen.getByRole("alert")).not.toHaveTextContent("private");
    expect(repo.create).toHaveBeenCalledTimes(1);
  });
  it("cancels or Escapes without writing and restores focus to registration button", async () => {
    const { user, repo } = await open();
    const button = screen.getByRole("button", { name: "매장 등록" });
    await user.click(button); fill();
    await user.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(button).toHaveFocus();
    await user.click(button); await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(button).toHaveFocus();
    expect(repo.create).not.toHaveBeenCalled();
  });
  it("keeps a confirmed save separate from failed list refresh and offers read retry", async () => {
    const repo = repositories();
    repo.load.mockRejectedValueOnce(new Error("initial retry"));
    const { user } = await openAfterFailure(repo);
    await user.click(screen.getByRole("button", { name: "매장 등록" })); fill();
    repo.load.mockRejectedValueOnce(new Error("refresh failed"));
    await user.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText(/매장을 등록했습니다/);
    await user.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.getByRole("alert")).toHaveTextContent("실제 매장 조회 실패");
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    await screen.findByText("매장 목록 · 1곳");
    expect(repo.create).toHaveBeenCalledTimes(1);
  });
  it("shows no write controls in explicit Mock mode", async () => {
    const user = userEvent.setup();
    render(<App repository={new MockAdminRepository()} orderRepository={null} ownerRepository={null}
      deviceRepository={null} alertRepository={null} storeRepository={null} />);
    await screen.findByRole("heading", { name: "운영 요약", level: 1 });
    await user.click(nav("매장 관리"));
    expect(screen.queryByRole("button", { name: "매장 등록" })).not.toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: /^매장 상세:/ })[0]);
    expect(screen.queryByRole("button", { name: "매장 정보 수정" })).not.toBeInTheDocument();
  });
  it("does not send an unchanged edit", async () => {
    const repo = repositories([parseStore(raw())]); const { user } = await open(repo);
    await user.click(screen.getByRole("button", { name: "매장 상세: 등록 매장" }));
    await user.click(await screen.findByRole("button", { name: "매장 정보 수정" }));
    await user.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText("변경된 정보가 없습니다.");
    expect(repo.update).not.toHaveBeenCalled();
  });
});
