import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { ApiStoreRepository, parseStore, type StoreRepository } from "../data/storeRepository";
import { MockAdminRepository } from "../data/adminRepository";

const raw = (storeId = 41, ownerId: number | null = 7) => ({
  store_id: storeId, store_name: "실제 매장 " + storeId, address: "부산시", address_detail: null,
  store_code: "00123", phone: "051-123", business_no: "0000000041",
  representative: "실제 대표", store_type: storeId === 42 ? "음식점" : "카페",
  admin_id: 3, admin_name: "실제 담당자", owner_id: ownerId,
  owner_login_id: ownerId === null ? null : "real-owner",
});
const nav = () => within(screen.getByRole("navigation", { name: "주요 화면" }))
  .getByRole("button", { name: "매장 관리" });
async function open(repository: StoreRepository) {
  const user = userEvent.setup();
  render(<App ownerRepository={null} repository={new MockAdminRepository()} orderRepository={null} storeRepository={repository} />);
  await screen.findByRole("heading", { level: 1, name: "운영 요약" });
  expect(screen.getByText(/이 화면의 Mock 매장 건수/)).toBeInTheDocument();
  await user.click(nav());
  return user;
}

describe("store API contract", () => {
  it("maps joined fields without interpreting store_code as a postcode", () => {
    const store = parseStore(raw());
    expect(store.storeCode).toBe("00123");
    expect(store.businessNo).toBe("0000000041");
    expect(store.addressDetail).toBe("");
    expect(store.adminName).toBe("실제 담당자");
    expect(store.ownerLoginId).toBe("real-owner");
    expect(store).not.toHaveProperty("postcode");
    expect(parseStore(raw(42, null)).ownerId).toBeNull();
  });
  it("rejects missing, malformed and contradictory fields", () => {
    for (const change of [
      { owner_id: undefined }, { store_code: 123 }, { admin_id: null },
      { owner_id: null, owner_login_id: "unexpected" }, { store_id: -1 },
    ]) expect(() => parseStore({ ...raw(), ...change })).toThrow();
  });
  it("only requests dedicated GET list and detail endpoints", async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ stores: [raw()], total: 1 })))
      .mockResolvedValueOnce(new Response(JSON.stringify(raw())));
    const repository = new ApiStoreRepository("http://localhost:8001/api/", transport);
    expect(await repository.load()).toHaveLength(1);
    expect((await repository.detail(41)).id).toBe(41);
    expect(transport.mock.calls.map(([url]) => url)).toEqual([
      "http://localhost:8001/api/admin/stores", "http://localhost:8001/api/admin/stores/41",
    ]);
    for (const [, init] of transport.mock.calls) expect(init?.method).toBe("GET");
  });
  it("rejects HTTP errors, incomplete lists, duplicates and mismatched details", async () => {
    for (const response of [
      new Response("failure", { status: 503 }),
      new Response(JSON.stringify({ stores: [raw()], total: 2 })),
      new Response(JSON.stringify({ stores: [raw(), raw()], total: 2 })),
    ]) {
      const repository = new ApiStoreRepository("http://localhost:8001", async () => response);
      await expect(repository.load()).rejects.toThrow();
    }
    const repository = new ApiStoreRepository("http://localhost:8001", async () => new Response(JSON.stringify(raw(42))));
    await expect(repository.detail(41)).rejects.toThrow();
    await expect(repository.detail(0)).rejects.toThrow();
  });
  it("rejects credential-bearing and unsupported API addresses before fetching", async () => {
    const transport = vi.fn<typeof fetch>();
    for (const base of ["file:///private", "http://user:password@localhost:8001"]) {
      await expect(new ApiStoreRepository(base, transport).load()).rejects.toThrow();
    }
    expect(transport).not.toHaveBeenCalled();
  });
  it("propagates cancellation to the fetch signal", async () => {
    const controller = new AbortController();
    const transport = vi.fn<typeof fetch>().mockImplementation((_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }));
    const request = new ApiStoreRepository("http://localhost:8001", transport).load(controller.signal);
    controller.abort();
    await expect(request).rejects.toThrow("aborted");
    expect(transport.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
});

