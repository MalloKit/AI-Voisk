import { useCallback, useState } from "react";
import { Mic, ReceiptText, Sparkles, Wallet } from "lucide-react";
import { Card, ErrorState, Filter, Heading, Loading, Section } from "../components/ui";
import type { OwnerAiRepository } from "../data/aiRepository";
import { apiErrorMessage } from "../data/ownerApiRepository";
import { useAsync } from "../hooks/useAsync";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const percent = (ratio: number) => `${(ratio * 100).toFixed(1)}%`;

function Metric({ title, icon, value, note }: { title: string; icon: React.ReactNode; value: string; note: string }) {
  return (
    <Card>
      <span className="metric-title">
        {title}
        {icon}
      </span>
      <strong className="metric-value">{value}</strong>
      <span className="metric-note">{note}</span>
    </Card>
  );
}

export function StatsPage({ repository }: { repository: OwnerAiRepository }) {
  const [days, setDays] = useState(7);
  const load = useCallback((signal: AbortSignal) => repository.getStats(days, signal), [repository, days]);
  const result = useAsync(load);
  const heading = (
    <Heading title="통계">
      음성 주문과 AI 추천이 실제 주문에 얼마나 쓰였는지 봅니다. 날짜는 한국 시간 기준입니다.
    </Heading>
  );
  const filter = (
    <Filter
      label="기간"
      value={days}
      options={[
        { value: 1, label: "오늘" },
        { value: 7, label: "최근 7일" },
        { value: 30, label: "최근 30일" },
      ]}
      onChange={(v) => setDays(Number(v))}
    />
  );
  if (result.loading)
    return (
      <>
        {heading}
        <Loading />
      </>
    );
  if (result.error || !result.data)
    return (
      <>
        {heading}
        <ErrorState message={apiErrorMessage(result.failure, "통계를 불러오지 못했습니다.")} onRetry={result.reload} />
      </>
    );
  const s = result.data;
  const maxDaily = Math.max(1, ...s.daily.map((d) => d.orders));
  const maxTop = Math.max(1, ...s.topMenus.map((m) => m.quantity));
  return (
    <>
      {heading}
      <div className="stats-filter">
        {filter}
        <span className="muted">
          {s.startDate} ~ {s.endDate}
        </span>
      </div>
      <div className="metrics">
        <Metric title="주문 수" icon={<ReceiptText aria-hidden="true" />} value={`${s.orders}건`}
          note={`음성 ${s.voiceOrders}건 · 터치 ${s.orders - s.voiceOrders}건`} />
        <Metric title="음성 주문 비율" icon={<Mic aria-hidden="true" />} value={percent(s.voiceRatio)}
          note="음성 대화로 장바구니를 채운 주문" />
        <Metric title="추천 선택률" icon={<Sparkles aria-hidden="true" />} value={percent(s.recSelectionRate)}
          note={`추천 ${s.recImpressions}회 중 ${s.recSelections}회 선택`} />
        <Metric title="추천 경유 매출" icon={<Wallet aria-hidden="true" />} value={won(s.recRevenueEstimate)}
          note={`전체 ${won(s.revenueEstimate)} 중`} />
      </div>
      <p className="muted stats-note">
        매출은 주문 당시 가격을 따로 저장하지 않아 현재 메뉴·옵션 가격으로 계산한 추정치입니다.
      </p>
      <div className="stats-grid">
        <Card className="today-card">
          <Section title="날짜별 주문" />
          {s.orders === 0 ? (
            <p className="muted">이 기간에 들어온 주문이 없습니다.</p>
          ) : (
            <ol className="stats-daily" aria-label="날짜별 주문 수">
              {s.daily.map((d) => (
                <li key={d.date}>
                  <span className="stats-date">{d.date.slice(5)}</span>
                  <span className="stats-bar" aria-hidden="true">
                    <span className="stats-bar-total" style={{ width: `${(d.orders / maxDaily) * 100}%` }}>
                      <span className="stats-bar-voice" style={{ width: d.orders ? `${(d.voiceOrders / d.orders) * 100}%` : 0 }} />
                    </span>
                  </span>
                  <span className="stats-count">
                    {d.orders}건 <span className="muted">(음성 {d.voiceOrders})</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
          <p className="stats-legend" aria-hidden="true">
            <span className="legend-voice" /> 음성 주문 <span className="legend-total" /> 전체 주문
          </p>
        </Card>
        <Card className="today-card">
          <Section title="많이 팔린 메뉴" />
          {s.topMenus.length ? (
            <ol className="top-menus" aria-label="많이 팔린 메뉴">
              {s.topMenus.map((m, i) => (
                <li key={m.menuId}>
                  <span className="top-rank">{i + 1}</span>
                  <span className="top-name">{m.menuName}</span>
                  <span className="top-bar" aria-hidden="true">
                    <span style={{ width: `${(m.quantity / maxTop) * 100}%` }} />
                  </span>
                  <span className="top-quantity">{m.quantity}개</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">이 기간에 팔린 메뉴가 없습니다.</p>
          )}
        </Card>
      </div>
    </>
  );
}
