import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { StoreEditor } from "../features/StoreEditor";
import type { ApiStore } from "../data/models";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockPopup() {
  const popup = { closed: false, close: vi.fn(), focus: vi.fn() };
  popup.close.mockImplementation(() => { popup.closed = true; });
  const open = vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
  return { popup, open };
}

function popupMessage(popup: ReturnType<typeof mockPopup>["popup"], data: object, origin = window.location.origin) {
  window.dispatchEvent(new MessageEvent("message", { origin, source: popup as unknown as Window, data }));
}

it.each([false, true])("fills postal fields and saves via the existing contract (edit=%s)", async (edit) => {
  const { popup, open } = mockPopup();
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
  const addressButton = screen.getByRole("button", { name: "주소 검색" });
  await user.click(addressButton);
  expect(open).toHaveBeenCalledExactlyOnceWith(
    new URL("/postcode-popup.html", window.location.href), "_blank", expect.stringContaining("popup"),
  );
  await user.click(addressButton);
  expect(open).toHaveBeenCalledTimes(1);
  expect(popup.focus).toHaveBeenCalledOnce();
  const data = { type: "voisk:postcode-selected", zonecode: "12345", address: "부산광역시 새 주소" };
  act(() => {
    popupMessage(popup, data, "https://other.example");
    popupMessage({ ...popup }, data);
  });
  expect(screen.getByLabelText(/^우편번호/)).toHaveValue(edit ? "T0001" : "");
  act(() => popupMessage(popup, data));
  expect(popup.close).toHaveBeenCalledOnce();
  expect(addressButton).toHaveFocus();
  expect(screen.getByLabelText(/^우편번호/)).toHaveValue("12345");
  expect(screen.getByLabelText(/^주소/)).toHaveValue("부산광역시 새 주소");
  expect(screen.getByLabelText(/^상세 주소/)).toHaveValue("2층");
  await user.click(screen.getByRole("button", { name: "저장" }));
  if (edit) expect(update).toHaveBeenCalledWith(1, { store_code: "12345", address: "부산광역시 새 주소" }, expect.any(AbortSignal));
  else expect(create).toHaveBeenCalledWith(expect.objectContaining({
    store_code: "12345", address: "부산광역시 새 주소", address_detail: "2층",
  }), expect.any(AbortSignal));
});

function renderEditor() {
  return render(<StoreEditor store={null} repository={{ load: vi.fn(), detail: vi.fn() }}
    onSaved={vi.fn()} onBusy={vi.fn()} formId="store" />);
}

it.each([
  ["blocked", "팝업이 차단됐습니다"],
  ["load failure", "불러오지 못했습니다"],
  ["closed", "창이 닫혔습니다"],
])("allows manual entry when the popup is %s", async (scenario, expectedError) => {
  const { popup, open } = mockPopup();
  if (scenario === "blocked") open.mockReturnValue(null);
  const user = userEvent.setup();
  renderEditor();
  await user.click(screen.getByRole("button", { name: "주소 검색" }));
  if (scenario === "load failure") act(() => popupMessage(popup, { type: "voisk:postcode-error" }));
  if (scenario === "closed") popup.closed = true;
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(expectedError);
  expect(alert).toHaveTextContent("직접 입력");
  await user.type(screen.getByLabelText(/^우편번호/), "12345");
  await user.type(screen.getByLabelText(/^주소/), "직접 입력 주소");
  expect(screen.getByLabelText(/^우편번호/)).toHaveValue("12345");
  expect(screen.getByLabelText(/^주소/)).toHaveValue("직접 입력 주소");
});

it("closes an open popup when the editor is dismissed", async () => {
  const { popup } = mockPopup();
  const user = userEvent.setup();
  const editor = renderEditor();
  await user.click(screen.getByRole("button", { name: "주소 검색" }));
  editor.unmount();
  expect(popup.close).toHaveBeenCalledOnce();
});

it.each(["complete", "error"])("loads the official SDK in the popup and reports %s", async (outcome) => {
  vi.resetModules();
  const postMessage = vi.fn();
  vi.stubGlobal("opener", { closed: false, postMessage });
  const status = document.createElement("p");
  status.id = "postcode-status";
  const target = document.createElement("div");
  target.id = "postcode-search";
  document.body.append(status, target);
  await import("../postcodePopup");
  const script = document.querySelector<HTMLScriptElement>('script[src$="postcode.v2.js"]')!;
  try {
    expect(script.src).toBe("https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js");
    if (outcome === "error") {
      script.dispatchEvent(new Event("error"));
      expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: "voisk:postcode-error" }, window.location.origin);
      return;
    }
    const address = { zonecode: "12345", address: "새 주소" };
    const embed = vi.fn();
    let select!: (data: typeof address) => void;
    vi.stubGlobal("kakao", { Postcode: class {
      constructor(options: { oncomplete: typeof select }) { select = options.oncomplete; }
      embed = embed;
    } });
    script.dispatchEvent(new Event("load"));
    expect(embed).toHaveBeenCalledExactlyOnceWith(target);
    expect(postMessage).toHaveBeenCalledWith({ type: "voisk:postcode-ready" }, window.location.origin);
    select(address);
    expect(postMessage).toHaveBeenCalledWith(
      { type: "voisk:postcode-selected", ...address }, window.location.origin,
    );
  } finally {
    script.remove();
    status.remove();
    target.remove();
  }
});