describe("live store management", () => {
  it("loads, combines real searches and filters, resets and opens joined details", async () => {
    const repository: StoreRepository = {
      load: vi.fn().mockResolvedValue([parseStore(raw()), parseStore(raw(42, null))]),
      detail: vi.fn().mockResolvedValue(parseStore(raw())),
    };
    const user = await open(repository);
    await screen.findByText("매장 목록 · 2곳");
    expect(screen.getByText("실제 매장 API")).toBeInTheDocument();
    expect(screen.queryByText("말로 카페 성수")).not.toBeInTheDocument();
    const search = screen.getByRole("textbox");
    for (const term of ["실제 매장 41", "실제 대표", "0000000041"]) {
      await user.clear(search);
      await user.type(search, term);
      expect(screen.getByRole("table")).toHaveTextContent("실제 매장 41");
    }
    await user.clear(search);
    await user.selectOptions(screen.getByLabelText("업종"), "음식점");
    await user.selectOptions(screen.getByLabelText("점주 연결"), "미연결");
    expect(screen.getByText("매장 목록 · 1곳")).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveTextContent("실제 매장 42");
    await user.selectOptions(screen.getByLabelText("점주 연결"), "연결됨");
    expect(screen.getByText(/조건에 맞는 결과/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "초기화" }));
    await user.click(screen.getByRole("button", { name: "매장 상세: 실제 매장 41" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("real-owner");
    expect(dialog).toHaveTextContent("실제 담당자");
    expect(dialog).toHaveTextContent("store_code (의미 미확인)");
    expect(within(dialog).queryByText("우편번호")).not.toBeInTheDocument();
    expect(repository.detail).toHaveBeenCalledWith(41, expect.any(AbortSignal));
  });
  it("shows list loading, error and retry without displaying Mock stores", async () => {
    let reject!: (error: Error) => void;
    const repository: StoreRepository = {
      load: vi.fn().mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }))
        .mockResolvedValueOnce([]),
      detail: vi.fn(),
    };
    const user = await open(repository);
    expect(screen.getByRole("status")).toHaveTextContent("실제 매장");
    reject(new Error("offline"));
    await screen.findByRole("alert");
    expect(screen.queryByText("매장 목록 · 6곳")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    await screen.findByText("매장 목록 · 0곳");
    expect(screen.getByText(/조건에 맞는 결과/)).toBeInTheDocument();
  });
  it("retries failed details and refreshes the real list", async () => {
    const repository: StoreRepository = {
      load: vi.fn().mockResolvedValueOnce([parseStore(raw(42, null))]).mockResolvedValueOnce([]),
      detail: vi.fn().mockRejectedValueOnce(new Error("missing")).mockResolvedValueOnce(parseStore(raw(42, null))),
    };
    const user = await open(repository);
    await user.click(await screen.findByRole("button", { name: "매장 상세: 실제 매장 42" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("dialog")).not.toHaveTextContent("부산시");
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    await within(screen.getByRole("dialog")).findByText("부산시");
    expect(screen.getByRole("dialog")).toHaveTextContent("미연결");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "새로고침" }));
    await screen.findByText("매장 목록 · 0곳");
    expect(repository.load).toHaveBeenCalledTimes(2);
  });
  it("applies the unlinked shortcut to real stores rather than Mock rows", async () => {
    const repository: StoreRepository = {
      load: async () => [parseStore(raw()), parseStore(raw(42, null))],
      detail: vi.fn(),
    };
    const user = userEvent.setup();
    render(<App ownerRepository={null} repository={new MockAdminRepository()} orderRepository={null} storeRepository={repository} />);
    await user.click(await screen.findByRole("button", { name: "미연결 매장 보기" }));
    await screen.findByText("매장 목록 · 1곳");
    expect(screen.getByRole("table")).toHaveTextContent("실제 매장 42");
    expect(screen.getByRole("table")).not.toHaveTextContent("실제 매장 41");
  });
});
