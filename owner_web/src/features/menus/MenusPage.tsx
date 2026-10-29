import { useEffect, useRef, useState, type RefObject } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
} from "@dnd-kit/core";
import type { MenuBoard } from "../../data/models";
import type { OwnerRepository } from "../../data/ownerRepository";
import {
  addCategory,
  addMenu,
  kioskView,
  menusInCategory,
  removeCategory,
  renameCategory,
  type Side,
} from "../../data/menuDraft";
import { findProblem, type Problem } from "../../data/menuChanges";
import { Card, Heading, Modal } from "../../components/ui";
import { useMenuDraft } from "./useMenuDraft";
import { KioskPreview, type DropMark } from "./KioskPreview";
import { MenuEditor, type FocusRequest } from "./MenuEditor";
import { CategoryEditor } from "./CategoryEditor";
import { MenuGuide } from "./MenuGuide";
import { HiddenMenus } from "./HiddenMenus";
import { NewMenuChip } from "./NewMenuChip";
import { SaveBar } from "./SaveBar";
import {
  announcements,
  collisionDetection,
  keyboardCoordinates,
  resolveDrop,
  screenReaderInstructions,
  type CategoryFilter,
  type DragData,
  type DropData,
} from "./dnd";

type Selection =
  { kind: "menu"; id: number } | { kind: "category"; id: number } | null;

// App이 사이드바 이동 전에 저장 안 된 변경을 확인할 때 쓴다.
export interface MenusGuard {
  changeCount: number;
  saveNow(): Promise<boolean>;
  discard(): void;
}

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

function sideOf(event: DragMoveEvent | DragEndEvent): Side {
  const a = event.active.rect.current.translated;
  const o = event.over?.rect;
  if (!a || !o) return "before";
  // 카테고리 레일은 세로, 메뉴 카드는 가로로 앞뒤를 판단한다.
  return event.over?.data.current?.type === "category"
    ? a.top + a.height / 2 > o.top + o.height / 2
      ? "after"
      : "before"
    : a.left + a.width / 2 > o.left + o.width / 2
      ? "after"
      : "before";
}

