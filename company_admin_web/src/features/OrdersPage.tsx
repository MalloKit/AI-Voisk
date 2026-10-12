import { useCallback, useState } from "react";
import type { AdminSnapshot, Order } from "../data/models";
import type { OrderRepository } from "../data/orderRepository";
import {
  dateLabel,
  diningLabel,
  filterOrders,
  mockOrders,
} from "../data/selectors";
import { useAsync } from "../hooks/useAsync";
import {
  ErrorState,
  Filter,
  Filters,
  Heading,
  Loading,
  Modal,
  Search,
  Section,
  Table,
} from "../components/ui";
import { OrderDetails } from "./details";

export function OrderTable({
  orders,
  onDetail,
}: {
  orders: Order[];
  onDetail(o: Order): void;
}) {
  return (
    <Table<Order>
      label="주문 목록"
      rows={orders}
      rowId={(o) => o.order_id}
      columns={[
        { label: "주문 ID", render: (o) => `#${o.order_id}` },
        { label: "매장", render: (o) => o.store_name },
        { label: "주문 시각", render: (o) => dateLabel(o.ordered_at, true) },
        { label: "주문 유형 / 테이블", render: diningLabel },
        { label: "총 수량", render: (o) => `${o.quantity}개` },
        {
          label: "",
          render: (o) => (
            <button
              aria-label={`주문 상세: #${o.order_id}`}
              onClick={() => onDetail(o)}
            >
              상세
            </button>
          ),
        },
      ]}
    />
  );
}
function LiveDetail({
  id,
  repository,
}: {
  id: number;
  repository: OrderRepository;
}) {
  const load = useCallback(
    (signal: AbortSignal) => repository.detail(id, signal),
    [id, repository],
  );
  const result = useAsync(load);
  if (result.loading) return <Loading text="주문 상세를 불러오는 중…" />;
  if (result.error)
    return (
      <ErrorState
        message="주문 상세 조회 실패. 닫은 뒤 다시 시도해 주세요."
        onRetry={result.reload}
      />
    );
  return <OrderDetails order={result.data!} live />;
}
export function OrdersPage({
  data,
  repository,
}: {
  data: AdminSnapshot;
  repository: OrderRepository | null;
}) {
  const live = repository !== null;
  const load = useCallback(
    (signal: AbortSignal) =>
      repository ? repository.load(signal) : Promise.resolve(mockOrders(data)),
    [data, repository],
  );
  const result = useAsync(load);
  const [search, setSearch] = useState(""),
    [store, setStore] = useState(0),
    [days, setDays] = useState(7),
    [detail, setDetail] = useState<Order>();
  const all = result.data ?? [];
  const reference = live ? new Date() : new Date(data.referenceDate);
  const rows = filterOrders(all, search, store, days, reference, !live);
  const stores = live
    ? [...new Map(all.map((o) => [o.store_id, o.store_name])).entries()].map(
        ([value, label]) => ({ value, label }),
      )
    : data.stores.map((s) => ({ value: s.id, label: s.name }));
  // Retain a selected store if a refreshed API result no longer contains it.
  if (store && !stores.some((s) => s.value === store))
    stores.push({ value: store, label: `매장 #${store}` });
  return (
    <>
      <Heading title="주문 조회">
        {live
          ? "실제 API 주문 데이터 · 다른 관리 화면은 Mock 데이터입니다."
          : "Mock 주문 데이터 · 명시적으로 선택한 시연 모드입니다."}
      </Heading>
      {result.loading ? (
        <Loading />
      ) : result.error ? (
        <ErrorState
          message="실제 주문 조회 실패. Mock 데이터로 대체하지 않습니다."
          onRetry={result.reload}
        />
      ) : (
        <>
          <Filters>
            <Search label="주문 ID" value={search} onChange={setSearch} />
            <Filter
              label="매장"
              value={store}
              options={[{ value: 0, label: "전체 매장" }, ...stores]}
              onChange={(v) => setStore(Number(v))}
            />
            <Filter
              label="조회 기간"
              value={days}
              options={[
                { value: 1, label: live ? "오늘" : "기준일" },
                { value: 7, label: "최근 7일" },
                { value: 30, label: "최근 30일" },
                { value: 0, label: "전체 기간" },
              ]}
              onChange={(v) => setDays(Number(v))}
            />
            {live && <button onClick={result.reload}>새로고침</button>}
            <button
              onClick={() => {
                setSearch("");
                setStore(0);
                setDays(7);
              }}
            >
              초기화
            </button>
            {!live && (
              <p className="filter-note">
                시연 기준일 {dateLabel(data.referenceDate)} · 기간은 기준일을
                포함합니다.
              </p>
            )}
          </Filters>
          <Section
            title={`${live ? "실제 " : ""}주문 목록 · ${rows.length}건`}
          />
          <OrderTable orders={rows} onDetail={setDetail} />
        </>
      )}
      {detail && (
        <Modal
          title={`${live ? "실제 " : ""}주문 #${detail.order_id}`}
          onClose={() => setDetail(undefined)}
        >
          {repository ? (
            <LiveDetail id={detail.order_id} repository={repository} />
          ) : (
            <OrderDetails order={detail} live={false} />
          )}
        </Modal>
      )}
    </>
  );
}
