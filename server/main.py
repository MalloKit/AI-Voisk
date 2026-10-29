"""로컬 시연용 메뉴 및 주문 API. 주문 저장·회사 관리자 조회는 실제 DB를 사용합니다."""

import json
from pathlib import Path

from fastapi import FastAPI, HTTPException, Path as ApiPath
from pydantic import BaseModel, Field
from fastapi import Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
import admin_auth
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from order_service import OrderInput, save_order, list_orders, order_detail
from store_service import StoreNotFound, list_stores, store_detail
from store_write_service import StoreCreate, StorePatch, create_store, update_store
from owner_service import OwnerNotFound, list_owners, owner_detail
from owner_write_service import OwnerCreate, StoreOwnerPatch, create_owner, update_store_owner
from device_service import DeviceNotFound, list_devices, device_detail
from device_write_service import DeviceCreate, DeviceStatusPatch, create_device, update_device_status
from alert_service import AlertNotFound, list_alerts, alert_detail


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


@app.middleware('http')
async def local_demo_only(request: Request, call_next):
    path = request.url.path
    admin_path = path == '/admin' or path.startswith('/admin/')
    auth_path = path == '/auth/admin' or path.startswith('/auth/admin/')
    if (admin_path or auth_path or path == '/orders') and (
        request.client is None or request.client.host not in {'127.0.0.1', '::1', 'testclient'}
    ):
        return JSONResponse(status_code=403, content={'detail': '인증 전에는 로컬 시연만 허용합니다.'})
    if admin_path or auth_path:
        try:
            admin_auth.check_transport(request)
            if admin_path:
                session = admin_auth.require_admin(request)
                if request.method not in ('GET', 'HEAD', 'OPTIONS'):
                    admin_auth.check_csrf(request, session)
        except HTTPException as error:
            response = JSONResponse(status_code=error.status_code, content={'detail': error.detail},
                                    headers=error.headers)
            if error.status_code == 401:
                admin_auth.clear_cookie(response)
            response.headers['Cache-Control'] = 'no-store'
            return response
        if request.method == 'POST' and (auth_path or path.rstrip('/') == '/admin/owners'):
            # 검증 오류가 요청 본문이나 비밀번호를 반사하지 않도록 크기도 제한합니다.
            if len(await request.body()) > 8192:
                return JSONResponse(status_code=413, content={'detail': '인증 요청 크기를 확인해 주세요.'},
                                    headers={'Cache-Control': 'no-store'})
    response = await call_next(request)
    if admin_path or auth_path:
        response.headers['Cache-Control'] = 'no-store'
        response.headers['Pragma'] = 'no-cache'
    return response


# CORS가 인증 실패 응답과 preflight도 감싸도록 가장 바깥에 등록합니다.
app.add_middleware(CORSMiddleware,
    allow_origins=list(admin_auth.settings.origins),
    allow_credentials=True,
    allow_methods=['GET', 'POST', 'PATCH'],
    allow_headers=['Content-Type', 'X-CSRF-Token'])
app.include_router(admin_auth.router)


@app.exception_handler(RequestValidationError)
async def safe_validation_error(request: Request, error: RequestValidationError):
    if request.url.path.startswith('/auth/admin/'):
        return JSONResponse(status_code=422, content={'detail': '로그인 입력 형식을 확인해 주세요.'},
                            headers={'Cache-Control': 'no-store'})
    if request.url.path.rstrip('/') == '/admin/owners' and request.method == 'POST':
        return JSONResponse(status_code=422, content={'detail': '계정 입력 형식과 허용 길이를 확인해 주세요.'},
                            headers={'Cache-Control': 'no-store'})
    if request.url.path.startswith('/admin/devices') and request.method in ('POST', 'PATCH'):
        return JSONResponse(status_code=422, content={'detail': '기기 입력 형식과 허용 길이를 확인해 주세요.'},
                            headers={'Cache-Control': 'no-store'})
    if request.url.path.startswith('/admin/stores') and request.method in ('POST', 'PATCH'):
        return JSONResponse(status_code=422, content={'detail': '매장 입력 형식과 허용 길이를 확인해 주세요.'},
                            headers={'Cache-Control': 'no-store'})
    return await request_validation_exception_handler(request, error)


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


class AdminStoreView(BaseModel):
    store_id: int
    store_name: str
    address: str
    address_detail: str | None
    store_code: str
    phone: str
    business_no: str
    representative: str
    store_type: str
    admin_id: int
    admin_name: str | None
    owner_id: int | None
    owner_login_id: str | None


class AdminStoreList(BaseModel):
    stores: list[AdminStoreView]
    total: int


def _store_call(function, *args):
    try:
        return function(*args)
    except StoreNotFound:
        raise HTTPException(404, '매장이 없습니다.') from None
    except Exception:
        raise HTTPException(503, '매장 조회 실패. 서버 연결과 DB 설정을 확인해 주세요.') from None


def _store_write_call(function, *args):
    try:
        return function(*args)
    except StoreNotFound:
        raise HTTPException(404, '매장이 없습니다.') from None
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, '매장 저장 결과를 확인할 수 없습니다. 목록을 새로고침해 확인한 뒤 다시 시도해 주세요.') from None


@app.post('/admin/stores', response_model=AdminStoreView, status_code=201)
def admin_create_store(payload: StoreCreate, request: Request):
    session = admin_auth.require_admin(request)
    return _store_write_call(create_store, payload, session.admin.admin_id)


