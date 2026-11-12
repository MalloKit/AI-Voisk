"""점주 인증. admin_auth의 세션·CSRF·Argon2id·시도 제한을 재사용하고 저장소와 쿠키만 분리합니다."""
import secrets
from dataclasses import dataclass
from threading import RLock

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, SecretStr, StrictStr, ValidationError

import admin_auth

UNAVAILABLE = '인증 서비스를 사용할 수 없습니다. 서버 연결을 확인해 주세요.'
CHANGE_REQUIRED = '임시 비밀번호를 먼저 변경해 주세요.'


@dataclass(frozen=True)
class Owner:
    owner_id: int
    login_id: str
    role: str = 'owner'
    # 회사 관리자가 매장 전화번호로 초기화한 비밀번호로 로그인했으면 True. 비밀번호 원문은 두지 않습니다.
    password_change_required: bool = False


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


def _store_phones(cursor, owner_id):
    cursor.execute('SELECT store_phone FROM store WHERE owner_id = %s ORDER BY store_id', (owner_id,))
    return [row['store_phone'] for row in cursor.fetchall()]


def is_store_phone_password(password, phones):
    """회사 관리자의 '매장 전화번호로 초기화'(phone_password)와 같은 값인지 봅니다. 결과만 쓰고 값은 남기지 않습니다."""
    # owner_write_service가 이 모듈을 import하므로 순환을 피하려고 함수 안에서 가져옵니다.
    from owner_write_service import phone_password
    given = password.encode('utf-8', 'surrogatepass')
    matched = False
    for phone in phones:
        try:
            candidate = phone_password(phone).encode('ascii')
        except ValueError:
            continue  # 숫자가 8자리 미만인 번호로는 초기화할 수 없습니다.
        matched |= secrets.compare_digest(candidate, given)
    return matched


def lookup_login(login_id):
    """비밀번호 해시는 이 함수에서만 읽고 응답·로그에는 넣지 않습니다."""
    def work(cursor):
        cursor.execute('SELECT owner_id, own_login_id, own_pw FROM owner WHERE own_login_id = %s', (login_id,))
        row = cursor.fetchone()
        if row is None:
            return None, [], []
        return row, _stores(cursor, row['owner_id']), _store_phones(cursor, row['owner_id'])
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


def _view(owner_id, login_id, stores, password_change_required=False):
    return {'owner': {'owner_id': owner_id, 'login_id': login_id, 'role': 'owner', 'stores': stores,
                      'password_change_required': password_change_required}}


class OwnerLoginInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    # 계정 생성 정책보다 넓게 받습니다. 정책 이전의 기존 ID도 비밀번호 검증까지는 가야 합니다.
    login_id: StrictStr = Field(min_length=1, max_length=100)
    password: SecretStr = Field(min_length=1, max_length=1024)


class OwnerPasswordChangeInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    # 새 비밀번호 정책(8~128자 등)은 회사 관리자와 같은 OwnerPassword로 따로 검사합니다.
    current_password: SecretStr = Field(min_length=1, max_length=1024)
    new_password: SecretStr = Field(min_length=1, max_length=1024)


class _OwnerGone(Exception):
    pass


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
            row, stores, phones = lookup_login(body.login_id)
        except Exception:
            raise HTTPException(503, UNAVAILABLE) from None
        password = body.password.get_secret_value()
        # 없는 ID도 더미 해시를 검증해 응답 시간과 문구로 구분되지 않게 합니다.
        if not admin_auth.verify_password(row.get('own_pw') if row else None, password):
            raise HTTPException(401, '로그인 ID 또는 비밀번호가 올바르지 않습니다.')
        # 테이블에 임시 여부 칸이 없으므로, 입력한 비밀번호가 연결 매장의 전화번호 초기화 값과 같은지로 판단합니다.
        owner = Owner(int(row['owner_id']), str(row['own_login_id']),
                      password_change_required=is_store_phone_password(password, phones))
        new_token, _ = sessions.create(owner, replace=token)
    set_cookie(response, new_token, authenticated=True)
    return _view(owner.owner_id, owner.login_id, stores, owner.password_change_required)


