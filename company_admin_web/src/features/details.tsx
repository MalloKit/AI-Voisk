import type {
  AdminSnapshot,
  ApiOwnerDetail,
  ApiDevice,
  ApiStore,
  Store,
  Owner,
  Device,
  Order,
} from "../data/models";
import {
  alertStatuses,
  alertTypes,
  connectionLabel,
  dateLabel,
  diningLabel,
} from "../data/selectors";
import { Field, Section } from "../components/ui";

export function StoreDetails({
  data,
  store: s,
}: {
  data: AdminSnapshot;
  store: Store | ApiStore;
}) {
  return (
    <>
      <Section title="매장 기본 정보" />
      <dl>
        <Field label="매장 ID">{s.id}</Field>
        <Field label="매장명">{s.name}</Field>
        <Field label="업종">{s.type}</Field>
        <Field label="대표자">{s.representative}</Field>
        <Field label="사업자번호">{s.businessNo}</Field>
        <Field label="주소">{`${s.address} ${s.addressDetail}`.trim()}</Field>
        {"storeCode" in s ? (
          <Field label="우편번호 (store_code)">{s.storeCode}</Field>
        ) : <Field label="우편번호">{s.postcode}</Field>}
        <Field label="전화번호">{s.phone}</Field>
      </dl>
      <hr />
      <Section title="담당자 및 점주 연결" />
      <dl>
        <Field label="담당 관리자">
          {"adminName" in s ? (s.adminName ?? "정보 없음") : data.admins.find((a) => a.id === s.adminId)?.name}
        </Field>
        <Field label="점주 로그인 ID">
          {s.ownerId === null ? "미연결" : "ownerLoginId" in s ? (s.ownerLoginId ?? "연결됨 · 계정 정보 없음") : (data.owners.find((o) => o.id === s.ownerId)?.loginId ?? "연결됨 · 계정 정보 없음")}
        </Field>
      </dl>
    </>
  );
}
export function OwnerDetails(
  props:
    | { source: "api"; owner: ApiOwnerDetail }
    | { source: "mock"; owner: Owner; data: AdminSnapshot },
) {
  const { owner } = props;
  // The API branch has no AdminSnapshot and cannot join against Mock stores.
  const mockStores = (data: AdminSnapshot, ownerId: number) =>
    data.stores.filter((s) => s.ownerId === ownerId).map((s) => ({
      id: s.id,
      name: s.name,
      address: s.address,
      addressDetail: s.addressDetail,
      adminId: s.adminId,
      adminName: data.admins.find((a) => a.id === s.adminId)?.name ?? null,
    }));
  const stores = props.source === "api"
    ? props.owner.stores
    : mockStores(props.data, owner.id);
  return (
    <>
      <dl>
        <Field label="점주 ID">{owner.id}</Field>
        <Field label="로그인 ID">{owner.loginId}</Field>
      </dl>
      <hr />
      <Section title={`연결 매장 · ${stores.length}곳`} />
      {!stores.length && <p>연결된 매장이 없습니다.</p>}
      <dl>
        {stores.map((s) => (
          <Field label={s.name} key={s.id}>
            매장 ID: {s.id}
            <br />
            {`${s.address} ${s.addressDetail}`.trim()}
            <br />
            담당 관리자: {s.adminName ?? "정보 없음"} (ID: {s.adminId})
          </Field>
        ))}
      </dl>
    </>
  );
}
export function DeviceDetails({
  data,
  device: d,
}: {
  data: AdminSnapshot;
  device: Device;
}) {
  const store = data.stores.find((s) => s.id === d.storeId)!;
  const alerts = [...data.alerts]
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .filter((a) => a.deviceId === d.id);
  return (
    <>
      <dl>
        <Field label="기기 ID">{d.id}</Field>
        <Field label="설치 매장">{store.name}</Field>
        <Field label="설치 주소">{store.address}</Field>
        <Field label="연결 상태">{connectionLabel(d.connection)}</Field>
        <Field label="마지막 연결 시각">
          {d.lastConnectedAt
            ? dateLabel(d.lastConnectedAt, true)
            : "연결 이력 없음"}
        </Field>
        <Field label="앱 버전">{d.appVersion}</Field>
      </dl>
      <hr />
      <Section title="관련 알림" />
      {!alerts.length && <p>관련 알림이 없습니다.</p>}
      <dl>
        {alerts.map((a) => (
          <Field
            key={a.id}
            label={`${alertTypes[a.type]} · ${alertStatuses[a.status]}`}
          >
            {a.id} · {dateLabel(a.occurredAt, true)}
          </Field>
        ))}
      </dl>
    </>
  );
}
export function OrderDetails({
  order: o,
  live,
}: {
  order: Order;
  live: boolean;
}) {
  return (
    <>
      <dl>
        <Field label="매장">{o.store_name}</Field>
        <Field label="주문 시각">{dateLabel(o.ordered_at, true)}</Field>
        <Field label="주문 유형">{diningLabel(o)}</Field>
      </dl>
      <hr />
      <Section title="주문 품목" />
      <dl>
        {o.items.map((i) => (
          <Field key={i.item_id} label={`${i.menu_name} · ${i.quantity}개`}>
            옵션:{" "}
            {i.options.length
              ? i.options.map((v) => v.name).join(", ")
              : "없음"}
          </Field>
        ))}
      </dl>
      <p className="muted">
        {live
          ? "메뉴/옵션명은 현재 등록 정보입니다. 주문 당시 가격은 저장되지 않습니다."
          : "메뉴·옵션 이름은 현재 등록 정보를 기준으로 표시합니다."}
      </p>
    </>
  );
}


/** 실데이터 상세에는 Mock 스냅샷을 전달하지 않습니다. */
export function ApiDeviceDetails({ device: d }: { device: ApiDevice }) {
  const moment = (value: string | null) => value === null ? "미수집" : dateLabel(value, true);
  return (
    <>
      <dl>
        <Field label="기기 ID">{d.device_id}</Field>
        <Field label="기기 코드">{d.device_code}</Field>
        <Field label="설치 매장">{d.store_name} (ID: {d.store_id})</Field>
        <Field label="매장 등록 주소">{`${d.store_address} ${d.store_address_detail ?? ""}`.trim()}</Field>
        <Field label="활성화 상태">{d.is_active ? "활성" : "비활성"}</Field>
        <Field label="연결 상태">미확인</Field>
        <Field label="등록 시각">{dateLabel(d.registered_at, true)}</Field>
        <Field label="앱 버전">{d.app_version ?? "미수집"}</Field>
        <Field label="마지막 확인 시각 (DB 기록)">{moment(d.last_seen_at)}</Field>
        <Field label="마지막 동기화 시각 (DB 기록)">{moment(d.last_synced_at)}</Field>
      </dl>
      <p className="muted">
        시각은 브라우저 현지 시간입니다. 활성화 상태는 온라인 상태가 아닙니다.
        마지막 확인 시각의 수집 주체는 미확인으로, 현재 접속 상태를 판정하지 않습니다.
      </p>
      <hr />
      <Section title="관련 알림" />
      <p>알림 조회 미연동</p>
    </>
  );
}
