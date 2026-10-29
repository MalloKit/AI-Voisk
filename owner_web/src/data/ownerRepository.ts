import fixture from "./mock/t0001-fixture.json";
import type {
  KioskDevice,
  MenuBoard,
  OrderHistory,
  StoreProfile,
} from "./models";

// 화면은 이 인터페이스만 쓴다. 실제 API가 생기면 구현체만 바꿔 App에 주입한다.
export interface OwnerRepository {
  getStoreProfile(signal?: AbortSignal): Promise<StoreProfile>;
  getMenuBoard(signal?: AbortSignal): Promise<MenuBoard>;
  getOrderHistory(signal?: AbortSignal): Promise<OrderHistory>;
  getDevices(signal?: AbortSignal): Promise<KioskDevice[]>;
}

type Fixture = StoreProfile &
  MenuBoard &
  OrderHistory & { devices: KioskDevice[] };

// T0001 시드와 같은 메뉴·옵션을 메모리에 둔다. 새로고침하면 초기 상태로 돌아간다.
export class MockOwnerRepository implements OwnerRepository {
  private data = structuredClone(fixture) as Fixture;
  async getStoreProfile() {
    return structuredClone({ store: this.data.store, owner: this.data.owner });
  }
  async getMenuBoard() {
    const { categories, menus, options } = this.data;
    return structuredClone({ categories, menus, options });
  }
  async getOrderHistory() {
    const { orders, items, itemOptions } = this.data;
    return structuredClone({ orders, items, itemOptions });
  }
  async getDevices() {
    return structuredClone(this.data.devices);
  }
}
