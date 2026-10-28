import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AdminShell, pages } from "../layout/AdminShell";
import { App } from "../App";
import { MockAdminRepository } from "../data/adminRepository";

describe("clean admin shell presentation", () => {
  it.each(pages)("keeps main heading and navigation with the account only below the sidebar logo on $label", async (page) => {
    const user = userEvent.setup(), onNavigate = vi.fn(), onLogout = vi.fn();
    const admin = { id: 87, name: "표시 확인" };
    const { container } = render(<AdminShell admin={admin} onLogout={onLogout} page={page.id}
      onNavigate={onNavigate} liveOrders liveStores={false} liveOwners liveDevices={false} liveAlerts>
      <h1>{page.label}</h1>
    </AdminShell>);
    const sidebar = container.querySelector("aside")!;
    expect(screen.getByRole("heading", { name: page.label, level: 1 })).toBeInTheDocument();
    expect(container.querySelector(".topbar")).toBeNull();
    expect(container.querySelector(".workspace > header")).toBeNull();
    const account = sidebar.querySelector<HTMLElement>(".sidebar-account")!;
    expect(account.querySelector("svg")).not.toBeNull();
    expect(within(account).getByText(admin.name)).toBeInTheDocument();
    expect(within(account).getByText("관리자 #87")).toBeInTheDocument();
    expect(screen.getAllByText(admin.name)).toHaveLength(1);
    expect(account.previousElementSibling).toHaveClass("brand");
    expect(account.nextElementSibling?.tagName).toBe("NAV");
    expect(sidebar).not.toHaveTextContent(/AI-Voisk 운영 관리|화면별 데이터 출처 확인/);
    expect(within(sidebar).getByText("AI-Voisk")).toBeInTheDocument();
    expect(within(sidebar).queryByText("회사 관리자")).not.toBeInTheDocument();
    expect(sidebar.querySelector(".signed-in-admin")).toBeNull();
    const footer = sidebar.querySelector<HTMLElement>(".sidebar-footer")!;
    expect(footer.textContent).toBe("로그아웃");
    const nav = screen.getByRole("navigation", { name: "주요 화면" });
    expect(within(nav).getAllByRole("button")).toHaveLength(6);
    for (const item of pages) {
      await user.click(within(nav).getByRole("button", { name: item.label }));
      expect(onNavigate).toHaveBeenLastCalledWith(item.id);
    }
    await user.click(screen.getByRole("button", { name: "메뉴 열기" }));
    expect(screen.getByRole("button", { name: "메뉴 열기" })).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "메뉴 열기" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "메뉴 열기" })).toHaveAttribute("aria-expanded", "false");
    await user.click(within(footer).getByRole("button", { name: "로그아웃" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
  it("updates the single sidebar account from session props", () => {
    const props = { page: "dashboard" as const, onNavigate: vi.fn(), onLogout: vi.fn(),
      liveOrders: false, liveStores: false, liveOwners: false, liveDevices: false, liveAlerts: false };
    const { rerender, container } = render(<AdminShell {...props} admin={{ id: 1, name: "첫 계정" }}><h1>운영 요약</h1></AdminShell>);
    rerender(<AdminShell {...props} admin={{ id: 2147483647, name: "다른관리자계정이름" }}><h1>운영 요약</h1></AdminShell>);
    expect(container.querySelector(".sidebar-account")).toHaveTextContent("다른관리자계정이름관리자 #2147483647");
    expect(screen.getAllByText("다른관리자계정이름")).toHaveLength(1);
    expect(screen.queryByText(/첫 계정/)).not.toBeInTheDocument();
    expect(container.querySelector(".workspace")).not.toHaveTextContent(/다른관리자계정이름|관리자 #2147483647/);
    expect(container.querySelector(".topbar")).toBeNull();
  });
  it.each(["close", "overlay", "escape-from-logout"])("closes the mobile sidebar and restores menu focus: %s", async (method) => {
    const user = userEvent.setup();
    const { container } = render(<AdminShell page="dashboard" admin={{ id: 9, name: "세션 관리자" }}
      onLogout={vi.fn()} onNavigate={vi.fn()} liveOrders liveStores liveOwners liveDevices liveAlerts><h1>운영 요약</h1></AdminShell>);
    const trigger = screen.getByRole("button", { name: "메뉴 열기" });
    await user.click(trigger);
    expect(screen.getByRole("button", { name: "운영 요약" })).toHaveFocus();
    if (method === "escape-from-logout") {
      screen.getByRole("button", { name: "로그아웃" }).focus();
      await user.keyboard("{Escape}");
    } else await user.click(container.querySelector<HTMLElement>(method === "overlay" ? ".nav-overlay" : ".mobile-close")!);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
    expect(container.querySelector(".nav-overlay")).toBeNull();
  });
  it("returns focus after choosing a page in the mobile menu", async () => {
    const user = userEvent.setup(), onNavigate = vi.fn();
    render(<AdminShell page="dashboard" onNavigate={onNavigate} liveOrders liveStores liveOwners liveDevices liveAlerts><h1>운영 요약</h1></AdminShell>);
    const trigger = screen.getByRole("button", { name: "메뉴 열기" });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "매장 관리" }));
    expect(onNavigate).toHaveBeenCalledWith("stores");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });
  it("retains Mock metrics, icons and actions without source captions", async () => {
    render(<App repository={new MockAdminRepository()} orderRepository={null} storeRepository={null}
      ownerRepository={null} deviceRepository={null} alertRepository={null} />);
    await screen.findByRole("heading", { name: "운영 요약", level: 1 });
    for (const [name, value] of [["등록 매장", "6곳"], ["점주 계정", "4개"]]) {
      const metric = screen.getByRole("region", { name });
      expect(metric).toHaveTextContent(value);
      expect(metric.querySelector("svg")).not.toBeNull();
      expect(metric.querySelector("small")).toBeNull();
    }
    expect(screen.getByRole("heading", { name: "최근 주문" })).toBeInTheDocument();
    expect(screen.queryByText(/매장:.*API|점주:.*Mock|기기:.*Mock|알림:.*Mock/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "기기 목록 보기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "알림 목록 보기" })).toBeInTheDocument();
  });
});
