import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import cases from "./number-cases.json";
import { NumberInput } from "../components/NumberInput";
import { formatNumber, validPhone, validBusiness, canonicalNumber, numberDigits, type NumberKind } from "../data/koreanNumbers";
import { StoreEditor } from "../features/StoreEditor";
import { parseStore } from "../data/storeRepository";
import type { ApiStore } from "../data/models";

describe("shared Korean number contract", () => {
  it.each(cases.phone)("accepts phone $input", ({ input, expected }) => {
    expect(validPhone(input)).toBe(true);
    expect(canonicalNumber(input, "phone")).toBe(expected);
  });
  it.each(cases.invalidPhone)("rejects phone %s", (input) => expect(validPhone(input)).toBe(false));
  it.each(cases.business)("normalizes business $input", ({ input, expected }) => {
    expect(validBusiness(input)).toBe(true);
    expect(canonicalNumber(input, "business")).toBe(expected);
    expect(formatNumber(input, "business")).toBe(expected.slice(0, 3) + "-" + expected.slice(3, 5) + "-" + expected.slice(5));
  });
  it.each(cases.invalidBusiness)("rejects business %s", (input) => expect(validBusiness(input)).toBe(false));
});
function Harness({ kind, initial = "" }: { kind: NumberKind; initial?: string }) {
  const [value, setValue] = useState(initial);
  return <NumberInput aria-label="번호" value={value} kind={kind} onValueChange={setValue} />;
}
async function field(kind: NumberKind, initial = "") {
  const user = userEvent.setup(); render(<Harness kind={kind} initial={initial} />);
  const input = screen.getByRole("textbox") as HTMLInputElement;
  await user.click(input); return { user, input };
}
describe("number input editing", () => {
  it("types mobile digits, appends separators, and keeps the caret at the end", async () => {
    const { user, input } = await field("phone");
    await user.type(input, "01012345678");
    expect(input).toHaveValue("010-1234-5678");
    expect(input.selectionStart).toBe(13);
  });
  it("formats a pasted Seoul number and replaces a selected phone with a representative number", async () => {
    const { user, input } = await field("phone");
    await user.paste("(02) 1234-5678"); expect(input).toHaveValue("02-1234-5678");
    input.select(); await user.paste("15881234"); expect(input).toHaveValue("1588-1234");
  });
  it("retains invalid paste and excess digits for validation rather than silently discarding them", async () => {
    const { user, input } = await field("business");
    await user.paste("123-AB-67890"); expect(input).toHaveValue("123-AB-67890");
    input.select(); await user.paste("12345678901");
    expect(numberDigits(input.value)).toBe("12345678901");
    expect(validBusiness(input.value)).toBe(false);
  });
  it("inserts in the middle without jumping the caret to the end", async () => {
    const { user, input } = await field("business", "123-45-67890");
    input.setSelectionRange(5, 5); await user.keyboard("9");
    expect(input).toHaveValue("123-49-567890");
    expect(input.selectionStart).toBe(6);
  });
  it("Backspace after a separator removes the preceding digit instead of re-inserting the same hyphen", async () => {
    const { user, input } = await field("phone", "010-1234-5678");
    input.setSelectionRange(4, 4); await user.keyboard("{Backspace}");
    expect(numberDigits(input.value)).toBe("0112345678"); expect(input.selectionStart).toBe(2);
  });
  it("Delete before a separator removes the next digit and preserves a useful caret", async () => {
    const { user, input } = await field("phone", "010-1234-5678");
    input.setSelectionRange(3, 3); await user.keyboard("{Delete}");
    expect(numberDigits(input.value)).toBe("0102345678"); expect(input.selectionStart).toBe(3);
  });
  it("supports selection deletion, select-all replacement and complete clearing", async () => {
    const { user, input } = await field("business", "123-45-67890");
    input.setSelectionRange(4, 7); await user.keyboard("{Backspace}");
    expect(input).toHaveValue("123-67-890");
    input.select(); await user.paste("0000000001"); expect(input).toHaveValue("000-00-00001");
    await user.clear(input); expect(input).toHaveValue("");
  });
  it("handles touch-keyboard separator deletion without keydown", async () => {
    const { input } = await field("phone", "010-1234-5678");
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(input, "0101234-5678"); input.setSelectionRange(3, 3);
    fireEvent.input(input, { inputType: "deleteContentBackward" });
    expect(numberDigits(input.value)).toBe("0112345678");
    expect(input.selectionStart).toBe(2);
  });
  it("defers formatting during composition and formats when composition ends", async () => {
    const { input } = await field("business");
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "12345" } }); expect(input).toHaveValue("12345");
    fireEvent.compositionEnd(input);
    expect(input).toHaveValue("123-45");
  });
});
const payload = { store_name: "번호 매장", address: "부산", address_detail: null, store_code: "00123",
  phone: "051-123-4567", business_no: "0000000001", representative: "대표", store_type: "카페" };
