import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminSnapshot, ApiAlert, DeviceAlert } from "../data/models";
import {
  alertStatuses,
  alertTypes,
  connectionLabel,
  dateLabel,
} from "../data/selectors";
import {
  Badge,
  Card,
  ErrorState,
  Loading,
  Field,
  Filter,
  Filters,
  Heading,
  Modal,
  Search,
  Section,
  Table,
} from "../components/ui";
import { AdminApiError } from "../data/apiSession";
import { FutureNotice } from "./DevicesPage";
import { apiAlertStatusLabel, type AlertRepository } from "../data/alertRepository";
import { useAsync, type AsyncResult } from "../hooks/useAsync";

function AlertDetails({
  data,
  alert,
  onAcknowledge,
}: {
  data: AdminSnapshot;
  alert: DeviceAlert;
  onAcknowledge(id: string): Promise<void>;
}) {
  const [saving, setSaving] = useState(false),
    [failed, setFailed] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const device = data.devices.find((d) => d.id === alert.deviceId)!;
  const store = data.stores.find((s) => s.id === device.storeId)!;
  async function acknowledge() {
    if (saving) return;
    setSaving(true);
    setFailed(false);
    try {
      await onAcknowledge(alert.id);
    } catch {
      if (mounted.current) setFailed(true);
    } finally {
      if (mounted.current) setSaving(false);
    }
  }
  return (
    <>
      <dl>
        <Field label="알림 유형">{alertTypes[alert.type]}</Field>
        <Field label="확인 상태">{alertStatuses[alert.status]}</Field>
        <Field label="발생 시각">{dateLabel(alert.occurredAt, true)}</Field>
        <Field label="기기 / 설치 매장">
          {device.id} / {store.name}
        </Field>
        <Field label="기기 연결 상태">
          {connectionLabel(device.connection)}
        </Field>
        <Field label="알림 내용">{alert.description}</Field>
        {alert.acknowledgedAt && (
          <Field label="확인 시각">
            {dateLabel(alert.acknowledgedAt, true)}
          </Field>
        )}
      </dl>
      <hr />
      <p>
        확인 완료는 알림을 검토했다는 의미이며 기기의 연결 상태나 장애 해소
        여부를 변경하지 않습니다.
      </p>
      <p className="muted">
        시연 모드: 확인 결과는 메모리에만 유지되며 새로고침하면 초기화됩니다.
      </p>
      {failed && (
        <p role="alert" className="error-text">
          확인 처리에 실패했습니다. 다시 시도해 주세요.
        </p>
      )}
      {alert.status === "unconfirmed" && (
        <button disabled={saving} onClick={acknowledge}>
          {saving ? "처리 중…" : "확인 완료로 표시"}
        </button>
      )}
    </>
  );
}
function MockAlertsPage({
  data,
  onAcknowledge,
}: {
  data: AdminSnapshot;
  onAcknowledge(id: string): Promise<void>;
}) {
  const [search, setSearch] = useState(""),
    [type, setType] = useState("전체"),
    [status, setStatus] = useState("전체"),
    [detailId, setDetailId] = useState<string>();
  const storeName = (a: DeviceAlert) =>
    data.stores.find(
      (s) => s.id === data.devices.find((d) => d.id === a.deviceId)!.storeId,
    )!.name;
  const rows = [...data.alerts]
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .filter(
      (a) =>
        `${a.id} ${a.deviceId} ${storeName(a)}`
          .toLowerCase()
          .includes(search.trim().toLowerCase()) &&
        (type === "전체" || a.type === type) &&
        (status === "전체" || a.status === status),
    );
  const detail = data.alerts.find((a) => a.id === detailId);
  return (
    <>
      <Heading title="장애/알림">
        오프라인, 연결 오류, 업데이트 필요 알림을 조회하고 확인합니다.
      </Heading>
      <FutureNotice data={data} />
      <Filters>
        <Search
          label="알림 ID / 기기 ID / 매장"
          value={search}
          onChange={setSearch}
        />
        <Filter
          label="알림 유형"
          value={type}
          options={[
            { value: "전체", label: "전체" },
            ...Object.entries(alertTypes).map(([value, label]) => ({
              value,
              label,
            })),
          ]}
          onChange={setType}
        />
        <Filter
          label="확인 상태"
          value={status}
          options={[
            { value: "전체", label: "전체" },
            ...Object.entries(alertStatuses).map(([value, label]) => ({
              value,
              label,
            })),
          ]}
          onChange={setStatus}
        />
        <button
          onClick={() => {
            setSearch("");
            setType("전체");
            setStatus("전체");
          }}
        >
          초기화
        </button>
      </Filters>
      <Section title={`알림 목록 · ${rows.length}건`} />
      <Table
        label="알림 목록"
        rows={rows}
        rowId={(a) => a.id}
        columns={[
          { label: "알림 ID", render: (a) => a.id },
          { label: "유형", render: (a) => alertTypes[a.type] },
          {
            label: "기기 / 매장",
            render: (a) => (
              <>
                {a.deviceId}
                <small>{storeName(a)}</small>
              </>
            ),
          },
          { label: "발생 시각", render: (a) => dateLabel(a.occurredAt, true) },
          {
            label: "확인 상태",
            render: (a) => (
              <Badge attention={a.status === "unconfirmed"}>
                {alertStatuses[a.status]}
              </Badge>
            ),
          },
          {
            label: "",
            render: (a) => (
              <button
                aria-label={`알림 상세: ${a.id}`}
                onClick={() => setDetailId(a.id)}
              >
                상세
              </button>
            ),
          },
        ]}
      />
      {detail && (
        <Modal
          title={`알림 ${detail.id}`}
          onClose={() => setDetailId(undefined)}
        >
          <AlertDetails
            data={data}
            alert={detail}
            onAcknowledge={onAcknowledge}
          />
        </Modal>
      )}
    </>
  );
}


