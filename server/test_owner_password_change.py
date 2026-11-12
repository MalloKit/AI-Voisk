"""점주 본인 비밀번호 변경과 임시 비밀번호 판단. 메모리 SQLite와 실제 Argon2id로만 검증합니다."""
import secrets
import unittest

import admin_auth
import owner_auth
from owner_test_support import HASH, ORIGIN, PASSWORD, OwnerFixture

PATH = '/auth/owner/password'
# 회사 관리자가 '매장 전화번호로 초기화'하면 숫자 마지막 8자리가 비밀번호가 됩니다.
PHONE = '010-1234-5678'
PHONE_PASSWORD = '12345678'


class OwnerPasswordChangeTests(unittest.TestCase):
    def setUp(self):
        self.f = OwnerFixture(self)
        self.client = self.f.signed_in()

    def change(self, client=None, current=PASSWORD, new=None, **extra):
        body = {'current_password': current, 'new_password': new or secrets.token_urlsafe(18), **extra}
        return (client or self.client).post(PATH, json=body)

    def stored(self, owner_id=7):
        return self.f.value('SELECT own_pw FROM owner WHERE owner_id = ?', owner_id)

    def test_change_success_updates_only_own_pw_and_rotates_session(self):
        new = secrets.token_urlsafe(18)
        before_token = self.client.cookies.get(owner_auth.cookie_name())
        before = self.f.snapshot()
        response = self.change(new=new)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertEqual(response.json()['owner']['password_change_required'], False)
        self.assertEqual([s['store_id'] for s in response.json()['owner']['stores']], [1, 3])
        for secret in (new, PASSWORD, self.stored()):
            self.assertNotIn(secret, response.text)
        self.assertTrue(admin_auth.verify_password(self.stored(), new))
        self.assertFalse(admin_auth.verify_password(self.stored(), PASSWORD))
        after = self.f.snapshot()
        # own_pw 말고는 바뀐 것이 없습니다.
        self.assertEqual({k: v for k, v in after.items() if k != 'owner'},
                         {k: v for k, v in before.items() if k != 'owner'})
        self.assertEqual([r[:2] for r in after['owner']], [r[:2] for r in before['owner']])
        self.assertEqual(after['owner'][1], before['owner'][1])
        self.assertEqual([s for s in self.f.statements if s.startswith('UPDATE')],
                         ['UPDATE owner SET own_pw = %s WHERE owner_id = %s'])
        # 현재 브라우저에는 새 세션이 발급되고 이전 쿠키는 쓸 수 없습니다.
        after_token = self.client.cookies.get(owner_auth.cookie_name())
        self.assertNotEqual(before_token, after_token)
        self.assertIsNone(owner_auth.sessions.get(before_token))
        self.assertEqual(self.client.get('/auth/owner/me').status_code, 200)
        # 새 비밀번호로 로그인되고 이전 비밀번호로는 안 됩니다.
        with self.f.client() as other:
            self.assertEqual(self.f.login(other, password=PASSWORD).status_code, 401)
            self.assertEqual(self.f.login(other, password=new).status_code, 200)

    def test_other_sessions_of_same_owner_are_revoked_but_not_other_owners(self):
        second = self.f.signed_in()
        other_owner = self.f.signed_in('owner.two')
        self.assertEqual(self.change().status_code, 200)
        self.assertEqual(second.get('/auth/owner/me').status_code, 401)
        self.assertEqual(other_owner.get('/auth/owner/me').status_code, 200)
        self.assertEqual(self.client.get('/auth/owner/me').status_code, 200)

    def test_wrong_current_password_is_401_and_keeps_session_and_hash(self):
        response = self.change(current=PASSWORD + 'x')
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()['detail'], '현재 비밀번호가 올바르지 않습니다.')
        self.assertEqual(self.stored(), HASH)
        self.assertEqual(self.f.commits, 0)
        # 현재 비밀번호가 틀린 것은 로그인 만료가 아니므로 세션은 그대로입니다.
        self.assertEqual(self.client.get('/auth/owner/me').status_code, 200)

    def test_new_password_policy_matches_company_admin_policy(self):
        for new in ('short7!', 'x' * 129, ' ' * 8, '﻿' * 8, 'abcd\nefgh', 'abcd\x7fefgh'):
            response = self.change(new=new)
            self.assertEqual(response.status_code, 422, repr(new))
            self.assertNotIn(PASSWORD, response.text)
        for new in ('a' * 8, ' ' + 'b' * 126 + ' '):
            self.f.db.execute('UPDATE owner SET own_pw = ? WHERE owner_id = 7', (HASH,))
            self.f.db.commit()
            client = self.f.signed_in()
            self.assertEqual(self.change(client, new=new).status_code, 200, len(new))
            self.assertTrue(admin_auth.verify_password(self.stored(), new))
        self.assertEqual(self.f.commits, 2)

    def test_same_password_is_rejected(self):
        response = self.change(new=PASSWORD)
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()['detail'], '새 비밀번호는 현재 비밀번호와 달라야 합니다.')
        self.assertEqual(self.stored(), HASH)

    def test_store_phone_value_cannot_be_new_password(self):
        self.f.db.execute('UPDATE store SET store_phone = ? WHERE store_id = 3', (PHONE,))
        self.f.db.commit()
        response = self.change(new=PHONE_PASSWORD)
        self.assertEqual(response.status_code, 422)
        self.assertNotIn(PHONE_PASSWORD, response.text)
        self.assertEqual(self.stored(), HASH)

    def test_body_allows_only_two_fields_and_never_echoes_secrets(self):
        secret = secrets.token_urlsafe(18)
        for body in ({}, {'current_password': PASSWORD}, {'new_password': secret},
                     {'current_password': PASSWORD, 'new_password': secret, 'new_password_confirm': secret},
                     {'current_password': PASSWORD, 'new_password': secret, 'owner_id': 8},
                     {'current_password': 42, 'new_password': secret},
                     {'current_password': '', 'new_password': secret}):
            response = self.client.post(PATH, json=body)
            self.assertEqual(response.status_code, 422)
            self.assertNotIn(secret, response.text)
            self.assertNotIn(PASSWORD, response.text)
            self.assertNotIn('input', response.text)
        big = self.client.post(PATH, content=b'x' * 8193, headers={'Content-Type': 'application/json'})
        self.assertEqual(big.status_code, 413)
        self.assertEqual(self.stored(), HASH)

    def test_csrf_origin_and_login_are_required(self):
        for headers in ({'X-CSRF-Token': ''}, {'X-CSRF-Token': 'x' * 43}, {'Origin': 'http://evil.example'}):
            response = self.client.post(PATH, json={'current_password': PASSWORD, 'new_password': 'n' * 12},
                                        headers=headers)
            self.assertEqual(response.status_code, 403)
        with self.f.client() as anonymous:
            token = self.f.csrf(anonymous)
            response = anonymous.post(PATH, json={'current_password': PASSWORD, 'new_password': 'n' * 12},
                                      headers={'Origin': ORIGIN, 'X-CSRF-Token': token})
            self.assertEqual(response.status_code, 401)
            # 본문이 틀려도 로그인 확인이 먼저입니다.
            self.assertEqual(anonymous.post(PATH, json={}, headers={'Origin': ORIGIN, 'X-CSRF-Token': token})
                             .status_code, 401)
        self.assertEqual(self.stored(), HASH)
        self.assertEqual(self.f.statements, [])

    def test_attempts_are_limited_like_login(self):
        # 로그인과 같은 제한을 함께 씁니다. setUp의 로그인 1회 + 틀린 현재 비밀번호 4회 = 5회
        for _ in range(4):
            self.assertEqual(self.change(current=PASSWORD + 'x').status_code, 401)
        limited = self.change()
        self.assertEqual(limited.status_code, 429)
        self.assertEqual(limited.headers['retry-after'], '60')
        self.assertEqual(self.stored(), HASH)
        with self.f.client() as other:
            self.assertEqual(self.f.login(other).status_code, 429)

    def test_failures_roll_back_and_keep_session(self):
        for mode in ('rowcount', 'commit', 'UPDATE owner'):
            self.f.bad_rowcount = mode == 'rowcount'
            self.f.commit_failure = mode == 'commit'
            self.f.fail_on = mode if mode.startswith('UPDATE') else None
            response = self.change()
            self.assertEqual(response.status_code, 503, mode)
            self.assertNotIn('private', response.text)
            self.assertEqual(self.stored(), HASH)
            self.assertEqual(self.client.get('/auth/owner/me').status_code, 200)

    def test_deleted_owner_gets_401(self):
        self.f.db.execute('UPDATE store SET owner_id = NULL WHERE owner_id = 7')
        self.f.db.execute('DELETE FROM owner WHERE owner_id = 7')
        self.f.db.commit()
        self.assertEqual(self.change().status_code, 401)
        self.assertEqual(self.client.get('/auth/owner/me').status_code, 401)


