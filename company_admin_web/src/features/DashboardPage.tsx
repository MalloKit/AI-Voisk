import { useEffect, useRef, useState } from "react";
import { Store as StoreIcon, Bell, ArrowRight, Unlink, ReceiptText, RefreshCw } from "lucide-react";
import type { AdminSnapshot, ApiAlert, ApiDevice, ApiOwner, ApiStore, Order, Page, Store } from "../data/models";
import type { OwnerRepository } from "../data/ownerRepository";
import type { StoreRepository } from "../data/storeRepository";
import type { OrderRepository } from "../data/orderRepository";
import type { AsyncResult } from "../hooks/useAsync";
import { filterOrders, mockOrders } from "../data/selectors";
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
  liveDevices,
  devicesResult,
  liveAlerts,
  alertsResult,
}: {
  data: AdminSnapshot;
  onNavigate(page: Page, unlinked?: boolean): void;
  orderRepository: OrderRepository | null;
  ordersResult: AsyncResult<Order[]>;
  storeRepository: StoreRepository | null;
  storesResult: AsyncResult<ApiStore[]>;
  ownerRepository: OwnerRepository | null;
  ownersResult: AsyncResult<ApiOwner[]>;
  liveDevices: boolean;
  devicesResult: AsyncResult<ApiDevice[]>;
  liveAlerts: boolean;
  alertsResult: AsyncResult<ApiAlert[]>;
}) {
  const refreshing = [storesResult, ownersResult, result, devicesResult, alertsResult].some((source) => source.loading);
  const refreshLock = useRef(false);
  useEffect(() => {
    if (!refreshing) refreshLock.current = false;
  }, [refreshing, storesResult.data, ownersResult.data, result.data, devicesResult.data, alertsResult.data]);
  function refreshAll() {
    if (refreshing || refreshLock.current) return;
    refreshLock.current = true;
    // Existing App hooks keep each source's loading, errors and shared data independent.
    storesResult.reload();
    ownersResult.reload();
    result.reload();
    devicesResult.reload();
    alertsResult.reload();
  }
  const deviceValue = (count: number) => devicesResult.loading ? "조회 중"
    : devicesResult.error ? "조회 실패" : `${count}대`;
  const alertValue = (count: number) => alertsResult.loading ? "조회 중"
    : alertsResult.error ? "조회 실패" : `${count}건`;
  const live = orderRepository !== null;
  const liveStores = storeRepository !== null;
  const liveOwners = ownerRepository !== null;
  const stores: (Store | ApiStore)[] = liveStores ? (storesResult.data ?? []) : data.stores;
  const unlinked = stores.filter((s) => s.ownerId === null);
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
      Icon: StoreIcon,
    },
    {
      label: "점주 미연결 매장",
      value: storeValue(unlinked.length),
      Icon: Unlink,
    },
    {
      label: "최근 7일 주문",
      value: live && result.loading
        ? "조회 중"
        : live && result.error
          ? "조회 실패"
          : `${recentCount}건`,
      Icon: ReceiptText,
    },
    {
      label: "미열람 알림",
      value: liveAlerts ? alertValue(alertsResult.data?.filter((a) => a.alert_status === "UNREAD").length ?? 0) : "미제공",
      Icon: Bell,
    },
  ];
  return (
    <>
      <div className="dashboard-heading">
        <Heading title="운영 요약">
          등록 매장과 점주 연결, 최근 주문 현황을 한눈에 확인합니다.
        </Heading>
        <button className="dashboard-refresh" onClick={refreshAll} disabled={refreshing} aria-busy={refreshing}>
          <RefreshCw size={18} aria-hidden="true" />
          {refreshing ? "새로고침 중…" : "전체 새로고침"}
        </button>
      </div>
      <div className="metrics">
        {metrics.map((m) => (
          <Card key={m.label}>
            <section aria-label={m.label}>
            <div className="metric-title">
              {m.label}
              <m.Icon aria-hidden="true" size={22} />
            </div>
            <strong className="metric-value">{m.value}</strong>
            </section>
          </Card>
        ))}
      </div>
      {((liveStores && storesResult.error) || (liveOwners && ownersResult.error)) && <div className="actions">
        {liveStores && storesResult.error && (
          <button onClick={storesResult.reload} disabled={storesResult.loading}>
            매장 다시 시도
          </button>
        )}
        {liveOwners && ownersResult.error && (
          <button onClick={ownersResult.reload} disabled={ownersResult.loading}>
            점주 다시 시도
          </button>
        )}
      </div>}
      {liveOwners && ownersResult.error && (
        <ErrorState message="실제 점주 조회 실패. Mock 계정 수로 대체하지 않습니다." />
      )}
      {liveAlerts && alertsResult.error && (
        <ErrorState message="실제 알림 조회 실패. Mock 수치로 대체하지 않습니다." onRetry={alertsResult.reload} />
      )}
      <Card>
        <section aria-label="기기 현황">
          <Section title="기기 현황" />
          <dl className="device-summary">
            <div><dt>등록 기기</dt><dd>{liveDevices ? deviceValue(devicesResult.data?.length ?? 0) : `${data.devices.length}대`}</dd></div>
            <div><dt>활성 기기</dt><dd>{liveDevices ? deviceValue(devicesResult.data?.filter((d) => d.is_active === true).length ?? 0) : "미제공"}</dd></div>
            <div><dt>비활성 기기</dt><dd>{liveDevices ? deviceValue(devicesResult.data?.filter((d) => d.is_active === false).length ?? 0) : "미제공"}</dd></div>
          </dl>
          <p className="muted">활성·비활성은 기기의 온라인 연결 상태를 의미하지 않습니다.</p>
          {!liveDevices && <p className="muted">시연 데이터에는 활성·비활성 정보가 없습니다.</p>}
          {devicesResult.error && liveDevices && <ErrorState message="실제 기기 조회 실패. Mock 수치로 대체하지 않습니다." onRetry={devicesResult.reload} />}
        </section>
      </Card>
      <Section title="최근 주문 내역">
        <a className="dashboard-list-link" href="#orders" aria-label="최근 주문 내역 전체 보기"
          onClick={(event) => { event.preventDefault(); onNavigate("orders"); }}>
          전체 보기 <ArrowRight size={16} aria-hidden="true" />
        </a>
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
        <a className="dashboard-list-link" href="#stores" aria-label="점주 미연결 매장 전체 보기"
          onClick={(event) => { event.preventDefault(); onNavigate("stores", true); }}>
          전체 보기 <ArrowRight size={16} aria-hidden="true" />
        </a>
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
      {store && (
        <Modal title={store.name} onClose={() => setStore(undefined)}>
          {storeRepository
            ? <LiveStoreDetail id={store.id} repository={storeRepository} data={data} />
            : <StoreDetails data={data} store={store} />}
        </Modal>
      )}
      {order && (
        <Modal
          title={`주문 #${order.order_id}`}
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
