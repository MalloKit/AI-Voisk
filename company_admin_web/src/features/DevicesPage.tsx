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
import { liveConnection, menuVersionStatus, type DeviceRepository, type DeviceToken } from "../data/deviceRepository";
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
  return <>
    <ApiDeviceDetails device={result.data} />
    {onStatus && <button autoFocus={focusStatus} onClick={() => onStatus(result.data!)}>{result.data.is_active ? "비활성화" : "활성화"}</button>}
    {repository.issueToken && <DeviceTokenPanel device={result.data} repository={repository} />}
  </>;
}

// 키오스크 기기 토큰. 키오스크 앱의 관리자 설정 화면에 입력하면 그 기기로 서버(LAN)에 접속한다.
// 원문은 발급 직후 이 화면에서 한 번만 보이고, 서버에는 해시만 남는다.
function DeviceTokenPanel({ device, repository }: { device: ApiDevice; repository: DeviceRepository }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<DeviceToken>();
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  async function issue() {
    setBusy(true); setError("");
    try {
      setIssued(await repository.issueToken!(device.device_id));
      setConfirming(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "토큰을 발급하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="device-token" aria-label="키오스크 기기 토큰">
      <hr />
      <Section title="키오스크 기기 토큰" />
      {issued ? (
        <>
          <p role="status" className="form-feedback">토큰을 발급했습니다. 이 화면을 닫으면 다시 볼 수 없습니다.</p>
          <label className="device-token-field">
            <span>기기 토큰</span>
            <input readOnly value={issued.token} aria-label="발급된 기기 토큰" onFocus={(e) => e.currentTarget.select()} />
          </label>
          <button onClick={() => void navigator.clipboard?.writeText(issued.token).then(() => setCopied(true), () => setCopied(false))}>
            {copied ? "복사했습니다" : "토큰 복사"}
          </button>
          <p className="muted">
            키오스크 앱 → 설정 → 키오스크 설정(관리자 PIN)에서 서버 주소, 매장 번호 {issued.store_id}, 기기 번호 {issued.device_id}와 함께 입력합니다.
          </p>
        </>
      ) : confirming ? (
        <>
          <p className="error-text">새로 발급하면 이 기기의 이전 토큰은 바로 쓸 수 없게 됩니다. 계속할까요?</p>
          <div className="store-form-actions">
            <button disabled={busy} onClick={() => setConfirming(false)}>취소</button>
            <button className="button-primary" disabled={busy} onClick={() => void issue()}>{busy ? "발급 중…" : "새 토큰 발급"}</button>
          </div>
        </>
      ) : (
        <>
          <p className="muted">키오스크가 서버에 연결하려면 기기 토큰이 필요합니다. 토큰 원문은 발급할 때 한 번만 보여 줍니다.</p>
          <button onClick={() => setConfirming(true)}>기기 토큰 발급</button>
        </>
      )}
      {error && <p role="alert" className="error-text">{error}</p>}
    </section>
  );
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
  return (
    <>
      <Heading title="기기 관리" actions={repository.create && liveStores && storesResult && <button className="button-primary" onClick={() => { setNotice(""); setCreating(true); }}>기기 등록</button>}>등록된 기기와 설치 매장 정보를 확인합니다.</Heading>
      {notice && <p role="status" className="form-feedback">{notice}</p>}
      <Card className="notice">
        활성화는 주문 허용 상태이며 온라인 상태가 아닙니다. 연결 상태는 키오스크가 60초마다 보내는 상태 보고로 판정합니다(3분 안에 보고가 있으면 연결).
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
          <Table className="devices-table" label="기기 목록" rows={rows} rowId={(d) => d.device_id}
            columns={[
              { label: "기기 ID", render: (d) => d.device_id },
              { label: "기기 코드", render: (d) => <span className="device-cell-text" title={d.device_code}>{d.device_code}</span> },
              { label: "설치 매장", render: (d) => <span className="device-cell-text" title={d.store_name}>{d.store_name}</span> },
              { label: "활성 상태", render: (d) => <Badge>{d.is_active ? "활성" : "비활성"}</Badge> },
              { label: "연결 상태", render: (d) => liveConnection(d.last_seen_at) },
              { label: "메뉴 버전", render: (d) => <span className="device-cell-wrap">{menuVersionStatus(d)}</span> },
              { label: "등록일", render: (d) => dateLabel(d.registered_at) },
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
