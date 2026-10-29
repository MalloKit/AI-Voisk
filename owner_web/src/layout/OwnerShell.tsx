import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CalendarCheck,
  UtensilsCrossed,
  ReceiptText,
  Store,
  Menu,
  UserCircle,
  X,
} from "lucide-react";
import type { Page } from "../data/models";

export const pages = [
  { id: "today", label: "오늘 현황", Icon: CalendarCheck },
  { id: "menus", label: "메뉴 관리", Icon: UtensilsCrossed },
  { id: "orders", label: "주문 내역", Icon: ReceiptText },
  { id: "store", label: "매장 정보", Icon: Store },
] as const;
export function OwnerShell({
  page,
  onNavigate,
  storeName,
  soldOutCount,
  children,
}: {
  page: Page;
  onNavigate(page: Page): void;
  storeName: string;
  soldOutCount: number;
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
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  const label = pages.find((p) => p.id === page)!.label;
  return (
    <div className={`shell ${open ? "nav-open" : ""}`}>
      <a className="skip-link" href="#main">
        본문으로 이동
      </a>
      {open && (
        <button
          className="nav-overlay"
          aria-label="메뉴 닫기"
          onClick={close}
        />
      )}
      <aside className="sidebar" aria-label="점주 관리자 메뉴">
        <div className="brand">
          <strong>AI-Voisk</strong>
          <span>점주 · {storeName}</span>
          <button
            className="mobile-close icon-button"
            aria-label="메뉴 닫기"
            onClick={close}
          >
            <X />
          </button>
        </div>
        <nav
          ref={nav}
          aria-label="주요 화면"
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
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
              <span className="nav-label">{p.label}</span>
              {p.id === "menus" && soldOutCount > 0 && (
                <span
                  className="nav-count"
                  aria-label={`품절 ${soldOutCount}개`}
                >
                  {soldOutCount}
                </span>
              )}
            </button>
          ))}
        </nav>
        <small className="sidebar-footer">
          AI-Voisk 매장 관리
          <br />
          시연 데이터로 동작합니다
        </small>
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
          <strong>{label}</strong>
          <span className="badge">시연 데이터</span>
          <span className="account">
            <UserCircle size={23} aria-hidden="true" />
            시연 점주
          </span>
        </header>
        <main id="main" tabIndex={-1} key={page}>
          <div className="content">{children}</div>
        </main>
      </div>
    </div>
  );
}
