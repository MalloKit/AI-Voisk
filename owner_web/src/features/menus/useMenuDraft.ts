import { useState } from "react";
import type { MenuBoard } from "../../data/models";
import type { OwnerRepository } from "../../data/ownerRepository";
import { updateMenu, updateOption } from "../../data/menuDraft";

type BoardUpdate = (board: MenuBoard) => MenuBoard;

// saved는 repository에 반영된 상태(App이 가진 값), draft는 화면에서 고치는 중인 상태다.
// 품절만 즉시 repository에 반영하고 나머지 편집은 draft에만 남는다.
export function useMenuDraft({
  saved,
  repository,
  onSavedChange,
}: {
  saved: MenuBoard;
  repository: OwnerRepository;
  onSavedChange(update: BoardUpdate): void;
}) {
  const [draft, setDraft] = useState(saved);
  const [pending, setPending] = useState<string[]>([]);
  const [soldOutError, setSoldOutError] = useState<string | null>(null);

  async function immediate(
    key: string,
    save: () => Promise<void>,
    update: BoardUpdate,
  ) {
    setPending((p) => [...p, key]);
    setSoldOutError(null);
    try {
      await save();
      onSavedChange(update);
      setDraft(update);
    } catch {
      setSoldOutError("품절 상태를 바꾸지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setPending((p) => p.filter((k) => k !== key));
    }
  }

  return {
    draft,
    edit: (update: BoardUpdate) => setDraft(update),
    soldOutError,
    isPending: (key: string) => pending.includes(key),
    setMenuSoldOut: (id: number, isSoldOut: boolean) =>
      immediate(
        `menu-${id}`,
        () => repository.setMenuSoldOut(id, isSoldOut),
        (b) => updateMenu(b, id, { isSoldOut }),
      ),
    // 아직 저장하지 않은 새 옵션(음수 id)은 repository에 없으므로 초안에만 둔다.
    setOptionSoldOut: (id: number, isSoldOut: boolean) =>
      id < 0
        ? setDraft((b) => updateOption(b, id, { isSoldOut }))
        : immediate(
            `option-${id}`,
            () => repository.setOptionSoldOut(id, isSoldOut),
            (b) => updateOption(b, id, { isSoldOut }),
          ),
  };
}
export type MenuDraft = ReturnType<typeof useMenuDraft>;
