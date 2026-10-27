import { useCallback, useState } from "react";
import type { AdminSnapshot, ApiStore, Store } from "../data/models";
import {
  Badge,
  ErrorState,
  Loading,
  Filter,
  Filters,
  Heading,
  Modal,
  Search,
  Section,
  Table,
} from "../components/ui";
import { StoreDetails } from "./details";
import type { StoreRepository } from "../data/storeRepository";
import { useAsync, type AsyncResult } from "../hooks/useAsync";

export function LiveStoreDetail({ id, repository, data }: { id: number; repository: StoreRepository; data: AdminSnapshot }) {
  const load = useCallback((signal: AbortSignal) => repository.detail(id, signal), [id, repository]);
  const result = useAsync(load);
  if (result.loading) return <Loading text="실제 매장 상세를 불러오는 중…" />;
  if (result.error || !result.data) return <ErrorState message="실제 매장 상세 조회 실패. Mock 데이터로 대체하지 않습니다." onRetry={result.reload} />;
  return <StoreDetails data={data} store={result.data} />;
}

export function StoresPage({
  data,
  initiallyUnlinked = false,
  repository = null,
  storesResult: result,
}: {
  data: AdminSnapshot;
  initiallyUnlinked?: boolean;
  repository?: StoreRepository | null;
  storesResult: AsyncResult<ApiStore[]>;
}) {
  const live = repository !== null;
  const all: (Store | ApiStore)[] = live ? (result.data ?? []) : data.stores;
  const [search, setSearch] = useState(""),
    [type, setType] = useState("전체"),
    [connection, setConnection] = useState(
      initiallyUnlinked ? "미연결" : "전체",
    );
  const [detail, setDetail] = useState<Store | ApiStore>();
  const rows = all.filter(
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
        등록 매장의 기본 정보와 담당자, 점주 연결 현황을 확인합니다. · {live ? "실제 매장 API · 읽기 전용" : "Mock 데이터 · 시연 모드"}
      </Heading>
      {live && result.loading ? <Loading text="실제 매장을 불러오는 중…" /> : live && result.error ? (
        <ErrorState message="실제 매장 조회 실패. Mock 데이터로 대체하지 않습니다." onRetry={result.reload} />
      ) : <>
      <Filters>
        <Search
          label="매장명 / 대표자 / 사업자번호"
          value={search}
          onChange={setSearch}
        />
        <Filter
          label="업종"
          value={type}
          options={["전체", ...new Set(all.map((s) => s.type))].map(
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
        {live && <button onClick={result.reload}>새로고침</button>}
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
            render: (s) => "adminName" in s ? (s.adminName ?? "정보 없음") : data.admins.find((a) => a.id === s.adminId)?.name,
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
      </>}
      {detail && (
        <Modal title={detail.name} onClose={() => setDetail(undefined)}>
          {repository ? <LiveStoreDetail id={detail.id} repository={repository} data={data} /> : <StoreDetails data={data} store={detail} />}
        </Modal>
      )}
    </>
  );
}
