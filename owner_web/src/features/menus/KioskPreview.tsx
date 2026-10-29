import { useEffect, useRef, useState } from "react";
import {
  CookingPot,
  CupSoda,
  Globe,
  Headset,
  Mic,
  Settings,
  Soup,
  Trash2,
  Utensils,
  UtensilsCrossed,
  CircleCheck,
} from "lucide-react";
import type { MenuBoard } from "../../data/models";
import { kioskView } from "../../data/menuDraft";
import { formatWon } from "../../data/validation";

// kiosk_app/lib/service/screens/order_screen.dart를 축소해 그린다.
// 실제 화면 크기(논리 해상도)로 그린 뒤 미리보기 폭에 맞춰 줄인다.
const SCREEN_WIDTH = 1280;
const SCREEN_HEIGHT = 800;

// 키오스크 _categoryIcon과 같은 구분. Material 아이콘과 비슷한 lucide 아이콘을 쓴다.
const categoryIcon = (name: string) =>
  ({ 식사: Soup, 국물: CookingPot, 사이드: Utensils, 음료: CupSoda })[name] ??
  UtensilsCrossed;

export type CategoryFilter = number | "all";

export function KioskPreview({
  board,
  category,
  selectedMenuId,
  editingCategoryId,
  onSelectCategory,
  onSelectMenu,
  onAddCategory,
  onRenameCategory,
  onFinishCategory,
}: {
  board: MenuBoard;
  category: CategoryFilter;
  selectedMenuId: number | null;
  editingCategoryId: number | null;
  onSelectCategory(category: CategoryFilter): void;
  onSelectMenu(id: number): void;
  onAddCategory(): void;
  onRenameCategory(id: number, name: string): void;
  onFinishCategory(id: number): void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useEffect(() => {
    const element = viewport.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) =>
      setScale(entry.contentRect.width / SCREEN_WIDTH),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { categories, menus } = kioskView(board);
  const visible =
    category === "all" ? menus : menus.filter((m) => m.categoryId === category);
  const current = categories.find((c) => c.id === category);
  const categoryName = (id: number) =>
    categories.find((c) => c.id === id)?.name ?? "";
  const hasMenus = (id: number) => menus.some((m) => m.categoryId === id);

  return (
    <section className="preview" aria-label="키오스크 미리보기">
      <div className="tablet">
        <div className="tablet-viewport" ref={viewport}>
          <div
            className="kiosk"
            style={{
              width: SCREEN_WIDTH,
              height: SCREEN_HEIGHT,
              transform: `scale(${scale})`,
            }}
          >
            <div className="kiosk-appbar" aria-hidden="true">
              <span className="kiosk-title">AI 보이스크 · 메뉴 주문</span>
              <span className="kiosk-soft-button">
                <Headset size={20} />
                직원 호출
              </span>
              <span className="kiosk-soft-button">
                <Mic size={20} />
                마이크
              </span>
            </div>
            <div className="kiosk-body">
              <nav className="kiosk-rail" aria-label="키오스크 카테고리">
                <button
                  className="kiosk-category"
                  aria-pressed={category === "all"}
                  onClick={() => onSelectCategory("all")}
                >
                  전체
                </button>
                {categories.map((c) =>
                  c.id === editingCategoryId ? (
                    <input
                      key={c.id}
                      className="kiosk-category-input"
                      aria-label="새 카테고리 이름"
                      autoFocus
                      value={c.name}
                      onChange={(e) => onRenameCategory(c.id, e.target.value)}
                      onBlur={() => onFinishCategory(c.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === "Escape")
                          e.currentTarget.blur();
                      }}
                    />
                  ) : (
                    <button
                      key={c.id}
                      className={`kiosk-category ${hasMenus(c.id) ? "" : "empty"}`}
                      aria-pressed={category === c.id}
                      title={
                        hasMenus(c.id)
                          ? undefined
                          : "판매 중인 메뉴가 없어 실제 키오스크에는 보이지 않습니다."
                      }
                      onClick={() => onSelectCategory(c.id)}
                    >
                      {c.name || "(이름 없음)"}
                    </button>
                  ),
                )}
                <button
                  className="kiosk-add-category"
                  aria-label="카테고리 추가"
                  title="편집용 버튼입니다. 실제 키오스크에는 없습니다."
                  onClick={onAddCategory}
                >
                  ＋
                </button>
              </nav>
              <div className="kiosk-menus">
                <div className="kiosk-heading">
                  <strong>
                    {category === "all"
                      ? "전체 메뉴"
                      : current?.name || "(이름 없음)"}
                  </strong>
                  <span>메뉴를 눌러 수량을 선택해 주세요.</span>
                </div>
                {visible.length ? (
                  <div className="kiosk-grid">
                    {visible.map((m) => {
                      const Icon = categoryIcon(categoryName(m.categoryId));
                      return (
                        <button
                          key={m.id}
                          className={`kiosk-card ${m.isSoldOut ? "sold-out" : ""}`}
                          aria-label={`${m.name} ${formatWon(m.price)}${m.isSoldOut ? " 품절" : ""}`}
                          aria-pressed={m.id === selectedMenuId}
                          onClick={() => onSelectMenu(m.id)}
                        >
                          <span className="kiosk-icon" aria-hidden="true">
                            <Icon size={52} />
                          </span>
                          {m.isSoldOut && (
                            <span className="kiosk-sold-out">품절</span>
                          )}
                          <span className="kiosk-name">{m.name}</span>
                          <span className="kiosk-price">
                            {formatWon(m.price)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="kiosk-empty">등록된 메뉴가 없습니다.</p>
                )}
              </div>
              <div className="kiosk-cart" aria-hidden="true">
                <div className="kiosk-cart-head">
                  <strong>장바구니 · 0개</strong>
                  <span className="kiosk-text-button">주문내역</span>
                </div>
                <span className="kiosk-text-button kiosk-clear">
                  <Trash2 size={18} />
                  전체 비우기
                </span>
                <p className="kiosk-cart-empty">
                  메뉴를 담으면 여기에 표시됩니다.
                </p>
                <div className="kiosk-total">
                  <span>합계 금액</span>
                  <strong>0원</strong>
                </div>
                <span className="kiosk-checkout">
                  <CircleCheck size={22} />
                  주문 완료 (시연)
                </span>
              </div>
            </div>
            <div className="kiosk-bottom" aria-hidden="true">
              <span className="kiosk-setting">
                <Settings size={22} />
                설정
              </span>
              <span className="kiosk-soft-button">글자 작게</span>
              <span className="kiosk-soft-button">글자 크게</span>
              <span className="kiosk-setting kiosk-language">
                <Globe size={22} />
                Language
              </span>
            </div>
          </div>
        </div>
      </div>
      <p className="preview-note">
        실제 키오스크 화면을 축소한 모습입니다. 카드를 누르면 편집할 수 있고,
        점선 ＋ 버튼은 편집용이라 실제 키오스크에는 없습니다.
      </p>
    </section>
  );
}
