"""점주 API. 인증은 main의 미들웨어와 각 경로의 세션 조회가 함께 확인합니다."""
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Query, Request
from pydantic import BaseModel

import owner_ai_service as ai
import owner_auth
import owner_menu_write_service as writes
import owner_portal_service as portal
from owner_menu_write_service import MenuBoardChanges, SoldOutInput

Id = Annotated[int, Path(ge=1, le=2147483647)]
router = APIRouter(prefix='/owner', tags=['점주'])


class OwnerDeviceView(BaseModel):
    device_id: int
    device_code: str
    is_active: bool
    last_seen_at: str | None


class OwnerDeviceList(BaseModel):
    devices: list[OwnerDeviceView]


def _owner_id(request):
    return owner_auth.require_owner(request).admin.owner_id


def _call(failure, function, *args):
    try:
        return function(*args)
    except portal.OwnerResourceNotFound:
        raise HTTPException(404, '항목을 찾을 수 없습니다.') from None
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, failure) from None


READ_FAILED = '조회 실패. 서버 연결과 DB 설정을 확인해 주세요.'
WRITE_FAILED = '저장 결과를 확인할 수 없습니다. 새로고침해 확인한 뒤 다시 시도해 주세요.'


@router.get('/stores/{store_id}')
def store(request: Request, store_id: Id):
    return _call(READ_FAILED, portal.store_detail, store_id, _owner_id(request))


@router.get('/stores/{store_id}/menu-board')
def menu_board(request: Request, store_id: Id):
    return _call(READ_FAILED, portal.menu_board, store_id, _owner_id(request))


@router.patch('/stores/{store_id}/menu-board')
def save_menu_board(payload: MenuBoardChanges, request: Request, store_id: Id):
    return _call(WRITE_FAILED, writes.save_menu_board, store_id, _owner_id(request), payload)


@router.patch('/menus/{menu_id}/sold-out')
def menu_sold_out(payload: SoldOutInput, request: Request, menu_id: Id):
    return _call(WRITE_FAILED, writes.set_menu_sold_out, menu_id, _owner_id(request), payload.is_sold_out)


@router.patch('/options/{option_id}/sold-out')
def option_sold_out(payload: SoldOutInput, request: Request, option_id: Id):
    return _call(WRITE_FAILED, writes.set_option_sold_out, option_id, _owner_id(request), payload.is_sold_out)


@router.get('/stores/{store_id}/orders')
def orders(request: Request, store_id: Id, limit: int = Query(100, ge=1, le=200),
           offset: int = Query(0, ge=0, le=2147483647)):
    return _call(READ_FAILED, portal.list_orders, store_id, _owner_id(request), limit, offset)


@router.get('/stores/{store_id}/orders/{order_id}')
def order(request: Request, store_id: Id, order_id: Id):
    return _call(READ_FAILED, portal.order_detail, store_id, _owner_id(request), order_id)


@router.get('/stores/{store_id}/devices', response_model=OwnerDeviceList)
def devices(request: Request, store_id: Id):
    return _call(READ_FAILED, portal.list_devices, store_id, _owner_id(request))


@router.get('/stores/{store_id}/ai-settings')
def ai_settings(request: Request, store_id: Id):
    return _call(READ_FAILED, ai.get_settings, store_id, _owner_id(request))


@router.patch('/stores/{store_id}/ai-settings')
def save_ai_settings(payload: ai.AiSettingsInput, request: Request, store_id: Id):
    return _call(WRITE_FAILED, ai.save_settings, store_id, _owner_id(request), payload)


@router.get('/stores/{store_id}/menu-ai')
def menu_ai(request: Request, store_id: Id):
    return _call(READ_FAILED, ai.get_menu_ai, store_id, _owner_id(request))


@router.patch('/stores/{store_id}/menu-ai')
def save_menu_ai(payload: ai.MenuAiChanges, request: Request, store_id: Id):
    return _call(WRITE_FAILED, ai.save_menu_ai, store_id, _owner_id(request), payload)


@router.get('/stores/{store_id}/stats')
def stats(request: Request, store_id: Id, days: int = Query(7, ge=1, le=90)):
    return _call(READ_FAILED, ai.stats, store_id, _owner_id(request), days)


@router.get('/stores/{store_id}/staff-calls')
def staff_calls(request: Request, store_id: Id):
    return _call(READ_FAILED, ai.staff_calls, store_id, _owner_id(request))


@router.patch('/stores/{store_id}/staff-calls/{alert_id}/resolve')
def resolve_staff_call(request: Request, store_id: Id, alert_id: Id):
    return _call(WRITE_FAILED, ai.resolve_staff_call, store_id, _owner_id(request), alert_id)
