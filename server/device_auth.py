"""키오스크 기기 토큰. 회사 관리자가 발급하고, 키오스크는 LAN에서 이 토큰으로 /kiosk API를 씁니다.

DB에는 SHA-256 해시만 저장하고 토큰 원문은 발급 응답에서 한 번만 돌려줍니다.
"""
import hashlib
import hmac
import secrets
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from threading import RLock

from fastapi import HTTPException, Request

import ai_db

INT_MAX = 2147483647


@dataclass(frozen=True)
class Device:
    device_id: int
    store_id: int


def hash_token(token):
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


class FailureLimiter:
    """잘못된 토큰 시도를 접속 주소별로 1분에 10회까지 허용합니다. worker 간 공유하지 않습니다."""

    def __init__(self, limit=10, window=60, clock=time.monotonic):
        self.limit, self.window, self.clock = limit, window, clock
        self._lock = RLock()
        self._failures = defaultdict(deque)

    def _trim(self, host, now):
        values = self._failures[host]
        while values and values[0] <= now - self.window:
            values.popleft()
        if not values:
            # 비운 키는 지워 메모리가 늘지 않게 합니다.
            del self._failures[host]
            return self._failures[host]
        return values

    def check(self, host):
        with self._lock:
            if len(self._trim(host, self.clock())) >= self.limit:
                raise HTTPException(429, '기기 인증 시도가 많습니다. 잠시 후 다시 시도해 주세요.',
                                    headers={'Retry-After': str(self.window)})

    def fail(self, host):
        with self._lock:
            now = self.clock()
            self._trim(host, now).append(now)


failures = FailureLimiter()


def _credentials(device_id_text, authorization):
    if not device_id_text or not device_id_text.isdigit() or not authorization:
        return None
    scheme, _, token = authorization.partition(' ')
    device_id = int(device_id_text)
    if scheme.lower() != 'bearer' or not 1 <= device_id <= INT_MAX or not 20 <= len(token) <= 200:
        return None
    return device_id, token


def verify(device_id_text, authorization, host):
    """활성 기기이고 토큰 해시가 맞으면 Device. 실패 사유는 응답에서 구분하지 않습니다."""
    # 같은 주소(NAT)를 쓰는 다른 키오스크가 함께 잠기지 않도록 기기 번호별로 셉니다.
    key = f'{host}#{(device_id_text or "")[:12]}'
    failures.check(key)
    credentials = _credentials(device_id_text, authorization)
    row = None
    if credentials is not None:
        with ai_db.read_cursor() as cursor:
            cursor.execute('SELECT device_id, store_id, is_active, device_token_hash FROM kiosk_device WHERE device_id = %s',
                           (credentials[0],))
            row = cursor.fetchone()
    stored = (row or {}).get('device_token_hash') or ''
    # 기기가 없을 때도 같은 비교를 수행해 응답 시간 차이를 줄입니다.
    expected = stored if len(stored) == 64 else '0' * 64
    supplied = hash_token(credentials[1]) if credentials else '1' * 64
    if not (hmac.compare_digest(expected, supplied) and row and stored and row['is_active']):
        failures.fail(key)
        raise HTTPException(401, '기기 인증이 필요합니다. 관리자에게 기기 토큰 발급을 요청해 주세요.')
    return Device(row['device_id'], row['store_id'])


def require_device(request: Request) -> Device:
    host = request.client.host if request.client else 'unknown'
    try:
        return verify(request.headers.get('x-device-id'), request.headers.get('authorization'), host)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, '기기 인증을 확인할 수 없습니다. 서버의 DB 연결을 확인해 주세요.') from None


def issue_token(device_id):
    """새 토큰을 만들고 이전 토큰을 무효로 합니다. 응답 후에는 원문을 다시 볼 수 없습니다."""
    token = secrets.token_urlsafe(32)
    with ai_db.write_cursor() as cursor:
        cursor.execute('SELECT device_id, store_id FROM kiosk_device WHERE device_id = %s FOR UPDATE', (device_id,))
        row = cursor.fetchone()
        if row is None:
            raise LookupError(device_id)
        cursor.execute('UPDATE kiosk_device SET device_token_hash = %s WHERE device_id = %s',
                       (hash_token(token), device_id))
    return {'device_id': row['device_id'], 'store_id': row['store_id'], 'token': token}
