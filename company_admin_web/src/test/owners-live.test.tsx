import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { MockAdminRepository } from "../data/adminRepository";
import type { OwnerRepository } from "../data/ownerRepository";
import type { ApiOwner, ApiOwnerDetail } from "../data/models";

const account = (id = 1, storeCount = 0): ApiOwner => ({
  id, loginId: "DB_OWNER_" + id, storeCount,
});
const detail = (id = 1, count = 0): ApiOwnerDetail => ({
  ...account(id, count),
  stores: Array.from({ length: count }, (_, index) => ({
    id: 9001 + index, name: "DB 연결 매장 " + index,
    address: "실제 부산 주소", addressDetail: index ? "2층" : "",
    adminId: 1, adminName: "DB 담당자",
  })),
});
async function open(repository: OwnerRepository) {
  const user = userEvent.setup();
  render(<App deviceRepository={null} repository={new MockAdminRepository()} orderRepository={null}
    storeRepository={null} ownerRepository={repository} />);
  await screen.findByRole("heading", { name: "운영 요약", level: 1 });
  expect(screen.getByText("점주 계정 · 실제 API")).toBeInTheDocument();
  await user.click(within(screen.getByRole("navigation", { name: "주요 화면" }))
    .getByRole("button", { name: "점주 계정" }));
  return user;
}

describe("live owner accounts without Mock store joins", () => {
  it("searches IDs and logins, combines filters, resets and renders multiple real stores", async () => {
    const repository: OwnerRepository = {
      load: vi.fn().mockResolvedValue([account(1, 0), account(2, 1), account(3, 2)]),
      detail: vi.fn().mockResolvedValue(detail(3, 2)),
    };
    const user = await open(repository);
    await screen.findByText("점주 계정 목록 · 3개");
    expect(screen.getByText("실제 점주 API")).toBeInTheDocument();
    const search = screen.getByRole("textbox");
    await user.type(search, "db_owner_3");
    expect(screen.getByText("점주 계정 목록 · 1개")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("매장 연결"), "미연결");
    expect(screen.getByText(/조건에 맞는 결과/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "초기화" }));
    await user.selectOptions(screen.getByLabelText("매장 연결"), "연결됨");
    expect(screen.getByText("점주 계정 목록 · 2개")).toBeInTheDocument();
    await user.type(search, "3");
    await user.click(screen.getByRole("button", { name: "연결 매장: DB_OWNER_3" }));
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByText("연결 매장 · 2곳");
    expect(dialog).toHaveTextContent("DB 연결 매장 0");
    expect(dialog).toHaveTextContent("DB 연결 매장 1");
    expect(dialog).toHaveTextContent("실제 부산 주소");
    expect(dialog).toHaveTextContent("DB 담당자");
    expect(dialog).toHaveTextContent("9001");
    expect(dialog).toHaveTextContent("9002");
    const mock = await new MockAdminRepository().load();
    for (const store of mock.stores) expect(dialog).not.toHaveTextContent(store.name);
    expect(repository.detail).toHaveBeenCalledWith(3, expect.any(AbortSignal));
  });

  it("treats zero accounts as a successful empty list", async () => {
    await open({ load: async () => [], detail: vi.fn() });
    await screen.findByText("점주 계정 목록 · 0개");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(/조건에 맞는 결과/)).toBeInTheDocument();
    expect(screen.queryByText("mallo_cafe")).not.toBeInTheDocument();
  });

  it("shows loading and errors distinctly and retries without falling back to Mock", async () => {
    let fail!: (error: Error) => void;
    const repository: OwnerRepository = {
      load: vi.fn().mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }))
        .mockResolvedValueOnce([]),
      detail: vi.fn(),
    };
    const user = await open(repository);
    expect(screen.getByRole("status")).toHaveTextContent("실제 점주");
    fail(new Error("unavailable"));
    await screen.findByRole("alert");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("점주 계정 목록 · 0개")).not.toBeInTheDocument();
    expect(screen.queryByText("mallo_cafe")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    await screen.findByText("점주 계정 목록 · 0개");
  });

  it("never attaches Mock stores to an unlinked real owner with the same ID", async () => {
    const user = await open({
      load: async () => [account(1, 0)],
      detail: async () => detail(1, 0),
    });
    await screen.findByText("점주 계정 목록 · 1개");
    expect(screen.getByRole("table")).toHaveTextContent("0곳");
    await user.selectOptions(screen.getByLabelText("매장 연결"), "미연결");
    await user.click(screen.getByRole("button", { name: "연결 매장: DB_OWNER_1" }));
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByText("연결된 매장이 없습니다.");
    expect(dialog).toHaveTextContent("연결 매장 · 0곳");
    expect(dialog).not.toHaveTextContent("말로 카페");
  });

  it("does not synthesize missing detail and allows a real detail retry", async () => {
    const repository: OwnerRepository = {
      load: async () => [account(2, 1)],
      detail: vi.fn().mockRejectedValueOnce(new Error("404"))
        .mockResolvedValueOnce(detail(2, 1)),
    };
    const user = await open(repository);
    await user.click(await screen.findByRole("button", { name: "연결 매장: DB_OWNER_2" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("dialog")).not.toHaveTextContent("연결 매장 ·");
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    await within(screen.getByRole("dialog")).findByText("연결 매장 · 1곳");
    expect(screen.getByRole("dialog")).toHaveTextContent("DB 담당자");
  });

  it("refreshes list counts and keeps the chosen connection filter", async () => {
    const repository: OwnerRepository = {
      load: vi.fn().mockResolvedValueOnce([account(1, 0)])
        .mockResolvedValueOnce([account(1, 1)]),
      detail: vi.fn(),
    };
    const user = await open(repository);
    await screen.findByText("점주 계정 목록 · 1개");
    await user.selectOptions(screen.getByLabelText("매장 연결"), "미연결");
    await user.click(screen.getByRole("button", { name: "새로고침" }));
    await screen.findByText("점주 계정 목록 · 0개");
    expect(screen.getByLabelText("매장 연결")).toHaveValue("미연결");
    await user.click(screen.getByRole("button", { name: "초기화" }));
    expect(screen.getByText("점주 계정 목록 · 1개")).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveTextContent("1곳");
    expect(repository.load).toHaveBeenCalledTimes(2);
  });
});
