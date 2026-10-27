import { localAdminBaseUrl } from "./data/apiSession.ts";
import type { AuthAdmin } from "./data/authRepository";
import { useCallback, useState } from "react";
import type { ApiAlert, ApiDevice, ApiOwner, ApiStore, Order, Page } from "./data/models";
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

import { ApiStoreRepository, type StoreRepository } from "./data/storeRepository";

import { ApiOwnerRepository, type OwnerRepository } from "./data/ownerRepository";

import { ApiDeviceRepository, type DeviceRepository } from "./data/deviceRepository";

import { ApiAlertRepository, type AlertRepository } from "./data/alertRepository";

const defaultAlerts = import.meta.env.VITE_ALERT_SOURCE === "mock"
  ? null
  : new ApiAlertRepository(localAdminBaseUrl(import.meta.env.VITE_ALERT_API_BASE_URL || import.meta.env.VITE_ORDER_API_BASE_URL || "http://127.0.0.1:8001"));

const defaultDevices = import.meta.env.VITE_DEVICE_SOURCE === "mock"
  ? null
  : new ApiDeviceRepository(localAdminBaseUrl(import.meta.env.VITE_DEVICE_API_BASE_URL || import.meta.env.VITE_ORDER_API_BASE_URL || "http://127.0.0.1:8001"));

const defaultOwners = import.meta.env.VITE_OWNER_SOURCE === "mock"
  ? null
  : new ApiOwnerRepository(localAdminBaseUrl(import.meta.env.VITE_OWNER_API_BASE_URL || import.meta.env.VITE_ORDER_API_BASE_URL || "http://127.0.0.1:8001"));

const defaultStores = import.meta.env.VITE_STORE_SOURCE === "mock"
  ? null
  : new ApiStoreRepository(localAdminBaseUrl(import.meta.env.VITE_STORE_API_BASE_URL || import.meta.env.VITE_ORDER_API_BASE_URL || "http://127.0.0.1:8001"));

const defaultOrders =
  import.meta.env.VITE_ORDER_SOURCE === "mock"
    ? null
    : new ApiOrderRepository(
        localAdminBaseUrl(import.meta.env.VITE_ORDER_API_BASE_URL || "http://127.0.0.1:8001"),
      );
export function App({
  repository,
  admin,
  onLogout,
  orderRepository = defaultOrders,
  storeRepository = defaultStores,
  ownerRepository = defaultOwners,
  deviceRepository = defaultDevices,
  alertRepository = defaultAlerts,
}: {
  repository?: AdminRepository;
  admin?: AuthAdmin;
  onLogout?(): void;
  orderRepository?: OrderRepository | null;
  storeRepository?: StoreRepository | null;
  ownerRepository?: OwnerRepository | null;
  deviceRepository?: DeviceRepository | null;
  alertRepository?: AlertRepository | null;
}) {
  const [fallbackRepository] = useState(() => new MockAdminRepository());
  const adminRepository = repository ?? fallbackRepository;
  const [page, setPage] = useState<Page>("dashboard"),
    [unlinked, setUnlinked] = useState(false);
  const load = useCallback(() => adminRepository.load(), [adminRepository]);
  const result = useAsync(load);
  // Share one order snapshot across dashboard and order list screens.
  const loadOrders = useCallback(
    (signal: AbortSignal) =>
      orderRepository ? orderRepository.load(signal) : Promise.resolve<Order[]>([]),
    [orderRepository],
  );
  const ordersResult = useAsync(loadOrders);
  // Keep independent list snapshots across dashboard and management navigation.
  const loadStores = useCallback(
    (signal: AbortSignal) =>
      storeRepository ? storeRepository.load(signal) : Promise.resolve<ApiStore[]>([]),
    [storeRepository],
  );
  const storesResult = useAsync(loadStores);
  const loadOwners = useCallback(
    (signal: AbortSignal) =>
      ownerRepository ? ownerRepository.load(signal) : Promise.resolve<ApiOwner[]>([]),
    [ownerRepository],
  );
  const ownersResult = useAsync(loadOwners);
  const loadDevices = useCallback(
    (signal: AbortSignal) => deviceRepository ? deviceRepository.load(signal) : Promise.resolve<ApiDevice[]>([]),
    [deviceRepository],
  );
  const devicesResult = useAsync(loadDevices);
  const loadAlerts = useCallback(
    (signal: AbortSignal) => alertRepository ? alertRepository.load(signal) : Promise.resolve<ApiAlert[]>([]),
    [alertRepository],
  );
  const alertsResult = useAsync(loadAlerts);
  function navigate(next: Page, onlyUnlinked = false) {
    setPage(next);
    setUnlinked(onlyUnlinked);
  }
  async function acknowledge(id: string) {
    await adminRepository.acknowledgeAlert(id);
    result.setData(await adminRepository.load());
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
      admin={admin}
      onLogout={onLogout}
      page={page}
      onNavigate={navigate}
      liveOrders={orderRepository !== null}
      liveStores={storeRepository !== null}
      liveOwners={ownerRepository !== null}
      liveDevices={deviceRepository !== null}
      liveAlerts={alertRepository !== null}
    >
      {page === "dashboard" && (
        <DashboardPage
          data={data}
          onNavigate={navigate}
          orderRepository={orderRepository}
          ordersResult={ordersResult}
          storeRepository={storeRepository}
          storesResult={storesResult}
          ownerRepository={ownerRepository}
          ownersResult={ownersResult}
          liveDevices={deviceRepository !== null}
          devicesResult={devicesResult}
          liveAlerts={alertRepository !== null}
          alertsResult={alertsResult}
        />
      )}
      {page === "stores" && (
        <StoresPage
          key={String(unlinked)}
          data={data}
          initiallyUnlinked={unlinked}
          repository={storeRepository}
          storesResult={storesResult}
        />
      )}
      {page === "owners" && <OwnersPage data={data} repository={ownerRepository} ownersResult={ownersResult} />}
      {page === "orders" && (
        <OrdersPage data={data} repository={orderRepository} ordersResult={ordersResult} />
      )}
      {page === "devices" && <DevicesPage data={data} repository={deviceRepository} devicesResult={devicesResult} />}
      {page === "alerts" && (
        <AlertsPage data={data} onAcknowledge={acknowledge} repository={alertRepository} alertsResult={alertsResult} />
      )}
    </AdminShell>
  );
}
