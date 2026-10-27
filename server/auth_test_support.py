"""테스트 전용 정상 로그인 준비. 운영 서버에서는 import하지 않습니다."""
import secrets
from contextlib import contextmanager
from unittest.mock import patch
import admin_auth

_TEST_PASSWORD = secrets.token_urlsafe(32)
_TEST_HASH = admin_auth.hasher.hash(_TEST_PASSWORD)
ORIGIN = 'http://localhost:8080'


@contextmanager
def authenticated_client(client):
    """권한 검사를 우회하지 않고 격리 계정으로 실제 로그인·CSRF를 수행합니다."""
    with patch.object(admin_auth, 'sessions', admin_auth.SessionStore()), \
         patch.object(admin_auth, 'attempts', admin_auth.AttemptLimiter()), \
         patch.object(admin_auth, 'lookup_admin', return_value={
             'admin_id': 1, 'admin_nm': '격리 관리자', 'admin_pw': _TEST_HASH}):
        token = client.get('/auth/admin/csrf', headers={'Origin': ORIGIN}).json()['csrf_token']
        response = client.post('/auth/admin/login', json={'admin_id': 1, 'password': _TEST_PASSWORD},
                               headers={'Origin': ORIGIN, 'X-CSRF-Token': token})
        if response.status_code != 200:
            raise AssertionError('격리 관리자 인증 준비 실패')
        token = client.get('/auth/admin/csrf', headers={'Origin': ORIGIN}).json()['csrf_token']
        client.headers.update({'Origin': ORIGIN, 'X-CSRF-Token': token})
        yield client
