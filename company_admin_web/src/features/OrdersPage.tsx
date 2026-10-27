import { useCallback, useState } from "react";
import type { AdminSnapshot, Order } from "../data/models";
import type { OrderRepository } from "../data/orderRepository";
import {
  dateLabel,
  diningLabel,
  filterOrdersAdvanced,
  mockOrders,
  type OrderKindFilter,
} from "../data/selectors";
import { useAsync, type AsyncResult } from "../hooks/useAsync";
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
        { label: "기기", render: (o) => o.device_id == null ? "미확인" : `#${o.device_id}` },
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
export function LiveDetail({
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
  ordersResult,
}: {
  data: AdminSnapshot;
  repository: OrderRepository | null;
  ordersResult: AsyncResult<Order[]>;
}) {
  const live = repository !== null;
  const [search, setSearch] = useState(""),
    [store, setStore] = useState(0),
    [days, setDays] = useState(7),
    [kind, setKind] = useState<OrderKindFilter>("all"),
    [device, setDevice] = useState("all"),
    [fromDate, setFromDate] = useState(""),
    [toDate, setToDate] = useState(""),
    [detail, setDetail] = useState<Order>();
  const all = live ? (ordersResult.data ?? []) : mockOrders(data);
  const reference = live ? new Date() : new Date(data.referenceDate);
  const invalidRange = days === -1 && !!fromDate && !!toDate && fromDate > toDate;
  const rows = invalidRange
    ? []
    : filterOrdersAdvanced(all, search, store, days, reference, !live, {
        kind, device, fromDate, toDate,
      });
  const deviceIds = [...new Set(all.map((o) => o.device_id).filter((id): id is number => id != null))]
    .sort((a, b) => a - b);
  const deviceOptions = [
    { value: "all", label: "전체 기기" },
    ...deviceIds.map((id) => ({ value: String(id), label: `기기 #${id}` })),
    { value: "unknown", label: "기기 미확인" },
  ];
  if (device !== "all" && device !== "unknown" && !deviceIds.some((id) => String(id) === device))
    deviceOptions.splice(deviceOptions.length - 1, 0, { value: device, label: `기기 #${device}` });
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
          ? "실제 주문 API · 읽기 전용 조회입니다. 각 화면에서 데이터 출처를 확인해 주세요."
          : "Mock 주문 데이터 · 명시적으로 선택한 시연 모드입니다."}
      </Heading>
      {live && ordersResult.loading ? (
        <Loading />
      ) : live && ordersResult.error ? (
        <ErrorState
          message="실제 주문 조회 실패. Mock 데이터로 대체하지 않습니다."
          onRetry={ordersResult.reload}
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
              label="주문 유형"
              value={kind}
              options={[
                { value: "all", label: "전체 유형" },
                { value: "takeaway", label: "포장" },
                { value: "dine_in", label: "매장 식사" },
                { value: "unknown", label: "유형 미확인" },
              ]}
              onChange={(v) => setKind(v as OrderKindFilter)}
            />
            <Filter
              label="기기"
              value={device}
              options={deviceOptions}
              onChange={setDevice}
            />
            <Filter
              label="조회 기간"
              value={days}
              options={[
                { value: 1, label: live ? "오늘" : "기준일" },
                { value: 7, label: "최근 7일" },
                { value: 30, label: "최근 30일" },
                { value: 0, label: "전체 기간" },
                { value: -1, label: "직접 지정" },
              ]}
              onChange={(v) => setDays(Number(v))}
            />
            {days === -1 && (
              <>
                <label className="field filter">
                  <span>시작일</span>
                  <input
                    type="date"
                    aria-label="시작일"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                  />
                </label>
                <label className="field filter">
                  <span>종료일</span>
                  <input
                    type="date"
                    aria-label="종료일"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                  />
                </label>
              </>
            )}
            {live && <button onClick={ordersResult.reload}>새로고침</button>}
            <button
              onClick={() => {
                setSearch("");
                setStore(0);
                setDays(7);
                setKind("all");
                setDevice("all");
                setFromDate("");
                setToDate("");
              }}
            >
              초기화
            </button>
            {!live && (
              <p className="filter-note">
                시연 기준일 {dateLabel(data.referenceDate)} · 기간은 기준일을
                포함합니다. Mock 주문에는 기기 ID가 없습니다.
              </p>
            )}
            {invalidRange && (
              <p role="alert" className="filter-note">
                시작일이 종료일보다 늦습니다. 날짜 범위를 확인해 주세요.
              </p>
            )}
          </Filters>
          <Section
            title={`${live ? "실제 " : ""}주문 목록 · ${rows.length}건`}
          />
          {!invalidRange && <OrderTable orders={rows} onDetail={setDetail} />}
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
