import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing } from "lucide-react";
import type { OwnerAiRepository, StaffCall } from "../data/aiRepository";

const POLL_MS = 5000;

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" });

// 키오스크 직원 호출. 5초마다 확인하고, 처리하지 않은 호출이 있으면 모든 화면 위쪽에 띄운다.
// 탭이 보이지 않을 때는 확인을 멈췄다가 돌아오면 바로 다시 확인한다.
export function StaffCallAlert({ repository, pollMs = POLL_MS }: { repository: OwnerAiRepository; pollMs?: number }) {
  const [calls, setCalls] = useState<StaffCall[]>([]);
  const [resolving, setResolving] = useState<number | null>(null);
  const known = useRef<Set<number>>(new Set());
  const refresh = useCallback(async () => {
    try {
      const result = await repository.getStaffCalls();
      const fresh = result.open.filter((c) => !known.current.has(c.alertId));
      known.current = new Set(result.open.map((c) => c.alertId));
      setCalls(result.open);
      // 새 호출이 오면 탭 제목으로도 알린다.
      if (fresh.length && document.hidden) document.title = `(직원 호출 ${result.open.length}) AI-Voisk 점주`;
    } catch {
      // 조회 실패는 다음 주기에 다시 시도합니다. 기존 알림은 그대로 둡니다.
    }
  }, [repository]);
  useEffect(() => {
    void refresh();
    let timer = window.setInterval(() => void refresh(), pollMs);
    const onVisible = () => {
      window.clearInterval(timer);
      if (!document.hidden) {
        document.title = "AI-Voisk 점주";
        void refresh();
        timer = window.setInterval(() => void refresh(), pollMs);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, pollMs]);
  if (!calls.length) return null;
  async function resolve(alertId: number) {
    setResolving(alertId);
    try {
      await repository.resolveStaffCall(alertId);
      setCalls((list) => list.filter((c) => c.alertId !== alertId));
    } finally {
      setResolving(null);
    }
  }
  return (
    <section className="staff-call-alert" aria-live="assertive" aria-label="직원 호출">
      <BellRing aria-hidden="true" />
      <ul>
        {calls.map((c) => (
          <li key={c.alertId}>
            <strong>{c.deviceCode}</strong>
            <span>{c.message}</span>
            <span className="muted">{timeLabel(c.occurredAt)}</span>
            <button type="button" className="primary" disabled={resolving === c.alertId} onClick={() => void resolve(c.alertId)}>
              {resolving === c.alertId ? "처리 중…" : "처리 완료"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
