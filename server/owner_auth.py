"""점주 인증. admin_auth의 세션·CSRF·Argon2id·시도 제한을 재사용하고 저장소와 쿠키만 분리합니다."""
from dataclasses import dataclass
from threading import RLock

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, SecretStr, StrictStr

import admin_auth


@dataclass(frozen=True)
class Owner:
    owner_id: int
    login_id: str
    role: str = 'owner'


# 회사 관리자와 저장소가 달라 한쪽 세션 ID가 다른 쪽에서 조회되지 않습니다.
# Session.admin 필드 이름은 admin_auth 구현 그대로이며 여기서는 Owner를 담습니다.
sessions = admin_auth.SessionStore()
attempts = admin_auth.AttemptLimiter()
credential_lock = RLock()


def connection_factory():
    from database import connect
    return connect()


def cookie_name():
    return '__Host-voisk_owner' if admin_auth.settings.secure else 'voisk_owner_local'


def _read(work):
    connection = connection_factory()
    try:
        with connection.cursor() as cursor:
            cursor.execute('START TRANSACTION READ ONLY')
            return work(cursor)
    finally:
        try:
            connection.rollback()
        finally:
            connection.close()


def _stores(cursor, owner_id):
    cursor.execute('SELECT store_id, store_nm AS store_name FROM store WHERE owner_id = %s ORDER BY store_id',
                   (owner_id,))
    return [{'store_id': row['store_id'], 'store_name': row['store_name']} for row in cursor.fetchall()]


def lookup_login(login_id):
    """비밀번호 해시는 이 함수에서만 읽고 응답·로그에는 넣지 않습니다."""
    def work(cursor):
        cursor.execute('SELECT owner_id, own_login_id, own_pw FROM owner WHERE own_login_id = %s', (login_id,))
        row = cursor.fetchone()
        return (row, _stores(cursor, row['owner_id']) if row else [])
    return _read(work)


def lookup_current(owner_id):
    def work(cursor):
        cursor.execute('SELECT owner_id, own_login_id FROM owner WHERE owner_id = %s', (owner_id,))
        row = cursor.fetchone()
        return (row, _stores(cursor, owner_id) if row else [])
    return _read(work)


def require_owner(request, touch=True):
    admin_auth.check_transport(request)
    session = sessions.get(request.cookies.get(cookie_name()), touch=touch)
    if session is None or session.admin is None:
        raise HTTPException(401, '점주 로그인이 필요합니다.')
    if session.admin.role != 'owner':
        raise HTTPException(403, '점주 권한이 필요합니다.')
    return session


def set_cookie(response, token, authenticated=False):
    response.set_cookie(cookie_name(), token, httponly=True, secure=admin_auth.settings.secure,
                        samesite='strict', path='/',
                        max_age=int(sessions.absolute if authenticated else sessions.anonymous))


def clear_cookie(response):
    response.delete_cookie(cookie_name(), path='/', httponly=True,
                           secure=admin_auth.settings.secure, samesite='strict')


def _view(owner_id, login_id, stores):
    return {'owner': {'owner_id': owner_id, 'login_id': login_id, 'role': 'owner', 'stores': stores}}


class OwnerLoginInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    # 계정 생성 정책보다 넓게 받습니다. 정책 이전의 기존 ID도 비밀번호 검증까지는 가야 합니다.
    login_id: StrictStr = Field(min_length=1, max_length=100)
    password: SecretStr = Field(min_length=1, max_length=1024)


router = APIRouter(prefix='/auth/owner', tags=['점주 인증'])


@router.get('/csrf')
def csrf(request: Request, response: Response):
    admin_auth.check_transport(request)
    if request.headers.get('origin') is not None:
        admin_auth.check_origin(request)
    session = sessions.get(request.cookies.get(cookie_name()))
    if session is None:
        token, session = sessions.create()
        set_cookie(response, token)
    return {'csrf_token': session.csrf}


@router.post('/login')
def login(body: OwnerLoginInput, request: Request, response: Response):
    admin_auth.check_origin(request)
    token = request.cookies.get(cookie_name())
    session = sessions.get(token)
    if session is None:
        raise HTTPException(403, '인증 요청이 만료되었습니다. 다시 시도해 주세요.')
    admin_auth.check_csrf(request, session)
    attempts.check(request.client.host if request.client else '')
    # Keep credential verification and session issuance ordered with password resets.
    with credential_lock:
        try:
            row, stores = lookup_login(body.login_id)
        except Exception:
            raise HTTPException(503, '인증 서비스를 사용할 수 없습니다. 서버 연결을 확인해 주세요.') from None
        # 없는 ID도 더미 해시를 검증해 응답 시간과 문구로 구분되지 않게 합니다.
        if not admin_auth.verify_password(row.get('own_pw') if row else None, body.password.get_secret_value()):
            raise HTTPException(401, '로그인 ID 또는 비밀번호가 올바르지 않습니다.')
        owner = Owner(int(row['owner_id']), str(row['own_login_id']))
        new_token, _ = sessions.create(owner, replace=token)
    set_cookie(response, new_token, authenticated=True)
    return _view(owner.owner_id, owner.login_id, stores)


@router.get('/me')
def me(request: Request):
    # 주기적인 세션 확인만으로 비활동 만료를 연장하지 않습니다.
    session = require_owner(request, touch=False)
    try:
        row, stores = lookup_current(session.admin.owner_id)
    except Exception:
        raise HTTPException(503, '인증 서비스를 사용할 수 없습니다. 서버 연결을 확인해 주세요.') from None
    if row is None:
        sessions.revoke(request.cookies.get(cookie_name()))
        raise HTTPException(401, '점주 로그인이 필요합니다.')
    return _view(row['owner_id'], row['own_login_id'], stores)


@router.post('/logout', status_code=204)
def logout(request: Request):
    session = require_owner(request, touch=False)
    admin_auth.check_csrf(request, session)
    sessions.revoke(request.cookies.get(cookie_name()))
    response = Response(status_code=204)
    clear_cookie(response)
    return response
