import {
  ApiOwnerRepository,
  bool,
  int,
  nullable,
  record,
  rows,
  text,
} from "./ownerApiRepository";

// AI 추천·음성 설정, 메뉴별 추천 정보, 통계, 직원 호출. 서버 API는 server/owner_router.py의 /owner/stores/{id}/… 이다.

export interface AiSettings {
  policyProfit: number; // 0 고객 적합 우선 ~ 100 매장 이익 우선
  pickWeight: number; // 매장 우선 메뉴 가산 0~100
  fitThreshold: number; // 적합도 기준선 0~100
  upsellEnabled: boolean;
  defaultMode: "normal" | "senior";
  speechRate: number; // 안내 음성 속도 50~150 %
  voiceEnabled: boolean;
}
export const DEFAULT_AI_SETTINGS: AiSettings = {
  policyProfit: 30,
  pickWeight: 10,
  fitThreshold: 50,
  upsellEnabled: true,
  defaultMode: "normal",
  speechRate: 100,
  voiceEnabled: true,
};

export interface MenuAi {
  menuId: number;
  menuName: string;
  categoryName: string;
  price: number;
  isActive: boolean;
  isSoldOut: boolean;
  costRate: number | null; // 원가율 %
  isRecExcluded: boolean;
  isStorePick: boolean;
  tags: string[];
  synonyms: string[];
  imageUrl: string | null; // 서버 기준 상대 경로
}

export interface StoreStats {
  days: number;
  startDate: string;
  endDate: string;
  orders: number;
  voiceOrders: number;
  voiceRatio: number;
  revenueEstimate: number;
  recRevenueEstimate: number;
  recImpressions: number;
  recSelections: number;
  recSelectionRate: number;
  topMenus: { menuId: number; menuName: string; quantity: number }[];
  daily: { date: string; orders: number; voiceOrders: number }[];
}

export interface StaffCall {
  alertId: number;
  deviceId: number;
  deviceCode: string;
  message: string;
  status: string;
  occurredAt: string;
  resolvedAt: string | null;
}
export interface StaffCalls {
  open: StaffCall[];
  recent: StaffCall[];
}

export interface OwnerAiRepository {
  getAiSettings(signal?: AbortSignal): Promise<{ aiReady: boolean; settings: AiSettings }>;
  saveAiSettings(settings: AiSettings): Promise<AiSettings>;
  getMenuAi(signal?: AbortSignal): Promise<MenuAi[]>;
  saveMenuAi(menus: MenuAi[]): Promise<MenuAi[]>;
  getStats(days: number, signal?: AbortSignal): Promise<StoreStats>;
  getStaffCalls(signal?: AbortSignal): Promise<StaffCalls>;
  resolveStaffCall(alertId: number): Promise<void>;
  uploadMenuImage(menuId: number, image: Blob): Promise<string | null>;
  deleteMenuImage(menuId: number): Promise<void>;
  // 상대 경로(/media/…)를 화면에서 열 수 있는 주소로 바꾼다.
  imageSrc(path: string | null): string | null;
}

const settingsFromServer = (value: unknown): AiSettings => {
  const s = record(value);
  return {
    policyProfit: int(s.policy_profit),
    pickWeight: int(s.pick_weight),
    fitThreshold: int(s.fit_threshold),
    upsellEnabled: bool(s.upsell_enabled),
    defaultMode: text(s.default_mode) === "senior" ? "senior" : "normal",
    speechRate: int(s.speech_rate),
    voiceEnabled: bool(s.voice_enabled),
  };
};
const strings = (value: unknown) => (Array.isArray(value) ? value.map(text) : []);
const menuAiFromServer = (value: unknown): MenuAi[] =>
  rows(record(value).menus).map((m) => ({
    menuId: int(m.menu_id),
    menuName: text(m.menu_name),
    categoryName: text(m.category_name),
    price: int(m.menu_price),
    isActive: bool(m.is_active),
    isSoldOut: bool(m.is_sold_out),
    costRate: nullable(m.cost_rate, int),
    isRecExcluded: bool(m.is_rec_excluded),
    isStorePick: bool(m.is_store_pick),
    tags: strings(m.tags),
    synonyms: strings(m.synonyms),
    imageUrl: nullable(m.image_url, text),
  }));