@app.patch('/admin/stores/{store_id}', response_model=AdminStoreView)
def admin_update_store(payload: StorePatch, store_id: int = ApiPath(ge=1)):
    return _store_write_call(update_store, store_id, payload)


@app.patch('/admin/stores/{store_id}/owner', response_model=AdminStoreView)
def admin_update_store_owner(payload: StoreOwnerPatch, store_id: int = ApiPath(ge=1, le=2147483647)):
    return _store_write_call(update_store_owner, store_id, payload)


@app.get('/admin/stores', response_model=AdminStoreList)
def admin_stores():
    return _store_call(list_stores)


@app.get('/admin/stores/{store_id}', response_model=AdminStoreView)
def admin_store_detail(store_id: int = ApiPath(ge=1)):
    return _store_call(store_detail, store_id)


class AdminOwnerView(BaseModel):
    owner_id: int = Field(ge=1)
    login_id: str
    store_count: int = Field(ge=0)


class AdminOwnerStoreView(BaseModel):
    store_id: int = Field(ge=1)
    store_name: str
    address: str
    address_detail: str | None
    admin_id: int = Field(ge=1)
    admin_name: str | None


class AdminOwnerDetail(AdminOwnerView):
    stores: list[AdminOwnerStoreView]


class AdminOwnerList(BaseModel):
    owners: list[AdminOwnerView]
    total: int = Field(ge=0)


def _owner_call(function, *args):
    try:
        return function(*args)
    except OwnerNotFound:
        raise HTTPException(404, '점주 계정이 없습니다.') from None
    except Exception:
        raise HTTPException(503, '점주 계정 조회 실패. 서버 연결과 DB 설정을 확인해 주세요.') from None


@app.post('/admin/owners', response_model=AdminOwnerView, status_code=201)
def admin_create_owner(payload: OwnerCreate):
    try:
        return create_owner(payload)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, '계정 생성 결과를 확인할 수 없습니다. 목록을 새로고침해 확인한 뒤 다시 시도해 주세요.') from None


@app.get('/admin/owners', response_model=AdminOwnerList)
def admin_owners():
    return _owner_call(list_owners)


@app.get('/admin/owners/{owner_id}', response_model=AdminOwnerDetail)
def admin_owner_detail(owner_id: int = ApiPath(ge=1)):
    return _owner_call(owner_detail, owner_id)


class AdminDeviceView(BaseModel):
    device_id: int = Field(ge=1)
    device_code: str
    store_id: int = Field(ge=1)
    store_name: str
    store_address: str
    store_address_detail: str | None
    is_active: bool
    registered_at: str
    app_version: str | None
    last_seen_at: str | None
    last_synced_at: str | None


class AdminDeviceList(BaseModel):
    devices: list[AdminDeviceView]
    total: int = Field(ge=0)


def _device_call(function, *args):
    try:
        return function(*args)
    except DeviceNotFound:
        raise HTTPException(404, '기기가 없습니다.') from None
    except Exception:
        raise HTTPException(503, '기기 조회 실패. 서버 연결과 DB 설정을 확인해 주세요.') from None


def _device_write_call(function, *args):
    try:
        return function(*args)
    except DeviceNotFound:
        raise HTTPException(404, '기기가 없습니다.') from None
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, '기기 저장 결과를 확인할 수 없습니다. 목록과 상세를 새로 조회한 뒤 확인해 주세요.') from None


@app.post('/admin/devices', response_model=AdminDeviceView, status_code=201)
def admin_create_device(payload: DeviceCreate):
    return _device_write_call(create_device, payload)


@app.patch('/admin/devices/{device_id}/status', response_model=AdminDeviceView)
def admin_update_device_status(payload: DeviceStatusPatch, device_id: int = ApiPath(ge=1, le=2147483647)):
    return _device_write_call(update_device_status, device_id, payload)


@app.get('/admin/devices', response_model=AdminDeviceList)
def admin_devices():
    return _device_call(list_devices)


@app.get('/admin/devices/{device_id}', response_model=AdminDeviceView)
def admin_device_detail(device_id: int = ApiPath(ge=1)):
    return _device_call(device_detail, device_id)


class AdminAlertView(BaseModel):
    alert_id: int = Field(ge=1)
    device_id: int = Field(ge=1)
    device_code: str
    store_id: int = Field(ge=1)
    store_name: str
    alert_type: str
    severity: str
    message: str
    alert_status: str
    occurred_at: str
    acknowledged_at: str | None
    acknowledged_by: int | None
    acknowledged_by_name: str | None
    resolved_at: str | None


class AdminAlertList(BaseModel):
    alerts: list[AdminAlertView]
    total: int = Field(ge=0)


def _alert_call(function, *args):
    try:
        return function(*args)
    except AlertNotFound:
        raise HTTPException(404, '알림이 없습니다.') from None
    except Exception:
        raise HTTPException(503, '알림 조회 실패. 서버 연결과 DB 설정을 확인해 주세요.') from None


@app.get('/admin/alerts', response_model=AdminAlertList)
def admin_alerts():
    return _alert_call(list_alerts)


@app.get('/admin/alerts/{alert_id}', response_model=AdminAlertView)
def admin_alert_detail(alert_id: int = ApiPath(ge=1)):
    return _alert_call(alert_detail, alert_id)
