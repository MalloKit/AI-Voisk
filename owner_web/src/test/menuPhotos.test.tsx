import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { MockOwnerAiRepository } from "../data/aiRepository";
import { keepSoldOut } from "../data/menuChanges";
import type { MenuBoard } from "../data/models";
import { MockOwnerRepository } from "../data/ownerRepository";

async function openMenus(ai = new MockOwnerAiRepository()) {
  const user = userEvent.setup();
  const repository = new MockOwnerRepository();
  render(<App repository={repository} aiRepository={ai} />);
  await screen.findByRole("heading", { level: 1, name: "오늘 현황" });
  await user.click(
    within(screen.getByRole("navigation", { name: "주요 화면" })).getByRole(
      "button",
      { name: /메뉴 관리/ },
    ),
  );
  return { user, ai, repository };
}
const preview = () => screen.getByRole("region", { name: "키오스크 미리보기" });
const rail = () =>
  within(preview()).getByRole("navigation", { name: "키오스크 카테고리" });
const card = (name: string) =>
  within(preview()).getByRole("button", { name: new RegExp(`^${name}`) });
const cardPhoto = (name: string) =>
  card(name).querySelector<HTMLImageElement>("img.kiosk-photo");
const bar = () => screen.getByRole("region", { name: "저장 바" });
const photoFile = () =>
  new File(["photo"], "menu.png", { type: "image/png" });

beforeEach(() => {
  // jsdom에는 객체 URL이 없다.
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

describe("메뉴 사진", () => {
  it("저장된 메뉴는 사진을 고르면 바로 올리고 미리보기 카드에 보인다", async () => {
    const { user, ai } = await openMenus();
    const upload = vi.spyOn(ai, "uploadMenuImage");
    expect(cardPhoto("제육덮밥")).toBeNull();
    await user.click(card("제육덮밥"));
    expect(screen.getByText("사진 없음")).toBeInTheDocument();
    expect(screen.getByText("(즉시 반영)", { selector: ".menu-photo-field *" })).toBeInTheDocument();

    await user.upload(screen.getByLabelText("메뉴 사진 파일"), photoFile());
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(upload.mock.calls[0][1]).toBeInstanceOf(Blob);
    await waitFor(() =>
      expect(cardPhoto("제육덮밥")?.getAttribute("src")).toMatch(/^\/media\/menu\//),
    );
    expect(screen.getByRole("img", { name: "제육덮밥 사진" })).toBeInTheDocument();
    // 사진은 즉시 저장이라 저장 바의 변경으로 세지 않는다.
    expect(bar()).toHaveTextContent("모든 변경이 저장됨");
  });

  it("사진을 지우면 서버에서 지우고 다시 분류 아이콘으로 돌아간다", async () => {
    const { user, ai } = await openMenus();
    const remove = vi.spyOn(ai, "deleteMenuImage");
    await user.click(card("제육덮밥"));
    await user.upload(screen.getByLabelText("메뉴 사진 파일"), photoFile());
    await screen.findByRole("button", { name: "사진 지우기" });

    await user.click(screen.getByRole("button", { name: "사진 지우기" }));
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("사진 없음")).toBeInTheDocument();
    expect(cardPhoto("제육덮밥")).toBeNull();
  });

  it("되돌리기를 해도 이미 올린 사진은 그대로 둔다", () => {
    const menu = {
      id: 1, categoryId: 1, name: "제육덮밥", price: 9000, description: null,
      isActive: true, isSoldOut: false, sort: 1,
    };
    const board = (imageUrl: string | null, name = "제육덮밥"): MenuBoard => ({
      categories: [], options: [], menus: [{ ...menu, name, imageUrl }],
    });
    const restored = keepSoldOut(board(null, "이전 이름"), board("/media/menu/1_a.jpg"));
    expect(restored.menus[0]).toMatchObject({ name: "이전 이름", imageUrl: "/media/menu/1_a.jpg" });
  });

  it("새 메뉴는 고른 사진을 미리 보여 주고, 저장으로 번호가 생기면 그 메뉴에 올린다", async () => {
    const { user, ai, repository } = await openMenus();
    const upload = vi.spyOn(ai, "uploadMenuImage");
    await user.click(within(rail()).getByRole("button", { name: "분식" }));
    await user.click(screen.getByRole("button", { name: "새 메뉴" }));
    await user.type(screen.getByLabelText("메뉴 이름"), "김밥");
    await user.type(screen.getByLabelText("가격(원)"), "4000");
    expect(screen.getByText("(저장할 때 함께 올림)")).toBeInTheDocument();

    await user.upload(screen.getByLabelText("메뉴 사진 파일"), photoFile());
    await waitFor(() => expect(cardPhoto("김밥")?.getAttribute("src")).toBe("blob:preview"));
    expect(upload).not.toHaveBeenCalled();

    await user.click(within(bar()).getByRole("button", { name: /^저장/ }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "저장" }),
    );
    await within(bar()).findByText("모든 변경이 저장됨");
    const saved = (await repository.getMenuBoard()).menus.find((m) => m.name === "김밥")!;
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(upload.mock.calls[0][0]).toBe(saved.id);
    await waitFor(() =>
      expect(cardPhoto("김밥")?.getAttribute("src")).toBe(
        `/media/menu/${saved.id}_${"1".padStart(16, "0")}.jpg`,
      ),
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });

  it("메뉴는 저장했지만 사진을 못 올리면 저장 바에 다시 올리라고 안내한다", async () => {
    const { user, ai } = await openMenus();
    vi.spyOn(ai, "uploadMenuImage").mockRejectedValue(new Error("network"));
    await user.click(within(rail()).getByRole("button", { name: "분식" }));
    await user.click(screen.getByRole("button", { name: "새 메뉴" }));
    await user.type(screen.getByLabelText("메뉴 이름"), "김밥");
    await user.type(screen.getByLabelText("가격(원)"), "4000");
    await user.upload(screen.getByLabelText("메뉴 사진 파일"), photoFile());
    await waitFor(() => expect(cardPhoto("김밥")).not.toBeNull());

    await user.click(within(bar()).getByRole("button", { name: /^저장/ }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "저장" }),
    );
    expect(
      await within(bar()).findByText(/메뉴는 저장했지만 사진 1장을 올리지 못했습니다/),
    ).toBeInTheDocument();
  });

  it("지원하지 않는 형식은 올리지 않고 편집 폼에 이유를 보인다", async () => {
    const { user, ai } = await openMenus();
    const upload = vi.spyOn(ai, "uploadMenuImage");
    await user.click(card("제육덮밥"));
    // accept 속성은 파일 선택 창에서만 거른다. 끌어 놓기 등으로 들어온 파일을 흉내 낸다.
    fireEvent.change(screen.getByLabelText("메뉴 사진 파일"), {
      target: { files: [new File(["gif"], "a.gif", { type: "image/gif" })] },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "JPG, PNG, WEBP 사진만 올릴 수 있습니다.",
    );
    expect(upload).not.toHaveBeenCalled();
  });
});
