import type {
  AdminSnapshot,
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
  store: Store;
}) {
  return (
    <>
      <Section title="매장 기본 정보" />
      <dl>
        <Field label="매장 ID">{s.id}</Field>
        <Field label="업종">{s.type}</Field>
        <Field label="대표자">{s.representative}</Field>
        <Field label="사업자번호">{s.businessNo}</Field>
        <Field label="주소">{`${s.address} ${s.addressDetail}`.trim()}</Field>
        <Field label="우편번호">{s.postcode}</Field>
        <Field label="전화번호">{s.phone}</Field>
      </dl>
      <hr />
      <Section title="담당자 및 점주 연결" />
      <dl>
        <Field label="담당 관리자">
          {data.admins.find((a) => a.id === s.adminId)?.name}
        </Field>
        <Field label="점주 로그인 ID">
          {data.owners.find((o) => o.id === s.ownerId)?.loginId ?? "미연결"}
        </Field>
      </dl>
    </>
  );
}
export function OwnerDetails({
  data,
  owner,
}: {
  data: AdminSnapshot;
  owner: Owner;
}) {
  const stores = data.stores.filter((s) => s.ownerId === owner.id);
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
            {s.address}
            <br />
            담당 관리자: {data.admins.find((a) => a.id === s.adminId)?.name}
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
          ? "실제 DB 조회 · 메뉴/옵션명은 현재 등록 정보입니다. 주문 당시 가격은 저장되지 않습니다."
          : "Mock 주문 · 메뉴·옵션 이름은 현재 등록 정보를 기준으로 표시합니다."}
      </p>
    </>
  );
}
