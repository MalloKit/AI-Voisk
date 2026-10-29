import { useCallback, useState } from "react";
import type { MenuBoard } from "../data/models";
import type { OwnerRepository } from "../data/ownerRepository";
import {
  PERIODS,
  filterOrders,
  formatDateTime,
  menuSummary,
  orderTypeLabel,
  orderViews,
  totalAmount,
  type OrderView,
  type Period,
  type TypeFilter,
} from "../data/orderSelectors";
import { formatWon } from "../data/validation";
import { useAsync } from "../hooks/useAsync";
import {
  ErrorState,
  Field,
  Filter,
  Filters,
  Heading,
  Loading,
  Modal,
  Search,
  Table,
} from "../components/ui";

const TYPES: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "dine_in", label: "매장 식사" },
  { value: "takeaway", label: "포장" },
];
const PRICE_NOTE =
  "주문 당시 가격이 저장되지 않아 지금의 메뉴·옵션 가격으로 계산했습니다.";

export function OrderDetail({
  order,
  onClose,
}: {
  order: OrderView;
  onClose(): void;
}) {
  return (
    <Modal title={`주문 #${order.id}`} onClose={onClose}>
      <dl className="detail-grid">
        <Field label="주문 시각">{formatDateTime(order.orderedAt)}</Field>
        <Field label="구분">{orderTypeLabel(order.orderType)}</Field>
        <Field label="키오스크">
          {order.deviceId === null ? "-" : `${order.deviceId}번`}
        </Field>
      </dl>
      <ul className="order-lines" aria-label="주문 품목">
        {order.lines.map((line) => (
          <li key={line.itemId}>
            <div className="order-line-head">
              <strong>{line.menuName}</strong>
              <span>× {line.quantity}</span>
              <span className="order-line-amount">
                {formatWon(line.amount)}
              </span>
            </div>
            <ul className="order-line-options">
              <li>
                <span>메뉴 가격</span>
                <span>{formatWon(line.menuPrice)}</span>
              </li>
              {line.options.map((o) => (
                <li key={o.id}>
                  <span>+ {o.name}</span>
                  <span>{formatWon(o.extraPrice)}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <div className="order-total">
        <span>합계 ({order.quantity}개)</span>
        <strong>{formatWon(order.amount)}</strong>
      </div>
      <p className="notice-box">
        <strong>현재 메뉴 가격 기준</strong> · {PRICE_NOTE}
      </p>
    </Modal>
  );
}

export function OrdersPage({
  repository,
  board,
  now,
}: {
  repository: OwnerRepository;
  board: MenuBoard;
  now: string;
}) {
  const load = useCallback(
    (signal: AbortSignal) => repository.getOrderHistory(signal),
    [repository],
  );
  const history = useAsync(load);
  const [period, setPeriod] = useState<Period>("7d");
  const [type, setType] = useState<TypeFilter>("all");
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<OrderView | null>(null);

  const heading = (
    <Heading title="주문 내역">
      키오스크로 들어온 주문을 조회합니다. 시각은 한국 시간입니다.
    </Heading>
  );
  if (history.loading)
    return (
      <>
        {heading}
        <Loading />
      </>
    );
  if (history.error || !history.data)
    return (
      <>
        {heading}
        <ErrorState
          message="주문 내역을 불러오지 못했습니다."
          onRetry={history.reload}
        />
      </>
    );
  const rows = filterOrders(
    orderViews(history.data, board),
    { period, type, query },
    now,
  );
  return (
    <>
      {heading}
      <Filters>
        <Filter
          label="기간"
          value={period}
          options={PERIODS}
          onChange={(v) => setPeriod(v as Period)}
        />
        <Filter
          label="구분"
          value={type}
          options={TYPES}
          onChange={(v) => setType(v as TypeFilter)}
        />
        <Search label="주문번호 검색" value={query} onChange={setQuery} />
        <button
          onClick={() => {
            setPeriod("7d");
            setType("all");
            setQuery("");
          }}
        >
          초기화
        </button>
      </Filters>
      <p className="result-summary" aria-live="polite">
        <strong>{rows.length}건</strong> · 합계{" "}
        <strong>{formatWon(totalAmount(rows))}</strong>
        <span className="muted"> (현재 메뉴 가격 기준)</span>
      </p>
      <Table
        label="주문 목록"
        rows={rows}
        rowId={(o) => o.id}
        onRowClick={(o: OrderView) => setDetail(o)}
        emptyMessage="조건에 맞는 주문이 없습니다. 기간이나 구분을 바꿔 보세요."
        columns={[
          {
            label: "주문번호",
            render: (o) => (
              <button
                aria-label={`주문 #${o.id} 상세`}
                onClick={(e) => {
                  e.stopPropagation();
                  setDetail(o);
                }}
              >
                #{o.id}
              </button>
            ),
          },
          { label: "주문 시각", render: (o) => formatDateTime(o.orderedAt) },
          { label: "구분", render: (o) => orderTypeLabel(o.orderType) },
          { label: "메뉴", render: menuSummary },
          { label: "수량", render: (o) => `${o.quantity}개` },
          { label: "금액", render: (o) => formatWon(o.amount) },
        ]}
      />
      {detail && <OrderDetail order={detail} onClose={() => setDetail(null)} />}
    </>
  );
}
