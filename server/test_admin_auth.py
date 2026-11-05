"""실제 계정·Azure 접속 없이 SQLite와 실제 Argon2id 검증으로 인증을 검증합니다."""
import secrets
import sqlite3
import unittest
from unittest.mock import patch

from argon2 import PasswordHasher, Type
from fastapi.testclient import TestClient
from main import app
import admin_auth as auth

ORIGIN = 'http://localhost:8080'


class Cursor:
    def __init__(self, fixture):
        self.fixture = fixture
        self.cursor = fixture.db.cursor()
    def __enter__(self): return self
    def __exit__(self, *_): self.cursor.close()
    def execute(self, sql, params=()):
        self.fixture.statements.append((sql, params))
        if sql == 'START TRANSACTION READ ONLY':
            self.fixture.db.execute('PRAGMA query_only=ON')
            return
        if not sql.lstrip().upper().startswith('SELECT '):
            raise AssertionError('인증 조회에서 쓰기 금지')
        self.cursor.execute(sql.replace('%s', '?'), params)
    def fetchone(self):
        row = self.cursor.fetchone()
        return dict(row) if row is not None else None


class Connection:
    def __init__(self, fixture): self.fixture = fixture
    def cursor(self): return Cursor(self.fixture)
    def rollback(self):
        self.fixture.db.rollback()
        self.fixture.rollbacks += 1
    def close(self):
        self.fixture.db.execute('PRAGMA query_only=OFF')
        self.fixture.closed += 1


class AdminAuthTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.password = secrets.token_urlsafe(32)
        cls.encoded = auth.hasher.hash(cls.password)

    def setUp(self):
        self.db = sqlite3.connect(':memory:', check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute('CREATE TABLE admin (admin_id INTEGER PRIMARY KEY, admin_nm TEXT, admin_pw TEXT)')
        self.db.execute('INSERT INTO admin VALUES (?, ?, ?)', (1, '격리 관리자', self.encoded))
        self.db.commit()
        self.statements, self.closed, self.rollbacks = [], 0, 0
        self.now = [0.]
        self.store = auth.SessionStore(clock=lambda: self.now[0])
        self.patches = [
            patch.object(auth, 'settings', auth.Settings('local', (ORIGIN,))),
            patch.object(auth, 'sessions', self.store),
            patch.object(auth, 'attempts', auth.AttemptLimiter(clock=lambda: self.now[0])),
            patch.object(auth, 'connection_factory', side_effect=lambda: Connection(self)),
            patch('database.connect', side_effect=AssertionError('Azure 접속 금지')),
        ]
        for item in self.patches: item.start()
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        for item in reversed(self.patches): item.stop()
        self.db.close()

    def csrf(self, client=None):
        client = client or self.client
        response = client.get('/auth/admin/csrf', headers={'Origin': ORIGIN})
        self.assertEqual(response.status_code, 200)
        return response.json()['csrf_token']

    def login(self, password=None, admin_id=1, client=None):
        client = client or self.client
        token = self.csrf(client)
        return client.post('/auth/admin/login', json={
            'admin_id': admin_id, 'password': self.password if password is None else password,
        }, headers={'Origin': ORIGIN, 'X-CSRF-Token': token})

    def test_success_me_and_local_cookie_properties(self):
        response = self.login()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'admin': {
            'admin_id': 1, 'admin_name': '격리 관리자', 'role': 'company_admin'}})
        self.assertEqual(self.client.get('/auth/admin/me').json(), response.json())
        cookie = response.headers['set-cookie']
        self.assertIn('HttpOnly', cookie)
        self.assertIn('SameSite=strict', cookie)
        self.assertIn('Max-Age=28800', cookie)
        self.assertNotIn('Secure;', cookie)
        self.assertIn('Path=/', cookie)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        for secret in (self.password, self.encoded, self.client.cookies.get(auth.settings.cookie)):
            self.assertFalse(secret in response.text)
        self.assertNotIn('admin_pw', response.text)

    def test_unknown_id_wrong_password_and_inactive_values_have_same_failure(self):
        responses = [self.login(admin_id=999), self.login(password=secrets.token_urlsafe(32))]
        inactive = secrets.token_urlsafe(32)
        self.db.execute('UPDATE admin SET admin_pw = ?', (inactive,))
        self.db.commit()
        responses.append(self.login(password=inactive))
        self.assertTrue(all(response.status_code == 401 for response in responses))
        self.assertTrue(all(response.json() == responses[0].json() for response in responses))
        self.assertEqual(self.client.get('/auth/admin/me').status_code, 401)

    def test_plain_malformed_and_non_argon2id_hashes_never_authenticate(self):
        variants = [secrets.token_urlsafe(32), '$argon2id$invalid',
                    PasswordHasher(type=Type.I).hash(self.password)]
        for encoded in variants:
            self.db.execute('UPDATE admin SET admin_pw = ?', (encoded,))
            self.db.commit()
            response = self.login(password=self.password)
            self.assertEqual(response.status_code, 401)
            self.assertNotIn('set-cookie', response.headers)

    def test_all_admin_lists_and_details_require_session_before_database(self):
        paths = ['/admin/orders','/admin/orders/1','/admin/stores','/admin/stores/1',
                 '/admin/owners','/admin/owners/1','/admin/devices','/admin/devices/1',
                 '/admin/alerts','/admin/alerts/1']
        for path in paths:
            response = self.client.get(path)
            self.assertEqual(response.status_code, 401)
            self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertEqual(self.statements, [])

    def test_authenticated_get_preserves_contract_and_logout_revokes_session(self):
        self.assertEqual(self.login().status_code, 200)
        expected = {'devices': [], 'total': 0}
        with patch('main.list_devices', return_value=expected):
            self.assertEqual(self.client.get('/admin/devices').json(), expected)
            saved_cookie = self.client.cookies.get(auth.settings.cookie)
            response = self.client.post('/auth/admin/logout',
                headers={'Origin': ORIGIN, 'X-CSRF-Token': self.csrf()})
            self.assertEqual(response.status_code, 204)
            self.assertIn('Max-Age=0', response.headers['set-cookie'])
            self.assertEqual(self.client.get('/admin/devices').status_code, 401)
            with TestClient(app) as replay:
                replay.cookies.set(auth.settings.cookie, saved_cookie)
                self.assertEqual(replay.get('/admin/devices').status_code, 401)

    def test_session_fixation_rotation_and_old_csrf_rejection(self):
        old_csrf = self.csrf()
        old_cookie = self.client.cookies.get(auth.settings.cookie)
        self.assertEqual(self.login().status_code, 200)
        self.assertNotEqual(old_cookie, self.client.cookies.get(auth.settings.cookie))
        with TestClient(app) as replay:
            replay.cookies.set(auth.settings.cookie, old_cookie)
            self.assertEqual(replay.get('/auth/admin/me').status_code, 401)
        self.assertEqual(self.client.post('/auth/admin/logout',
            headers={'Origin': ORIGIN, 'X-CSRF-Token': old_csrf}).status_code, 403)
        self.assertEqual(self.client.get('/auth/admin/me').status_code, 200)

    def test_missing_untrusted_null_origins_and_wrong_csrf_are_blocked(self):
        token = self.csrf()
        payload = {'admin_id': 1, 'password': self.password}
        for headers in ({}, {'Origin': 'null', 'X-CSRF-Token': token},
                        {'Origin': 'https://untrusted.example', 'X-CSRF-Token': token},
                        {'Origin': ORIGIN}, {'Origin': ORIGIN, 'X-CSRF-Token': 'invalid'}):
            self.assertEqual(self.client.post('/auth/admin/login', json=payload, headers=headers).status_code, 403)
        self.assertEqual(self.statements, [])
        self.assertEqual(self.login().status_code, 200)
        self.assertEqual(self.client.post('/auth/admin/logout').status_code, 403)
        self.assertEqual(self.client.get('/auth/admin/me').status_code, 200)

    def test_csrf_token_from_other_browser_is_rejected(self):
        with TestClient(app) as other:
            token = self.csrf(other)
        self.csrf()
        response = self.client.post('/auth/admin/login', json={'admin_id': 1, 'password': self.password},
                                   headers={'Origin': ORIGIN, 'X-CSRF-Token': token})
        self.assertEqual(response.status_code, 403)

    def test_idle_expiration_is_not_extended_by_me_polling(self):
        self.assertEqual(self.login().status_code, 200)
        self.now[0] = 1799
        self.assertEqual(self.client.get('/auth/admin/me').status_code, 200)
        self.now[0] = 1800
        self.assertEqual(self.client.get('/auth/admin/me').status_code, 401)

    def test_admin_requests_touch_idle_but_absolute_expiry_still_applies(self):
        self.assertEqual(self.login().status_code, 200)
        with patch('main.list_devices', return_value={'devices': [], 'total': 0}):
            for value in range(1700, 28800, 1700):
                self.now[0] = value
                self.assertEqual(self.client.get('/admin/devices').status_code, 200)
            self.now[0] = 28800
            self.assertEqual(self.client.get('/admin/devices').status_code, 401)

    def test_restart_and_malformed_or_unknown_cookie_cannot_authenticate(self):
        self.assertEqual(self.login().status_code, 200)
        for cookie in ('invalid', secrets.token_urlsafe(32)):
            with TestClient(app) as client:
                client.cookies.set(auth.settings.cookie, cookie)
                self.assertEqual(client.get('/admin/devices').status_code, 401)
        with patch.object(auth, 'sessions', auth.SessionStore()):
            self.assertEqual(self.client.get('/auth/admin/me').status_code, 401)

    def test_wrong_role_is_forbidden(self):
        token, _ = self.store.create(auth.Admin(9, '격리 점주', role='owner'))
        self.client.cookies.set(auth.settings.cookie, token)
        self.assertEqual(self.client.get('/auth/admin/me').status_code, 403)
        self.assertEqual(self.client.get('/admin/devices').status_code, 403)

    def test_login_rate_limit_and_recovery(self):
        for _ in range(5):
            self.assertEqual(self.login(password=secrets.token_urlsafe(32)).status_code, 401)
        response = self.login()
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.headers['retry-after'], '60')
        self.now[0] += 61
        self.assertEqual(self.login().status_code, 200)

    def test_database_errors_and_validation_never_reflect_secrets(self):
        token = self.csrf()
        with patch.object(auth, 'lookup_admin', side_effect=RuntimeError(secrets.token_urlsafe(32))):
            response = self.login()
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json(), {'detail': '인증 서비스를 사용할 수 없습니다. 서버 연결을 확인해 주세요.'})
        for payload in ({'admin_id': 'bad', 'password': self.password},
                        {'admin_id': 1, 'password': self.password, 'role': 'company_admin'},
                        {'admin_id': 1, 'password': self.password * 100},
                        {'admin_id': True, 'password': self.password}):
            response = self.client.post('/auth/admin/login', json=payload,
                        headers={'Origin': ORIGIN, 'X-CSRF-Token': token})
            self.assertEqual(response.status_code, 422)
            self.assertFalse(self.password in response.text)
            self.assertNotIn('input', response.text)
        response = self.client.post('/auth/admin/login', content='x' * 9000,
                                    headers={'Origin': ORIGIN, 'Content-Type': 'application/json'})
        self.assertEqual(response.status_code, 413)

    def test_auth_database_read_is_explicit_parameterized_and_read_only(self):
        self.assertEqual(self.login().status_code, 200)
        self.assertEqual(self.statements, [
            ('START TRANSACTION READ ONLY', ()),
            ('SELECT admin_id, admin_nm, admin_pw FROM admin WHERE admin_id = %s', (1,)),
        ])
        self.assertEqual((self.rollbacks, self.closed), (1, 1))

    def test_cors_preflight_and_unauthorized_responses_include_credentials(self):
        response = self.client.options('/admin/devices', headers={
            'Origin': ORIGIN, 'Access-Control-Request-Method': 'GET',
            'Access-Control-Request-Headers': 'X-CSRF-Token',
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['access-control-allow-credentials'], 'true')
        response = self.client.get('/admin/devices', headers={'Origin': ORIGIN})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.headers['access-control-allow-origin'], ORIGIN)
        response = self.client.options('/auth/admin/login', headers={
            'Origin': 'https://untrusted.example', 'Access-Control-Request-Method': 'POST'})
        self.assertEqual(response.status_code, 400)

    def test_remote_limit_is_not_replaced_by_auth_or_forwarded_headers(self):
        with TestClient(app, client=('203.0.113.9', 1234)) as remote:
            for path in ('/admin/devices','/auth/admin/csrf','/auth/admin/me'):
                response = remote.get(path, headers={'X-Forwarded-For': '127.0.0.1'})
                self.assertEqual(response.status_code, 403)

    def test_https_cookie_settings_and_insecure_transport_rejection(self):
        configured = auth.Settings('https', ('https://admin.example',))
        with patch.object(auth, 'settings', configured):
            self.assertEqual(self.client.get('/auth/admin/csrf').status_code, 403)
            with TestClient(app, base_url='https://testserver') as secure:
                response = secure.get('/auth/admin/csrf')
                self.assertEqual(response.status_code, 200)
                cookie = response.headers['set-cookie']
                self.assertIn('__Host-voisk_admin=', cookie)
                self.assertIn('Secure', cookie)
                self.assertIn('HttpOnly', cookie)
                self.assertNotIn('Domain=', cookie)

    def test_configuration_rejects_insecure_or_wildcard_origins(self):
        for env in (
            {'ADMIN_AUTH_MODE': 'https', 'ADMIN_AUTH_ALLOWED_ORIGINS': 'http://localhost:8080'},
            {'ADMIN_AUTH_MODE': 'local', 'ADMIN_AUTH_ALLOWED_ORIGINS': 'http://remote.example'},
            {'ADMIN_AUTH_MODE': 'local', 'ADMIN_AUTH_ALLOWED_ORIGINS': 'https://localhost:8080'},
            {'ADMIN_AUTH_MODE': 'local', 'ADMIN_AUTH_ALLOWED_ORIGINS': '*'},
            {'ADMIN_AUTH_MODE': 'unknown'},
        ):
            with patch.dict('os.environ', env, clear=True):
                with self.assertRaises(ValueError): auth.Settings.from_env()

    def test_anonymous_expiry_and_bounded_store(self):
        store = auth.SessionStore(clock=lambda: self.now[0], maximum=1)
        token, _ = store.create()
        with self.assertRaises(auth.HTTPException): store.create()
        self.now[0] = 300
        self.assertIsNone(store.get(token))
        self.assertIsNotNone(store.create())


if __name__ == '__main__':
    unittest.main()
