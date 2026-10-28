import { useCallback, useId, useState } from "react";
import type { AdminSnapshot, ApiOwner, ApiStore, Store } from "../data/models";
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
import { StoreOwnerForm } from "./StoreOwnerForm";
import { StoreEditor } from "./StoreEditor";
import { StoreDetails } from "./details";
import type { StoreRepository } from "../data/storeRepository";
import { useAsync, type AsyncResult } from "../hooks/useAsync";

export function LiveStoreDetail({ id, repository, data, onEdit, focusEdit = false, onManageOwner, focusOwner = false }: {
  id: number; repository: StoreRepository; data: AdminSnapshot; onEdit?: (store: ApiStore) => void; focusEdit?: boolean;
  onManageOwner?: (store: ApiStore) => void; focusOwner?: boolean;
}) {
  const load = useCallback((signal: AbortSignal) => repository.detail(id, signal), [id, repository]);
  const result = useAsync(load);
  if (result.loading) return <Loading text="실제 매장 상세를 불러오는 중…" />;
  if (result.error || !result.data) return <ErrorState message="실제 매장 상세 조회 실패. Mock 데이터로 대체하지 않습니다." onRetry={result.reload} />;
  return <><StoreDetails data={data} store={result.data} />{onEdit && <button autoFocus={focusEdit} onClick={() => onEdit(result.data!)}>매장 정보 수정</button>}
    {onManageOwner && <button className="owner-manage-button" autoFocus={focusOwner} onClick={() => onManageOwner(result.data!)}>점주 연결 관리</button>}</>;
}

export function StoresPage({
  data,
  initiallyUnlinked = false,
  repository = null,
  storesResult: result,
  ownersResult,
  liveOwners = false,
  onOwnerChanged,
}: {
  data: AdminSnapshot;
  initiallyUnlinked?: boolean;
  repository?: StoreRepository | null;
  storesResult: AsyncResult<ApiStore[]>;
  ownersResult?: AsyncResult<ApiOwner[]>;
  liveOwners?: boolean;
  onOwnerChanged?(): void;
}) {
  const live = repository !== null;
  const all: (Store | ApiStore)[] = live ? (result.data ?? []) : data.stores;
  const [search, setSearch] = useState(""),
    [type, setType] = useState("전체"),
    [connection, setConnection] = useState(
      initiallyUnlinked ? "미연결" : "전체",
    );
  const [detail, setDetail] = useState<Store | ApiStore>();
  const [editing, setEditing] = useState<ApiStore | null | undefined>();
  const [linking, setLinking] = useState<ApiStore>();
  const [focusOwner, setFocusOwner] = useState(false);
  const linkable = !!repository?.setOwner && liveOwners && !!ownersResult;
  const editorFormId = useId();
  const [focusEdit, setFocusEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const writable = !!repository?.create && !!repository?.update;
  function saved(store: ApiStore) {
    setNotice(editing === null ? "매장을 등록했습니다." : "매장 정보를 저장했습니다.");
    setSaving(false); setFocusOwner(false); setFocusEdit(true); setEditing(undefined); setDetail(store);
    result.reload();
  }
  function close() {
    if (saving) return;
    setEditing(undefined); setLinking(undefined); setDetail(undefined);
  }
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
        등록 매장의 기본 정보와 담당자, 점주 연결 현황을 확인합니다.
      </Heading>
      {writable && <div className="store-page-actions"><button className="button-primary" onClick={() => { setNotice(""); setFocusEdit(false); setEditing(null); }}>매장 등록</button></div>}
      {notice && <p role="status" className="form-feedback">{notice} 목록과 운영 요약은 최신 조회 결과로 갱신합니다.</p>}
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
                onClick={() => { setFocusEdit(false); setFocusOwner(false); setDetail(s); }}
              >
                상세
              </button>
            ),
          },
        ]}
      />
      </>}
      {(detail || editing !== undefined) && (
        <Modal title={linking ? "점주 연결 관리" : editing === null ? "매장 등록" : editing ? "매장 정보 수정" : detail!.name}
          onClose={close} closeDisabled={saving}
          footer={linking ? <div className="store-form-actions">
            <button disabled={saving} onClick={() => { setFocusOwner(true); setLinking(undefined); }}>취소</button>
            <button type="submit" form={editorFormId} disabled={saving || !!ownersResult?.loading || !!ownersResult?.error} className="button-primary">{saving ? "저장 중…" : "저장"}</button>
          </div> : editing !== undefined ? <div className="store-form-actions">
            <button type="button" disabled={saving} onClick={() => { setFocusEdit(true); setEditing(undefined); }}>취소</button>
            <button type="submit" form={editorFormId} disabled={saving} className="button-primary">{saving ? "저장 중…" : "저장"}</button>
          </div> : undefined}>
          {linking && repository && ownersResult ? <StoreOwnerForm key={linking.id} store={linking} repository={repository} ownersResult={ownersResult}
            formId={editorFormId} onBusy={setSaving} onSaved={(store) => {
              setSaving(false); setLinking(undefined); setDetail(store); setFocusOwner(true);
              setNotice("점주 연결 정보를 저장했습니다.");
              if (onOwnerChanged) onOwnerChanged(); else result.reload();
            }} /> : editing !== undefined && repository ? <StoreEditor store={editing} repository={repository}
            onBusy={setSaving} onSaved={saved} formId={editorFormId} />
            : repository ? <LiveStoreDetail id={detail!.id} repository={repository} data={data}
                onEdit={writable ? (store) => { setFocusOwner(false); setEditing(store); } : undefined} focusEdit={focusEdit && !focusOwner}
                onManageOwner={linkable ? setLinking : undefined} focusOwner={focusOwner} />
            : <StoreDetails data={data} store={detail!} />}
        </Modal>
      )}
    </>
  );
}
