import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppEntry } from "../AppEntry";
import { MockAdminRepository } from "../data/adminRepository";
import { AdminLoginForm, LoginPage, parseAdminLoginId } from "../features/LoginPage";

afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

describe("login UI preview without authentication", () => {
  it("opens /login independently without mounting the admin data loaders", () => {
    window.history.replaceState(null, "", "/login");
    const transport = vi.fn();
    vi.stubGlobal("fetch", transport);
    render(<AppEntry />);
    expect(screen.getByRole("heading", { name: "관리자 로그인" })).toBeInTheDocument();
    expect(screen.getByText(/인증 API 미연동/)).toBeInTheDocument();
    expect(screen.getByText(/접근을 제한하지 않습니다/)).toBeInTheDocument();
    expect(screen.getByLabelText("관리자 ID")).toHaveAttribute("inputmode", "numeric");
    expect(screen.getByLabelText("비밀번호", { exact: true })).toHaveAttribute("type", "password");
    expect(screen.getByRole("link", { name: /기존 관리자 화면 보기/ })).toHaveAttribute("href", "/");
    expect(transport).not.toHaveBeenCalled();
  });

  it("also supports a trailing slash preview URL", () => {
    window.history.replaceState(null, "", "/login/");
    render(<AppEntry />);
    expect(screen.getByRole("heading", { name: "관리자 로그인" })).toBeInTheDocument();
  });

  it("keeps the existing admin root accessible without a fake authentication guard", async () => {
    render(<AppEntry repository={new MockAdminRepository()}
      orderRepository={null} storeRepository={null} ownerRepository={null}
      deviceRepository={null} alertRepository={null} />);
    await screen.findByRole("heading", { name: "운영 요약" });
    expect(screen.getByRole("link", { name: "로그인 UI 미리보기" })).toHaveAttribute("href", "/login");
    expect(screen.getByText("회사 관리자 · 시연 모드")).toBeInTheDocument();
  });

  it("validates empty inputs, focuses ID first, and never submits invalid data", async () => {
    const submit = vi.fn();
    const user = userEvent.setup();
    render(<AdminLoginForm onSubmit={submit} />);
    await user.click(screen.getByRole("button", { name: "로그인" }));
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(screen.getByLabelText("관리자 ID")).toHaveFocus();
    expect(screen.getByLabelText("관리자 ID")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("비밀번호", { exact: true })).toHaveAttribute("aria-invalid", "true");
    expect(submit).not.toHaveBeenCalled();
  });

  it.each(["0", "-1", "1.5", "1e2", "letters", "01", "2147483648"])(
    "rejects the invalid admin ID format %s", async (value) => {
      const submit = vi.fn();
      const user = userEvent.setup();
      render(<AdminLoginForm onSubmit={submit} />);
      await user.type(screen.getByLabelText("관리자 ID"), value);
      await user.type(screen.getByLabelText("비밀번호", { exact: true }), crypto.randomUUID());
      await user.click(screen.getByRole("button", { name: "로그인" }));
      expect(screen.getByRole("alert")).toHaveTextContent("정수로 입력");
      expect(submit).not.toHaveBeenCalled();
    },
  );

  it("separates integer parsing from the form and forwards only a validated integer", async () => {
    expect(parseAdminLoginId("2147483647")).toBe(2147483647);
    expect(parseAdminLoginId("9007199254740993")).toBeNull();
    const submit = vi.fn();
    const user = userEvent.setup();
    const generatedInput = crypto.randomUUID();
    render(<AdminLoginForm onSubmit={submit} />);
    await user.type(screen.getByLabelText("관리자 ID"), " 12 ");
    await user.type(screen.getByLabelText("비밀번호", { exact: true }), generatedInput);
    await user.keyboard("{Enter}");
    expect(submit).toHaveBeenCalledTimes(1);
    const input = submit.mock.calls[0][0];
    expect(input.adminId).toBe(12);
    expect(input.password === generatedInput).toBe(true);
    expect(screen.getByLabelText("비밀번호", { exact: true })).toHaveValue("");
  });

  it("focuses the missing password and clears its field error on editing", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText("관리자 ID"), "12");
    await user.click(screen.getByRole("button", { name: "로그인" }));
    const field = screen.getByLabelText("비밀번호", { exact: true });
    expect(field).toHaveFocus();
    expect(field).toHaveAccessibleDescription("비밀번호를 입력해 주세요.");
    await user.type(field, crypto.randomUUID());
    expect(field).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("toggles password visibility accessibly without submitting", async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    render(<AdminLoginForm onSubmit={submit} />);
    const input = screen.getByLabelText("비밀번호", { exact: true });
    await user.type(input, crypto.randomUUID());
    await user.click(screen.getByRole("button", { name: "비밀번호 표시" }));
    expect(input).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "비밀번호 숨기기" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "비밀번호 숨기기" }));
    expect(input).toHaveAttribute("type", "password");
    expect(submit).not.toHaveBeenCalled();
  });

  it("never sends, persists, logs, echoes or authenticates valid preview input", async () => {
    const transport = vi.fn();
    vi.stubGlobal("fetch", transport);
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    window.history.replaceState(null, "", "/login");
    render(<AppEntry />);
    const user = userEvent.setup();
    const generatedInput = crypto.randomUUID();
    await user.type(screen.getByLabelText("관리자 ID"), "12");
    await user.type(screen.getByLabelText("비밀번호", { exact: true }), generatedInput);
    await user.click(screen.getByRole("button", { name: "로그인" }));
    expect(screen.getByRole("status")).toHaveTextContent("로그인할 수 없습니다");
    expect(screen.getByLabelText("비밀번호", { exact: true })).toHaveValue("");
    expect(document.body.textContent?.includes(generatedInput)).toBe(false);
    expect(transport).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
    for (const log of logs) expect(log).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/login");
    expect(screen.queryByRole("heading", { name: "운영 요약" })).not.toBeInTheDocument();
    expect(screen.queryByText(/로그인 성공|로그아웃/)).not.toBeInTheDocument();
  });

  it("supports a safe authentication error presentation without interpreting HTML", () => {
    render(<AdminLoginForm onSubmit={() => undefined} feedback={{
      kind: "error", message: "<b>인증 요청에 실패했습니다.</b>",
    }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("<b>인증 요청에 실패했습니다.</b>");
    expect(screen.getByRole("alert").querySelector("b")).toBeNull();
  });
});
