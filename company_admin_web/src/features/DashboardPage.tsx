import { useState } from "react";
import { Store as StoreIcon, Users, Unlink, ReceiptText } from "lucide-react";
import type { AdminSnapshot, Order, Page, Store } from "../data/models";
import type { OrderRepository } from "../data/orderRepository";
import type { AsyncResult } from "../hooks/useAsync";
import { dateLabel, filterOrders, mockOrders } from "../data/selectors";
import { Badge, Card, ErrorState, Heading, Loading, Modal, Section, Table } from "../components/ui";
import { OrderDetails, StoreDetails } from "./details";
import { LiveDetail, OrderTable } from "./OrdersPage";

export function DashboardPage({
  data,
  onNavigate,
  orderRepository,
  ordersResult: result,
  liveStores,
}: {
  data: AdminSnapshot;
  onNavigate(page: Page, unlinked?: boolean): void;
  orderRepository: OrderRepository | null;
  ordersResult: AsyncResult<Order[]>;
  liveStores: boolean;
}) {
  const live = orderRepository !== null;
  const unlinked = data.stores.filter((s) => s.ownerId === null);
  const orders = live ? (result.data ?? []) : mockOrders(data);
  const reference = live ? new Date() : new Date(data.referenceDate);
  const recentCount = filterOrders(orders, "", 0, 7, reference, true).length;
  const latestOrders = [...orders]
    .sort(
      (a, b) =>
        new Date(b.ordered_at).getTime() - new Date(a.ordered_at).getTime() ||
        b.order_id - a.order_id,
    )
    .slice(0, 5);
  const [store, setStore] = useState<Store>(),
    [order, setOrder] = useState<Order>();
  const metrics = [
    {
      label: "등록 매장",
      value: `${data.stores.length}곳`,
      caption: "전체 매장",
      Icon: StoreIcon,
    },
    {
      label: "점주 계정",
      value: `${data.owners.length}개`,
      caption: "등록 계정 · Mock",
      Icon: Users,
    },
    {
      label: "점주 미연결 매장",
      value: `${unlinked.length}곳`,
      caption: "연결 여부 확인",
      Icon: Unlink,
    },
    {
      label: "최근 7일 주문",
      value: live && result.loading
        ? "조회 중"
        : live && result.error
          ? "조회 실패"
          : `${recentCount}건`,
      caption: live ? "실제 주문 API" : "시연 기준일 포함 · Mock",
      Icon: ReceiptText,
    },
  ];
  return (
    <>
      <Heading title="운영 요약">
        등록 매장과 점주 연결, 최근 주문 현황을 한눈에 확인합니다. ·
        {live ? "주문은 실제 API, 다른 현황은 Mock 데이터입니다." : "모든 요약은 Mock 데이터입니다."}
      </Heading>
      <p className="muted">
        이 대시보드의 매장·점주·기기·알림 요약: Mock · 주문: {live ? "실제 API" : `Mock (시연 기준일 ${dateLabel(data.referenceDate)})`}
      </p>
      {liveStores && <p className="muted">매장 관리 화면은 실제 API 조회입니다. 이 화면의 Mock 매장 건수·상세와 일치하지 않을 수 있습니다.</p>}
      <div className="metrics">
        {metrics.map((m) => (
          <Card key={m.label}>
            <div className="metric-title">
              {m.label}
              <m.Icon aria-hidden="true" size={22} />
            </div>
            <strong className="metric-value">{m.value}</strong>
            <small>{m.caption}</small>
          </Card>
        ))}
      </div>
      <Card>
        <Section title="기기 및 알림 현황" />
        <p>
          등록 기기 {data.devices.length}대 · 오프라인{" "}
          {data.devices.filter((d) => d.connection === "offline").length}대 ·
          미확인 알림{" "}
          {data.alerts.filter((a) => a.status === "unconfirmed").length}건
        </p>
        <p className="muted">
          향후 기능 Mock · 관측 기준 {dateLabel(data.observedAt, true)}
        </p>
        <div className="actions">
          <button onClick={() => onNavigate("devices")}>기기 목록 보기</button>
          <button onClick={() => onNavigate("alerts")}>알림 목록 보기</button>
        </div>
      </Card>
      <Section title={live ? "최근 주문 · 실제 API" : "최근 주문 · Mock"}>
        <button onClick={() => onNavigate("orders")}>주문 전체 보기</button>
        {live && (
          <button onClick={result.reload} disabled={result.loading}>
            새로고침
          </button>
        )}
      </Section>
      {live && result.loading ? (
        <Loading text="실제 주문을 불러오는 중…" />
      ) : live && result.error ? (
        <ErrorState
          message="실제 주문 조회 실패. Mock 주문으로 대체하지 않습니다."
          onRetry={result.reload}
        />
      ) : (
        <OrderTable orders={latestOrders} onDetail={setOrder} />
      )}
      <Section title="점주 미연결 매장">
        <button onClick={() => onNavigate("stores", true)}>
          미연결 매장 보기
        </button>
      </Section>
      <Table
        label="미연결 매장"
        rows={unlinked}
        rowId={(s) => s.id}
        emptyMessage="모든 매장에 점주 계정이 연결되어 있습니다."
        columns={[
          { label: "매장명", render: (s) => s.name },
          { label: "업종", render: (s) => s.type },
          {
            label: "담당 관리자",
            render: (s) => data.admins.find((a) => a.id === s.adminId)?.name,
          },
          { label: "점주 연결", render: () => <Badge>미연결</Badge> },
          {
            label: "",
            render: (s) => (
              <button
                aria-label={`매장 상세: ${s.name}`}
                onClick={() => setStore(s)}
              >
                상세
              </button>
            ),
          },
        ]}
      />
      <div className="actions">
        <button onClick={() => onNavigate("stores")}>
          등록 매장 전체 보기
        </button>
      </div>
      {store && (
        <Modal title={store.name} onClose={() => setStore(undefined)}>
          <StoreDetails data={data} store={store} />
        </Modal>
      )}
      {order && (
        <Modal
          title={`${live ? "실제" : "Mock"} 주문 #${order.order_id}`}
          onClose={() => setOrder(undefined)}
        >
          {live && orderRepository ? (
            <LiveDetail id={order.order_id} repository={orderRepository} />
          ) : (
            <OrderDetails order={order} live={false} />
          )}
        </Modal>
      )}
    </>
  );
}
