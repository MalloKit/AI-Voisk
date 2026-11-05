import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { MockAdminRepository } from "../data/adminRepository";
import { ApiOwnerRepository } from "../data/ownerRepository";

const password = crypto.randomUUID();
function fixture() {
  const owner = { owner_id: 7, login_id: "existing-owner", store_count: 1 };
  const writes: { body: Record<string, unknown>; init: RequestInit }[] = [];
  let status = 204, hold: Promise<Response> | undefined;
  const json = (value: unknown, code = 200) => new Response(JSON.stringify(value), { status: code });
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === "/auth/admin/csrf") return json({ csrf_token: "c".repeat(43) });
    if (init?.method === "PATCH") {
      writes.push({ body: JSON.parse(String(init.body)), init });
      if (hold) return hold;
      return status === 204 ? new Response(null, { status }) : json({ detail: password }, status);
    }
    if (path === "/admin/owners") return json({ owners: [owner], total: 1 });
    return json({ ...owner, stores: [{ store_id: 10, store_name: "실제 연결 매장", address: "부산", address_detail: null, admin_id: 1, admin_name: "관리자" }] });
  });
  return { owner, writes, transport, repository: new ApiOwnerRepository("http://localhost:8001", transport),
    fail(code: number) { status = code; }, hold(value: Promise<Response>) { hold = value; } };
}
async function open(f = fixture(), mock = false) {
  render(<App repository={new MockAdminRepository()} ownerRepository={mock ? null : f.repository}
    orderRepository={null} storeRepository={null} deviceRepository={null} alertRepository={null} />);
  const user = userEvent.setup();
  await user.click(within(await screen.findByRole("navigation", { name: "주요 화면" })).getByRole("button", { name: "점주 계정" }));
  if (!mock) await user.click(await screen.findByRole("button", { name: "비밀번호 초기화: existing-owner" }));
  return user;
}
async function fill(user: ReturnType<typeof userEvent.setup>, value: string = password) {
  await user.click(screen.getByLabelText("새 비밀번호")); await user.paste(value);
  await user.click(screen.getByLabelText("비밀번호 확인")); await user.paste(value);
}

describe("owner password reset", () => {
  it("keeps the target read-only, validates inputs, focuses errors and toggles visibility", async () => {
    const f = fixture(), user = await open(f);
    expect(screen.getByLabelText("로그인 ID")).toHaveValue("existing-owner");
    expect(screen.getByLabelText("로그인 ID")).toHaveAttribute("readonly");
    await user.click(screen.getByRole("button", { name: "변경" }));
    expect(screen.getByLabelText("새 비밀번호")).toHaveFocus();
    expect(f.writes).toHaveLength(0);
    await fill(user,password.slice(0,7));
    await user.click(screen.getByRole("button", { name: "변경" }));
    expect(f.writes).toHaveLength(0);
    await user.clear(screen.getByLabelText("새 비밀번호"));
    await user.click(screen.getByLabelText("새 비밀번호"));await user.paste(password);
    await user.click(screen.getByRole("button", { name: "새 비밀번호 표시" }));
    expect(screen.getByLabelText("새 비밀번호")).toHaveAttribute("type","text");
    await user.click(screen.getByRole("button", { name: "새 비밀번호 숨기기" }));
    expect(screen.getByLabelText("새 비밀번호")).toHaveAttribute("type","password");
    await user.click(screen.getByRole("button", { name: "비밀번호 확인 표시" }));
    expect(screen.getByLabelText("비밀번호 확인")).toHaveAttribute("type","text");
    await user.click(screen.getByRole("button", { name: "변경" }));
    expect(screen.getByText("비밀번호 확인 값이 일치하지 않습니다.")).toBeInTheDocument();
    expect(f.writes).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.getByRole("button", { name: "비밀번호 초기화: existing-owner" })).toHaveFocus();
  });

  it.each([8,128])("accepts %i characters, sends only the password and preserves account metadata", async (length) => {
    const f = fixture(), user = await open(f);const value = Array.from({length},(_,i)=>password[i%password.length]).join("");
    await fill(user,value);await user.click(screen.getByRole("button", { name: "변경" }));
    await screen.findByText("existing-owner 계정의 비밀번호를 변경했습니다.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(f.writes).toHaveLength(1);
    expect(Object.keys(f.writes[0].body)).toEqual(["password"]);
    expect(f.writes[0].body.password === value).toBe(true);
    expect(f.writes[0].init.credentials).toBe("include");
    expect(f.writes[0].init.headers).toHaveProperty("X-CSRF-Token");
    expect(screen.getByRole("table")).toHaveTextContent("existing-owner");
    expect(screen.getByRole("table")).toHaveTextContent("1곳");
    expect(screen.getByRole("status").textContent?.includes(value)).toBe(false);
    await user.click(screen.getByRole("button", { name: "연결 매장: existing-owner" }));
    expect(await within(screen.getByRole("dialog")).findByText("실제 연결 매장")).toBeInTheDocument();
  });

  it.each([404,422,503])("preserves the form and account on %i without reflecting server content or retrying", async (status) => {
    const f = fixture();f.fail(status);const user = await open(f);await fill(user);
    await user.click(screen.getByRole("button", { name: "변경" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent?.includes(password)).toBe(false);
    expect(screen.getByLabelText("로그인 ID")).toHaveValue("existing-owner");
    expect(screen.getByRole("table")).toHaveTextContent("1곳");expect(f.writes).toHaveLength(1);
    expect(screen.getByRole("button", { name: "변경" })).toBeEnabled();
    expect(screen.queryByText(/계정의 비밀번호를 변경했습니다/)).not.toBeInTheDocument();
  });

  it("blocks duplicate submits, cancel and Escape while pending, then restores focus", async () => {
    const f = fixture();let resolve!: (r: Response)=>void;f.hold(new Promise(r=>{resolve=r}));
    const user=await open(f);await fill(user);
    const button=screen.getByRole("button", {name:"변경"});
    act(()=>{fireEvent.click(button);fireEvent.click(button)});
    await waitFor(()=>expect(f.writes).toHaveLength(1));
    expect(screen.getByRole("button", {name:"취소"})).toBeDisabled();
    await user.keyboard("{Escape}");expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async()=>resolve(new Response(null,{status:204})));
    await screen.findByText(/계정의 비밀번호를 변경했습니다/);
    expect(screen.getByRole("button",{name:"비밀번호 초기화: existing-owner"})).toHaveFocus();
  });

  it("rejects overlong input before requests", async () => {
    const f=fixture(),user=await open(f);await fill(user,password.repeat(4));
    await user.click(screen.getByRole("button",{name:"변경"}));expect(f.writes).toHaveLength(0);
    await user.keyboard("{Escape}");expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("hides password resets in explicit Mock mode", async () => {
    const f=fixture();await open(f,true);
    expect(screen.queryByRole("button",{name:/비밀번호 초기화/})).not.toBeInTheDocument();expect(f.transport).not.toHaveBeenCalled();
  });

  it("does not retry network failures and rejects invalid IDs before fetching", async () => {
    const transport=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({csrf_token:"c".repeat(43)})))
      .mockRejectedValueOnce(new TypeError("network"));
    const repository=new ApiOwnerRepository("http://localhost:8001",transport);
    await expect(repository.resetPassword(0,password)).rejects.toThrow();expect(transport).not.toHaveBeenCalled();
    await expect(repository.resetPassword(7,password)).rejects.toThrow();expect(transport).toHaveBeenCalledTimes(2);
  });
});
