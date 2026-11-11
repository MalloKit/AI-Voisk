import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { StoreEditor } from "../features/StoreEditor";
import type { ApiStore } from "../data/models";

afterEach(() => vi.unstubAllGlobals());

it.each([false, true])("fills postal fields and saves via the existing contract (edit=%s)", async (edit) => {
  let select!: (data: { zonecode: string; address: string }) => void;
  vi.stubGlobal("daum", { Postcode: class {
    constructor(options: { oncomplete: typeof select }) { select = options.oncomplete; }
    embed() {}
  } });
  const store: ApiStore = { id: 1, name: "매장", type: "카페", address: "기존 주소",
    addressDetail: "2층", storeCode: "T0001", phone: "010-1234-5678", businessNo: "1234567890",
    representative: "담당자", adminId: 1, adminName: null, ownerId: null, ownerLoginId: null };
  const create = vi.fn().mockResolvedValue(store), update = vi.fn().mockResolvedValue(store);
  const user = userEvent.setup();
  render(<><StoreEditor store={edit ? store : null}
    repository={{ load: vi.fn(), detail: vi.fn(), create, update }}
    onSaved={vi.fn()} onBusy={vi.fn()} formId="store" /><button form="store">저장</button></>);
  if (!edit) {
    for (const [label, value] of [["매장명", "매장"], ["업종", "카페"], ["상세 주소", "2층"],
      ["전화번호", "01012345678"], ["사업자번호", "1234567890"], ["대표자명", "담당자"]]) {
      const input = screen.getByLabelText(new RegExp("^" + label));
      await user.type(input, value);
    }
  }
  await user.click(screen.getByRole("button", { name: "주소 검색" }));
  await act(async () => select({ zonecode: "12345", address: "부산광역시 새 주소" }));
  expect(screen.getByLabelText(/^우편번호/)).toHaveValue("12345");
  expect(screen.getByLabelText(/^주소/)).toHaveValue("부산광역시 새 주소");
  expect(screen.getByLabelText(/^상세 주소/)).toHaveValue("2층");
  await user.click(screen.getByRole("button", { name: "저장" }));
  if (edit) expect(update).toHaveBeenCalledWith(1, { store_code: "12345", address: "부산광역시 새 주소" }, expect.any(AbortSignal));
  else expect(create).toHaveBeenCalledWith(expect.objectContaining({
    store_code: "12345", address: "부산광역시 새 주소", address_detail: "2층",
  }), expect.any(AbortSignal));
});

it("keeps manual entry available when loading the provider fails", async () => {
  const user = userEvent.setup();
  render(<StoreEditor store={null} repository={{ load: vi.fn(), detail: vi.fn() }}
    onSaved={vi.fn()} onBusy={vi.fn()} formId="store" />);
  await user.click(screen.getByRole("button", { name: "주소 검색" }));
  const script = document.querySelector('script[src*="postcode.v2.js"]')!;
  await act(async () => { script.dispatchEvent(new Event("error")); });
  expect(screen.getByRole("alert")).toHaveTextContent("직접 입력");
  await user.click(screen.getByRole("button", { name: "주소 검색 닫기" }));
  await user.type(screen.getByLabelText(/^우편번호/), "12345");
  expect(screen.getByLabelText(/^우편번호/)).toHaveValue("12345");
});
