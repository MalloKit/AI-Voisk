import { useState } from "react";
import type { AdminSnapshot, Device } from "../data/models";
import { connectionLabel, dateLabel } from "../data/selectors";
import {
  Badge,
  Card,
  Filter,
  Filters,
  Heading,
  Modal,
  Search,
  Section,
  Table,
} from "../components/ui";
import { DeviceDetails } from "./details";

export function FutureNotice({ data }: { data: AdminSnapshot }) {
  return (
    <Card className="notice">
      향후 기능 · 기기 상태/알림의 Mock 데이터입니다.
      <br />
      상태 관측 기준: {dateLabel(data.observedAt, true)} · 실시간 모니터링이
      아닙니다.
    </Card>
  );
}
export function DevicesPage({ data }: { data: AdminSnapshot }) {
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
