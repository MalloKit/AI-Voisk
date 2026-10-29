import { useCallback, useRef, useState } from "react";
import type { Page } from "./data/models";
import {
  MockOwnerRepository,
  type OwnerRepository,
} from "./data/ownerRepository";
import { soldOutMenuCount } from "./data/selectors";
import { useAsync } from "./hooks/useAsync";
import { ErrorState, Loading, Modal } from "./components/ui";
import { OwnerShell } from "./layout/OwnerShell";
import { TodayPage } from "./features/TodayPage";
import { MenusPage, type MenusGuard } from "./features/menus/MenusPage";
import { OrdersPage } from "./features/OrdersPage";
import { StorePage } from "./features/StorePage";

// 실제 API 구현체가 생기면 이 한 줄만 바꾼다.
const defaultRepository = new MockOwnerRepository();
export function App({
  repository = defaultRepository,
}: {
  repository?: OwnerRepository;
}) {
  const [page, setPage] = useState<Page>("today");
  // 메뉴 관리에 저장 안 된 변경이 있으면 이동 전에 확인한다.
  const menusGuard = useRef<MenusGuard | null>(null);
  const [leavingTo, setLeavingTo] = useState<Page | null>(null);
  const [leaving, setLeaving] = useState(false);
  const load = useCallback(
    async (signal: AbortSignal) => {
      const [profile, board] = await Promise.all([
        repository.getStoreProfile(signal),
        repository.getMenuBoard(signal),
      ]);
      return { profile, board };
    },
    [repository],
  );
  const result = useAsync(load);
  if (result.loading)
    return (
      <div className="app-state">
        <Loading />
      </div>
    );
  if (result.error || !result.data)
    return (
      <div className="app-state">
        <ErrorState
          message="매장 정보를 불러오지 못했습니다."
          onRetry={result.reload}
        />
      </div>
    );
  const { profile, board } = result.data;
  function navigate(next: Page) {
    if (next === page) return;
    if (menusGuard.current?.changeCount) setLeavingTo(next);
    else setPage(next);
  }
  async function leave(save: boolean) {
    const next = leavingTo!;
    if (save) {
      setLeaving(true);
      const saved = await menusGuard.current!.saveNow();
      setLeaving(false);
      setLeavingTo(null);
      if (!saved) return; // 저장 바의 안내를 보도록 메뉴 관리에 남는다.
    } else {
      menusGuard.current?.discard();
      setLeavingTo(null);
    }
    setPage(next);
  }
  return (
    <>
      <OwnerShell
        page={page}
        onNavigate={navigate}
        storeName={profile.store.name}
        soldOutCount={soldOutMenuCount(board)}
      >
        {page === "today" && <TodayPage />}
        {page === "menus" && (
          <MenusPage
            repository={repository}
            storeId={profile.store.id}
            board={board}
            onBoardChange={(update) =>
              result.setData((d) => d && { ...d, board: update(d.board) })
            }
            guard={menusGuard}
          />
        )}
        {page === "orders" && <OrdersPage />}
        {page === "store" && <StorePage />}
      </OwnerShell>
      {leavingTo && (
        <Modal
          title="저장하지 않은 변경이 있습니다"
          onClose={() => setLeavingTo(null)}
          actions={
            <>
              <button disabled={leaving} onClick={() => setLeavingTo(null)}>
                계속 편집
              </button>
              <button disabled={leaving} onClick={() => void leave(false)}>
                버리고 이동
              </button>
              <button
                className="primary"
                disabled={leaving}
                onClick={() => void leave(true)}
              >
                저장하고 이동
              </button>
            </>
          }
        >
          <p>
            메뉴 관리에 저장 안 된 변경 {menusGuard.current?.changeCount ?? 0}
            건이 있습니다. 품절은 이미 반영되어 있어 버려도 그대로입니다.
          </p>
        </Modal>
      )}
    </>
  );
}
