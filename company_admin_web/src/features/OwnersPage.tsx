import { useState } from "react";
import type { AdminSnapshot, Owner } from "../data/models";
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
import { OwnerDetails } from "./details";

export function OwnersPage({ data }: { data: AdminSnapshot }) {
  const [search, setSearch] = useState(""),
    [connection, setConnection] = useState("전체"),
    [detail, setDetail] = useState<Owner>();
  const storesFor = (id: number) => data.stores.filter((s) => s.ownerId === id);
  const rows = data.owners.filter(
    (o) =>
      `${o.id} ${o.loginId}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()) &&
      (connection === "전체" ||
        (connection === "연결됨"
          ? !!storesFor(o.id).length
          : !storesFor(o.id).length)),
  );
  return (
    <>
      <Heading title="점주 계정">
        점주 로그인 ID와 계정별 연결 매장을 조회합니다. · Mock 데이터
      </Heading>
      <Filters>
        <Search
          label="점주 ID / 로그인 ID"
          value={search}
          onChange={setSearch}
        />
        <Filter
          label="매장 연결"
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
            setConnection("전체");
          }}
        >
          초기화
        </button>
      </Filters>
      <Section title={`점주 계정 목록 · ${rows.length}개`} />
      <Table
        label="점주 계정 목록"
        rows={rows}
        rowId={(o) => o.id}
        columns={[
          { label: "점주 ID", render: (o) => o.id },
          { label: "로그인 ID", render: (o) => o.loginId },
          {
            label: "연결 매장 수",
            render: (o) => `${storesFor(o.id).length}곳`,
          },
          {
            label: "매장 연결",
            render: (o) => (
              <Badge>{storesFor(o.id).length ? "연결됨" : "미연결"}</Badge>
            ),
          },
          {
            label: "",
            render: (o) => (
              <button
                aria-label={`연결 매장: ${o.loginId}`}
                onClick={() => setDetail(o)}
              >
                연결 매장
              </button>
            ),
          },
        ]}
      />
      {detail && (
        <Modal title="점주 계정 상세" onClose={() => setDetail(undefined)}>
          <OwnerDetails data={data} owner={detail} />
        </Modal>
      )}
    </>
  );
}
