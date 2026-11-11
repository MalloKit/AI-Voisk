import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Trash2, Sparkles, Mic } from "lucide-react";
import { Badge, Card, ErrorState, Heading, Loading, Section } from "../components/ui";
import type { AiSettings, MenuAi, OwnerAiRepository } from "../data/aiRepository";
import { apiErrorMessage } from "../data/ownerApiRepository";
import { PHOTO_ACCEPT, shrinkImage } from "../data/menuImage";
import { useAsync } from "../hooks/useAsync";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const TAG_MAX = 10;
// 추천 순서 기준(policy_profit) 빠른 선택
const POLICY_PRESETS = [
  { label: "고객 적합 우선", value: 0 },
  { label: "균형", value: 50 },
  { label: "매장 이익 우선", value: 100 },
] as const;

// 쉼표로 구분한 입력을 태그 목록으로 바꾼다. 서버와 같은 규칙(공백 정리, 중복 제거, 길이 제한)을 쓴다.
export function parseLabels(value: string, limit: number) {
  const labels = [
    ...new Set(value.split(",").map((v) => v.split(/\s+/).filter(Boolean).join(" ")).filter(Boolean)),
  ];
  const tooLong = labels.find((l) => l.length > limit);
  if (tooLong) return { labels, error: `"${tooLong}"은(는) ${limit}자 이하로 써 주세요.` };
  if (labels.length > TAG_MAX) return { labels, error: `${TAG_MAX}개까지 입력할 수 있습니다.` };
  return { labels, error: null };
}

function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  left,
  right,
  help,
  unit = "",
}: {
  label: string;
  value: number;
  onChange(v: number): void;
  min?: number;
  max?: number;
  left?: string;
  right?: string;
  help: string;
  unit?: string;
}) {
  return (
    <label className="ai-slider">
      <span className="ai-slider-head">
        <span>{label}</span>
        <output>
          {value}
          {unit}
        </output>
      </span>
      <input type="range" min={min} max={max} step={5} value={value} aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))} />
      {(left || right) && (
        <span className="ai-slider-ends" aria-hidden="true">
          <span>{left}</span>
          <span>{right}</span>
        </span>
      )}
      <span className="form-help">{help}</span>
    </label>
  );
}

function Toggle({
  label,
  note,
  checked,
  onChange,
  name,
}: {
  label: string;
  note: string;
  checked: boolean;
  onChange(v: boolean): void;
  // 같은 스위치가 여러 줄에 있을 때 화면 낭독기가 구분하도록 붙이는 이름
  name?: string;
}) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" aria-label={name} aria-description={name ? note : undefined}
        checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        <br />
        <span className="switch-note">{note}</span>
      </span>
    </label>
  );
}

