import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import {
  MockOwnerRepository,
  type OwnerRepository,
} from "../data/ownerRepository";

async function open(repository: OwnerRepository = new MockOwnerRepository()) {
  const user = userEvent.setup();
  render(<App repository={repository} />);
  await screen.findByRole("heading", { level: 1, name: "오늘 현황" });
  return user;
}
const nav = () => screen.getByRole("navigation", { name: "주요 화면" });

describe("점주 웹 레이아웃", () => {
  it("매장 이름, 메뉴 4개, 시연 데이터 표시를 보여 준다", async () => {
    await open();
    expect(screen.getByText("점주 · 보이스크 테스트 매장")).toBeInTheDocument();
    expect(
      within(nav())
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["오늘 현황", "메뉴 관리1", "주문 내역", "매장 정보"]);
    expect(screen.getByText("시연 데이터")).toBeInTheDocument();
    expect(
      within(nav()).getByRole("button", { current: "page" }),
    ).toHaveTextContent("오늘 현황");
  });

  it("메뉴 관리 옆에 판매 중인 품절 메뉴 개수를 보여 준다", async () => {
    await open();
    expect(within(nav()).getByLabelText("품절 1개")).toHaveTextContent("1");
  });

  it("품절 메뉴가 없으면 개수 배지를 숨긴다", async () => {
    const repository = new MockOwnerRepository();
    const board = await repository.getMenuBoard();
    for (const m of board.menus) m.isSoldOut = false;
    vi.spyOn(repository, "getMenuBoard").mockResolvedValue(board);
    await open(repository);
    expect(within(nav()).queryByLabelText(/품절/)).toBeNull();
  });

  it("메뉴를 누르면 화면과 상단 제목이 바뀐다", async () => {
    const user = await open();
    for (const name of ["메뉴 관리", "주문 내역", "매장 정보", "오늘 현황"]) {
      await user.click(
        within(nav()).getByRole("button", { name: new RegExp(name) }),
      );
      expect(
        screen.getByRole("heading", { level: 1, name }),
      ).toBeInTheDocument();
      expect(document.querySelector(".topbar strong")).toHaveTextContent(name);
    }
  });

  it("좁은 화면용 메뉴를 열고 Escape로 닫으면 초점이 열기 버튼으로 돌아간다", async () => {
    const user = await open();
    const toggle = screen.getByRole("button", { name: "메뉴 열기" });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      within(nav()).getByRole("button", { current: "page" }),
    ).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
  });

  it("불러오기에 실패하면 오류와 다시 시도를 보여 준다", async () => {
    const repository = new MockOwnerRepository();
    const spy = vi
      .spyOn(repository, "getStoreProfile")
      .mockRejectedValueOnce(new Error("실패"));
    const user = userEvent.setup();
    render(<App repository={repository} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "매장 정보를 불러오지 못했습니다.",
    );
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    await screen.findByRole("heading", { level: 1, name: "오늘 현황" });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
