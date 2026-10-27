import { useState } from "react";
import { Store as StoreIcon, Users, Unlink, ReceiptText } from "lucide-react";
import type { AdminSnapshot, ApiOwner, ApiStore, Order, Page, Store } from "../data/models";
import type { OwnerRepository } from "../data/ownerRepository";
import type { StoreRepository } from "../data/storeRepository";
import type { OrderRepository } from "../data/orderRepository";
import type { AsyncResult } from "../hooks/useAsync";
import { dateLabel, filterOrders, mockOrders } from "../data/selectors";
import { Badge, Card, ErrorState, Heading, Loading, Modal, Section, Table } from "../components/ui";
import { OrderDetails, StoreDetails } from "./details";
import { LiveDetail, OrderTable } from "./OrdersPage";
import { LiveStoreDetail } from "./StoresPage";

export function DashboardPage({
  data,
  onNavigate,
  orderRepository,
  ordersResult: result,
  storeRepository,
  storesResult,
  ownerRepository,
  ownersResult,
}: {
  data: AdminSnapshot;
  onNavigate(page: Page, unlinked?: boolean): void;
  orderRepository: OrderRepository | null;
  ordersResult: AsyncResult<Order[]>;
  storeRepository: StoreRepository | null;
  storesResult: AsyncResult<ApiStore[]>;
  ownerRepository: OwnerRepository | null;
  ownersResult: AsyncResult<ApiOwner[]>;
}) {
  const live = orderRepository !== null;
  const liveStores = storeRepository !== null;
  const liveOwners = ownerRepository !== null;
  const stores: (Store | ApiStore)[] = liveStores ? (storesResult.data ?? []) : data.stores;
  const unlinked = stores.filter((s) => s.ownerId === null);
  const ownerCount = liveOwners ? (ownersResult.data?.length ?? 0) : data.owners.length;
  const storeValue = (count: number) =>
    liveStores && storesResult.loading ? "조회 중"
      : liveStores && storesResult.error ? "조회 실패" : `${count}곳`;
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
  const [store, setStore] = useState<Store | ApiStore>(),
    [order, setOrder] = useState<Order>();
  const metrics = [
    {
      label: "등록 매장",
      value: storeValue(stores.length),
      caption: liveStores ? "전체 매장 · 실제 API" : "전체 매장 · Mock",
      Icon: StoreIcon,
    },
    {
      label: "점주 계정",
      value: liveOwners && ownersResult.loading ? "조회 중"
        : liveOwners && ownersResult.error ? "조회 실패" : `${ownerCount}개`,
      caption: liveOwners ? "점주 계정 · 실제 API" : "등록 계정 · Mock",
      Icon: Users,
    },
    {
      label: "점주 미연결 매장",
      value: storeValue(unlinked.length),
      caption: liveStores ? "점주 연결 여부 · 실제 API" : "점주 연결 여부 · Mock",
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
        등록 매장과 점주 연결, 최근 주문 현황을 한눈에 확인합니다.
      </Heading>
      <p className="muted">
        매장: {liveStores ? "실제 API" : "Mock"} · 점주: {liveOwners ? "실제 API" : "Mock"}
        {" · "}주문: {live ? "실제 API" : `Mock (시연 기준일 ${dateLabel(data.referenceDate)})`}
        {" · "}기기·알림: Mock
      </p>
      <div className="metrics">
        {metrics.map((m) => (
          <Card key={m.label}>
            <section aria-label={m.label}>
            <div className="metric-title">
              {m.label}
              <m.Icon aria-hidden="true" size={22} />
            </div>
            <strong className="metric-value">{m.value}</strong>
            <small>{m.caption}</small>
            </section>
          </Card>
        ))}
      </div>
      <div className="actions">
        {liveStores && (
          <button onClick={storesResult.reload} disabled={storesResult.loading}>
            {storesResult.error ? "매장 다시 시도" : "매장 새로고침"}
          </button>
        )}
        {liveOwners && (
          <button onClick={ownersResult.reload} disabled={ownersResult.loading}>
            {ownersResult.error ? "점주 다시 시도" : "점주 새로고침"}
          </button>
        )}
      </div>
      {liveOwners && ownersResult.error && (
        <ErrorState message="실제 점주 조회 실패. Mock 계정 수로 대체하지 않습니다." />
      )}
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
      {liveStores && storesResult.loading ? (
        <Loading text="실제 매장을 불러오는 중…" />
      ) : liveStores && storesResult.error ? (
        <ErrorState message="실제 매장 조회 실패. Mock 매장으로 대체하지 않습니다." />
      ) : <Table
        label="미연결 매장"
        rows={unlinked}
        rowId={(s) => s.id}
        emptyMessage={stores.length ? "모든 매장에 점주 계정이 연결되어 있습니다." : "등록된 매장이 없습니다."}
        columns={[
          { label: "매장명", render: (s) => s.name },
          { label: "업종", render: (s) => s.type },
          {
            label: "담당 관리자",
            render: (s) => "adminName" in s ? (s.adminName ?? "정보 없음") : data.admins.find((a) => a.id === s.adminId)?.name,
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
      />}
      <div className="actions">
        <button onClick={() => onNavigate("stores")}>
          등록 매장 전체 보기
        </button>
      </div>
      {store && (
        <Modal title={store.name} onClose={() => setStore(undefined)}>
          {storeRepository
            ? <LiveStoreDetail id={store.id} repository={storeRepository} data={data} />
            : <StoreDetails data={data} store={store} />}
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
