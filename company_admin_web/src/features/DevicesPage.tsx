import { useCallback, useId, useState } from "react";
import type { AdminSnapshot, ApiDevice, ApiStore, Device } from "../data/models";
import { connectionLabel, dateLabel } from "../data/selectors";
import {
  Badge,
  ErrorState,
  Loading,
  Card,
  Filter,
  Filters,
  Heading,
  Modal,
  Search,
  Section,
  Table,
} from "../components/ui";
import { DeviceCreateForm } from "./DeviceCreateForm";
import { DeviceStatusForm } from "./DeviceStatusForm";
import { ApiDeviceDetails, DeviceDetails } from "./details";
import type { DeviceRepository } from "../data/deviceRepository";
import { useAsync, type AsyncResult } from "../hooks/useAsync";

export function FutureNotice({ data }: { data: AdminSnapshot }) {
  return (
    <Card className="notice">
      상태 관측 기준: {dateLabel(data.observedAt, true)} · 실시간 모니터링이
      아닙니다.
    </Card>
  );
}
function MockDevicesPage({ data }: { data: AdminSnapshot }) {
  const [search, setSearch] = useState(""),
    [store, setStore] = useState(0),
    [connection, setConnection] = useState("전체"),
    [detail, setDetail] = useState<Device>();
  const storeName = (id: number) => data.stores.find((s) => s.id === id)!.name;
  const rows = data.devices.filter(
    (d) =>
      `${d.id} ${storeName(d.storeId)}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()) &&
      (!store || store === d.storeId) &&
      (connection === "전체" || connectionLabel(d.connection) === connection),
  );
  return (
    <>
      <Heading title="기기 관리">
        설치된 기기의 연결 상태와 앱 버전을 확인합니다.
      </Heading>
      <FutureNotice data={data} />
      <Filters>
        <Search
          label="기기 ID / 설치 매장"
          value={search}
          onChange={setSearch}
        />
        <Filter
          label="설치 매장"
          value={store}
          options={[
            { value: 0, label: "전체 매장" },
            ...data.stores.map((s) => ({ value: s.id, label: s.name })),
          ]}
          onChange={(v) => setStore(Number(v))}
        />
        <Filter
          label="연결 상태"
          value={connection}
          options={["전체", "온라인", "오프라인"].map((v) => ({
            value: v,
            label: v,
          }))}
          onChange={setConnection}
        />
        <button
          onClick={() => {
            setSearch("");
            setStore(0);
            setConnection("전체");
          }}
        >
          초기화
        </button>
      </Filters>
      <Section title={`기기 목록 · ${rows.length}대`} />
      <Table
        label="기기 목록"
        rows={rows}
        rowId={(d) => d.id}
        columns={[
          { label: "기기 ID", render: (d) => d.id },
          { label: "설치 매장", render: (d) => storeName(d.storeId) },
          {
            label: "연결 상태",
            render: (d) => (
              <Badge attention={d.connection === "offline"}>
                {connectionLabel(d.connection)}
              </Badge>
            ),
          },
          {
            label: "마지막 연결",
            render: (d) =>
              d.lastConnectedAt
                ? dateLabel(d.lastConnectedAt, true)
                : "연결 이력 없음",
          },
          { label: "앱 버전", render: (d) => d.appVersion },
          {
            label: "",
            render: (d) => (
              <button
                aria-label={`기기 상세: ${d.id}`}
                onClick={() => setDetail(d)}
              >
                상세
              </button>
            ),
          },
        ]}
      />
      {detail && (
        <Modal title={`기기 ${detail.id}`} onClose={() => setDetail(undefined)}>
          <DeviceDetails data={data} device={detail} />
        </Modal>
      )}
    </>
  );
}


function LiveDeviceDetail({ id, repository, onStatus, focusStatus }: { id: number; repository: DeviceRepository; onStatus?(device: ApiDevice): void; focusStatus?: boolean }) {
  const load = useCallback((signal: AbortSignal) => repository.detail(id, signal), [id, repository]);
  const result = useAsync(load);
  if (result.loading) return <Loading text="실제 기기 상세를 불러오는 중…" />;
  if (result.error || !result.data) return (
    <ErrorState message="실제 기기 상세 조회 실패. Mock 데이터로 대체하지 않습니다." onRetry={result.reload} />
  );
  return <><ApiDeviceDetails device={result.data} />{onStatus && <button autoFocus={focusStatus} onClick={() => onStatus(result.data!)}>{result.data.is_active ? "비활성화" : "활성화"}</button>}</>;
}

function LiveDevicesPage({
  repository,
  result, storesResult, liveStores,
}: {
  repository: DeviceRepository;
  result: AsyncResult<ApiDevice[]>;
  storesResult?: AsyncResult<ApiStore[]>; liveStores?: boolean;
}) {
  const [search, setSearch] = useState(""),
    [store, setStore] = useState(0),
    [active, setActive] = useState("전체"),
    [detail, setDetail] = useState<ApiDevice>();
  const [creating, setCreating] = useState(false), [changing, setChanging] = useState<ApiDevice>();
  const [saving, setSaving] = useState(false), [notice, setNotice] = useState(""), [focusStatus, setFocusStatus] = useState(false);
  const formId = useId();
  function saved(device: ApiDevice) {
    setNotice(creating ? "기기를 비활성 상태로 등록했습니다." : "기기 활성화 상태를 저장했습니다.");
    setSaving(false); setCreating(false); setChanging(undefined); setDetail(device); setFocusStatus(true); result.reload();
  }
  function close() { if (!saving) { setCreating(false); setChanging(undefined); setDetail(undefined); } }
  const all = result.data ?? [];
  const stores = [...new Map(all.map((d) => [d.store_id, d.store_name])).entries()];
  const query = search.trim().toLowerCase();
  const rows = all.filter((d) =>
    `${d.device_id} ${d.device_code}`.toLowerCase().includes(query) &&
    (!store || d.store_id === store) &&
    (active === "전체" || (active === "활성" ? d.is_active : !d.is_active)),
  );
  const moment = (value: string | null) => value === null ? "미수집" : dateLabel(value, true);
  return (
    <>
      <Heading title="기기 관리">등록된 기기와 설치 매장 정보를 확인합니다.</Heading>
      {repository.create && liveStores && storesResult && <div className="store-page-actions"><button className="button-primary" onClick={() => { setNotice(""); setCreating(true); }}>기기 등록</button></div>}
      {notice && <p role="status" className="form-feedback">{notice}</p>}
      <Card className="notice">
        활성화는 주문 허용 상태이며 온라인 상태가 아닙니다. 연결 상태는 미확인입니다.
        시각은 브라우저 현지 시간이며 마지막 확인·동기화 시각은 DB 기록입니다.
        알림 조회 미연동.
      </Card>
      {result.loading ? <Loading text="실제 기기를 불러오는 중…" /> : result.error ? (
        <ErrorState message="실제 기기 조회 실패. Mock 데이터로 대체하지 않습니다." onRetry={result.reload} />
      ) : (
        <>
          <Filters>
            <Search label="기기 ID / 기기 코드" value={search} onChange={setSearch} />
            <Filter label="설치 매장" value={store}
              options={[{ value: 0, label: "전체 매장" }, ...stores.map(([value, label]) => ({ value, label }))]}
              onChange={(value) => setStore(Number(value))} />
            <Filter label="활성화 상태" value={active}
              options={["전체", "활성", "비활성"].map((value) => ({ value, label: value }))}
              onChange={setActive} />
            <button onClick={result.reload}>새로고침</button>
            <button onClick={() => { setSearch(""); setStore(0); setActive("전체"); }}>초기화</button>
          </Filters>
          <Section title={`기기 목록 · ${rows.length}대`} />
          <Table label="기기 목록" rows={rows} rowId={(d) => d.device_id}
            columns={[
              { label: "기기 ID", render: (d) => d.device_id },
              { label: "기기 코드", render: (d) => d.device_code },
              { label: "설치 매장", render: (d) => d.store_name },
              { label: "활성화 상태", render: (d) => <Badge>{d.is_active ? "활성" : "비활성"}</Badge> },
              { label: "연결 상태", render: () => "미확인" },
              { label: "앱 버전", render: (d) => d.app_version ?? "미수집" },
              { label: "등록 시각", render: (d) => dateLabel(d.registered_at, true) },
              { label: "마지막 확인 (DB 기록)", render: (d) => moment(d.last_seen_at) },
              { label: "마지막 동기화 (DB 기록)", render: (d) => moment(d.last_synced_at) },
              { label: "", render: (d) => (
                <button aria-label={`기기 상세: ${d.device_code}`} onClick={() => { setFocusStatus(false); setDetail(d); }}>상세</button>
              ) },
            ]} />
        </>
      )}
      {(creating || detail) && (
        <Modal title={creating ? "기기 등록" : changing ? "기기 활성화 상태 변경" : `기기 ${detail!.device_code}`}
          onClose={close} closeDisabled={saving}
          footer={creating || changing ? <div className="store-form-actions">
            <button disabled={saving} onClick={() => { if (creating) close(); else { setChanging(undefined); setFocusStatus(true); } }}>취소</button>
            <button type="submit" form={formId} disabled={saving || (creating && (!!storesResult?.loading || !!storesResult?.error))} className="button-primary">{saving ? "저장 중…" : creating ? "등록" : "변경 저장"}</button>
          </div> : undefined}>
          {creating && storesResult ? <DeviceCreateForm repository={repository} storesResult={storesResult} formId={formId} onBusy={setSaving} onSaved={saved} />
            : changing ? <DeviceStatusForm device={changing} repository={repository} formId={formId} onBusy={setSaving} onSaved={saved} />
            : <LiveDeviceDetail id={detail!.device_id} repository={repository} onStatus={repository.setStatus ? setChanging : undefined} focusStatus={focusStatus} />}
        </Modal>
      )}
    </>
  );
}

export function DevicesPage({
  data,
  repository,
  devicesResult, storesResult, liveStores = false,
}: {
  data: AdminSnapshot;
  repository: DeviceRepository | null;
  devicesResult: AsyncResult<ApiDevice[]>;
  storesResult?: AsyncResult<ApiStore[]>; liveStores?: boolean;
}) {
  return repository
    ? <LiveDevicesPage repository={repository} result={devicesResult} storesResult={storesResult} liveStores={liveStores} />
    : <MockDevicesPage data={data} />;
}
