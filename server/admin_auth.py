"""회사 관리자 인증. 단일 프로세스 메모리 세션이며 DB에는 쓰지 않습니다."""
import hashlib
import os
import re
import secrets
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from pathlib import Path
from threading import RLock
from urllib.parse import urlsplit

from argon2 import PasswordHasher, Type, extract_parameters
from argon2.exceptions import InvalidHashError, VerificationError
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, SecretStr, StrictInt

load_dotenv(Path(__file__).with_name('.env'))


@dataclass(frozen=True)
class Settings:
    mode: str
    origins: tuple[str, ...]

    @classmethod
    def from_env(cls):
        mode = os.getenv('ADMIN_AUTH_MODE', 'local')
        if mode not in ('local', 'https'):
            raise ValueError('관리자 인증 환경 설정을 확인해 주세요.')
        default = 'http://localhost:8080,http://127.0.0.1:8080' if mode == 'local' else ''
        origins = tuple(dict.fromkeys(x.strip() for x in os.getenv('ADMIN_AUTH_ALLOWED_ORIGINS', default).split(',') if x.strip()))
        if not origins:
            raise ValueError('관리자 인증 허용 출처가 필요합니다.')
        for origin in origins:
            parsed = urlsplit(origin)
            if (parsed.scheme not in ('http', 'https') or not parsed.hostname or
                    parsed.username or parsed.password or parsed.path or parsed.query or
                    parsed.fragment or '*' in origin):
                raise ValueError('관리자 인증 허용 출처를 확인해 주세요.')
            if mode == 'https' and parsed.scheme != 'https':
                raise ValueError('HTTPS 인증 환경에는 HTTPS 출처가 필요합니다.')
            if mode == 'local' and (parsed.scheme != 'http' or parsed.hostname not in ('localhost', '127.0.0.1', '::1')):
                raise ValueError('개발 HTTP 인증은 로컬 출처만 허용합니다.')
        return cls(mode, origins)

    @property
    def secure(self):
        return self.mode == 'https'

    @property
    def cookie(self):
        return '__Host-voisk_admin' if self.secure else 'voisk_admin_local'


settings = Settings.from_env()
TOKEN = re.compile(r'^[A-Za-z0-9_-]{43}$')
hasher = PasswordHasher()
# 존재하지 않는 ID·비활성 비밀번호도 동일한 비용의 검증을 수행합니다.
_dummy_hash = hasher.hash(secrets.token_urlsafe(32))


@dataclass(frozen=True)
class Admin:
    admin_id: int
    admin_name: str
    role: str = 'company_admin'


@dataclass
class Session:
    admin: Admin | None
    csrf: str
    created: float
    touched: float


class SessionStore:
    def __init__(self, clock=time.monotonic, idle=1800, absolute=28800, anonymous=300, maximum=256):
        self.clock, self.idle, self.absolute = clock, idle, absolute
        self.anonymous, self.maximum = anonymous, maximum
        self._sessions = {}
        self._lock = RLock()

    def _key(self, token):
        return hashlib.sha256(token.encode('ascii')).digest()

    def _prune(self):
        now = self.clock()
        for key, session in list(self._sessions.items()):
            ttl = self.absolute if session.admin else self.anonymous
            if now - session.created >= ttl or (session.admin and now - session.touched >= self.idle):
                del self._sessions[key]

    def get(self, token, touch=False):
        if not isinstance(token, str) or not TOKEN.fullmatch(token):
            return None
        with self._lock:
            self._prune()
            result = self._sessions.get(self._key(token))
            if result and touch:
                result.touched = self.clock()
            return result

    def create(self, admin=None, replace=None):
        with self._lock:
            self._prune()
            if replace is not None:
                if self.get(replace) is None:
                    raise HTTPException(403, '인증 요청이 만료되었습니다. 다시 시도해 주세요.')
                self._sessions.pop(self._key(replace), None)
            if len(self._sessions) >= self.maximum:
                raise HTTPException(503, '인증 서비스를 잠시 사용할 수 없습니다.')
            token = secrets.token_urlsafe(32)
            now = self.clock()
            session = Session(admin, secrets.token_urlsafe(32), now, now)
            self._sessions[self._key(token)] = session
            return token, session

    def revoke(self, token):
        if isinstance(token, str) and TOKEN.fullmatch(token):
            with self._lock:
                self._sessions.pop(self._key(token), None)


class AttemptLimiter:
    """로컬 출처별 인증 시도를 제한합니다. worker 간 공유하지 않습니다."""
    def __init__(self, clock=time.monotonic):
        self.clock, self._lock = clock, RLock()
        self._attempts = defaultdict(deque)

    def check(self, host):
        with self._lock:
            now = self.clock()
            for key in list(self._attempts):
                values = self._attempts[key]
                while values and values[0] <= now - 60:
                    values.popleft()
                if not values:
                    del self._attempts[key]
            values = self._attempts[host]
            if len(values) >= 5:
                raise HTTPException(429, '로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요.',
                                    headers={'Retry-After': '60'})
            values.append(now)


sessions = SessionStore()
attempts = AttemptLimiter()