class TemporaryPasswordTests(unittest.TestCase):
    def setUp(self):
        self.f = OwnerFixture(self)
        self.client = self.f.client()
        # 회사 관리자가 매장 3의 전화번호로 비밀번호를 초기화한 상태
        self.f.db.execute('UPDATE store SET store_phone = ? WHERE store_id = 3', (PHONE,))
        self.f.db.execute('UPDATE owner SET own_pw = ? WHERE owner_id = 7', (admin_auth.hasher.hash(PHONE_PASSWORD),))
        self.f.db.commit()

    def sign_in(self, password=PHONE_PASSWORD):
        response = self.f.login(self.client, password=password)
        self.client.headers.update({'Origin': ORIGIN, 'X-CSRF-Token': self.f.csrf(self.client)})
        return response

    def test_phone_password_login_blocks_owner_api_until_changed(self):
        login = self.sign_in()
        self.assertEqual(login.status_code, 200)
        self.assertIs(login.json()['owner']['password_change_required'], True)
        self.assertNotIn(PHONE_PASSWORD, login.text)
        self.assertIs(self.client.get('/auth/owner/me').json()['owner']['password_change_required'], True)
        session = owner_auth.sessions.get(self.client.cookies.get(owner_auth.cookie_name()))
        # 세션에는 판단 결과만 있고 비밀번호 원문은 없습니다.
        self.assertNotIn(PHONE_PASSWORD, repr(session))
        for method, path in (('GET', '/owner/stores/1'), ('GET', '/owner/stores/1/menu-board'),
                             ('GET', '/owner/stores/1/orders'), ('PATCH', '/owner/menus/10/sold-out')):
            response = self.client.request(method, path, json={'is_sold_out': True} if method == 'PATCH' else None)
            self.assertEqual(response.status_code, 403, path)
            self.assertEqual(response.json()['detail'], '임시 비밀번호를 먼저 변경해 주세요.')
        self.assertEqual(self.f.value('SELECT is_sold_out FROM menu WHERE menu_id = 10'), 0)
        self.assertEqual(self.client.get('/auth/owner/csrf').status_code, 200)

        new = secrets.token_urlsafe(18)
        changed = self.client.post(PATH, json={'current_password': PHONE_PASSWORD, 'new_password': new})
        self.assertEqual(changed.status_code, 200)
        self.assertIs(changed.json()['owner']['password_change_required'], False)
        self.client.headers['X-CSRF-Token'] = self.f.csrf(self.client)
        self.assertIs(self.client.get('/auth/owner/me').json()['owner']['password_change_required'], False)
        self.assertEqual(self.client.get('/owner/stores/1').status_code, 200)

    def test_temporary_session_can_log_out(self):
        self.sign_in()
        self.assertEqual(self.client.post('/auth/owner/logout').status_code, 204)
        self.assertEqual(self.client.get('/auth/owner/me').status_code, 401)

    def test_normal_password_login_is_not_blocked(self):
        self.f.db.execute('UPDATE owner SET own_pw = ? WHERE owner_id = 7', (HASH,))
        self.f.db.commit()
        login = self.sign_in(PASSWORD)
        self.assertIs(login.json()['owner']['password_change_required'], False)
        self.assertEqual(self.client.get('/owner/stores/1').status_code, 200)

    def test_short_or_unlinked_store_phones_do_not_count(self):
        # 다른 점주 매장의 번호는 이 점주의 임시 비밀번호가 아닙니다.
        self.f.db.execute("UPDATE store SET store_phone = '02-1' WHERE store_id = 3")
        self.f.db.execute('UPDATE store SET store_phone = ? WHERE store_id = 2', (PHONE,))
        self.f.db.commit()
        login = self.sign_in()
        self.assertEqual(login.status_code, 200)
        self.assertIs(login.json()['owner']['password_change_required'], False)

    def test_wrong_password_still_401_with_same_message(self):
        response = self.sign_in('87654321')
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()['detail'], '로그인 ID 또는 비밀번호가 올바르지 않습니다.')

    def test_helper_matches_reset_rule(self):
        self.assertTrue(owner_auth.is_store_phone_password('12345678', ['051-000', '(010) 1234-5678']))
        self.assertFalse(owner_auth.is_store_phone_password('12345678', ['010-1234-5679', None, '']))
        self.assertFalse(owner_auth.is_store_phone_password('\ud800' * 8, [PHONE]))


if __name__ == '__main__':
    unittest.main()
