import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AdminShell, pages } from "../layout/AdminShell";
import { App } from "../App";
import { MockAdminRepository } from "../data/adminRepository";

describe("clean admin shell presentation", () => {
  it.each(pages)("keeps main heading, navigation and only the top-right account on $label", async (page) => {
    const user = userEvent.setup(), onNavigate = vi.fn(), onLogout = vi.fn();
    const admin = { id: 87, name: "표시 확인" };
    const { container } = render(<AdminShell admin={admin} onLogout={onLogout} page={page.id}
      onNavigate={onNavigate} liveOrders liveStores={false} liveOwners liveDevices={false} liveAlerts>
      <h1>{page.label}</h1>
    </AdminShell>);
    const header = container.querySelector(".topbar")!;
    const sidebar = container.querySelector("aside")!;
    expect(screen.getByRole("heading", { name: page.label, level: 1 })).toBeInTheDocument();
    expect(header).not.toHaveTextContent(page.label);
    expect(header.querySelector(".source")).toBeNull();
    expect(header.querySelector(".account svg")).not.toBeNull();
    expect(header).toHaveTextContent("표시 확인 · 관리자 #87");
    expect(screen.getAllByText("표시 확인 · 관리자 #87")).toHaveLength(1);
    expect(sidebar).not.toHaveTextContent(/표시 확인|관리자 #87|AI-Voisk 운영 관리|화면별 데이터 출처 확인/);
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
  it("updates the visible account from props without creating a sidebar copy", () => {
    const props = { page: "dashboard" as const, onNavigate: vi.fn(), onLogout: vi.fn(),
      liveOrders: false, liveStores: false, liveOwners: false, liveDevices: false, liveAlerts: false };
    const { rerender, container } = render(<AdminShell {...props} admin={{ id: 1, name: "첫 계정" }}><h1>운영 요약</h1></AdminShell>);
    rerender(<AdminShell {...props} admin={{ id: 2147483647, name: "다른관리자계정이름" }}><h1>운영 요약</h1></AdminShell>);
    expect(container.querySelector(".account")).toHaveTextContent("다른관리자계정이름 · 관리자 #2147483647");
    expect(screen.queryByText(/첫 계정/)).not.toBeInTheDocument();
    expect(container.querySelector("aside")).not.toHaveTextContent("다른관리자계정이름");
    expect(container.querySelector(".topbar")).not.toHaveTextContent(/출처별 요약|Mock 데이터|실제.*API/);
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