const call = (c: Record<string, unknown>): StaffCall => ({
  alertId: int(c.alert_id),
  deviceId: int(c.device_id),
  deviceCode: text(c.device_code),
  message: text(c.message),
  status: text(c.status),
  occurredAt: text(c.occurred_at),
  resolvedAt: nullable(c.resolved_at, text),
});

export class ApiOwnerAiRepository
  extends ApiOwnerRepository
  implements OwnerAiRepository
{
  async getAiSettings(signal?: AbortSignal) {
    const body = record(await this.request(`${this.store}/ai-settings`, { method: "GET" }, signal));
    return { aiReady: bool(body.ai_ready), settings: settingsFromServer(body.settings) };
  }

  async saveAiSettings(s: AiSettings) {
    const body = record(
      await this.write(`${this.store}/ai-settings`, {
        policy_profit: s.policyProfit,
        pick_weight: s.pickWeight,
        fit_threshold: s.fitThreshold,
        upsell_enabled: s.upsellEnabled,
        default_mode: s.defaultMode,
        speech_rate: s.speechRate,
        voice_enabled: s.voiceEnabled,
      }),
    );
    return settingsFromServer(body.settings);
  }

  async getMenuAi(signal?: AbortSignal) {
    return menuAiFromServer(await this.request(`${this.store}/menu-ai`, { method: "GET" }, signal));
  }

  async saveMenuAi(menus: MenuAi[]) {
    return menuAiFromServer(
      await this.write(`${this.store}/menu-ai`, {
        menus: menus.map((m) => ({
          menu_id: m.menuId,
          cost_rate: m.costRate,
          is_rec_excluded: m.isRecExcluded,
          is_store_pick: m.isStorePick,
          tags: m.tags,
          synonyms: m.synonyms,
        })),
      }),
    );
  }

  async getStats(days: number, signal?: AbortSignal): Promise<StoreStats> {
    const s = record(await this.request(`${this.store}/stats?days=${days}`, { method: "GET" }, signal));
    return {
      days: int(s.days),
      startDate: text(s.start_date),
      endDate: text(s.end_date),
      orders: int(s.orders),
      voiceOrders: int(s.voice_orders),
      voiceRatio: Number(s.voice_ratio) || 0,
      revenueEstimate: int(s.revenue_estimate),
      recRevenueEstimate: int(s.rec_revenue_estimate),
      recImpressions: int(s.rec_impressions),
      recSelections: int(s.rec_selections),
      recSelectionRate: Number(s.rec_selection_rate) || 0,
      topMenus: rows(s.top_menus).map((m) => ({
        menuId: int(m.menu_id),
        menuName: text(m.menu_name),
        quantity: int(m.quantity),
      })),
      daily: rows(s.daily).map((d) => ({
        date: text(d.date),
        orders: int(d.orders),
        voiceOrders: int(d.voice_orders),
      })),
    };
  }

  async getStaffCalls(signal?: AbortSignal) {
    const body = record(await this.request(`${this.store}/staff-calls`, { method: "GET" }, signal));
    return { open: rows(body.open).map(call), recent: rows(body.recent).map(call) };
  }

  async resolveStaffCall(alertId: number) {
    await this.write(`${this.store}/staff-calls/${alertId}/resolve`, {});
  }

  async uploadMenuImage(menuId: number, image: Blob) {
    const body = record(await this.write(`/owner/menus/${menuId}/image`, image, "PUT"));
    return nullable(body.image_url, text);
  }

  async deleteMenuImage(menuId: number) {
    await this.write(`/owner/menus/${menuId}/image`, undefined, "DELETE");
  }

  imageSrc(path: string | null) {
    if (!path) return null;
    const base = new URL(this.baseUrl);
    return base.origin + base.pathname.replace(/\/$/, "") + path;
  }
}

