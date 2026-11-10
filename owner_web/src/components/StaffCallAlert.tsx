import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing } from "lucide-react";
import type { OwnerAiRepository, StaffCall } from "../data/aiRepository";
import { apiErrorMessage } from "../data/ownerApiRepository";

const POLL_MS = 5000;

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" });

// 키오스크 직원 호출. 5초마다 확인하고, 처리하지 않은 호출이 있으면 모든 화면 위쪽에 띄운다.
// 탭이 보이지 않을 때는 확인을 멈췄다가 돌아오면 바로 다시 확인한다.
export function StaffCallAlert({ repository, pollMs = POLL_MS }: { repository: OwnerAiRepository; pollMs?: number }) {
  const [calls, setCalls] = useState<StaffCall[]>([]);
  const [resolving, setResolving] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const known = useRef<Set<number>>(new Set());
  // 처리 중이거나 방금 처리한 호출. 처리 전에 출발한 조회 응답이 늦게 와도 다시 띄우지 않는다.
  // 방금 처리한 호출은 처리가 끝난 뒤 시작한 조회가 성공하면 목록에서 놓아준다.
  const hidden = useRef<Map<number, "resolving" | number>>(new Map());
  const resolvedCount = useRef(0);
  const refresh = useCallback(async () => {
    const startedAfter = resolvedCount.current;
    try {
      const result = await repository.getStaffCalls();
      for (const [id, state] of hidden.current)
        if (state !== "resolving" && state <= startedAfter) hidden.current.delete(id);
      const open = result.open.filter((c) => !hidden.current.has(c.alertId));
      const fresh = open.filter((c) => !known.current.has(c.alertId));
      known.current = new Set(open.map((c) => c.alertId));
      setCalls(open);
      // 새 호출이 오면 탭 제목으로도 알린다.
      if (fresh.length && document.hidden) document.title = `(직원 호출 ${open.length}) AI-Voisk 점주`;
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
  async function resolve(call: StaffCall) {
    const { alertId } = call;
    setResolving(alertId);
    setError(null);
    hidden.current.set(alertId, "resolving");
    try {
      await repository.resolveStaffCall(alertId);
      hidden.current.set(alertId, ++resolvedCount.current);
      setCalls((list) => list.filter((c) => c.alertId !== alertId));
    } catch (failure) {
      // 처리되지 않았으므로 다시 보이게 하고 이유를 알린다.
      hidden.current.delete(alertId);
      setCalls((list) => (list.some((c) => c.alertId === alertId) ? list : [...list, call]));
      setError(apiErrorMessage(failure, "호출을 처리 완료로 바꾸지 못했습니다. 다시 시도해 주세요."));
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
            <button type="button" className="primary" disabled={resolving === c.alertId} onClick={() => void resolve(c)}>
              {resolving === c.alertId ? "처리 중…" : "처리 완료"}
            </button>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="error-text staff-call-error">{error}</p>}
    </section>
  );
}
