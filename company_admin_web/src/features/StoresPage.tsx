import { useState } from "react";
import type { AdminSnapshot, Store } from "../data/models";
import {
  Badge,
  Filter,
  Filters,
  Heading,
  Modal,
  Search,
  Section,
  Table,
} from "../components/ui";
import { StoreDetails } from "./details";

export function StoresPage({
  data,
  initiallyUnlinked = false,
}: {
  data: AdminSnapshot;
  initiallyUnlinked?: boolean;
}) {
  const [search, setSearch] = useState(""),
    [type, setType] = useState("전체"),
    [connection, setConnection] = useState(
      initiallyUnlinked ? "미연결" : "전체",
    );
  const [detail, setDetail] = useState<Store>();
  const rows = data.stores.filter(
    (s) =>
      `${s.name} ${s.representative} ${s.businessNo}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()) &&
      (type === "전체" || type === s.type) &&
      (connection === "전체" ||
        (connection === "연결됨" ? s.ownerId !== null : s.ownerId === null)),
  );
  return (
    <>
      <Heading title="매장 관리">
        등록 매장의 기본 정보와 담당자, 점주 연결 현황을 확인합니다. · Mock
        데이터
      </Heading>
      <Filters>
        <Search
          label="매장명 / 대표자 / 사업자번호"
          value={search}
          onChange={setSearch}
        />
        <Filter
          label="업종"
          value={type}
          options={["전체", ...new Set(data.stores.map((s) => s.type))].map(
            (v) => ({ value: v, label: v }),
          )}
          onChange={setType}
        />
        <Filter
          label="점주 연결"
          value={connection}
          options={["전체", "연결됨", "미연결"].map((v) => ({
            value: v,
            label: v,
          }))}
          onChange={setConnection}
        />
        <button
          onClick={() => {
            setSearch("");
            setType("전체");
            setConnection("전체");
          }}
        >
          초기화
        </button>
      </Filters>
      <Section title={`매장 목록 · ${rows.length}곳`} />
      <Table
        label="매장 목록"
        rows={rows}
        rowId={(s) => s.id}
        columns={[
          { label: "매장명", render: (s) => s.name },
          { label: "업종", render: (s) => s.type },
          { label: "전화번호", render: (s) => s.phone },
          {
            label: "담당 관리자",
            render: (s) => data.admins.find((a) => a.id === s.adminId)?.name,
          },
          {
            label: "점주 연결",
            render: (s) => (
              <Badge>{s.ownerId !== null ? "연결됨" : "미연결"}</Badge>
            ),
          },
          {
            label: "",
            render: (s) => (
              <button
                aria-label={`매장 상세: ${s.name}`}
                onClick={() => setDetail(s)}
              >
                상세
              </button>
            ),
          },
        ]}
      />
      {detail && (
        <Modal title={detail.name} onClose={() => setDetail(undefined)}>
          <StoreDetails data={data} store={detail} />
        </Modal>
      )}
    </>
  );
}
