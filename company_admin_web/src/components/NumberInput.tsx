import { useLayoutEffect, useRef, type InputHTMLAttributes } from "react";
import { formatNumber, numberDigits, type NumberKind } from "../data/koreanNumbers";

import { acceptsInput } from "../data/inputLimits";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  kind: NumberKind;
  maxDigits?: number;
  originalValue?: string;
  onRejected?(): void;
  onValueChange(value: string): void;
};
const count = (value: string) => (value.match(/[0-9]/g) ?? []).length;
function position(value: string, digits: number): number {
  if (!digits) return 0;
  for (let i = 0; i < value.length; i++) {
    if (/[0-9]/.test(value[i]) && --digits === 0) return i + 1;
  }
  return value.length;
}
export function NumberInput({ value, kind, onValueChange, maxDigits, originalValue, onRejected, ...props }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const compositionValue = useRef(value);
  const selection = useRef<[number, number]>([0, 0]);
  const allowed = (next: string, current = value, deletion = true) => maxDigits === undefined ||
    acceptsInput(next, current, { max: maxDigits, kind, original: originalValue }, deletion);
  const caret = useRef<[number, number, "forward" | "backward" | "none"] | null>(null);
  useLayoutEffect(() => {
    if (caret.current && ref.current === document.activeElement) ref.current?.setSelectionRange(...caret.current);
    caret.current = null;
  });
  function change(raw: string, start: number, end: number, direction: "forward" | "backward" | "none", inputType = "") {
    if (composing.current) { onValueChange(raw); return; }
    if (!allowed(raw)) {
      if (ref.current) { ref.current.value = value; ref.current.setSelectionRange(...selection.current); }
      onRejected?.(); return;
    }
    let before = count(raw.slice(0, start)), after = count(raw.slice(0, end));
    const oldDigits = numberDigits(value), digits = numberDigits(raw);
    // Touch keyboards may delete a separator without sending keydown. Delete the adjacent digit instead of trapping the cursor.
    if (start === end && digits !== null && digits === oldDigits && raw.length < value.length && inputType.startsWith("delete")) {
      const backwards = inputType === "deleteContentBackward";
      const index = backwards ? before - 1 : before;
      if (index >= 0 && index < digits.length) {
        raw = digits.slice(0, index) + digits.slice(index + 1);
        before = after = backwards ? Math.max(0, before - 1) : before;
      }
    }
    const formatted = formatNumber(raw, kind);
    caret.current = numberDigits(raw) === null ? [start, end, direction]
      : [position(formatted, before), position(formatted, after), direction];
    onValueChange(formatted);
  }
  return <input {...props} ref={ref} value={value}
    onChange={(event) => {
      const el = event.currentTarget;
      change(el.value, el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length,
        el.selectionDirection ?? "none", (event.nativeEvent as InputEvent).inputType ?? "");
    }}
    onBeforeInput={(event) => {
      if (!composing.current) selection.current = [event.currentTarget.selectionStart ?? 0, event.currentTarget.selectionEnd ?? 0];
    }}
    onPaste={(event) => {
      const el = event.currentTarget;
      const next = value.slice(0, el.selectionStart ?? 0) + event.clipboardData.getData("text") + value.slice(el.selectionEnd ?? value.length);
      if (!allowed(next, value, false)) { event.preventDefault(); onRejected?.(); }
    }}
    onKeyDown={(event) => {
      if (!composing.current) selection.current = [event.currentTarget.selectionStart ?? 0, event.currentTarget.selectionEnd ?? 0];
      if (composing.current || event.ctrlKey || event.metaKey || event.altKey) return;
      const el = event.currentTarget, start = el.selectionStart ?? 0;
      if (start !== el.selectionEnd || numberDigits(value) === null) return;
      const backwards = event.key === "Backspace", forward = event.key === "Delete";
      if ((backwards && value[start - 1] === "-") || (forward && value[start] === "-")) {
        event.preventDefault();
        const index = backwards ? start - 2 : start + 1;
        const raw = value.slice(0, index) + value.slice(index + 1);
        const next = backwards ? Math.max(0, start - 1) : start;
        change(raw, next, next, "none");
      }
    }}
    onCompositionStart={() => { compositionValue.current = value; composing.current = true; }}
    onCompositionEnd={(event) => {
      composing.current = false; const el = event.currentTarget;
      if (!allowed(el.value, compositionValue.current)) {
        el.value = compositionValue.current; onValueChange(compositionValue.current); onRejected?.(); return;
      }
      change(el.value, el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length, el.selectionDirection ?? "none");
    }} />;
}
