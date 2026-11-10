"""카카오페이 개발 CID 전용. 별도 설정 시 승인된 테스트 주문을 저장합니다."""
import os
import secrets
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from html import escape
from pathlib import Path
from threading import RLock
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse

from order_service import OrderPayment, OrderInput, save_order

router = APIRouter(prefix='/payments/kakaopay', tags=['카카오페이 테스트'])
BASE = 'http://localhost:8001'
CID = 'TC0ONETIME'
TTL = 900
lock = RLock()


@dataclass
class Session:
    token: str
    order: OrderInput
    total: int
    tid: str
    redirect: str
    created: float
    status: str = 'ready'
    save_enabled: bool = False
    payment: OrderPayment | None = None
    order_id: int | None = None


sessions: dict[str, Session] = {}


def local_only(request: Request):
    if not request.client or request.client.host not in {'127.0.0.1', '::1', 'testclient'}:
        raise HTTPException(403, '카카오페이 테스트는 PC 로컬에서만 사용할 수 있습니다.')
    origin = request.headers.get('origin')
    if origin and origin not in {BASE, 'http://127.0.0.1:8001'}:
        raise HTTPException(403, '허용되지 않은 결제 요청 출처입니다.')


def credentials():
    load_dotenv(Path(__file__).with_name('.env'))
    if os.getenv('KAKAOPAY_CID') != CID:
        raise HTTPException(503, '개발용 CID TC0ONETIME만 허용합니다.')
    key = os.getenv('KAKAOPAY_SECRET_KEY', '').strip()
    if not key:
        raise HTTPException(503, '서버의 카카오페이 개발용 키 설정을 확인해 주세요.')
    return key


def provider(operation, payload):
    # 외부 오류 본문·키·토큰은 응답이나 로그에 포함하지 않습니다.
    key = credentials()
    try:
        with httpx.Client(timeout=15, follow_redirects=False) as client:
            response = client.post(f'https://open-api.kakaopay.com/online/v1/payment/{operation}',
                headers={'Authorization': f'SECRET_KEY {key}'}, json={'cid': CID, **payload})
            response.raise_for_status()
            return response.json()
    except Exception:
        raise HTTPException(502, '카카오페이 응답을 확인하지 못했습니다. 승인 여부를 임의로 판단하지 마세요.') from None


def quote(order):
    """동일 읽기 전용 트랜잭션에서 기기·메뉴·옵션과 실제 가격을 검증합니다."""
    from database import connect
    connection = connect()
    try:
        with connection.cursor() as cursor:
            cursor.execute('START TRANSACTION READ ONLY')
            cursor.execute('SELECT store_id,is_active FROM kiosk_device WHERE device_id=%s', (order.device_id,))
            device = cursor.fetchone()
            if not device or device['store_id'] != order.store_id or not device['is_active']:
                raise HTTPException(422, '매장·기기 정보를 확인해 주세요.')
            total = 0
            for item in order.items:
                cursor.execute('''SELECT m.menu_price,m.is_active,m.is_sold_out,c.store_id
                    FROM menu m JOIN category c ON c.category_id=m.category_id WHERE m.menu_id=%s''', (item.menu_id,))
                menu = cursor.fetchone()
                if not menu or menu['store_id'] != order.store_id or not menu['is_active'] or menu['is_sold_out']:
                    raise HTTPException(422, '현재 판매할 수 없는 메뉴입니다.')
                price = menu['menu_price']
                if price < 0:
                    raise HTTPException(422, '메뉴 가격을 확인해 주세요.')
                for option_id in item.option_ids:
                    cursor.execute('SELECT menu_id,extra_price,is_active,is_sold_out FROM menu_option WHERE option_id=%s', (option_id,))
                    option = cursor.fetchone()
                    if not option or option['menu_id'] != item.menu_id or not option['is_active'] or option['is_sold_out'] or option['extra_price'] < 0:
                        raise HTTPException(422, '현재 사용할 수 없는 옵션입니다.')
                    price += option['extra_price']
                total += price * item.quantity
            if not 1 <= total <= 1000000:
                raise HTTPException(422, '테스트 결제 금액은 1원 이상 100만원 이하로 제한합니다.')
            return total
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, '결제 금액 조회 실패. DB 연결을 확인해 주세요.') from None
    finally:
        connection.rollback()
        connection.close()