def connection_factory():
    from database import connect
    return connect()


def lookup_admin(admin_id):
    """인증에 필요한 해시는 이 함수에서만 읽고 응답·로그에는 넣지 않습니다."""
    connection = connection_factory()
    try:
        with connection.cursor() as cursor:
            cursor.execute('START TRANSACTION READ ONLY')
            cursor.execute('SELECT admin_id, admin_nm, admin_pw FROM admin WHERE admin_id = %s', (admin_id,))
            return cursor.fetchone()
    finally:
        try:
            connection.rollback()
        finally:
            connection.close()


def verify_password(encoded, password):
    allowed = False
    if isinstance(encoded, str) and len(encoded) <= 255:
        try:
            params = extract_parameters(encoded)
            allowed = (params.type == Type.ID and params.version == 19 and
                       19456 <= params.memory_cost <= 262144 and 2 <= params.time_cost <= 10 and
                       1 <= params.parallelism <= 8 and params.salt_len >= 16 and params.hash_len >= 32)
        except (InvalidHashError, ValueError, TypeError):
            pass
    try:
        verified = hasher.verify(encoded if allowed else _dummy_hash, password)
        return bool(allowed and verified)
    except (VerificationError, InvalidHashError, ValueError, TypeError):
        return False


def check_transport(request):
    if settings.secure and request.url.scheme != 'https':
        raise HTTPException(403, 'HTTPS 연결이 필요합니다.')
    if not settings.secure and request.url.scheme != 'http':
        raise HTTPException(403, 'HTTPS 환경은 관리자 인증 설정을 변경해 주세요.')


def check_origin(request):
    check_transport(request)
    if request.headers.get('origin') not in settings.origins:
        raise HTTPException(403, '허용되지 않은 요청 출처입니다.')


def require_admin(request, touch=True):
    check_transport(request)
    session = sessions.get(request.cookies.get(settings.cookie), touch=touch)
    if session is None or session.admin is None:
        raise HTTPException(401, '관리자 로그인이 필요합니다.')
    if session.admin.role != 'company_admin':
        raise HTTPException(403, '관리자 권한이 필요합니다.')
    return session


def check_csrf(request, session):
    check_origin(request)
    token = request.headers.get('x-csrf-token', '')
    if not TOKEN.fullmatch(token) or not secrets.compare_digest(token, session.csrf):
        raise HTTPException(403, '인증 요청을 확인할 수 없습니다. 다시 시도해 주세요.')


def set_cookie(response, token, authenticated=False):
    response.set_cookie(settings.cookie, token, httponly=True, secure=settings.secure,
                        samesite='strict', path='/',
                        max_age=int(sessions.absolute if authenticated else sessions.anonymous))


def clear_cookie(response):
    response.delete_cookie(settings.cookie, path='/', httponly=True,
                           secure=settings.secure, samesite='strict')


def admin_view(admin):
    return {'admin_id': admin.admin_id, 'admin_name': admin.admin_name, 'role': admin.role}


class LoginInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    admin_id: StrictInt = Field(ge=1, le=2147483647)
    password: SecretStr = Field(min_length=1, max_length=1024)


router = APIRouter(prefix='/auth/admin', tags=['관리자 인증'])


@router.get('/csrf')
def csrf(request: Request, response: Response):
    check_transport(request)
    # 같은 출처 GET에는 Origin이 없을 수 있습니다. 교차 출처는 정확히 허용합니다.
    if request.headers.get('origin') is not None:
        check_origin(request)
    session = sessions.get(request.cookies.get(settings.cookie))
    if session is None:
        token, session = sessions.create()
        set_cookie(response, token)
    return {'csrf_token': session.csrf}


@router.post('/login')
def login(body: LoginInput, request: Request, response: Response):
    check_origin(request)
    token = request.cookies.get(settings.cookie)
    session = sessions.get(token)
    if session is None:
        raise HTTPException(403, '인증 요청이 만료되었습니다. 다시 시도해 주세요.')
    check_csrf(request, session)
    attempts.check(request.client.host if request.client else '')
    try:
        row = lookup_admin(body.admin_id)
    except Exception:
        raise HTTPException(503, '인증 서비스를 사용할 수 없습니다. 서버 연결을 확인해 주세요.') from None
    if not verify_password(row.get('admin_pw') if row else None, body.password.get_secret_value()):
        raise HTTPException(401, '관리자 ID 또는 비밀번호를 확인해 주세요.')
    admin = Admin(int(row['admin_id']), str(row['admin_nm']))
    new_token, _ = sessions.create(admin, replace=token)
    set_cookie(response, new_token, authenticated=True)
    return {'admin': admin_view(admin)}


@router.get('/me')
def me(request: Request):
    # 주기적인 세션 확인만으로 비활동 만료를 연장하지 않습니다.
    return {'admin': admin_view(require_admin(request, touch=False).admin)}


@router.post('/logout', status_code=204)
def logout(request: Request):
    session = require_admin(request, touch=False)
    check_csrf(request, session)
    sessions.revoke(request.cookies.get(settings.cookie))
    response = Response(status_code=204)
    clear_cookie(response)
    return response