function SettingsCard({ repository }: { repository: OwnerAiRepository }) {
  const load = useCallback((signal: AbortSignal) => repository.getAiSettings(signal), [repository]);
  const result = useAsync(load);
  const [draft, setDraft] = useState<AiSettings | null>(null);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (result.data) setDraft(result.data.settings);
  }, [result.data]);
  if (result.loading) return <Card><Loading /></Card>;
  if (result.error || !result.data || !draft)
    return (
      <Card>
        <ErrorState message={apiErrorMessage(result.failure, "추천 설정을 불러오지 못했습니다.")} onRetry={result.reload} />
      </Card>
    );
  const saved = result.data.settings;
  const changed = JSON.stringify(saved) !== JSON.stringify(draft);
  const set = (patch: Partial<AiSettings>) => {
    setStatus(null);
    setDraft({ ...draft, ...patch });
  };
  async function save() {
    setSaving(true);
    try {
      const next = await repository.saveAiSettings(draft!);
      result.setData((d) => d && { ...d, settings: next });
      setStatus({ kind: "ok", text: "저장했습니다. 매장 키오스크에 바로 반영됩니다(주문 중이면 주문이 끝난 뒤)." });
    } catch (error) {
      setStatus({ kind: "error", text: apiErrorMessage(error, "저장하지 못했습니다. 다시 시도해 주세요.") });
    } finally {
      setSaving(false);
    }
  }
  return (
    <Card className="ai-card">
      <Section title="추천 정책">
        <Sparkles aria-hidden="true" />
      </Section>
      {!result.data.aiReady && (
        <p className="error-text">서버 DB에 AI 기능 변경이 적용되지 않아 저장할 수 없습니다. 관리자에게 문의해 주세요.</p>
      )}
      <div className="ai-settings-grid">
        <div className="ai-policy">
          {/* 자주 쓰는 세 값으로 슬라이더를 옮긴다. 슬라이더 값이 같으면 그 버튼을 선택 상태로 보인다. */}
          <div className="ai-presets" role="group" aria-label="추천 순서 기준 빠른 선택">
            {POLICY_PRESETS.map((p) => (
              <button key={p.value} type="button" aria-pressed={draft.policyProfit === p.value}
                onClick={() => set({ policyProfit: p.value })}>
                {p.label}
              </button>
            ))}
          </div>
          <Slider label="추천 순서 기준" value={draft.policyProfit} onChange={(v) => set({ policyProfit: v })}
            left="고객에게 맞는 메뉴 우선" right="매장 이익 우선"
            help="고객 상황에 맞는 메뉴들 사이의 순서만 바꿉니다. 맞지 않는 메뉴를 이익 때문에 추천하지는 않습니다." />
        </div>
        <Slider label="적합도 기준선" value={draft.fitThreshold} onChange={(v) => set({ fitThreshold: v })} unit="점"
          help="AI가 매긴 상황 적합도가 이 점수보다 낮은 메뉴는 추천하지 않습니다." />
        <Slider label="매장 우선 메뉴 가산" value={draft.pickWeight} onChange={(v) => set({ pickWeight: v })}
          help="아래 메뉴 목록에서 '매장 우선'으로 고른 메뉴(신메뉴·재고 소진 등)를 조금 더 앞에 둡니다." />
        <Toggle label="추가 제안" note="주문을 담은 뒤 음료·사이드를 한 번만 권합니다. 시니어 모드에서는 하지 않습니다."
          checked={draft.upsellEnabled} onChange={(v) => set({ upsellEnabled: v })} />
      </div>
      <Section title="음성 주문">
        <Mic aria-hidden="true" />
      </Section>
      <div className="ai-settings-grid">
        <Toggle label="음성 주문 사용" note="끄면 키오스크의 '말로 주문하기' 버튼이 터치 주문 안내만 합니다."
          checked={draft.voiceEnabled} onChange={(v) => set({ voiceEnabled: v })} />
        <Slider label="안내 음성 속도" value={draft.speechRate} onChange={(v) => set({ speechRate: v })} min={50} max={150} unit="%"
          help="시니어 모드에서는 이 속도보다 20% 더 천천히 말합니다." />
        <label className="form-field">
          <span>기본 사용자 모드</span>
          <select value={draft.defaultMode} aria-label="기본 사용자 모드"
            onChange={(e) => set({ defaultMode: e.target.value === "senior" ? "senior" : "normal" })}>
            <option value="normal">일반 모드</option>
            <option value="senior">시니어 모드(큰 글씨·천천히)</option>
          </select>
        </label>
      </div>
      <div className="ai-save-row">
        {status && <p role="status" className={status.kind === "ok" ? "ok-text" : "error-text"}>{status.text}</p>}
        <button type="button" disabled={!changed || saving} onClick={() => setDraft(saved)}>되돌리기</button>
        <button type="button" className="primary" disabled={!changed || saving || !result.data.aiReady} onClick={() => void save()}>
          {saving ? "저장 중…" : "설정 저장"}
        </button>
      </div>
    </Card>
  );
}

type RowDraft = { menu: MenuAi; cost: string; tags: string; synonyms: string };
const toRow = (menu: MenuAi): RowDraft => ({
  menu,
  cost: menu.costRate === null ? "" : String(menu.costRate),
  tags: menu.tags.join(", "),
  synonyms: menu.synonyms.join(", "),
});

function rowError(row: RowDraft) {
  if (row.cost.trim() && !/^\d{1,3}$/.test(row.cost.trim())) return "원가율은 0~100 사이 숫자입니다.";
  if (row.cost.trim() && Number(row.cost) > 100) return "원가율은 0~100 사이 숫자입니다.";
  return parseLabels(row.tags, 20).error ?? parseLabels(row.synonyms, 30).error;
}

function fromRow(row: RowDraft): MenuAi {
  return {
    ...row.menu,
    costRate: row.cost.trim() ? Number(row.cost) : null,
    tags: parseLabels(row.tags, 20).labels,
    synonyms: parseLabels(row.synonyms, 30).labels,
  };
}