export function MenusPage({
  repository,
  storeId,
  board,
  onBoardChange,
  guard,
}: {
  repository: OwnerRepository;
  storeId: number;
  board: MenuBoard;
  onBoardChange(update: (board: MenuBoard) => MenuBoard): void;
  guard?: RefObject<MenusGuard | null>;
}) {
  const draft = useMenuDraft({
    saved: board,
    repository,
    onSavedChange: onBoardChange,
  });
  const [selection, setSelection] = useState<Selection>(null);
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(
    null,
  );
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [dragging, setDragging] = useState<DragData | null>(null);
  const [mark, setMark] = useState<DropMark | null>(null);

  // 되돌리기로 사라진 카테고리를 보고 있었다면 전체로 돌아간다.
  const view: CategoryFilter =
    category === "all" || draft.draft.categories.some((c) => c.id === category)
      ? category
      : "all";
  const menu =
    selection?.kind === "menu"
      ? draft.draft.menus.find((m) => m.id === selection.id)
      : undefined;
  const selectedCategory =
    selection?.kind === "category"
      ? draft.draft.categories.find((c) => c.id === selection.id)
      : undefined;
  const firstCategory = kioskView(draft.draft).categories[0];

  // 편집하면 지난 저장 안내는 지운다.
  useEffect(() => setMessage(null), [draft.draft]);

  function requestFocus(id: number, field: FocusRequest["field"]) {
    setFocus((f) => ({ id, field, serial: (f?.serial ?? 0) + 1 }));
  }
  function showAll() {
    setCategory("all");
    setSelection(null);
  }
  function selectCategory(next: CategoryFilter) {
    setCategory(next);
    setSelection(next === "all" ? null : { kind: "category", id: next });
  }
  function selectMenu(id: number) {
    setSelection({ kind: "menu", id });
  }
  function createMenu() {
    const categoryId = view === "all" ? firstCategory?.id : view;
    if (categoryId === undefined) return;
    const { board: next, id } = addMenu(draft.draft, { categoryId });
    draft.edit(() => next);
    selectMenu(id);
    requestFocus(id, "name");
  }
  function startCategory() {
    const { board: next, id } = addCategory(draft.draft, storeId);
    draft.edit(() => next);
    setEditingCategoryId(id);
    selectCategory(id);
  }
  // 이름 없이 끝낸 새 카테고리는 만들지 않은 것으로 본다.
  function finishCategory(id: number) {
    setEditingCategoryId(null);
    const target = draft.draft.categories.find((c) => c.id === id);
    if (
      id < 0 &&
      target &&
      !target.name.trim() &&
      !menusInCategory(draft.draft, id).length
    ) {
      draft.edit((b) => removeCategory(b, id));
      showAll();
    }
  }

  // 저장을 막는 항목을 선택하고 그 입력칸으로 보낸다.
  function showProblem(problem: Problem) {
    if (problem.kind === "category") {
      selectCategory(problem.id);
      requestFocus(problem.id, "name");
    } else {
      const target = draft.draft.menus.find((m) => m.id === problem.id)!;
      if (view !== "all" && target.isActive) setCategory(target.categoryId);
      selectMenu(problem.id);
      requestFocus(problem.id, problem.field);
    }
    setMessage(problem.message);
  }
  function blocked() {
    const problem = findProblem(draft.draft);
    if (problem) showProblem(problem);
    return !!problem;
  }
  async function commit() {
    try {
      const { ids } = await draft.save();
      // 새로 만든 항목은 실제 id로 바뀐다.
      setSelection((s) =>
        s && s.id < 0 && ids[s.id] ? { ...s, id: ids[s.id] } : s,
      );
      setCategory((c) =>
        typeof c === "number" && c < 0 && ids[c] ? ids[c] : c,
      );
      return true;
    } catch {
      setMessage(
        "저장하지 못했습니다. 변경 내용은 그대로 남아 있으니 다시 시도해 주세요.",
      );
      return false;
    }
  }

  // 사이드바 이동 확인창에서 쓰는 저장·버리기
  useEffect(() => {
    if (!guard) return;
    guard.current = {
      changeCount: draft.changes.length,
      saveNow: async () => !blocked() && commit(),
      discard: draft.discard,
    };
  });
  useEffect(
    () => () => {
      if (guard) guard.current = null;
    },
    [guard],
  );

  // 새로고침·탭 닫기 경고
  useEffect(() => {
    if (!draft.isDirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft.isDirty]);

  // Ctrl+Z(⌘+Z) 되돌리기. 입력칸 안에서는 브라우저 기본 되돌리기를 쓴다.
  const undo = useRef(draft.undo);
  undo.current = draft.undo;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== "z" || isEditable(e.target)) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      undo.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 작은 움직임은 클릭, 그 이상 움직이면 드래그. 터치는 잠깐 누르고 있어야 드래그라 스크롤과 겹치지 않는다.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: keyboardCoordinates,
      keyboardCodes: {
        start: ["Space"],
        cancel: ["Escape"],
        end: ["Space", "Enter"],
      },
    }),
  );
  function updateMark(event: DragMoveEvent) {
    const over = event.over;
    const drop = over?.data.current as DropData | undefined;
    const drag = event.active.data.current as DragData;
    if (!over || !drop || drop.type === "hidden" || drop.type === "grid") {
      setMark(null);
      return;
    }
    const mode =
      drop.type === "category" && drag.type !== "category"
        ? "into"
        : sideOf(event);
    setMark((m) =>
      m?.id === over.id && m.mode === mode ? m : { id: String(over.id), mode },
    );
  }
  function drop(event: DragEndEvent) {
    setDragging(null);
    setMark(null);
    const target = event.over?.data.current as DropData | undefined;
    if (!target) return;
    const result = resolveDrop(
      draft.draft,
      event.active.data.current as DragData,
      target,
      sideOf(event),
      view,
    );
    if (!result) return;
    draft.edit(() => result.board);
    if (result.view !== undefined) setCategory(result.view);
    if (result.select !== undefined) {
      selectMenu(result.select);
      requestFocus(result.select, "name");
    }
  }

  return (
    <div className="menus-page">
      <Heading title="메뉴 관리">
        키오스크 미리보기에서 메뉴를 눌러 편집하고, 끌어서 배치합니다. 변경은
        아래 저장 바에서 한 번에 저장합니다.
      </Heading>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        accessibility={{ announcements, screenReaderInstructions }}
        onDragStart={(e) => setDragging(e.active.data.current as DragData)}
        onDragMove={updateMark}
        onDragOver={updateMark}
        onDragEnd={drop}
        onDragCancel={() => {
          setDragging(null);
          setMark(null);
        }}
      >
        <div className="menus-layout">
          <div className="menus-side">
            <NewMenuChip disabled={!firstCategory} onCreate={createMenu} />
            <Card className="menus-panel">
              {menu ? (
                <MenuEditor
                  key={menu.id}
                  menu={menu}
                  draft={draft}
                  focus={focus}
                  onClose={() => setSelection(null)}
                  onCategoryChange={(id) => {
                    if (view !== "all") setCategory(id);
                  }}
                />
              ) : selectedCategory ? (
                <CategoryEditor
                  key={selectedCategory.id}
                  category={selectedCategory}
                  draft={draft}
                  focusSerial={
                    focus?.id === selectedCategory.id ? focus.serial : null
                  }
                  onClose={() => setSelection(null)}
                  onDeleted={showAll}
                  onSelectMenu={selectMenu}
                />
              ) : (
                <MenuGuide />
              )}
            </Card>
            <HiddenMenus
              board={draft.draft}
              changedMenuIds={draft.changedMenuIds}
              onSelectMenu={selectMenu}
            />
          </div>
          <KioskPreview
            board={draft.draft}
            category={view}
            selectedMenuId={menu?.id ?? null}
            editingCategoryId={editingCategoryId}
            changedMenuIds={draft.changedMenuIds}
            mark={mark}
            onSelectCategory={selectCategory}
            onSelectMenu={selectMenu}
            onAddCategory={startCategory}
            onRenameCategory={(id, name) =>
              draft.edit(
                (b) => renameCategory(b, id, name),
                `category-${id}-name`,
              )
            }
            onFinishCategory={finishCategory}
          />
        </div>
        <DragOverlay dropAnimation={null}>
          {dragging && <div className="drag-chip">{dragging.label}</div>}
        </DragOverlay>
      </DndContext>
      <SaveBar
        count={draft.changes.length}
        canUndo={draft.canUndo}
        saving={draft.saving}
        message={message}
        onUndo={draft.undo}
        onDiscard={() => {
          draft.discard();
          setEditingCategoryId(null);
        }}
        onSave={() => {
          if (!blocked()) setConfirming(true);
        }}
      />
      {confirming && (
        <Modal
          title="변경 내용 저장"
          onClose={() => setConfirming(false)}
          actions={
            <>
              <button onClick={() => setConfirming(false)}>취소</button>
              <button
                className="primary"
                onClick={() => {
                  setConfirming(false);
                  void commit();
                }}
              >
                저장
              </button>
            </>
          }
        >
          <p>
            아래 {draft.changes.length}건을 저장합니다. 저장하면 키오스크에 바로
            반영됩니다.
          </p>
          <ul className="change-list" aria-label="저장할 변경">
            {draft.changes.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </Modal>
      )}
    </div>
  );
}
