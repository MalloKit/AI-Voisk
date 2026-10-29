import { MousePointerClick } from "lucide-react";
import type { MenuBoard } from "../../data/models";
import { Badge } from "../../components/ui";

export function MenuGuide({
  board,
  onSelectMenu,
}: {
  board: MenuBoard;
  onSelectMenu(id: number): void;
}) {
  const stopped = board.menus.filter((m) => !m.isActive);
  return (
    <section className="editor guide" aria-labelledby="menu-guide-title">
      <MousePointerClick className="guide-icon" size={32} aria-hidden="true" />
      <h2 id="menu-guide-title">메뉴를 선택해 주세요</h2>
      <ol>
        <li>
          오른쪽 키오스크 미리보기에서 메뉴 카드를 누르면 여기에 편집 폼이
          열립니다.
        </li>
        <li>이름·가격을 고치면 미리보기 카드가 바로 바뀝니다.</li>
        <li>
          미리보기의 카테고리를 누르면 이름을 바꾸거나 삭제할 수 있습니다.
        </li>
        <li>카테고리 목록 아래의 점선 ＋ 버튼으로 새 카테고리를 만듭니다.</li>
        <li>품절은 누르는 즉시 키오스크에 반영됩니다.</li>
      </ol>
      <section className="editor-section" aria-label="판매 중지 메뉴">
        <h3>판매 중지 메뉴 {stopped.length}개</h3>
        {stopped.length ? (
          <ul className="menu-links">
            {stopped.map((m) => (
              <li key={m.id}>
                <button onClick={() => onSelectMenu(m.id)}>
                  {m.name || "(이름 없음)"}
                </button>
                <Badge>판매 중지</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            판매 중지된 메뉴가 없습니다. 판매 중지 메뉴는 키오스크에 보이지 않아
            이 목록에서 다시 열 수 있습니다.
          </p>
        )}
      </section>
    </section>
  );
}