function ApiAlertDetails({ alert: a }: { alert: ApiAlert }) {
  const moment = (value: string | null) => value === null ? "기록 없음" : dateLabel(value, true);
  return (
    <>
      <dl>
        <Field label="알림 ID">{a.alert_id}</Field>
        <Field label="알림 유형">{a.alert_type}</Field>
        <Field label="심각도">{a.severity}</Field>
        <Field label="DB 원본 상태">{a.alert_status}</Field>
        {["UNREAD", "ACKNOWLEDGED"].includes(a.alert_status) && <Field label="상태 설명">{apiAlertStatusLabel(a.alert_status)}</Field>}
        <Field label="발생 시각">{dateLabel(a.occurred_at, true)}</Field>
        <Field label="알림 내용">{a.message}</Field>
        <Field label="기기 ID / 코드">{a.device_id} / {a.device_code}</Field>
        <Field label="연결 매장">{a.store_name} (ID: {a.store_id})</Field>
        <Field label="관리자 확인 시각">{moment(a.acknowledged_at)}</Field>
        <Field label="확인한 관리자">{a.acknowledged_by === null ? "기록 없음"
          : `${a.acknowledged_by_name ?? "이름 정보 없음"} (ID: ${a.acknowledged_by})`}</Field>
        <Field label="장애 해소 시각">{moment(a.resolved_at)}</Field>
      </dl>
      <p className="muted">
        시각은 브라우저 현지 시간입니다.
        관리자 확인과 장애 해소는 별개 기록이며 원본 상태를 임의로 변경하지 않습니다.
      </p>
    </>
  );
}

