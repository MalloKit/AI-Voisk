import { CheckCircle2, RotateCcw, Save, Undo2 } from "lucide-react";

// 화면 아래에 고정된 저장 바. 품절을 뺀 변경을 모았다가 한 번에 저장한다.
export function SaveBar({
  count,
  canUndo,
  saving,
  message,
  onUndo,
  onDiscard,
  onSave,
}: {
  count: number;
  canUndo: boolean;
  saving: boolean;
  message: string | null;
  onUndo(): void;
  onDiscard(): void;
  onSave(): void;
}) {
  return (
    <div
      className={`save-bar ${count ? "dirty" : ""}`}
      role="region"
      aria-label="저장 바"
    >
      <div className="save-status" aria-live="polite">
        {count ? (
          <>
            <span className="unsaved-dot inline" aria-hidden="true" />
            저장 안 된 변경 {count}건
          </>
        ) : (
          <>
            <CheckCircle2 size={18} aria-hidden="true" />
            모든 변경이 저장됨
          </>
        )}
      </div>
      {message && (
        <p className="save-message" role="alert">
          {message}
        </p>
      )}
      <div className="save-actions">
        <button
          disabled={!canUndo || saving}
          onClick={onUndo}
          title="되돌리기 (Ctrl+Z)"
        >
          <Undo2 size={16} aria-hidden="true" />
          되돌리기
        </button>
        <button disabled={!count || saving} onClick={onDiscard}>
          <RotateCcw size={16} aria-hidden="true" />
          변경 취소
        </button>
        <button
          className="primary"
          disabled={!count || saving}
          onClick={onSave}
        >
          <Save size={16} aria-hidden="true" />
          {saving ? "저장 중…" : "저장"}
        </button>
      </div>
    </div>
  );
}
