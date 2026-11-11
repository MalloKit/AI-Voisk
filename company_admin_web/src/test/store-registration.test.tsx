import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { StoreEditor } from "../features/StoreEditor";

it.each(["none", "existing", "new"] as const)("registers with the selected owner mode %s", async (mode) => {
  const create = vi.fn().mockResolvedValue({});
  const user = userEvent.setup();
  render(<><StoreEditor store={null} repository={{ load: vi.fn(), detail: vi.fn(), create }}
    ownersResult={{ loading: false, error: false, data: [{ id: 7, loginId: "existing-owner", storeCount: 1 }],
      reload: vi.fn() }}
    onSaved={vi.fn()} onBusy={vi.fn()} formId="store" /><button form="store">저장</button></>);
  for (const [label, value] of [["매장명", "매장"], ["우편번호", "12345"], ["주소", "부산"], ["업종", "카페"],
    ["전화번호", "01012345678"], ["사업자번호", "1234567890"], ["대표자명", "담당자"]]) {
    await user.type(screen.getByLabelText(new RegExp("^" + label)), value);
  }
  await user.selectOptions(screen.getByLabelText("연결 방식"), mode);
  if (mode === "existing") await user.selectOptions(screen.getByLabelText("연결할 점주"), "7");
  if (mode === "new") await user.type(screen.getByLabelText(/^새 점주 로그인 ID/), "new.owner");
  await user.click(screen.getByRole("button", { name: "저장" }));
  expect(create).toHaveBeenCalledTimes(1);
  expect(create.mock.calls[0][0].owner_connection).toEqual(mode === "existing"
    ? { kind: "existing", owner_id: 7 }
    : mode === "new" ? { kind: "new", login_id: "new.owner" } : undefined);
  expect(create.mock.calls[0][0]).not.toHaveProperty("password");
});