@router.get('/me')
def me(request: Request):
    # 주기적인 세션 확인만으로 비활동 만료를 연장하지 않습니다.
    session = require_owner(request, touch=False)
    try:
        row, stores = lookup_current(session.admin.owner_id)
    except Exception:
        raise HTTPException(503, UNAVAILABLE) from None
    if row is None:
        sessions.revoke(request.cookies.get(cookie_name()))
        raise HTTPException(401, '점주 로그인이 필요합니다.')
    return _view(row['owner_id'], row['own_login_id'], stores, session.admin.password_change_required)


def _save_password(owner_id, current, encoded, new):
    """현재 비밀번호 확인과 own_pw UPDATE를 한 트랜잭션에서 합니다. 성공하면 (로그인 ID, 매장 목록)."""
    connection = connection_factory()
    try:
        with connection.cursor() as cursor:
            cursor.execute('START TRANSACTION')
            cursor.execute('SELECT owner_id, own_login_id, own_pw FROM owner WHERE owner_id = %s FOR UPDATE',
                           (owner_id,))
            row = cursor.fetchone()
            if row is None:
                raise _OwnerGone()
            if not admin_auth.verify_password(row['own_pw'], current):
                raise HTTPException(401, '현재 비밀번호가 올바르지 않습니다.')
            # 바꾼 비밀번호가 다시 임시 비밀번호로 판정되지 않게 매장 전화번호 값은 받지 않습니다.
            if is_store_phone_password(new, _store_phones(cursor, owner_id)):
                raise HTTPException(422, '매장 전화번호로 만든 비밀번호는 쓸 수 없습니다. 다른 비밀번호를 입력해 주세요.')
            cursor.execute('UPDATE owner SET own_pw = %s WHERE owner_id = %s', (encoded, owner_id))
            if cursor.rowcount != 1:
                raise RuntimeError('Unexpected password update result')
            stores = _stores(cursor, owner_id)
        connection.commit()
        return str(row['own_login_id']), stores
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


@router.post('/password')
def change_password(body: OwnerPasswordChangeInput, request: Request, response: Response):
    # 미들웨어도 같은 검사를 하지만, 라우터만 단독으로 쓰여도 막히도록 여기서 다시 확인합니다.
    session = require_owner(request)
    admin_auth.check_csrf(request, session)
    # owner_write_service가 이 모듈을 import하므로 순환을 피하려고 함수 안에서 가져옵니다.
    from owner_write_service import OwnerPassword, _password_hash
    current = body.current_password.get_secret_value()
    new = body.new_password.get_secret_value()
    try:
        payload = OwnerPassword(password=new)
    except ValidationError:
        raise HTTPException(422, '새 비밀번호는 8~128자이며, 공백만으로 만들거나 제어 문자를 넣을 수 없습니다.') from None
    if secrets.compare_digest(new.encode('utf-8', 'surrogatepass'), current.encode('utf-8', 'surrogatepass')):
        raise HTTPException(422, '새 비밀번호는 현재 비밀번호와 달라야 합니다.')
    # 현재 비밀번호를 실제로 확인하는 요청만 로그인과 같은 시도 제한(출처별 1분 5회)에 넣습니다.
    attempts.check(request.client.host if request.client else '')
    owner_id = session.admin.owner_id
    # 회사 관리자의 비밀번호 초기화·로그인과 순서가 섞이지 않게 같은 잠금 안에서 저장과 세션 교체를 합니다.
    with credential_lock:
        try:
            encoded = _password_hash(payload)
            login_id, stores = _save_password(owner_id, current, encoded, new)
        except HTTPException:
            raise
        except _OwnerGone:
            sessions.revoke(request.cookies.get(cookie_name()))
            raise HTTPException(401, '점주 로그인이 필요합니다.') from None
        except Exception:
            raise HTTPException(503, UNAVAILABLE) from None
        # 이 점주의 다른 기기 세션은 끊고(현재 세션 포함), 현재 브라우저에는 새 세션을 발급합니다.
        sessions.revoke_matching(lambda owner: getattr(owner, 'owner_id', None) == owner_id)
        owner = Owner(owner_id, login_id)
        new_token, _ = sessions.create(owner)
    set_cookie(response, new_token, authenticated=True)
    return _view(owner.owner_id, owner.login_id, stores, owner.password_change_required)


@router.post('/logout', status_code=204)
def logout(request: Request):
    session = require_owner(request, touch=False)
    admin_auth.check_csrf(request, session)
    sessions.revoke(request.cookies.get(cookie_name()))
    response = Response(status_code=204)
    clear_cookie(response)
    return response
