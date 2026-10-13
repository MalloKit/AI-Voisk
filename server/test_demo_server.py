"""명시적으로 실행할 때만 메모리 DB를 쓰는 로컬 연동 검증 서버. Azure 연결은 차단됩니다."""
from asyncio import Lock
import uvicorn
from main import app
import test_orders


if __name__ == '__main__':
    fixture = test_orders.OrderApiTests()
    fixture.setUp()
    # Shared SQLite connection: serialize HTTP tests. Production uses independent MySQL connections.
    lock = Lock()

    @app.middleware('http')
    async def serialize_test_request(request, call_next):
        async with lock:
            return await call_next(request)

    @app.get('/test/fixture-health')
    def fixture_health():
        return {'dataSource': 'isolated-memory', 'liveDatabaseBlocked': True}

    try:
        uvicorn.run(app, host='127.0.0.1', port=18001, access_log=False)
    finally:
        fixture.tearDown()
