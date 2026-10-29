import { useCallback, useState } from "react";
import type { Page } from "./data/models";
import {
  MockOwnerRepository,
  type OwnerRepository,
} from "./data/ownerRepository";
import { soldOutMenuCount } from "./data/selectors";
import { useAsync } from "./hooks/useAsync";
import { ErrorState, Loading } from "./components/ui";
import { OwnerShell } from "./layout/OwnerShell";
import { TodayPage } from "./features/TodayPage";
import { MenusPage } from "./features/menus/MenusPage";
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
  return (
    <OwnerShell
      page={page}
      onNavigate={setPage}
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
        />
      )}
      {page === "orders" && <OrdersPage />}
      {page === "store" && <StorePage />}
    </OwnerShell>
  );
}
