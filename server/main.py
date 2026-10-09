"""손님 메뉴 조회용 로컬 API. Azure DB 조회와 임시 메뉴를 제공하며 주문 저장은 미구현입니다."""

import json
from pathlib import Path

from fastapi import FastAPI, HTTPException, Path as ApiPath
from pydantic import BaseModel, Field


class Menu(BaseModel):
    id: str
    name: str
    category: str
    price: int = Field(ge=0)
    description: str
    isSoldOut: bool = False


app = FastAPI(title="AI 보이스크 · 연습용 메뉴 API", version="0.1.0")
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
    return [Menu(id=str(row['menu_id']), name=row['menu_nm'],
                 category=row['category_nm'], price=row['menu_price'],
                 description=row['menu_des'] or '', isSoldOut=bool(row['is_sold_out']))
            for row in rows]
