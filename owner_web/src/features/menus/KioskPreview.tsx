import { useEffect, useRef, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
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
import type { Category, Menu, MenuBoard } from "../../data/models";
import { kioskView } from "../../data/menuDraft";
import { formatWon } from "../../data/validation";
import type { CategoryFilter, DragData, DropData } from "./dnd";

export type { CategoryFilter };
// 끄는 동안 놓일 위치 표시. into는 카테고리 안으로 넣기.
export interface DropMark {
  id: string;
  mode: "before" | "after" | "into";
}

// kiosk_app/lib/service/screens/order_screen.dart를 축소해 그린다.
// 실제 화면 크기(논리 해상도)로 그린 뒤 미리보기 폭에 맞춰 줄인다.
const SCREEN_WIDTH = 1280;
const SCREEN_HEIGHT = 800;

// 키오스크 _categoryIcon과 같은 구분. Material 아이콘과 비슷한 lucide 아이콘을 쓴다.
const categoryIcon = (name: string) =>
  ({ 식사: Soup, 국물: CookingPot, 사이드: Utensils, 음료: CupSoda })[name] ??
  UtensilsCrossed;

export const menuLabel = (m: Pick<Menu, "name">) => m.name.trim() || "새 메뉴";
const markClass = (mark: DropMark | null, id: string) =>
  mark?.id === id ? `drop-${mark.mode}` : "";

function MenuCard({
  menu,
  categoryName,
  selected,
  changed,
  mark,
  onSelect,
}: {
  menu: Menu;
  categoryName: string;
  selected: boolean;
  changed: boolean;
  mark: DropMark | null;
  onSelect(): void;
}) {
  const id = `menu:${menu.id}`;
  const label = menuLabel(menu);
  const drag = useDraggable({
    id,
    data: { type: "menu", menuId: menu.id, label } satisfies DragData,
    attributes: { roleDescription: "끌 수 있는 메뉴 카드" },
  });
  const drop = useDroppable({
    id,
    data: {
      type: "menu",
      menuId: menu.id,
      categoryId: menu.categoryId,
      label,
    } satisfies DropData,
  });
  const Icon = categoryIcon(categoryName);
  return (
    <button
      ref={(el) => {
        drag.setNodeRef(el);
        drop.setNodeRef(el);
      }}
      {...drag.attributes}
      {...drag.listeners}
      className={[
        "kiosk-card",
        menu.isSoldOut ? "sold-out" : "",
        drag.isDragging ? "dragging" : "",
        markClass(mark, id),
      ].join(" ")}
      aria-label={[
        menu.name.trim() || "이름 입력",
        menu.price ? formatWon(menu.price) : "가격 입력",
        menu.isSoldOut ? "품절" : "",
        changed ? "· 저장 안 됨" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-pressed={selected}
      onClick={onSelect}
    >
      {changed && <span className="unsaved-dot" aria-hidden="true" />}
      <span className="kiosk-icon" aria-hidden="true">
        <Icon size={52} />
      </span>
      {menu.isSoldOut && <span className="kiosk-sold-out">품절</span>}
      <span className={`kiosk-name ${menu.name.trim() ? "" : "placeholder"}`}>
        {menu.name.trim() || "이름 입력"}
      </span>
      <span className={`kiosk-price ${menu.price ? "" : "placeholder"}`}>
        {menu.price ? formatWon(menu.price) : "가격 입력"}
      </span>
    </button>
  );
}

function RailCategory({
  category,
  pressed,
  empty,
  mark,
  onSelect,
}: {
  category: Category;
  pressed: boolean;
  empty: boolean;
  mark: DropMark | null;
  onSelect(): void;
}) {
  const id = `category:${category.id}`;
  const label = category.name.trim() || "이름 없는 카테고리";
  const drag = useDraggable({
    id,
    data: {
      type: "category",
      categoryId: category.id,
      label,
    } satisfies DragData,
    attributes: { roleDescription: "끌 수 있는 카테고리" },
  });
  const drop = useDroppable({
    id,
    data: {
      type: "category",
      categoryId: category.id,
      label,
    } satisfies DropData,
  });
  return (
    <button
      ref={(el) => {
        drag.setNodeRef(el);
        drop.setNodeRef(el);
      }}
      {...drag.attributes}
      {...drag.listeners}
      className={[
        "kiosk-category",
        empty ? "empty" : "",
        drag.isDragging ? "dragging" : "",
        markClass(mark, id),
      ].join(" ")}
      aria-pressed={pressed}
      title={
        empty
          ? "판매 중인 메뉴가 없어 실제 키오스크에는 보이지 않습니다."
          : undefined
      }
      onClick={onSelect}
    >
      {category.name || "(이름 없음)"}
    </button>
  );
}

export function KioskPreview({
  board,
  category,
  selectedMenuId,
  editingCategoryId,
  changedMenuIds,
  mark,
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
  changedMenuIds: Set<number>;
  mark: DropMark | null;
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
  const grid = useDroppable({
    id: "grid",
    data: { type: "grid", label: "메뉴 영역" } satisfies DropData,
  });

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
                    <RailCategory
                      key={c.id}
                      category={c}
                      pressed={category === c.id}
                      empty={!hasMenus(c.id)}
                      mark={mark}
                      onSelect={() => onSelectCategory(c.id)}
                    />
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
              <div
                ref={grid.setNodeRef}
                className={`kiosk-menus ${grid.isOver ? "drop-grid" : ""}`}
              >
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
                    {visible.map((m) => (
                      <MenuCard
                        key={m.id}
                        menu={m}
                        categoryName={categoryName(m.categoryId)}
                        selected={m.id === selectedMenuId}
                        changed={changedMenuIds.has(m.id)}
                        mark={mark}
                        onSelect={() => onSelectMenu(m.id)}
                      />
                    ))}
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
        실제 키오스크 화면을 축소한 모습입니다. 카드를 누르면 편집하고, 끌면
        순서를 바꿉니다. 점선 ＋ 버튼과 주황 점은 편집용 표시라 실제
        키오스크에는 없습니다.
      </p>
    </section>
  );
}
