import { useCallback, useState, type ReactNode } from "react";
import {
  Ban,
  ChevronRight,
  CircleAlert,
  MonitorSmartphone,
  ReceiptText,
  Wallet,
} from "lucide-react";
import type { MenuBoard, Page } from "../data/models";
import type { OwnerRepository } from "../data/ownerRepository";
import {
  formatDateTime,
  formatTime,
  menuSummary,
  orderTypeLabel,
  orderViews,
  ordersDaysAgo,
  topMenus,
  totalAmount,
} from "../data/orderSelectors";
import { soldOutMenuCount } from "../data/selectors";
import { updateMenu, updateOption } from "../data/menuDraft";
import { formatWon } from "../data/validation";
import { useAsync } from "../hooks/useAsync";
import {
  Badge,
  Card,
  ErrorState,
  Heading,
  Loading,
  Section,
} from "../components/ui";
import { OrderDetail } from "./OrdersPage";
import type { OrderView } from "../data/orderSelectors";

function Metric({
  title,
  icon,
  value,
  note,
  attention = false,
}: {
  title: string;
  icon: ReactNode;
  value: string;
  note: ReactNode;
  attention?: boolean;
}) {
  return (
    <>
      <span className="metric-title">
        {title}
        {icon}
      </span>
      <strong className="metric-value">{value}</strong>
      <span className={attention ? "metric-note error-text" : "metric-note"}>
        {note}
      </span>
    </>
  );
}

