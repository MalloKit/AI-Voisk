import { useCallback, useId, useState } from "react";
import type { AdminSnapshot, ApiOwner } from "../data/models";
import type { OwnerRepository } from "../data/ownerRepository";
import { useAsync, type AsyncResult } from "../hooks/useAsync";
import {
  Badge, ErrorState, Filter, Filters, Heading, Loading,
  Modal, Search, Section, Table,
} from "../components/ui";
import { OwnerCreateForm } from "./OwnerCreateForm";
import { OwnerDetails } from "./details";

function LiveOwnerDetail({ id, repository }: { id: number; repository: OwnerRepository }) {
  const load = useCallback(
    (signal: AbortSignal) => repository.detail(id, signal),
    [id, repository],
  );
  const result = useAsync(load);
  if (result.loading) return <Loading text="실제 점주 상세를 불러오는 중…" />;
  if (result.error || !result.data)
    return <ErrorState
      message="실제 점주 상세 조회 실패. Mock 데이터로 대체하지 않습니다."
      onRetry={result.reload}
    />;
  return <OwnerDetails source="api" owner={result.data} />;
}

export function OwnersPage({
  data,
  repository = null,
  ownersResult: result,
}: {
  data: AdminSnapshot;
  repository?: OwnerRepository | null;
  ownersResult: AsyncResult<ApiOwner[]>;
}) {
  const live = repository !== null;
  const formId = useId();
  const [creating, setCreating] = useState(false), [saving, setSaving] = useState(false), [notice, setNotice] = useState("");
  const all: ApiOwner[] = live ? (result.data ?? []) : data.owners.map((o) => ({
    ...o, storeCount: data.stores.filter((s) => s.ownerId === o.id).length,
  }));
  const [search, setSearch] = useState(""),
    [connection, setConnection] = useState("전체"),
    [detail, setDetail] = useState<ApiOwner>();
  const rows = all.filter(
    (o) =>
      `${o.id} ${o.loginId}`.toLowerCase().includes(search.trim().toLowerCase()) &&
      (connection === "전체" ||
        (connection === "연결됨" ? o.storeCount > 0 : o.storeCount === 0)),
  );
  return (
    <>
      <Heading title="점주 계정">
        점주 로그인 ID와 계정별 연결 매장을 조회합니다.
      </Heading>
      {repository?.create && <div className="store-page-actions"><button className="button-primary" onClick={() => { setNotice(""); setCreating(true); }}>점주 계정 생성</button></div>}
      {notice && <p role="status" className="form-feedback">{notice}</p>}
      {live && result.loading ? <Loading text="실제 점주 계정을 불러오는 중…" /> :
        live && result.error ? (
          <ErrorState
            message="실제 점주 조회 실패. Mock 데이터로 대체하지 않습니다."
            onRetry={result.reload}
          />
        ) : (
          <>
            <Filters>
              <Search label="점주 ID / 로그인 ID" value={search} onChange={setSearch} />
              <Filter
                label="매장 연결"
                value={connection}
                options={["전체", "연결됨", "미연결"].map((v) => ({ value: v, label: v }))}
                onChange={setConnection}
              />
              {live && <button onClick={result.reload}>새로고침</button>}
              <button onClick={() => { setSearch(""); setConnection("전체"); }}>초기화</button>
            </Filters>
            <Section title={`점주 계정 목록 · ${rows.length}개`} />
            <Table
              label="점주 계정 목록"
              rows={rows}
              rowId={(o) => o.id}
              columns={[
                { label: "점주 ID", render: (o) => o.id },
                { label: "로그인 ID", render: (o) => o.loginId },
                { label: "연결 매장 수", render: (o) => `${o.storeCount}곳` },
                {
                  label: "매장 연결",
                  render: (o) => <Badge>{o.storeCount ? "연결됨" : "미연결"}</Badge>,
                },
                {
                  label: "",
                  render: (o) => (
                    <button
                      aria-label={`연결 매장: ${o.loginId}`}
                      onClick={() => setDetail(o)}
                    >연결 매장</button>
                  ),
                },
              ]}
            />
          </>
        )}
      {creating && repository && <Modal title="점주 계정 생성" closeDisabled={saving} onClose={() => { if (!saving) setCreating(false); }}
        footer={<div className="store-form-actions"><button disabled={saving} onClick={() => setCreating(false)}>취소</button>
          <button type="submit" form={formId} disabled={saving} className="button-primary">{saving ? "등록 중…" : "등록"}</button></div>}>
        <OwnerCreateForm repository={repository} formId={formId} onBusy={setSaving} onSaved={() => {
          setSaving(false); setCreating(false); setNotice("점주 계정을 생성했습니다. 목록에서 연결 매장과 상세 정보를 확인할 수 있습니다."); result.reload();
        }} />
      </Modal>}
      {detail && (
        <Modal title="점주 계정 상세" onClose={() => setDetail(undefined)}>
          {repository
            ? <LiveOwnerDetail id={detail.id} repository={repository} />
            : <OwnerDetails source="mock" data={data} owner={detail} />}
        </Modal>
      )}
    </>
  );
}