def find(token):
    session = sessions.get(token)
    if not session:
        raise HTTPException(410, '테스트 결제 세션이 만료됐거나 서버가 재시작됐습니다.')
    # 대기 중인 결제만 만료시킵니다. 승인 결과가 불확실한 결제를
    # 시간 초과로 처리하면 사용자가 새 결제를 중복 생성할 수 있습니다.
    if session.status == 'ready' and time.monotonic() - session.created > TTL:
        session.status = 'expired'
    return session


def public(session):
    status = session.status
    if status == 'approved' and session.save_enabled and session.order_id is None:
        status = 'save_failed'
    return {'payment_id': session.token, 'status': status, 'total_amount': session.total,
            'expires_in': max(0, int(TTL - (time.monotonic() - session.created) + 0.999999)) if session.status == 'ready' else 0,
            'test_only': True, 'order_saved': session.order_id is not None, 'order_id': session.order_id,
            'browser_url': f'{BASE}/payments/kakaopay/browser/{session.token}',
            'checkout_url': session.redirect if session.status == 'ready' else None}


@router.post('/ready')
def ready(order: OrderInput, request: Request):
    local_only(request)
    credentials()
    with lock:
        for token in list(sessions):
            find(token)
            # 다른 기기의 준비 요청이 와도 만료 결과를 잠시 조회할 수 있게 보존합니다.
            if (time.monotonic() - sessions[token].created > TTL * 2
                and sessions[token].status in {'cancelled', 'failed', 'expired'}):
                del sessions[token]
        for existing in sessions.values():
            if existing.order.client_order_id == order.client_order_id:
                if existing.order != order:
                    raise HTTPException(409, '이미 사용한 결제 요청의 내용이 다릅니다.')
                return public(existing)
        if len(sessions) >= 100:
            raise HTTPException(429, '테스트 결제 요청이 많습니다. 잠시 후 다시 시도해 주세요.')
        total = quote(order)
        token = secrets.token_urlsafe(32)
        result = provider('ready', {
            'partner_order_id': str(order.client_order_id), 'partner_user_id': 'ai-voisk-test',
            'item_name': 'AI-Voisk 테스트 주문', 'quantity': sum(i.quantity for i in order.items),
            'total_amount': total, 'tax_free_amount': 0,
            **{name + '_url': f'{BASE}/payments/kakaopay/{name}/{token}' for name in ('approval', 'cancel', 'fail')},
        })
        redirect = result.get('next_redirect_pc_url', '')
        url = urlparse(redirect)
        if url.scheme != 'https' or not url.hostname or not any(url.hostname.endswith('.' + h) for h in ('kakaopay.com', 'kakao.com')) or not result.get('tid'):
            raise HTTPException(502, '카카오페이 결제 준비 응답이 올바르지 않습니다.')
        session = Session(token, order, total, result['tid'], redirect, time.monotonic(),
                          save_enabled=os.getenv('KAKAOPAY_SAVE_TEST_ORDERS') == '1')
        sessions[token] = session
        return public(session)


@router.get('/status/{token}')
def status(token: str, request: Request):
    local_only(request)
    with lock:
        return public(find(token))


def save_approved(session):
    if session.save_enabled and session.payment is not None and session.order_id is None:
        try:
            session.order_id = save_order(session.order, payment=session.payment)['order_id']
        except Exception:
            # 승인 상태를 유지하고, 앱에서 저장만 다시 요청할 수 있게 합니다.
            return


