import { useRef, useState, type InputHTMLAttributes } from "react";
import { acceptsInput, type InputLimit } from "../data/inputLimits";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  rule: InputLimit;
  onValueChange(value: string): void;
  onRejected(): void;
};
/** Reject whole edits instead of maxlength's silent paste truncation; defer limits until IME composition ends. */
export function LimitedInput({ value, rule, onValueChange, onRejected, ...props }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const composing = useRef(false);
  const selection = useRef<[number, number]>([0, 0]);
  function remember(el: HTMLInputElement) { selection.current = [el.selectionStart ?? 0, el.selectionEnd ?? 0]; }
  function apply(el: HTMLInputElement, next: string) {
    if (acceptsInput(next, value, rule)) onValueChange(next);
    else {
      el.value = value;
      el.setSelectionRange(...selection.current);
      onRejected();
    }
  }
  return <input {...props} value={draft ?? value}
    onBeforeInput={(event) => { if (!composing.current) remember(event.currentTarget); }}
    onKeyDown={(event) => { if (!composing.current) remember(event.currentTarget); }}
    onPaste={(event) => {
      const el = event.currentTarget; remember(el);
      const next = value.slice(0, el.selectionStart ?? 0) + event.clipboardData.getData("text") + value.slice(el.selectionEnd ?? value.length);
      if (!acceptsInput(next, value, rule, false)) { event.preventDefault(); onRejected(); }
    }}
    onChange={(event) => {
      if (composing.current) setDraft(event.currentTarget.value);
      else apply(event.currentTarget, event.currentTarget.value);
    }}
    onCompositionStart={(event) => { remember(event.currentTarget); composing.current = true; setDraft(value); }}
    onCompositionEnd={(event) => { composing.current = false; setDraft(null); apply(event.currentTarget, event.currentTarget.value); }} />;
}
