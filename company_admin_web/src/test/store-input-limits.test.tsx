import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StoreEditor } from "../features/StoreEditor";
import { parseStore } from "../data/storeRepository";

const raw = { store_id: 1, store_name: "매장", store_code: "12345", store_type: "카페", address: "부산",
  address_detail: null, phone: "0212345678", business_no: "1234567890", representative: "대표",
  admin_id: 3, admin_name: "관리자", owner_id: 7, owner_login_id: "owner" };
function open(overrides: Partial<typeof raw> = {}) {
  const repository = { load: vi.fn(), detail: vi.fn(), create: vi.fn().mockResolvedValue(parseStore(raw)), update: vi.fn().mockResolvedValue(parseStore(raw)) };
  render(<><StoreEditor store={parseStore({ ...raw, ...overrides })} repository={repository}
    formId="limits" onSaved={vi.fn()} onBusy={vi.fn()} /><button type="submit" form="limits">저장</button></>);
  return { user: userEvent.setup(), repository };
}
const field = (name: string) => screen.getByRole("textbox", { name }) as HTMLInputElement;

describe("store input bounds", () => {
  it("blocks the sixth postcode digit, permits selection replacement, and rejects short saves", async () => {
    const { user, repository } = open(); const input = field("우편번호 *");
    await user.clear(input); await user.type(input, "123456"); expect(input).toHaveValue("12345");
    input.setSelectionRange(2, 3); await user.keyboard("9"); expect(input).toHaveValue("12945");
    await user.clear(input); await user.type(input, "123"); await user.click(screen.getByRole("button", { name: "저장" }));
    expect(input).toHaveFocus(); expect(screen.getByText("우편번호는 숫자 5자리로 입력해 주세요.")).toBeInTheDocument();
    expect(repository.update).not.toHaveBeenCalled();
  });
  it("rejects whole oversized and invalid postcode pastes instead of sanitizing", async () => {
    const { user } = open(); const input = field("우편번호 *"); await user.click(input); input.select();
    await user.paste("654321"); expect(input).toHaveValue("12345");
    await user.paste("12a34"); expect(input).toHaveValue("12345");
    await user.paste("54321"); expect(input).toHaveValue("54321");
    await user.keyboard("a"); expect(input).toHaveValue("54321");
  });
  it("bounds business digits, supports middle editing, and sends digits only", async () => {
    const { user, repository } = open(); const input = field("사업자번호 *");
    await user.clear(input); await user.type(input, "12345678901"); expect(input).toHaveValue("123-45-67890");
    input.setSelectionRange(4, 5); await user.keyboard("9"); expect(input).toHaveValue("123-95-67890");
    input.setSelectionRange(5, 5); await user.keyboard("{Backspace}"); expect(input).toHaveValue("123-56-7890");
    input.select(); await user.paste("000-00-00001"); expect(input).toHaveValue("000-00-00001");
    input.select(); await user.paste("12345678901"); expect(input).toHaveValue("000-00-00001");
    await user.paste("123-AB-67890"); expect(input).toHaveValue("000-00-00001");
    await user.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(repository.update).toHaveBeenCalledWith(1, { business_no: "0000000001" }, expect.any(AbortSignal)));
  });
  it.each(["15881234", "021234567", "0212345678", "0511234567", "01012345678", "07012345678", "0801234567"])("retains supported phone %s", async (phone) => {
    const { user, repository } = open(); const input = field("전화번호 *");
    await user.clear(input); await user.type(input, phone);
    expect(input.value.replaceAll("-", "")).toBe(phone);
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(input).toHaveAttribute("aria-invalid", "false");
    if (phone !== raw.phone) await waitFor(() => expect(repository.update).toHaveBeenCalled());
  });
  it("blocks a twelfth phone digit and rejects whole long pastes", async () => {
    const { user } = open(); const input = field("전화번호 *");
    await user.clear(input); await user.type(input, "010123456789"); expect(input).toHaveValue("010-1234-5678");
    input.select(); await user.paste("010999988887"); expect(input).toHaveValue("010-1234-5678");
    input.setSelectionRange(4, 8); await user.keyboard("9999"); expect(input).toHaveValue("010-9999-5678");
  });
  it.each([["매장명 *",100],["업종 *",200],["주소 *",200],["상세 주소",200],["대표자명 *",50]] as const)("limits %s without truncating paste", async (name, max) => {
    const { user } = open(); const input = field(name); fireEvent.change(input, { target: { value: "가".repeat(max-1) } });
    await user.click(input); input.setSelectionRange(max-1,max-1); await user.keyboard("나다");
    const full = "가".repeat(max-1)+"나"; expect(input).toHaveValue(full);
    input.select(); await user.paste("다".repeat(max+1)); expect(input).toHaveValue(full);
    input.setSelectionRange(1,2); await user.keyboard("라"); expect(Array.from(input.value)).toHaveLength(max);
    await user.keyboard("{Backspace}"); expect(Array.from(input.value)).toHaveLength(max-1);
  });
  it("defers Hangul IME limits until composition ends and rolls back an overflow", () => {
    open(); const input = field("매장명 *"); fireEvent.change(input, { target: { value: "가".repeat(99) } });
    input.setSelectionRange(99,99); fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "가".repeat(99)+"ㄴ" } });
    fireEvent.change(input, { target: { value: "가".repeat(99)+"나" } }); fireEvent.compositionEnd(input);
    expect(input).toHaveValue("가".repeat(99)+"나");
    fireEvent.compositionStart(input); fireEvent.change(input, { target: { value: input.value+"다" } }); fireEvent.compositionEnd(input);
    expect(input).toHaveValue("가".repeat(99)+"나");
  });
  it("counts Unicode characters without splitting surrogate pairs", async () => {
    const { user } = open(); const input = field("대표자명 *");
    await user.click(input); input.select(); await user.paste("😀".repeat(50)); expect(Array.from(input.value)).toHaveLength(50);
    await user.keyboard("가"); expect(input).toHaveValue("😀".repeat(50));
  });
  it("preserves legacy originals and exact restoration while only PATCHing the changed field", async () => {
    const legacy = { store_name: "가".repeat(101), store_code: "T0001", phone: "old-phone", business_no: "OLD" };
    const { user, repository } = open(legacy);
    for (const [name, original] of [["매장명 *",legacy.store_name],["우편번호 *",legacy.store_code],["전화번호 *",legacy.phone],["사업자번호 *",legacy.business_no]]) {
      const input = field(name); expect(input).toHaveValue(original);
      await user.click(input); input.select(); await user.paste("1"); input.select(); await user.paste(original); expect(input).toHaveValue(original);
    }
    fireEvent.change(field("업종 *"), { target: { value: "음식점" } }); await user.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(repository.update).toHaveBeenCalledWith(1, { store_type: "음식점" }, expect.any(AbortSignal)));
  });
  it("rejects an overlong numeric IME composition without replacing the original", () => {
    open(); const input = field("사업자번호 *");fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "12345678901" } });fireEvent.compositionEnd(input);expect(input).toHaveValue(raw.business_no);
  });
});
