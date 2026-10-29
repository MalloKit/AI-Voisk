import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Search as SearchIcon,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`card ${className}`}>{children}</div>;
}
export function Heading({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <header className="page-heading">
      <h1>{title}</h1>
      <p>{children}</p>
    </header>
  );
}
export function Section({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>
      {children}
    </div>
  );
}
// ok: 정상, attention: 오류·연결 끊김, unsaved: 저장하지 않은 변경
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "ok" | "attention" | "unsaved";
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="detail-field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
export function Search({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange(v: string): void;
}) {
  return (
    <label className="search field">
      <span>{label}</span>
      <div>
        <SearchIcon size={18} aria-hidden="true" />
        <input
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {value && (
          <button
            type="button"
            className="icon-button"
            aria-label="검색어 지우기"
            onClick={() => onChange("")}
          >
            <X size={16} />
          </button>
        )}
      </div>
    </label>
  );
}
export function Filter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | number;
  options: { value: string | number; label: string }[];
  onChange(v: string): void;
}) {
  return (
    <label className="field filter">
      <span>{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
export function Filters({ children }: { children: ReactNode }) {
  return <Card className="filters">{children}</Card>;
}
export function Loading({ text = "데이터를 불러오는 중…" }: { text?: string }) {
  return (
    <div role="status" className="loading">
      <span className="spinner" />
      {text}
    </div>
  );
}
export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <Card>
      <p role="alert">{message}</p>
      {onRetry && <button onClick={onRetry}>다시 시도</button>}
    </Card>
  );
}
export interface Column<T> {
  label: string;
  render(row: T): ReactNode;
}
export function Table<T>({
  rows,
  columns,
  rowId,
  label,
  emptyMessage = "조건에 맞는 결과가 없습니다. 검색어나 필터를 변경해 주세요.",
}: {
  rows: T[];
  columns: Column<T>[];
  rowId(row: T): string | number;
  label: string;
  emptyMessage?: string;
}) {
  const keys = rows.map(rowId).join("|");
  const [state, setState] = useState({ keys, page: 0 });
  const page =
    state.keys === keys
      ? Math.min(state.page, Math.max(0, Math.ceil(rows.length / 5) - 1))
      : 0;
  const start = page * 5,
    end = Math.min(start + 5, rows.length);
  if (!rows.length) return <Card className="empty">{emptyMessage}</Card>;
  return (
    <div className="table-card">
      <div
        className="table-scroll"
        tabIndex={0}
        role="region"
        aria-label={`${label} 표`}
      >
        <table>
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr>
              {columns.map((c, i) => (
                <th key={i} scope="col">
                  {c.label || <span className="sr-only">상세 보기</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(start, end).map((row) => (
              <tr key={rowId(row)}>
                {columns.map((c, i) => (
                  <td key={i}>{c.render(row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pagination">
        <span>
          {start + 1}–{end} / {rows.length}건
        </span>
        <button
          className="icon-button"
          aria-label="이전 페이지"
          disabled={!page}
          onClick={() => setState({ keys, page: page - 1 })}
        >
          <ChevronLeft />
        </button>
        <button
          className="icon-button"
          aria-label="다음 페이지"
          disabled={end >= rows.length}
          onClick={() => setState({ keys, page: page + 1 })}
        >
          <ChevronRight />
        </button>
      </div>
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
          if (e.key === "Tab") {
            const nodes = Array.from(
              ref.current!.querySelectorAll<HTMLElement>(
                'button:not(:disabled), input, select, [tabindex="0"]',
              ),
            );
            if (!nodes.length) {
              e.preventDefault();
              return;
            }
            const first = nodes[0],
              last = nodes[nodes.length - 1];
            if (
              e.shiftKey &&
              (document.activeElement === first ||
                document.activeElement === ref.current)
            ) {
              e.preventDefault();
              last.focus();
            } else if (
              !e.shiftKey &&
              (document.activeElement === last ||
                document.activeElement === ref.current)
            ) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <h2>{title}</h2>
        <div className="modal-content">{children}</div>
        <footer>
          <button onClick={onClose}>닫기</button>
        </footer>
      </div>
    </div>
  );
}
