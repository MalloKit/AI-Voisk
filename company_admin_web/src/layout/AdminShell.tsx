import type { AuthAdmin } from "../data/authRepository";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  LayoutDashboard,
  Store,
  Users,
  ReceiptText,
  Monitor,
  Bell,
  Menu,
  UserCircle,
  X,
} from "lucide-react";
import type { Page } from "../data/models";

export const pages = [
  { id: "dashboard", label: "운영 요약", Icon: LayoutDashboard },
  { id: "stores", label: "매장 관리", Icon: Store },
  { id: "owners", label: "점주 계정", Icon: Users },
  { id: "orders", label: "주문 조회", Icon: ReceiptText },
  { id: "devices", label: "기기 관리", Icon: Monitor },
  { id: "alerts", label: "장애/알림", Icon: Bell },
] as const;
export function AdminShell({
  admin,
  onLogout,
  page,
  onNavigate,
  children,
}: {
  admin?: AuthAdmin;
  onLogout?(): void;
  page: Page;
  onNavigate(page: Page): void;
  liveOrders: boolean;
  liveStores: boolean;
  liveOwners: boolean;
  liveDevices: boolean;
  liveAlerts: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const nav = useRef<HTMLElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open)
      nav.current
        ?.querySelector<HTMLButtonElement>('[aria-current="page"]')
        ?.focus();
  }, [open]);
  return (
    <div className={`shell ${open ? "nav-open" : ""}`}>
      <a className="skip-link" href="#main">
        본문으로 이동
      </a>
      {open && (
        <button
          className="nav-overlay"
          aria-label="메뉴 닫기"
          onClick={() => {
            setOpen(false);
            trigger.current?.focus();
          }}
        />
      )}
      <aside className="sidebar" aria-label="회사 관리자 메뉴">
        <div className="brand">
          <strong>AI-Voisk</strong>
          <button
            className="mobile-close icon-button"
            aria-label="메뉴 닫기"
            onClick={() => {
              setOpen(false);
              trigger.current?.focus();
            }}
          >
            <X />
          </button>
        </div>
        <nav
          ref={nav}
          aria-label="주요 화면"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              trigger.current?.focus();
            }
          }}
        >
          {pages.map((p) => (
            <button
              key={p.id}
              aria-current={page === p.id ? "page" : undefined}
              onClick={() => {
                setOpen(false);
                onNavigate(p.id);
                if (open) trigger.current?.focus();
              }}
            >
              <p.Icon aria-hidden="true" size={21} />
              {p.label}
            </button>
          ))}
        </nav>
        {onLogout && <div className="sidebar-footer">
          <button className="logout-button" onClick={onLogout}>로그아웃</button>
        </div>}
      </aside>
      <div className="workspace">
        <header className="topbar">
          <button
            ref={trigger}
            className="menu-toggle icon-button"
            aria-label="메뉴 열기"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <Menu />
          </button>
          <span className="account">
            <UserCircle size={23} aria-hidden="true" />
            {admin ? `${admin.name} · 관리자 #${admin.id}` : "관리자 인증 확인 필요"}
          </span>
        </header>
        <main id="main" tabIndex={-1} key={page}>
          <div className="content">{children}</div>
        </main>
      </div>
    </div>
  );
}
