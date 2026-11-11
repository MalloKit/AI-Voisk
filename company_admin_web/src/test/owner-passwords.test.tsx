import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { App } from "../App";
import { MockAdminRepository } from "../data/adminRepository";
import { ApiOwnerRepository } from "../data/ownerRepository";

const password = crypto.randomUUID();

function fixture(storeCount = 2, status = 204) {
  const owner = { owner_id: 7, login_id: "existing-owner", store_count: storeCount };
  const stores = Array.from({ length: storeCount }, (_, i) => ({
    store_id: 10 + i, store_name: "연결 매장 " + (i + 1),
    address: "부산", address_detail: null, admin_id: 1, admin_name: "관리자",
  }));
  const writes: { body: Record<string, unknown>; init: RequestInit }[] = [];
  let hold: Promise<Response> | undefined;
  const json = (value: unknown, code = 200) => new Response(JSON.stringify(value), { status: code });
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === "/auth/admin/csrf") return json({ csrf_token: "c".repeat(43) });
    if (init?.method === "PATCH") {
      writes.push({ body: JSON.parse(String(init.body)), init });
      return hold ?? (status === 204 ? new Response(null, { status }) : json({ detail: password }, status));
    }
    if (path === "/admin/owners") return json({ owners: [owner], total: 1 });
    return json({ ...owner, stores });
  });
  return { writes, transport, repository: new ApiOwnerRepository("http://localhost:8001", transport),
    hold(value: Promise<Response>) { hold = value; } };
}

async function open(f = fixture(), mock = false) {
  render(<App repository={new MockAdminRepository()} ownerRepository={mock ? null : f.repository}
    orderRepository={null} storeRepository={null} deviceRepository={null} alertRepository={null} />);
  const user = userEvent.setup();
  await user.click(within(await screen.findByRole("navigation", { name: "주요 화면" })).getByRole("button", { name: "점주 계정" }));
  if (!mock) await user.click(await screen.findByRole("button", { name: "비밀번호 초기화: existing-owner" }));
  return user;
}

it("requires an explicit choice across multiple linked stores and sends only its ID", async () => {
  const f = fixture(), user = await open(f);
  const store = await screen.findByLabelText("초기화 기준 매장");
  expect(screen.getByLabelText("로그인 ID")).toHaveAttribute("readonly");
  expect(screen.queryByLabelText("새 비밀번호")).not.toBeInTheDocument();
  expect(store).toHaveValue("");
  await user.click(screen.getByRole("button", { name: "변경" }));
  expect(screen.getByText("초기화 기준 매장을 선택해 주세요.")).toBeInTheDocument();
  expect(f.writes).toHaveLength(0);
  await user.selectOptions(store, "11");
  await user.click(screen.getByRole("button", { name: "변경" }));
  await screen.findByText("existing-owner 계정의 비밀번호를 변경했습니다.");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0].body).toEqual({ store_id: 11 });
  expect(f.writes[0].init.credentials).toBe("include");
  expect(f.writes[0].init.headers).toHaveProperty("X-CSRF-Token");
  expect(screen.getByRole("table")).toHaveTextContent("2곳");
  await user.click(screen.getByRole("button", { name: "연결 매장: existing-owner" }));
  expect(await within(screen.getByRole("dialog")).findByText("연결 매장 2")).toBeInTheDocument();
});

it("blocks the reset when there are no linked stores", async () => {
  const f = fixture(0), user = await open(f);
  await screen.findByText("연결된 매장이 없어 초기화할 수 없습니다.");
  await user.click(screen.getByRole("button", { name: "변경" }));
  expect(f.writes).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: "취소" }));
  expect(screen.getByRole("button", { name: "비밀번호 초기화: existing-owner" })).toHaveFocus();
});

it.each([404, 409, 422, 503])("keeps the dialog on %i and suppresses response details", async (status) => {
  const f = fixture(1, status), user = await open(f);
  expect(await screen.findByLabelText("초기화 기준 매장")).toHaveValue("10");
  await user.click(screen.getByRole("button", { name: "변경" }));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent?.includes(password)).toBe(false);
  if (status === 422) expect(alert).toHaveTextContent("숫자 8자리 이상");
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(f.writes).toHaveLength(1);
});

it("blocks duplicate submits and Escape while saving and returns focus on success", async () => {
  const f = fixture(1);
  let resolve!: (response: Response) => void;
  f.hold(new Promise((r) => { resolve = r; }));
  const user = await open(f);
  await screen.findByLabelText("초기화 기준 매장");
  const button = screen.getByRole("button", { name: "변경" });
  act(() => { fireEvent.click(button); fireEvent.click(button); });
  await waitFor(() => expect(f.writes).toHaveLength(1));
  expect(screen.getByRole("button", { name: "취소" })).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await act(async () => resolve(new Response(null, { status: 204 })));
  await screen.findByText(/계정의 비밀번호를 변경했습니다/);
  expect(screen.getByRole("button", { name: "비밀번호 초기화: existing-owner" })).toHaveFocus();
});

it("hides the action in explicit Mock mode", async () => {
  const f = fixture();
  await open(f, true);
  expect(screen.queryByRole("button", { name: /비밀번호 초기화/ })).not.toBeInTheDocument();
  expect(f.transport).not.toHaveBeenCalled();
});

it("retains the previous explicit-password API contract without retrying a network failure", async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ csrf_token: "c".repeat(43) })))
    .mockRejectedValueOnce(new TypeError("network"));
  const repository = new ApiOwnerRepository("http://localhost:8001", transport);
  await expect(repository.resetPassword(0, password)).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
  await expect(repository.resetPassword(7, password)).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(2);
  const request = JSON.parse(String(transport.mock.calls[1][1]?.body));
  expect(Object.keys(request)).toEqual(["password"]);
  expect(request.password === password).toBe(true);
});
