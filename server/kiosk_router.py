"""키오스크 전용 API. 모든 경로는 기기 토큰(device_auth)을 요구하며 LAN의 태블릿에서 호출합니다."""
import os
from datetime import datetime, timezone
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr

import ai_db
import device_auth
import kiosk_catalog
import voice_service
from device_auth import Device
from order_service import OrderInput, OrderPayment, save_order
from sync_hub import hub

router = APIRouter(prefix='/kiosk', tags=['키오스크'])
DeviceDep = Annotated[Device, Depends(device_auth.require_device)]
MenuId = Annotated[StrictInt, Field(ge=1, le=2147483647)]

READ_FAILED = '서버에서 매장 정보를 읽지 못했습니다. 잠시 후 다시 시도해 주세요.'


def _db(failure, function, *args):
    try:
        return function(*args)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, failure) from None


# ---------- 메뉴·동기화 ----------

@router.get('/bootstrap')
def bootstrap(device: DeviceDep):
    def load():
        with ai_db.read_cursor() as cursor:
            return kiosk_catalog.read_catalog(cursor, device.store_id)
    catalog = _db(READ_FAILED, load)
    return {**catalog, 'device_id': device.device_id}


@router.get('/menu-version')
def current_version(device: DeviceDep):
    def load():
        with ai_db.read_cursor() as cursor:
            return kiosk_catalog.menu_version(cursor, device.store_id)
    return {'menu_version': _db(READ_FAILED, load)}


class HeartbeatInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    applied_menu_version: StrictInt = Field(ge=0, le=2147483647)
    app_version: StrictStr | None = Field(default=None, max_length=30, pattern=r'^[0-9A-Za-z.+_-]*$')


@router.post('/heartbeat')
def heartbeat(payload: HeartbeatInput, device: DeviceDep):
    def save():
        with ai_db.write_cursor() as cursor:
            version = kiosk_catalog.menu_version(cursor, device.store_id)
            synced = payload.applied_menu_version >= version
            fields = ['last_seen_at = CURRENT_TIMESTAMP']
            params = []
            if synced:
                fields.append('last_synced_at = CURRENT_TIMESTAMP')
            if payload.app_version and ai_db.has_columns(cursor, 'kiosk_device', ('app_version',)):
                fields.append('app_version = %s')
                params.append(payload.app_version)
            if ai_db.has_columns(cursor, 'kiosk_device', ('applied_menu_version',)):
                fields.append('applied_menu_version = %s')
                params.append(payload.applied_menu_version)
            if not ai_db.has_columns(cursor, 'kiosk_device', ('last_synced_at',)):
                fields = [f for f in fields if not f.startswith('last_synced_at')]
            cursor.execute(f'UPDATE kiosk_device SET {", ".join(fields)} WHERE device_id = %s',
                           (*params, device.device_id))
            return {'menu_version': version, 'synced': synced}
    return _db('기기 상태를 저장하지 못했습니다.', save)


@router.websocket('/ws')
async def menu_changes(websocket: WebSocket):
    """핸드셰이크 헤더(X-Device-Id, Authorization)로 인증합니다. 토큰을 URL에 넣지 않아 접근 로그에 남지 않습니다."""
    host = websocket.client.host if websocket.client else 'unknown'
    try:
        from starlette.concurrency import run_in_threadpool
        device = await run_in_threadpool(device_auth.verify, websocket.headers.get('x-device-id'),
                                         websocket.headers.get('authorization'), host)
    except Exception:
        await websocket.close(code=4401)
        return
    await websocket.accept()
    await hub.register(device.store_id, websocket)
    try:
        while True:
            # 키오스크가 보내는 ping 문자열은 연결 유지용이며 내용을 쓰지 않습니다.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        hub.unregister(device.store_id, websocket)


# ---------- 주문·결제 ----------

def _own_order(order: OrderInput, device: Device):
    if order.device_id != device.device_id or order.store_id != device.store_id:
        raise HTTPException(403, '인증된 기기와 주문의 기기·매장이 다릅니다.')


def _order_call(function, *args, **kwargs):
    try:
        return function(*args, **kwargs)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, '주문 저장 결과를 확인할 수 없습니다. 같은 주문으로 다시 시도해 주세요.') from None


@router.post('/orders')
def create_order(order: OrderInput, device: DeviceDep):
    _own_order(order, device)
    return _order_call(save_order, order)


class PaymentInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    order: OrderInput
    expected_amount: StrictInt = Field(gt=0)


@router.post('/payments/demo/{method}')
def demo_payment(method: Literal['card', 'naverpay'], data: PaymentInput, device: DeviceDep):
    _own_order(data.order, device)
    if os.getenv('KIOSK_SAVE_DEMO_PAYMENTS') != '1':
        raise HTTPException(403, '서버에서 시연 결제 저장을 활성화해 주세요.')
    payment = OrderPayment(None, data.expected_amount, datetime.now(timezone.utc).replace(tzinfo=None), method)
    return _order_call(save_order, data.order, payment=payment)


@router.post('/payments/cash/pending')
def cash_order(data: PaymentInput, device: DeviceDep):
    _own_order(data.order, device)
    if os.getenv('KIOSK_SAVE_CASH_ORDERS') != '1':
        raise HTTPException(403, '서버에서 현금 주문 저장을 활성화해 주세요.')
    return _order_call(save_order, data.order, payment=OrderPayment(None, data.expected_amount, None, 'cash'))


