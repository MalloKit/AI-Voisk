import { useRef, useState } from "react";
import type { MenuBoard, MenuBoardSaveResult } from "../../data/models";
import type { OwnerRepository } from "../../data/ownerRepository";
import { updateMenu, updateOption } from "../../data/menuDraft";
import {
  buildChanges,
  changedMenuIds,
  describeChanges,
  keepSoldOut,
} from "../../data/menuChanges";

type BoardUpdate = (board: MenuBoard) => MenuBoard;
const HISTORY_LIMIT = 100;

// saved는 repository에 저장된 상태(App이 가진 값), draft는 화면에서 고치는 중인 상태다.
// 품절만 즉시 저장하고, 나머지 편집은 draft에 모았다가 saveMenuBoard로 한 번에 저장한다.
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
  // 되돌리기용 이전 초안. 같은 입력칸을 이어서 고치면 한 번으로 묶는다.
  const [history, setHistory] = useState<MenuBoard[]>([]);
  const lastKey = useRef<string | null>(null);
  const [pending, setPending] = useState<string[]>([]);
  const [soldOutError, setSoldOutError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function edit(update: BoardUpdate, key?: string) {
    const next = update(draft);
    if (next === draft) return;
    if (!key || key !== lastKey.current)
      setHistory((h) => [...h, draft].slice(-HISTORY_LIMIT));
    lastKey.current = key ?? null;
    setDraft(next);
  }
  function undo() {
    const previous = history.at(-1);
    if (!previous) return;
    setHistory((h) => h.slice(0, -1));
    lastKey.current = null;
    setDraft(keepSoldOut(previous, draft));
  }
  function reset(board: MenuBoard) {
    setHistory([]);
    lastKey.current = null;
    setDraft(board);
  }

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

  const changes = describeChanges(saved, draft);
  return {
    draft,
    saved,
    edit,
    undo,
    canUndo: history.length > 0,
    changes,
    isDirty: changes.length > 0,
    changedMenuIds: changedMenuIds(saved, draft),
    saving,
    // 변경 취소: 마지막 저장 상태로. saved에는 즉시 반영한 품절이 이미 들어 있다.
    discard: () => reset(saved),
    // 저장에 실패하면 예외를 그대로 넘기고 초안은 그대로 둔다.
    async save(): Promise<MenuBoardSaveResult> {
      setSaving(true);
      try {
        const result = await repository.saveMenuBoard(
          buildChanges(saved, draft),
        );
        onSavedChange(() => result.board);
        reset(result.board);
        return result;
      } finally {
        setSaving(false);
      }
    },
    soldOutError,
    isPending: (key: string) => pending.includes(key),
    setMenuSoldOut: (id: number, isSoldOut: boolean) =>
      id < 0
        ? setDraft((b) => updateMenu(b, id, { isSoldOut }))
        : immediate(
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
