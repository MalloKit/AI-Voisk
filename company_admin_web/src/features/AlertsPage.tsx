import { useEffect, useRef, useState } from "react";
import type { AdminSnapshot, DeviceAlert } from "../data/models";
import {
  alertStatuses,
  alertTypes,
  connectionLabel,
  dateLabel,
} from "../data/selectors";
import {
  Badge,
  Field,
  Filter,
  Filters,
  Heading,
  Modal,
  Search,
  Section,
  Table,
} from "../components/ui";
import { FutureNotice } from "./DevicesPage";

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
export function AlertsPage({
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