// 지금 품절인 메뉴와 옵션. 판매 재개는 품절 스위치처럼 즉시 반영한다.
function SoldOutList({
  board,
  repository,
  onBoardChange,
}: {
  board: MenuBoard;
  repository: OwnerRepository;
  onBoardChange(update: (board: MenuBoard) => MenuBoard): void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeMenus = new Map(
    board.menus.filter((m) => m.isActive).map((m) => [m.id, m]),
  );
  const rows = [
    ...board.menus
      .filter((m) => m.isActive && m.isSoldOut)
      .map((m) => ({
        key: `menu-${m.id}`,
        name: m.name,
        kind: "메뉴",
        id: m.id,
      })),
    ...board.options
      .filter((o) => o.isActive && o.isSoldOut && activeMenus.has(o.menuId))
      .map((o) => ({
        key: `option-${o.id}`,
        name: `${activeMenus.get(o.menuId)!.name} · ${o.name}`,
        kind: "옵션",
        id: o.id,
      })),
  ];
  async function resume(row: (typeof rows)[number]) {
    setPending(row.key);
    setError(null);
    try {
      if (row.kind === "메뉴") {
        await repository.setMenuSoldOut(row.id, false);
        onBoardChange((b) => updateMenu(b, row.id, { isSoldOut: false }));
      } else {
        await repository.setOptionSoldOut(row.id, false);
        onBoardChange((b) => updateOption(b, row.id, { isSoldOut: false }));
      }
    } catch {
      setError("판매를 재개하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setPending(null);
    }
  }
  return (
    <Card className="today-card">
      <Section title="지금 품절" />
      {error && <p role="alert">{error}</p>}
      {rows.length ? (
        <ul className="today-list" aria-label="품절 목록">
          {rows.map((row) => (
            <li key={row.key}>
              <Badge tone="attention">{row.kind}</Badge>
              <span className="today-list-main">{row.name}</span>
              <button
                className="primary"
                disabled={pending === row.key}
                aria-label={`${row.name} 판매 재개`}
                onClick={() => void resume(row)}
              >
                판매 재개
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">지금 품절인 메뉴와 옵션이 없습니다.</p>
      )}
      <p className="muted">판매 재개는 누르는 즉시 키오스크에 반영됩니다.</p>
    </Card>
  );
}

export function TodayPage({
  repository,
  board,
  now,
  onBoardChange,
  onNavigate,
}: {
  repository: OwnerRepository;
  board: MenuBoard;
  now: string;
  onBoardChange(update: (board: MenuBoard) => MenuBoard): void;
  onNavigate(page: Page): void;
}) {
  const load = useCallback(
    async (signal: AbortSignal) => {
      const [history, devices] = await Promise.all([
        repository.getOrderHistory(signal),
        repository.getDevices(signal),
      ]);
      return { history, devices };
    },
    [repository],
  );
  const result = useAsync(load);
  const [detail, setDetail] = useState<OrderView | null>(null);

  const heading = (
    <Heading title="오늘 현황">
      {formatDateTime(now).slice(0, 10)} 기준입니다. 금액은 현재 메뉴 가격으로
      계산합니다.
    </Heading>
  );
  if (result.loading)
    return (
      <>
        {heading}
        <Loading />
      </>
    );
  if (result.error || !result.data)
    return (
      <>
        {heading}
        <ErrorState
          message="오늘 현황을 불러오지 못했습니다."
          onRetry={result.reload}
        />
      </>
    );

  const orders = orderViews(result.data.history, board);
  const today = ordersDaysAgo(orders, 0, now);
  const yesterday = ordersDaysAgo(orders, 1, now);
  const takeaway = today.filter((o) => o.orderType === "takeaway").length;
  const soldOut = soldOutMenuCount(board);
  const stopped = board.menus.filter((m) => !m.isActive).length;
  const top = topMenus(today);
  const maxQuantity = Math.max(1, ...top.map((t) => t.quantity));
  const devices = result.data.devices.filter((d) => d.isActive);
  const offline = devices.filter((d) => d.connection === "offline");

  return (
    <>
      {heading}
      <div className="metrics">
        <Card>
          <Metric
            title="오늘 주문"
            icon={<ReceiptText aria-hidden="true" />}
            value={`${today.length}건`}
            note={`포장 ${takeaway}건 · 매장 식사 ${today.length - takeaway}건`}
          />
        </Card>
        <Card>
          <Metric
            title="오늘 매출"
            icon={<Wallet aria-hidden="true" />}
            value={formatWon(totalAmount(today))}
            note={`어제 ${formatWon(totalAmount(yesterday))}`}
          />
        </Card>
        <button
          className={`card metric-button ${soldOut ? "attention" : ""}`}
          aria-label={`품절 메뉴 ${soldOut}개, 메뉴 관리로 이동`}
          onClick={() => onNavigate("menus")}
        >
          <Metric
            title="품절 메뉴"
            icon={<CircleAlert aria-hidden="true" />}
            value={`${soldOut}개`}
            note={
              <>
                메뉴 관리로 이동 <ChevronRight size={14} aria-hidden="true" />
              </>
            }
            attention={soldOut > 0}
          />
        </button>
        <Card>
          <Metric
            title="판매 중지 메뉴"
            icon={<Ban aria-hidden="true" />}
            value={`${stopped}개`}
            note="키오스크에 보이지 않는 메뉴"
          />
        </Card>
      </div>

      <div className="today-grid">
        <Card
          className={`today-card ${offline.length ? "attention-card" : ""}`}
        >
          <Section title="키오스크 연결 상태">
            <MonitorSmartphone aria-hidden="true" />
          </Section>
          <p
            className={offline.length ? "error-text strong" : "ok-text strong"}
          >
            {offline.length
              ? `연결 끊김 ${offline.length}대`
              : `모두 정상 (${devices.length}대)`}
          </p>
          <ul className="today-list" aria-label="키오스크 목록">
            {devices.map((d) => (
              <li key={d.id}>
                <span className="today-list-main">키오스크 {d.id}번</span>
                {d.connection === "online" ? (
                  <Badge tone="ok">정상</Badge>
                ) : (
                  <Badge tone="attention">연결 끊김</Badge>
                )}
                <span className="muted">
                  {d.lastSeenAt
                    ? `마지막 연결 ${formatTime(d.lastSeenAt)}`
                    : "연결 기록 없음"}
                </span>
              </li>
            ))}
          </ul>
          {offline.length > 0 && (
            <p className="muted">
              키오스크의 전원과 인터넷 연결을 확인해 주세요.
            </p>
          )}
        </Card>
        <SoldOutList
          board={board}
          repository={repository}
          onBoardChange={onBoardChange}
        />

        <Card className="today-card">
          <Section title="오늘 많이 팔린 메뉴" />
          {top.length ? (
            <ol className="top-menus" aria-label="오늘 많이 팔린 메뉴 TOP 5">
              {top.map((t, i) => (
                <li key={t.menuId}>
                  <span className="top-rank">{i + 1}</span>
                  <span className="top-name">{t.name}</span>
                  <span className="top-bar" aria-hidden="true">
                    <span
                      style={{ width: `${(t.quantity / maxQuantity) * 100}%` }}
                    />
                  </span>
                  <span className="top-quantity">{t.quantity}개</span>
                  <span className="top-amount">{formatWon(t.amount)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">오늘 들어온 주문이 없습니다.</p>
          )}
        </Card>

        <Card className="today-card">
          <Section title="최근 주문">
            <button onClick={() => onNavigate("orders")}>전체 보기</button>
          </Section>
          <ul className="recent-orders" aria-label="최근 주문 5건">
            {orders.slice(0, 5).map((o) => (
              <li key={o.id}>
                <button
                  className="recent-order"
                  aria-label={`주문 #${o.id} 상세`}
                  onClick={() => setDetail(o)}
                >
                  <span className="recent-id">#{o.id}</span>
                  <span className="muted">{formatDateTime(o.orderedAt)}</span>
                  <span>{orderTypeLabel(o.orderType)}</span>
                  <span className="recent-menu">{menuSummary(o)}</span>
                  <strong>{formatWon(o.amount)}</strong>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      {detail && <OrderDetail order={detail} onClose={() => setDetail(null)} />}
    </>
  );
}