const rawStore = { ...payload, store_id: 1, admin_id: 1, admin_name: "담당", owner_id: null, owner_login_id: null };
async function editor(store: ApiStore | null = null) {
  const user = userEvent.setup();
  const repository = { load: vi.fn(), detail: vi.fn(), create: vi.fn().mockResolvedValue(parseStore(rawStore)),
    update: vi.fn().mockResolvedValue(parseStore(rawStore)) };
  render(<><StoreEditor formId="numbers" store={store} repository={repository} onSaved={vi.fn()} onBusy={vi.fn()} />
    <button type="submit" form="numbers">저장</button></>);
  return { user, repository };
}
const named = (label: string) => screen.getByRole("textbox", { name: label + " *" });
describe("store number integration", () => {
  it("sends canonical phone and digits-only business number on create", async () => {
    const { user, repository } = await editor();
    for (const [label, value] of Object.entries({ 매장명: payload.store_name, 주소: "부산", 우편번호: "00123", 업종: "카페", 대표자명: "대표" }))
      fireEvent.change(named(label), { target: { value } });
    await user.click(named("전화번호")); await user.paste("01012345678");
    await user.click(named("사업자번호")); await user.paste("0000000001");
    expect(named("사업자번호")).toHaveValue("000-00-00001");
    await user.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(repository.create).toHaveBeenCalledWith({ ...payload, phone: "010-1234-5678" }, expect.any(AbortSignal)));
  });
  it("preserves existing values on open without adding formatting-only changes to PATCH", async () => {
    const { user, repository } = await editor(parseStore({ ...rawStore, phone: "0212345678" }));
    expect(named("전화번호")).toHaveValue("0212345678");
    expect(named("사업자번호")).toHaveValue("0000000001");
    fireEvent.change(named("매장명"), { target: { value: "이름만 변경" } });
    await user.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(repository.update).toHaveBeenCalledWith(1, { store_name: "이름만 변경" }, expect.any(AbortSignal)));
  });
  it("keeps unchanged legacy numbers and sends only explicitly changed canonical fields", async () => {
    const { user, repository } = await editor(parseStore({ ...rawStore, phone: "legacy-phone", business_no: "OLD" }));
    expect(named("전화번호")).toHaveValue("legacy-phone"); expect(named("사업자번호")).toHaveValue("OLD");
    await user.click(named("사업자번호")); await user.keyboard("{Control>}a{/Control}"); await user.paste("123-45-67890");
    await user.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(repository.update).toHaveBeenCalledWith(1, { business_no: "1234567890" }, expect.any(AbortSignal)));
  });
  it("rejects newly changed invalid phone and business numbers", async () => {
    const { user, repository } = await editor(parseStore(rawStore));
    fireEvent.change(named("전화번호"), { target: { value: "0101234567" } });
    fireEvent.change(named("사업자번호"), { target: { value: "123456789" } });
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(named("전화번호")).toHaveAttribute("aria-invalid", "true");
    expect(named("사업자번호")).toHaveAttribute("aria-invalid", "true");
    expect(repository.update).not.toHaveBeenCalled();
  });
});