function LiveAlertDetail({ id, repository, onBusy, onSaved }: {
  id: number; repository: AlertRepository; onBusy(value: boolean): void; onSaved(): void;
}) {
  const load = useCallback((signal: AbortSignal) => repository.detail(id, signal), [id, repository]);
  const result = useAsync(load);
  const [saving, setSaving] = useState(false), [message, setMessage] = useState(""), [conflict, setConflict] = useState(false), [saved, setSaved] = useState(false);
  const pending = useRef(false), controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  function refresh() { setConflict(false); setMessage(""); result.reload(); }
  async function acknowledge() {
    const alert = result.data;
    if (pending.current || conflict || !repository.acknowledge || !alert || alert.alert_status !== "UNREAD" || alert.acknowledged_at !== null || alert.acknowledged_by !== null) return;
    pending.current = true; setSaving(true); onBusy(true); setMessage("");
    const abort = new AbortController(); controller.current = abort;
    try {
      const updated = await repository.acknowledge(id, abort.signal);
      if (!abort.signal.aborted) {
        result.setData(updated); setSaved(true); onSaved(); result.reload();
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        setConflict(error instanceof AdminApiError && [404, 409].includes(error.status));
        setMessage(error instanceof AdminApiError ? error.message : "확인 처리 결과를 확인할 수 없습니다. 목록과 상세를 새로 조회해 주세요.");
      }
    } finally { if (!abort.signal.aborted) { pending.current = false; setSaving(false); onBusy(false); } }
  }
  const alert = result.data;
  return <>
    {saved && <p role="status" className="form-feedback">확인 저장이 완료되었습니다. 최초 확인 기록을 표시합니다.</p>}
    {result.loading ? <Loading text="실제 알림 상세를 불러오는 중…" /> : result.error || !alert ?
      <ErrorState message={saved ? "확인 저장은 완료됐지만 상세 재조회에 실패했습니다." : "실제 알림 상세 조회 실패. Mock 데이터로 대체하지 않습니다."} onRetry={refresh} /> : <>
      <ApiAlertDetails alert={alert} />
      {repository.acknowledge && alert.alert_status === "UNREAD" && alert.acknowledged_at === null && alert.acknowledged_by === null && <>
        <p>확인 완료는 관리자가 알림을 검토했다는 의미이며, 실제 장애 해결을 의미하지 않습니다.</p>
        <button disabled={saving || conflict} onClick={acknowledge}>{saving ? "확인 중…" : "확인 완료"}</button>
      </>}
    </>}
    {message && <p role="alert" className="form-feedback">{message}</p>}
    {conflict && <button onClick={refresh}>상세 다시 조회</button>}
  </>;
}

function RawFilter({
  label, value, values, onChange, display = (raw: string) => raw,
}: {
  label: string;
  value: string | null;
  values: string[];
  onChange(value: string | null): void;
  display?(value: string): string;
}) {
  // Keep the selected filter visible even when a refresh removes its last matching row.
  const options = value !== null && !values.includes(value) ? [...values, value].sort() : values;
  // 원본이 '전체' 또는 '*'여도 전체 선택과 충돌하지 않도록 인코딩합니다.
  return <Filter label={label} value={value === null ? "*" : JSON.stringify(value)}
    options={[{ value: "*", label: "전체" }, ...options.map((raw) => ({
      value: JSON.stringify(raw), label: display(raw),
    }))]}
    onChange={(next) => onChange(next === "*" ? null : JSON.parse(next) as string)} />;
}

