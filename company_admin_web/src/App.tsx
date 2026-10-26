import { useCallback, useState } from "react";
import type { Order, Page } from "./data/models";
import {
  MockAdminRepository,
  type AdminRepository,
} from "./data/adminRepository";
import {
  ApiOrderRepository,
  type OrderRepository,
} from "./data/orderRepository";
import { useAsync } from "./hooks/useAsync";
import { ErrorState, Loading } from "./components/ui";
import { AdminShell } from "./layout/AdminShell";
import { DashboardPage } from "./features/DashboardPage";
import { StoresPage } from "./features/StoresPage";
import { OwnersPage } from "./features/OwnersPage";
import { OrdersPage } from "./features/OrdersPage";
import { DevicesPage } from "./features/DevicesPage";
import { AlertsPage } from "./features/AlertsPage";

const defaultAdmin = new MockAdminRepository();
const defaultOrders =
  import.meta.env.VITE_ORDER_SOURCE === "mock"
    ? null
    : new ApiOrderRepository(
        import.meta.env.VITE_ORDER_API_BASE_URL || "http://127.0.0.1:8001",
      );
export function App({
  repository = defaultAdmin,
  orderRepository = defaultOrders,
}: {
  repository?: AdminRepository;
  orderRepository?: OrderRepository | null;
}) {
  const [page, setPage] = useState<Page>("dashboard"),
    [unlinked, setUnlinked] = useState(false);
  const load = useCallback(() => repository.load(), [repository]);
  const result = useAsync(load);
  // Share one order snapshot across dashboard and order list screens.
  const loadOrders = useCallback(
    (signal: AbortSignal) =>
      orderRepository ? orderRepository.load(signal) : Promise.resolve<Order[]>([]),
    [orderRepository],
  );
  const ordersResult = useAsync(loadOrders);
  function navigate(next: Page, onlyUnlinked = false) {
    setPage(next);
    setUnlinked(onlyUnlinked);
  }
  async function acknowledge(id: string) {
    await repository.acknowledgeAlert(id);
    result.setData(await repository.load());
  }
  if (result.loading)
    return (
      <div className="app-state">
        <Loading />
      </div>
    );
  if (result.error || !result.data)
    return (
      <div className="app-state">
        <ErrorState
          message="데이터를 불러오지 못했습니다."
          onRetry={result.reload}
        />
      </div>
    );
  const data = result.data;
  return (
    <AdminShell
      page={page}
      onNavigate={navigate}
      liveOrders={orderRepository !== null}
    >
      {page === "dashboard" && (
        <DashboardPage
          data={data}
          onNavigate={navigate}
          orderRepository={orderRepository}
          ordersResult={ordersResult}
        />
      )}
      {page === "stores" && (
        <StoresPage
          key={String(unlinked)}
          data={data}
          initiallyUnlinked={unlinked}
        />
      )}
      {page === "owners" && <OwnersPage data={data} />}
      {page === "orders" && (
        <OrdersPage data={data} repository={orderRepository} ordersResult={ordersResult} />
      )}
      {page === "devices" && <DevicesPage data={data} />}
      {page === "alerts" && (
        <AlertsPage data={data} onAcknowledge={acknowledge} />
      )}
    </AdminShell>
  );
}