@router.post('/save/{token}')
def retry_save(token: str, request: Request):
    local_only(request)
    with lock:
        session = find(token)
        if session.status != 'approved' or not session.save_enabled or session.payment is None:
            raise HTTPException(409, '저장할 수 있는 승인된 테스트 결제가 없습니다.')
        save_approved(session)
        return public(session)


@router.post('/abandon/{token}')
def abandon(token: str, request: Request):
    local_only(request)
    with lock:
        session = find(token)
        if session.status == 'ready':
            session.status = 'cancelled'
        if session.status not in {'cancelled', 'failed', 'expired'}:
            raise HTTPException(409, '승인된 결제 또는 결과 확인 중인 결제는 여기서 취소할 수 없습니다.')
        return public(session)


def page(title, body):
    return HTMLResponse('<!doctype html><html lang="ko"><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>AI-Voisk 카카오페이 테스트</title><body style="font:20px sans-serif;max-width:640px;margin:60px auto;padding:24px">'
        f'<h1>{escape(title)}</h1>{body}<p>카카오페이 개발용 결제 테스트</p></body></html>',
        headers={'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
                 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'"})


@router.get('/browser/{token}')
def browser(token: str, request: Request):
    local_only(request)
    with lock:
        session = find(token)
        if session.status != 'ready':
            return page('테스트 결제 상태', f'<p>{escape(session.status)}</p><p>키오스크에서 결과를 확인해 주세요.</p>')
        return page('카카오페이 테스트 결제', f'<p>서버 확인 금액: {session.total:,}원</p>'
            f'<p><a href="{escape(session.redirect, quote=True)}">카카오페이 테스트 결제창 열기</a></p>'
            '<p>PC 브라우저에서 진행하고 완료 후 키오스크의 결과 확인을 눌러주세요.</p>')


@router.get('/approval/{token}')
def approve(token: str, request: Request):
    local_only(request)
    # main.py 미들웨어가 access log에 남지 않도록 query를 제거한 뒤 전달합니다.
    pg_token = getattr(request.state, 'payment_pg_token', None)
    if not pg_token or len(pg_token) > 1024:
        raise HTTPException(422, '승인 인증 정보를 확인해 주세요.')
    with lock:
        session = find(token)
        if session.status == 'ready':
            session.status = 'unknown'
            try:
                result = provider('approve', {'tid': session.tid, 'partner_order_id': str(session.order.client_order_id),
                    'partner_user_id': 'ai-voisk-test', 'pg_token': pg_token, 'total_amount': session.total})
                if (result.get('tid') == session.tid and result.get('cid') == CID
                    and result.get('partner_order_id') == str(session.order.client_order_id)
                    and result.get('partner_user_id') == 'ai-voisk-test'
                    and type(result.get('amount', {}).get('total')) is int
                    and result['amount']['total'] == session.total):
                    session.status = 'approved'
                    session.payment = OrderPayment(
                        session.tid, session.total, datetime.now(timezone.utc).replace(tzinfo=None))
                    save_approved(session)
            except HTTPException:
                pass
        if session.status == 'approved':
            return page('테스트 결제 승인 완료', '<p>키오스크로 돌아가 결과를 확인해 주세요.</p>')
        return page('승인 결과 확인 필요', '<p>승인 여부를 확정할 수 없습니다. 새 결제를 만들지 말고 개발자센터에서 확인해 주세요.</p>')


@router.get('/{outcome}/{token}')
def stopped(outcome: str, token: str, request: Request):
    local_only(request)
    if outcome not in {'cancel', 'fail'}:
        raise HTTPException(404)
    with lock:
        session = find(token)
        if session.status == 'ready':
            session.status = 'cancelled' if outcome == 'cancel' else 'failed'
    return page('테스트 결제 취소·실패', '<p>키오스크에서 결제 결과 확인을 눌러주세요.</p>')
