"""로컬 시연용 메뉴 및 주문 API. 주문 저장·회사 관리자 조회는 실제 DB를 사용합니다."""

import json
from pathlib import Path

from fastapi import FastAPI, HTTPException, Path as ApiPath
from pydantic import BaseModel, Field
from fastapi import Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from order_service import OrderInput, save_order, list_orders, order_detail


class MenuOption(BaseModel):
    id: str
    name: str
    price: int = Field(ge=0)
    isSoldOut: bool = False


class Menu(BaseModel):
    id: str
    name: str
    category: str
    price: int = Field(ge=0)
    description: str
    isSoldOut: bool = False
    options: list[MenuOption] = Field(default_factory=list)


app = FastAPI(title="AI 보이스크 · 연습용 메뉴 API", version="0.1.0")
app.add_middleware(CORSMiddleware,
    allow_origins=['http://localhost:8080', 'http://127.0.0.1:8080'],
    allow_methods=['GET', 'POST'], allow_headers=['Content-Type'])


@app.middleware('http')
async def local_demo_only(request: Request, call_next):
    if (request.url.path.startswith('/admin/') or request.url.path == '/orders') and (
        request.client is None or request.client.host not in {'127.0.0.1', '::1', 'testclient'}
    ):
        return JSONResponse(status_code=403, content={'detail': '인증 전에는 로컬 시연만 허용합니다.'})
    return await call_next(request)


def _order_call(function, *args):
    try:
        return function(*args)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, '주문 처리 실패. 동일 주문으로 다시 시도해 주세요.') from None


@app.post('/orders')
def create_order(order: OrderInput):
    return _order_call(save_order, order)


@app.get('/admin/orders')
def admin_orders(limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0)):
    return _order_call(list_orders, limit, offset)


@app.get('/admin/orders/{order_id}')
def admin_order_detail(order_id: int = ApiPath(ge=1)):
    return _order_call(order_detail, order_id)
_data_path = Path(__file__).with_name("sample_menus.json")
_menus = [Menu.model_validate(item) for item in json.loads(_data_path.read_text(encoding="utf-8"))]


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "dataSource": "mock"}


@app.get("/menus", response_model=list[Menu])
async def menus(category: str | None = None) -> list[Menu]:
    """임시 메뉴 전체 또는 한 카테고리의 메뉴를 제공합니다. 품절 메뉴도 포함합니다."""
    if category is None:
        return _menus
    return [menu for menu in _menus if menu.category == category]


def _db_query(sql, params=()):
    # 임시 메뉴 API는 DB가 이용 불가능해도 사용할 수 있습니다.
    from database import query
    try:
        return query(sql, params)
    except Exception:
        raise HTTPException(status_code=503, detail='DB 조회 실패. 접속 설정·Azure 네트워크 허용·인증서를 확인해 주세요.') from None


@app.get('/db/health')
def db_health():
    _db_query('SELECT 1 AS connected')
    return {'status': 'ok', 'dataSource': 'mysql'}


@app.get('/stores')
def stores():
    return _db_query('SELECT store_id, store_nm FROM store ORDER BY store_id')


@app.get('/stores/{store_id}/menus', response_model=list[Menu])
def store_menus(store_id: int = ApiPath(ge=1)):
    rows = _db_query('''
        SELECT m.menu_id, m.menu_nm, m.menu_price, m.menu_des, m.is_sold_out, c.category_nm
        FROM menu m JOIN category c ON c.category_id = m.category_id
        WHERE c.store_id = %s AND m.is_active = TRUE
        ORDER BY c.category_sort, c.category_id, m.menu_sort, m.menu_id
    ''', (store_id,))
    option_rows = _db_query('''
        SELECT o.option_id, o.menu_id, o.option_nm, o.extra_price, o.is_sold_out
        FROM menu_option o JOIN menu m ON m.menu_id = o.menu_id
        JOIN category c ON c.category_id = m.category_id
        WHERE c.store_id = %s AND m.is_active = TRUE AND o.is_active = TRUE
        ORDER BY o.menu_option_sort, o.option_id
    ''', (store_id,)) if rows else []
    options_by_menu = {}
    for option in option_rows:
        options_by_menu.setdefault(option['menu_id'], []).append(MenuOption(
            id=str(option['option_id']), name=option['option_nm'],
            price=option['extra_price'], isSoldOut=bool(option['is_sold_out'])))
    return [Menu(id=str(row['menu_id']), name=row['menu_nm'],
                 category=row['category_nm'], price=row['menu_price'],
                 description=row['menu_des'] or '', isSoldOut=bool(row['is_sold_out']),
                 options=options_by_menu.get(row['menu_id'], []))
            for row in rows]
