import { MousePointerClick } from "lucide-react";

export function MenuGuide() {
  return (
    <section className="editor guide" aria-labelledby="menu-guide-title">
      <MousePointerClick className="guide-icon" size={32} aria-hidden="true" />
      <h2 id="menu-guide-title">메뉴를 선택해 주세요</h2>
      <ol>
        <li>
          오른쪽 키오스크 미리보기에서 메뉴 카드를 누르면 여기에 편집 폼이
          열립니다.
        </li>
        <li>
          카드를 끌어 다른 카드 앞뒤에 놓으면 순서가, 카테고리 위에 놓으면
          카테고리가 바뀝니다. 카테고리끼리도 끌어서 순서를 바꿉니다.
        </li>
        <li>
          키보드: 카드에서 Space로 집고 화살표로 옮긴 뒤 Space로 놓습니다.
        </li>
        <li>카드를 아래 '숨긴 메뉴' 상자에 넣으면 판매를 멈춥니다.</li>
        <li>
          위의 '＋ 새 메뉴'를 누르거나 원하는 자리에 끌어 놓아 메뉴를
          추가합니다.
        </li>
        <li>
          변경은 아래 저장 바에서 한 번에 저장합니다. 품절만 누르는 즉시
          키오스크에 반영됩니다.
        </li>
      </ol>
    </section>
  );
}