function LiveAlertsPage({
  repository,
  result,
}: {
  repository: AlertRepository;
  result: AsyncResult<ApiAlert[]>;
}) {
  const [search, setSearch] = useState(""),
    [type, setType] = useState<string | null>(null),
    [severity, setSeverity] = useState<string | null>(null),
    [status, setStatus] = useState<string | null>(null),
    [detailId, setDetailId] = useState<number>();
  const [saving, setSaving] = useState(false), [notice, setNotice] = useState("");
  const all = result.data ?? [];
  const query = search.trim().toLowerCase();
  const values = (field: "alert_type" | "severity" | "alert_status") =>
    [...new Set(all.map((a) => a[field]))].sort();
  const rows = [...all].sort((a, b) =>
    new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime() || b.alert_id - a.alert_id,
  ).filter((a) =>
    `${a.alert_id} ${a.device_id} ${a.device_code} ${a.store_name}`.toLowerCase().includes(query) &&
    (type === null || a.alert_type === type) &&
    (severity === null || a.severity === severity) &&
    (status === null || a.alert_status === status),
  );
  return (
    <>
      <Heading title="장애/알림">장애·알림 내역을 조회합니다.</Heading>
      <Card className="notice">
        유형·심각도·상태는 DB 원본 값을 보존합니다.
        관리자 확인과 장애 해소는 별개이며, 확인 처리로 장애가 해결되지는 않습니다.
      </Card>
      {notice && <p role="status" className="form-feedback">{notice}</p>}
      {result.loading ? <Loading text="실제 알림을 불러오는 중…" /> : result.error ? (
        <ErrorState message={notice ? "확인 저장은 완료됐지만 알림 목록 재조회에 실패했습니다. 다시 시도해 주세요." : "실제 알림 조회 실패. Mock 데이터로 대체하지 않습니다."} onRetry={result.reload} />
      ) : (
        <>
          <Filters>
            <Search label="알림 ID / 기기 ID / 기기 코드 / 매장" value={search} onChange={setSearch} />
            <RawFilter label="알림 유형" value={type} values={values("alert_type")} onChange={setType} />
            <RawFilter label="심각도" value={severity} values={values("severity")} onChange={setSeverity} />
            <RawFilter label="DB 원본 상태" value={status} values={values("alert_status")}
              onChange={setStatus} display={apiAlertStatusLabel} />
            <button onClick={result.reload}>새로고침</button>
            <button onClick={() => { setSearch(""); setType(null); setSeverity(null); setStatus(null); }}>초기화</button>
          </Filters>
          <Section title={`알림 목록 · ${rows.length}건`} />
          <Table label="알림 목록" rows={rows} rowId={(a) => a.alert_id}
            emptyMessage={all.length ? "조건에 맞는 결과가 없습니다. 검색어나 필터를 변경해 주세요." : "등록된 장애·알림이 없습니다."}
            columns={[
              { label: "알림 ID", render: (a) => a.alert_id },
              { label: "유형", render: (a) => a.alert_type },
              { label: "심각도", render: (a) => a.severity },
              { label: "기기 / 매장", render: (a) => <>{a.device_id} / {a.device_code}<small>{a.store_name}</small></> },
              { label: "내용", render: (a) => a.message },
              { label: "발생 시각", render: (a) => dateLabel(a.occurred_at, true) },
              { label: "DB 원본 상태", render: (a) => <Badge>{apiAlertStatusLabel(a.alert_status)}</Badge> },
              { label: "", render: (a) => (
                <button aria-label={`알림 상세: #${a.alert_id}`} onClick={() => setDetailId(a.alert_id)}>상세</button>
              ) },
            ]} />
        </>
      )}
      {detailId !== undefined && (
        <Modal title={`알림 #${detailId}`} closeDisabled={saving} onClose={() => { if (!saving) setDetailId(undefined); }}>
          <LiveAlertDetail id={detailId} repository={repository} onBusy={setSaving} onSaved={() => {
            setNotice("알림 확인 저장이 완료되었습니다. 목록과 운영 요약은 최신 조회 결과로 갱신합니다."); result.reload();
          }} />
        </Modal>
      )}
    </>
  );
}

export function AlertsPage({
  data, onAcknowledge, repository, alertsResult,
}: {
  data: AdminSnapshot;
  onAcknowledge(id: string): Promise<void>;
  repository: AlertRepository | null;
  alertsResult: AsyncResult<ApiAlert[]>;
}) {
  return repository
    ? <LiveAlertsPage repository={repository} result={alertsResult} />
    : <MockAlertsPage data={data} onAcknowledge={onAcknowledge} />;
}
