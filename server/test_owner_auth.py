"""점주 인증을 실제 Argon2id와 메모리 SQLite로 검증합니다. 외부 DB에 접속하지 않습니다."""
import os
import unittest
from unittest.mock import patch

import admin_auth
import owner_auth
from auth_test_support import authenticated_client
from owner_test_support import HASH, ORIGIN, PASSWORD, OwnerFixture


class OwnerAuthTests(unittest.TestCase):
    def setUp(self):
        self.f = OwnerFixture(self)
        self.client = self.f.client()

    def test_login_me_logout_flow_and_contract(self):
        response = self.f.login(self.client)
        self.assertEqual(response.status_code, 200)
        expected = {'owner': {'owner_id': 7, 'login_id': 'owner.one', 'role': 'owner', 'stores': [
            {'store_id': 1, 'store_name': '점주1 매장'}, {'store_id': 3, 'store_name': '점주1 2호점'}]}}
        self.assertEqual(response.json(), expected)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertNotIn(HASH, response.text)
        self.assertEqual(self.client.get('/auth/owner/me').json(), expected)
        token = self.f.csrf(self.client)
        logout = self.client.post('/auth/owner/logout', headers={'Origin': ORIGIN, 'X-CSRF-Token': token})
        self.assertEqual(logout.status_code, 204)
        self.assertEqual(self.client.get('/auth/owner/me').status_code, 401)

    def test_owner_without_store_gets_empty_list(self):
        self.f.db.execute('UPDATE store SET owner_id = NULL WHERE owner_id = 8')
        self.f.db.commit()
        self.assertEqual(self.f.login(self.client, 'owner.two').json()['owner']['stores'], [])

    def test_wrong_password_and_unknown_id_are_indistinguishable(self):
        wrong = self.f.login(self.client, password=PASSWORD + 'x')
        unknown = self.f.login(self.client, login_id='nobody')
        self.assertEqual((wrong.status_code, unknown.status_code), (401, 401))
        self.assertEqual(wrong.json(), unknown.json())
        self.assertEqual(self.client.get('/auth/owner/me').status_code, 401)

    def test_plaintext_or_other_hash_is_rejected(self):
        self.f.db.execute("UPDATE owner SET own_pw = ? WHERE owner_id = 7", (PASSWORD,))
        self.f.db.commit()
        self.assertEqual(self.f.login(self.client).status_code, 401)

    def test_login_requires_session_csrf_and_origin(self):
        body = {'login_id': 'owner.one', 'password': PASSWORD}
        self.assertEqual(self.client.post('/auth/owner/login', json=body, headers={'Origin': ORIGIN}).status_code, 403)
        token = self.f.csrf(self.client)
        for headers in ({'Origin': ORIGIN}, {'Origin': ORIGIN, 'X-CSRF-Token': 'x' * 43},
                        {'Origin': 'http://evil.example', 'X-CSRF-Token': token}, {'X-CSRF-Token': token}):
            self.assertEqual(self.client.post('/auth/owner/login', json=body, headers=headers).status_code, 403)
        self.assertEqual(self.client.get('/auth/owner/me').status_code, 401)

    def test_login_rotates_session_and_old_cookie_is_invalid(self):
        self.f.csrf(self.client)
        before = self.client.cookies.get(owner_auth.cookie_name())
        self.f.login(self.client)
        after = self.client.cookies.get(owner_auth.cookie_name())
        self.assertNotEqual(before, after)
        self.assertIsNone(owner_auth.sessions.get(before))

    def test_attempts_are_limited_separately_from_admin(self):
        for _ in range(5):
            self.assertEqual(self.f.login(self.client, password=PASSWORD + 'x').status_code, 401)
        limited = self.f.login(self.client)
        self.assertEqual(limited.status_code, 429)
        self.assertEqual(limited.headers['retry-after'], '60')
        self.assertIsNot(owner_auth.attempts, admin_auth.attempts)

    def test_validation_never_reflects_password_and_body_is_limited(self):
        token = self.f.csrf(self.client)
        headers = {'Origin': ORIGIN, 'X-CSRF-Token': token}
        for body in ({'login_id': 'owner.one'}, {'login_id': 42, 'password': PASSWORD},
                     {'login_id': 'a' * 101, 'password': PASSWORD}, {'login_id': 'owner.one', 'password': ''},
                     {'login_id': 'owner.one', 'password': PASSWORD, 'role': 'company_admin'}):
            response = self.client.post('/auth/owner/login', json=body, headers=headers)
            self.assertEqual(response.status_code, 422)
            self.assertNotIn(PASSWORD, response.text)
            self.assertNotIn('input', response.text)
        big = self.client.post('/auth/owner/login', content=b'x' * 8193,
                               headers={**headers, 'Content-Type': 'application/json'})
        self.assertEqual(big.status_code, 413)

    def test_database_failure_is_generic_503(self):
        self.f.fail_on = 'FROM owner'
        response = self.f.login(self.client)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('private', response.text)

    def test_me_reflects_store_link_change_and_deleted_owner(self):
        self.f.login(self.client)
        self.f.db.execute('UPDATE store SET owner_id = 8 WHERE store_id = 3')
        self.f.db.commit()
        self.assertEqual([s['store_id'] for s in self.client.get('/auth/owner/me').json()['owner']['stores']], [1])
        self.f.db.execute('UPDATE store SET owner_id = NULL WHERE owner_id = 7')
        self.f.db.execute('DELETE FROM owner WHERE owner_id = 7')
        self.f.db.commit()
        self.assertEqual(self.client.get('/auth/owner/me').status_code, 401)

    def test_me_does_not_extend_idle_lifetime(self):
        self.f.login(self.client)
        session = owner_auth.sessions.get(self.client.cookies.get(owner_auth.cookie_name()))
        touched = session.touched
        self.client.get('/auth/owner/me')
        self.assertEqual(session.touched, touched)

    def test_sessions_and_cookies_are_separate_from_company_admin(self):
        self.assertNotEqual(owner_auth.cookie_name(), admin_auth.settings.cookie)
        self.assertIsNot(owner_auth.sessions, admin_auth.sessions)
        self.f.login(self.client)
        self.assertEqual(self.client.get('/admin/stores').status_code, 401)
        self.assertEqual(self.client.get('/auth/admin/me').status_code, 401)
        # 점주 쿠키 값을 관리자 쿠키 이름으로 보내도 관리자 저장소에는 없습니다.
        with self.f.client() as forged:
            forged.cookies.set(admin_auth.settings.cookie, self.client.cookies.get(owner_auth.cookie_name()))
            self.assertEqual(forged.get('/admin/stores').status_code, 401)
        with self.f.client() as admin:
            with authenticated_client(admin):
                self.assertEqual(admin.get('/auth/owner/me').status_code, 401)
                self.assertEqual(admin.get('/owner/stores/1').status_code, 401)
                self.assertEqual(admin.get('/auth/admin/me').json()['admin']['role'], 'company_admin')

    def test_wrong_role_in_owner_session_is_forbidden(self):
        self.f.login(self.client)
        session = owner_auth.sessions.get(self.client.cookies.get(owner_auth.cookie_name()))
        session.admin = owner_auth.Owner(7, 'owner.one', role='company_admin')
        self.assertEqual(self.client.get('/auth/owner/me').status_code, 403)
        self.assertEqual(self.client.get('/owner/stores/1').status_code, 403)

    def test_remote_clients_are_blocked_before_database(self):
        remote = self.f.client(client=('203.0.113.1', 1234))
        for method, path in (('GET', '/auth/owner/csrf'), ('POST', '/auth/owner/login'), ('GET', '/auth/owner/me'),
                             ('POST', '/auth/owner/logout')):
            self.assertEqual(remote.request(method, path).status_code, 403)
        self.assertEqual(self.f.statements, [])

    def test_https_mode_uses_host_prefixed_owner_cookie(self):
        with patch.object(admin_auth, 'settings', admin_auth.Settings('https', ('https://owner.example',))):
            self.assertEqual(owner_auth.cookie_name(), '__Host-voisk_owner')

    def test_8081_origin_setting_keeps_8080_when_both_listed(self):
        value = 'http://localhost:8080,http://127.0.0.1:8080,http://localhost:8081,http://127.0.0.1:8081'
        with patch.dict(os.environ, {'ADMIN_AUTH_MODE': 'local', 'ADMIN_AUTH_ALLOWED_ORIGINS': value}):
            origins = admin_auth.Settings.from_env().origins
        self.assertEqual(set(origins), set(value.split(',')))


if __name__ == '__main__':
    unittest.main()
