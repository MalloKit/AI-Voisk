"""메뉴 변경 실시간 알림. 같은 프로세스의 WebSocket 연결에만 알리며 worker 1개 실행을 전제로 합니다.

알림을 놓쳐도 키오스크가 30초마다 메뉴 버전을 확인하므로 반영은 늦어질 뿐 빠지지 않습니다.
"""
import asyncio
import threading


class SyncHub:
    def __init__(self):
        self._lock = threading.Lock()
        self._loop = None
        self._subscribers = {}

    async def register(self, store_id, websocket):
        self._loop = asyncio.get_running_loop()
        with self._lock:
            self._subscribers.setdefault(store_id, set()).add(websocket)

    def unregister(self, store_id, websocket):
        with self._lock:
            sockets = self._subscribers.get(store_id)
            if sockets is not None:
                sockets.discard(websocket)
                if not sockets:
                    del self._subscribers[store_id]

    def count(self, store_id):
        with self._lock:
            return len(self._subscribers.get(store_id, ()))

    async def _broadcast(self, store_id, message):
        with self._lock:
            sockets = list(self._subscribers.get(store_id, ()))
        for websocket in sockets:
            try:
                await websocket.send_json(message)
            except Exception:
                self.unregister(store_id, websocket)

    def notify(self, store_id, version):
        """동기 엔드포인트(스레드풀)에서도 안전하게 호출할 수 있습니다. 실패해도 저장 결과에는 영향이 없습니다."""
        loop = self._loop
        if loop is None or loop.is_closed() or not self.count(store_id):
            return
        message = {'type': 'menu_changed', 'menu_version': version}
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is loop:
            loop.create_task(self._broadcast(store_id, message))
        else:
            asyncio.run_coroutine_threadsafe(self._broadcast(store_id, message), loop)


hub = SyncHub()


def menu_changed(store_id):
    """저장이 커밋된 뒤 호출합니다. 캐시를 비우고 연결된 키오스크에 새 버전을 알립니다."""
    import ai_db
    import kiosk_catalog
    kiosk_catalog.cache.invalidate(store_id)
    try:
        with ai_db.read_cursor() as cursor:
            version = kiosk_catalog.menu_version(cursor, store_id)
    except Exception:
        return
    hub.notify(store_id, version)
