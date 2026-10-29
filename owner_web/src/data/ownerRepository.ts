import t0001 from "./mock/t0001-fixture.json";
import t0002 from "./mock/t0002-fixture.json";
import t0003 from "./mock/t0003-fixture.json";
import type {
  Category,
  KioskDevice,
  Menu,
  MenuBoard,
  MenuBoardChanges,
  MenuBoardSaveResult,
  MenuOption,
  OrderHistory,
  StoreProfile,
} from "./models";

// 화면은 이 인터페이스만 쓴다. 한 인스턴스는 매장 하나(store_id)만 다룬다.
// 실제 API가 생기면 구현체만 바꿔 AppEntry에서 주입한다.
export interface OwnerRepository {
  getStoreProfile(signal?: AbortSignal): Promise<StoreProfile>;
  getMenuBoard(signal?: AbortSignal): Promise<MenuBoard>;
  getOrderHistory(signal?: AbortSignal): Promise<OrderHistory>;
  getDevices(signal?: AbortSignal): Promise<KioskDevice[]>;
  // 품절은 영업 중에 바로 알려야 하므로 저장 바를 거치지 않고 즉시 반영한다.
  setMenuSoldOut(menuId: number, isSoldOut: boolean): Promise<void>;
  setOptionSoldOut(optionId: number, isSoldOut: boolean): Promise<void>;
  // 품절을 뺀 메뉴 관리 변경을 한 묶음으로 저장한다. 서버는 한 트랜잭션으로 처리하고,
  // 하나라도 실패하면 아무것도 바꾸지 않는다.
  saveMenuBoard(changes: MenuBoardChanges): Promise<MenuBoardSaveResult>;
}

type Fixture = StoreProfile &
  MenuBoard &
  OrderHistory & { devices: KioskDevice[] };

// 매장 1(T0001)은 seed_test_menus.sql·seed_test_options.sql과 같은 메뉴·옵션이다.
// 매장 2·3은 '매장 2개 연결' 개발용 Mock 계정을 위한 작은 Mock 매장이다.
const FIXTURES: Record<number, unknown> = { 1: t0001, 2: t0002, 3: t0003 };
export const MOCK_STORE_IDS = Object.keys(FIXTURES).map(Number);

// 메모리에만 둔다. 새로고침하면 초기 상태로 돌아간다.
export class MockOwnerRepository implements OwnerRepository {
  private data: Fixture;
  constructor(readonly storeId = 1) {
    if (!FIXTURES[storeId]) throw new Error(`Mock 매장이 없습니다: ${storeId}`);
    this.data = structuredClone(FIXTURES[storeId]) as Fixture;
  }
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
  async setMenuSoldOut(menuId: number, isSoldOut: boolean) {
    const menu = this.data.menus.find((m) => m.id === menuId);
    if (!menu) throw new Error("Unknown Mock menu");
    menu.isSoldOut = isSoldOut;
  }
  async setOptionSoldOut(optionId: number, isSoldOut: boolean) {
    const option = this.data.options.find((o) => o.id === optionId);
    if (!option) throw new Error("Unknown Mock option");
    option.isSoldOut = isSoldOut;
  }
  // 복사본에 모두 적용하고 검사가 끝난 뒤에만 바꿔 끼운다(트랜잭션 흉내).
  async saveMenuBoard(changes: MenuBoardChanges) {
    const next = structuredClone(this.data);
    const ids: Record<number, number> = {};
    const nextId = (rows: { id: number }[]) =>
      Math.max(0, ...rows.map((r) => r.id)) + 1;
    const real = (id: number) => (id < 0 ? ids[id] : id);
    const find = <T extends { id: number }>(rows: T[], id: number) => {
      const row = rows.find((r) => r.id === id);
      if (!row) throw new Error(`없는 항목입니다: ${id}`);
      return row;
    };
    const storeId = next.store.id;

    for (const c of changes.categories.create) {
      const row: Category = {
        id: nextId(next.categories),
        storeId,
        name: c.name,
        sort: c.sort,
      };
      ids[c.tempId] = row.id;
      next.categories.push(row);
    }
    for (const c of changes.categories.update)
      Object.assign(find(next.categories, c.id), {
        name: c.name,
        sort: c.sort,
      });
    for (const { tempId, ...m } of changes.menus.create) {
      const row: Menu = {
        ...m,
        id: nextId(next.menus),
        categoryId: real(m.categoryId),
      };
      ids[tempId] = row.id;
      next.menus.push(row);
    }
    for (const m of changes.menus.update)
      Object.assign(find(next.menus, m.id), {
        ...m,
        categoryId: real(m.categoryId),
      });
    for (const { tempId, ...o } of changes.options.create) {
      const row: MenuOption = {
        ...o,
        id: nextId(next.options),
        menuId: real(o.menuId),
        isActive: true,
      };
      ids[tempId] = row.id;
      next.options.push(row);
    }
    for (const o of changes.options.update)
      Object.assign(find(next.options, o.id), o);
    // FK에 ON DELETE 규칙이 없으므로 메뉴가 남은 카테고리는 지울 수 없다.
    for (const id of changes.categories.remove) {
      find(next.categories, id);
      if (next.menus.some((m) => m.categoryId === id))
        throw new Error("메뉴가 남아 있는 카테고리는 삭제할 수 없습니다.");
      next.categories = next.categories.filter((c) => c.id !== id);
    }
    for (const m of next.menus) {
      if (!next.categories.some((c) => c.id === m.categoryId))
        throw new Error("메뉴의 카테고리가 없습니다.");
      if (!m.name.trim() || m.price < 1 || m.price > 1_000_000)
        throw new Error("메뉴 이름과 가격을 확인해 주세요.");
    }
    for (const o of next.options)
      if (!next.menus.some((m) => m.id === o.menuId))
        throw new Error("옵션의 메뉴가 없습니다.");

    this.data = next;
    return { board: await this.getMenuBoard(), ids };
  }
}