# ---------- 직원 호출 ----------

class StaffCallInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    reason: Literal['touch', 'voice_help']


STAFF_CALL_MESSAGES = {'touch': '고객이 직원 호출 버튼을 눌렀습니다.',
                       'voice_help': '음성 주문을 여러 번 실패해 고객이 도움을 요청했습니다.'}


@router.post('/staff-call')
def staff_call(payload: StaffCallInput, device: DeviceDep):
    """기기 알림(device_alert)에 기록합니다. 처리되지 않은 호출이 있으면 새로 만들지 않습니다."""
    def save():
        with ai_db.write_cursor() as cursor:
            cursor.execute('''SELECT alert_id FROM device_alert WHERE device_id = %s AND alert_type = 'STAFF_CALL'
                AND alert_status = 'UNREAD' ORDER BY alert_id DESC LIMIT 1''', (device.device_id,))
            existing = cursor.fetchone()
            if existing:
                return {'alert_id': existing['alert_id'], 'replayed': True}
            cursor.execute('''INSERT INTO device_alert (device_id, alert_type, severity, message, alert_status)
                VALUES (%s, 'STAFF_CALL', 'WARNING', %s, 'UNREAD')''', (device.device_id, STAFF_CALL_MESSAGES[payload.reason]))
            return {'alert_id': cursor.lastrowid, 'replayed': False}
    return _db('직원 호출을 전달하지 못했습니다. 카운터에 말씀해 주세요.', save)


# ---------- 음성·추천 ----------

@router.post('/voice/interpret')
def interpret(payload: voice_service.InterpretInput, device: DeviceDep):
    if not voice_service.limiter.allow(device.device_id):
        raise HTTPException(429, {'code': 'rate_limited', 'message': '잠시 후 다시 말씀해 주세요.'})
    catalog = _db(READ_FAILED, kiosk_catalog.cache.get, device.store_id)
    try:
        return voice_service.interpret(catalog, payload)
    except voice_service.VoiceUnavailable:
        raise HTTPException(503, {'code': 'voice_unavailable', 'message': '지금은 음성 주문을 쓸 수 없습니다. 화면으로 주문해 주세요.'}) from None


class RecLogInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    client_log_id: UUID
    situation: list[Annotated[StrictStr, Field(min_length=1, max_length=20)]] = Field(default_factory=list, max_length=5)
    shown_menu_ids: list[MenuId] = Field(min_length=1, max_length=3)
    selected_menu_id: MenuId | None = None
    policy_profit: StrictInt = Field(ge=0, le=100)


@router.post('/rec-logs')
def recommendation_log(payload: RecLogInput, device: DeviceDep):
    """노출 시 한 번, 선택 시 같은 client_log_id로 한 번 더 보냅니다. 발화 원문은 받지 않습니다."""
    if payload.selected_menu_id is not None and payload.selected_menu_id not in payload.shown_menu_ids:
        raise HTTPException(422, '보여준 추천 메뉴 중에서만 선택할 수 있습니다.')

    def save():
        with ai_db.write_cursor() as cursor:
            if not ai_db.has_columns(cursor, 'recommendation_log', ('rec_log_id',)):
                raise ai_db.AiSchemaMissing()
            ids = sorted(set(payload.shown_menu_ids))
            cursor.execute(f'''SELECT COUNT(*) AS n FROM menu m JOIN category c ON c.category_id = m.category_id
                WHERE c.store_id = %s AND m.menu_id IN ({", ".join(["%s"] * len(ids))})''', (device.store_id, *ids))
            if cursor.fetchone()['n'] != len(ids):
                raise HTTPException(422, '매장 메뉴가 아닌 추천 기록입니다.')
            cursor.execute('SELECT rec_log_id, selected_menu_id FROM recommendation_log WHERE device_id = %s AND client_log_id = %s',
                           (device.device_id, str(payload.client_log_id)))
            existing = cursor.fetchone()
            if existing:
                if payload.selected_menu_id is not None and existing['selected_menu_id'] is None:
                    cursor.execute('UPDATE recommendation_log SET selected_menu_id = %s WHERE rec_log_id = %s',
                                   (payload.selected_menu_id, existing['rec_log_id']))
                return {'rec_log_id': existing['rec_log_id'], 'replayed': True}
            cursor.execute('''INSERT INTO recommendation_log
                (store_id, device_id, client_log_id, situation, shown_menu_ids, selected_menu_id, policy_profit)
                VALUES (%s, %s, %s, %s, %s, %s, %s)''',
                (device.store_id, device.device_id, str(payload.client_log_id), ','.join(payload.situation)[:100] or None,
                 ','.join(str(i) for i in payload.shown_menu_ids), payload.selected_menu_id, payload.policy_profit))
            return {'rec_log_id': cursor.lastrowid, 'replayed': False}
    try:
        return save()
    except ai_db.AiSchemaMissing:
        raise HTTPException(503, {'code': 'ai_schema_missing', 'message': 'AI DB 변경이 적용되지 않았습니다.'}) from None
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, '추천 기록을 저장하지 못했습니다.') from None