// 시연·테스트용. 메모리에만 두며 새로고침하면 초기 상태로 돌아간다.
export class MockOwnerAiRepository implements OwnerAiRepository {
  settings: AiSettings = { ...DEFAULT_AI_SETTINGS };
  menus: MenuAi[] = [
    { menuId: 1, menuName: "제육덮밥", categoryName: "식사", price: 9000, isActive: true, isSoldOut: false,
      costRate: 35, isRecExcluded: false, isStorePick: false, tags: ["든든한", "매운"], synonyms: ["제육"], imageUrl: null },
    { menuId: 3, menuName: "순두부찌개", categoryName: "국물", price: 8500, isActive: true, isSoldOut: false,
      costRate: 30, isRecExcluded: false, isStorePick: false, tags: ["해장", "국물"], synonyms: ["순두부"], imageUrl: null },
    { menuId: 4, menuName: "콩나물국밥", categoryName: "국물", price: 7500, isActive: true, isSoldOut: false,
      costRate: 25, isRecExcluded: false, isStorePick: true, tags: ["해장", "시원한"], synonyms: [], imageUrl: null },
    { menuId: 6, menuName: "콜라", categoryName: "음료", price: 2000, isActive: true, isSoldOut: false,
      costRate: null, isRecExcluded: false, isStorePick: false, tags: [], synonyms: ["코크"], imageUrl: null },
  ];
  calls: StaffCalls = {
    open: [{ alertId: 9, deviceId: 1, deviceCode: "K-001", message: "고객이 직원 호출 버튼을 눌렀습니다.",
      status: "UNREAD", occurredAt: "2026-11-11T03:10:00+00:00", resolvedAt: null }],
    recent: [],
  };
  uploads = 0;

  async getAiSettings() {
    return { aiReady: true, settings: { ...this.settings } };
  }
  async saveAiSettings(settings: AiSettings) {
    this.settings = { ...settings };
    return { ...this.settings };
  }
  async getMenuAi() {
    return structuredClone(this.menus);
  }
  async saveMenuAi(menus: MenuAi[]) {
    for (const changed of menus) {
      const index = this.menus.findIndex((m) => m.menuId === changed.menuId);
      if (index < 0) throw new Error("없는 메뉴입니다.");
      this.menus[index] = structuredClone(changed);
    }
    return structuredClone(this.menus);
  }
  async getStats(days: number): Promise<StoreStats> {
    const daily = Array.from({ length: days }, (_, i) => ({
      date: `2026-11-${String(11 - days + 1 + i).padStart(2, "0")}`,
      orders: [12, 18, 9, 21, 15, 19, 24][i % 7],
      voiceOrders: [4, 7, 2, 9, 6, 8, 11][i % 7],
    }));
    const orders = daily.reduce((sum, d) => sum + d.orders, 0);
    const voiceOrders = daily.reduce((sum, d) => sum + d.voiceOrders, 0);
    return {
      days, startDate: daily[0].date, endDate: daily[daily.length - 1].date, orders, voiceOrders,
      voiceRatio: orders ? voiceOrders / orders : 0, revenueEstimate: orders * 9100,
      recRevenueEstimate: voiceOrders * 3200, recImpressions: 63, recSelections: 29, recSelectionRate: 29 / 63,
      topMenus: [
        { menuId: 1, menuName: "제육덮밥", quantity: 41 },
        { menuId: 3, menuName: "순두부찌개", quantity: 27 },
        { menuId: 6, menuName: "콜라", quantity: 22 },
      ],
      daily,
    };
  }
  async getStaffCalls() {
    return structuredClone(this.calls);
  }
  async resolveStaffCall(alertId: number) {
    const call = this.calls.open.find((c) => c.alertId === alertId);
    if (!call) return;
    this.calls.open = this.calls.open.filter((c) => c !== call);
    this.calls.recent.unshift({ ...call, status: "RESOLVED", resolvedAt: new Date().toISOString() });
  }
  async uploadMenuImage(menuId: number) {
    this.uploads++;
    const menu = this.menus.find((m) => m.menuId === menuId)!;
    menu.imageUrl = `/media/menu/${menuId}_${String(this.uploads).padStart(16, "0")}.jpg`;
    return menu.imageUrl;
  }
  async deleteMenuImage(menuId: number) {
    this.menus.find((m) => m.menuId === menuId)!.imageUrl = null;
  }
  imageSrc(path: string | null) {
    return path;
  }
}