function MenuAiCard({ repository }: { repository: OwnerAiRepository }) {
  const load = useCallback((signal: AbortSignal) => repository.getMenuAi(signal), [repository]);
  const result = useAsync(load);
  const [rows, setRows] = useState<RowDraft[]>([]);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState<number | "save" | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadFor = useRef<number | null>(null);
  // 입력칸을 서버 값으로 다시 채우는 때는 처음 불러올 때와 저장 직후뿐이다.
  // 사진을 바꿀 때 result.data를 고쳐도 다른 메뉴의 저장 안 된 입력은 지우지 않는다.
  const resetRows = useRef(true);
  useEffect(() => {
    if (result.data && resetRows.current) {
      resetRows.current = false;
      setRows(result.data.map(toRow));
    }
  }, [result.data]);
  // 사진 주소는 즉시 저장되므로 저장본과 그 행의 입력만 함께 바꾼다.
  const setImage = (menuId: number, imageUrl: string | null) => {
    const patch = (m: MenuAi) => (m.menuId === menuId ? { ...m, imageUrl } : m);
    result.setData((data) => data?.map(patch));
    setRows((list) => list.map((r) => ({ ...r, menu: patch(r.menu) })));
  };
  const saved = useMemo(() => new Map((result.data ?? []).map((m) => [m.menuId, JSON.stringify(m)])), [result.data]);
  const changed = rows.filter((r) => saved.get(r.menu.menuId) !== JSON.stringify(fromRow(r)));
  const errors = rows.map(rowError);
  if (result.loading) return <Card><Loading /></Card>;
  if (result.error || !result.data)
    return (
      <Card>
        <ErrorState message={apiErrorMessage(result.failure, "메뉴 추천 정보를 불러오지 못했습니다.")}
          onRetry={() => { resetRows.current = true; result.reload(); }} />
      </Card>
    );
  const update = (menuId: number, patch: Partial<RowDraft> | ((r: RowDraft) => Partial<RowDraft>)) => {
    setStatus(null);
    setRows((list) => list.map((r) => (r.menu.menuId === menuId ? { ...r, ...(typeof patch === "function" ? patch(r) : patch) } : r)));
  };
  async function save() {
    setBusy("save");
    try {
      const next = await repository.saveMenuAi(changed.map(fromRow));
      resetRows.current = true;
      result.setData(() => next);
      setStatus({ kind: "ok", text: `메뉴 ${changed.length}개를 저장했습니다. 키오스크 추천에 바로 반영됩니다.` });
    } catch (error) {
      setStatus({ kind: "error", text: apiErrorMessage(error, "저장하지 못했습니다. 다시 시도해 주세요.") });
    } finally {
      setBusy(null);
    }
  }
  async function upload(file: File | undefined) {
    const menuId = uploadFor.current;
    if (!file || menuId === null) return;
    setBusy(menuId);
    setStatus(null);
    try {
      const imageUrl = await repository.uploadMenuImage(menuId, await shrinkImage(file));
      setImage(menuId, imageUrl);
      setStatus({ kind: "ok", text: "사진을 바꿨습니다." });
    } catch (error) {
      setStatus({ kind: "error", text: error instanceof Error && !("status" in error) ? error.message : apiErrorMessage(error, "사진을 올리지 못했습니다.") });
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function removeImage(menuId: number) {
    setBusy(menuId);
    try {
      await repository.deleteMenuImage(menuId);
      setImage(menuId, null);
    } catch (error) {
      setStatus({ kind: "error", text: apiErrorMessage(error, "사진을 지우지 못했습니다.") });
    } finally {
      setBusy(null);
    }
  }
  return (
    <Card className="ai-card">
      <Section title="메뉴별 추천 정보">
        {changed.length > 0 && <Badge tone="unsaved">저장 안 된 메뉴 {changed.length}개</Badge>}
      </Section>
      <p className="muted ai-lead">
        상황 태그(해장·든든한·아이와함께 등)와 동의어("아아", "제육" 등)는 음성 주문 해석과 추천에 쓰입니다. 원가율은 '매장 이익 우선' 정책의 순서 계산에만 쓰고 고객에게 보이지 않습니다.
      </p>
      <input ref={fileInput} type="file" accept={PHOTO_ACCEPT} hidden aria-label="메뉴 사진 파일"
        onChange={(e) => void upload(e.target.files?.[0])} />
      {rows.length === 0 ? (
        <p className="muted">등록된 메뉴가 없습니다. 메뉴 관리에서 먼저 메뉴를 만들어 주세요.</p>
      ) : (
        <ul className="ai-menu-list" aria-label="메뉴별 추천 정보">
          {rows.map((row, index) => {
            const m = row.menu;
            const src = repository.imageSrc(m.imageUrl);
            const error = errors[index];
            return (
              <li key={m.menuId} className={`ai-menu-row ${m.isActive ? "" : "inactive"}`}>
                <div className="ai-photo">
                  {src ? <img src={src} alt={`${m.menuName} 사진`} /> : <span className="ai-photo-empty" aria-hidden="true">사진 없음</span>}
                  <div className="ai-photo-actions">
                    <button type="button" disabled={busy !== null} aria-label={`${m.menuName} 사진 올리기`}
                      onClick={() => { uploadFor.current = m.menuId; fileInput.current?.click(); }}>
                      <ImagePlus size={16} aria-hidden="true" /> {busy === m.menuId ? "올리는 중…" : "사진"}
                    </button>
                    {m.imageUrl && (
                      <button type="button" className="icon-button" disabled={busy !== null} aria-label={`${m.menuName} 사진 지우기`}
                        onClick={() => void removeImage(m.menuId)}>
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="ai-menu-name">
                  <strong>{m.menuName}</strong>
                  <span className="muted">{m.categoryName} · {won(m.price)}</span>
                  <span className="ai-badges">
                    {!m.isActive && <Badge>판매 중지</Badge>}
                    {m.isSoldOut && <Badge tone="attention">품절</Badge>}
                  </span>
                </div>
                <label className="form-field ai-cost">
                  <span>원가율(%)</span>
                  <input inputMode="numeric" value={row.cost} maxLength={3} aria-label={`${m.menuName} 원가율`}
                    onChange={(e) => update(m.menuId, { cost: e.target.value.replace(/[^\d]/g, "") })} />
                </label>
                <label className="form-field ai-tags">
                  <span>상황 태그</span>
                  <input value={row.tags} placeholder="해장, 든든한" aria-label={`${m.menuName} 상황 태그`}
                    onChange={(e) => update(m.menuId, { tags: e.target.value })} />
                </label>
                <label className="form-field ai-tags">
                  <span>동의어</span>
                  <input value={row.synonyms} placeholder="제육, 제육볶음" aria-label={`${m.menuName} 동의어`}
                    onChange={(e) => update(m.menuId, { synonyms: e.target.value })} />
                </label>
                <div className="ai-flags">
                  <Toggle label="매장 우선" note="추천에서 조금 앞에" name={`${m.menuName} 매장 우선`} checked={m.isStorePick}
                    onChange={(v) => update(m.menuId, (r) => ({ menu: { ...r.menu, isStorePick: v } }))} />
                  <Toggle label="추천 제외" note="추천·추가 제안에서 뺌" name={`${m.menuName} 추천 제외`} checked={m.isRecExcluded}
                    onChange={(v) => update(m.menuId, (r) => ({ menu: { ...r.menu, isRecExcluded: v } }))} />
                </div>
                {error && <p className="error-text ai-row-error" role="alert">{error}</p>}
              </li>
            );
          })}
        </ul>
      )}
      <div className="ai-save-row sticky">
        {status && <p role="status" className={status.kind === "ok" ? "ok-text" : "error-text"}>{status.text}</p>}
        <button type="button" disabled={!changed.length || busy !== null} onClick={() => setRows(result.data!.map(toRow))}>되돌리기</button>
        <button type="button" className="primary" disabled={!changed.length || busy !== null || errors.some(Boolean)}
          onClick={() => void save()}>
          {busy === "save" ? "저장 중…" : `메뉴 추천 정보 저장${changed.length ? ` (${changed.length})` : ""}`}
        </button>
      </div>
    </Card>
  );
}

export function AiPage({ repository }: { repository: OwnerAiRepository }) {
  return (
    <>
      <Heading title="AI 추천·음성">
        음성 주문과 상황 추천의 기준을 정합니다. 저장하면 매장 키오스크에 바로 반영됩니다.
      </Heading>
      <div className="ai-page">
        <SettingsCard repository={repository} />
        <MenuAiCard repository={repository} />
      </div>
    </>
  );
}
