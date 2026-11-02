"""SQLite 메모리 DB에서만 매장 쓰기를 검증합니다. Azure 접속은 차단합니다."""
import sqlite3
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from pymysql.err import IntegrityError
import admin_auth
import store_service
from auth_test_support import authenticated_client
from main import app


class Cursor:
    def __init__(self, fixture):
        self.f = fixture
        self.cursor = fixture.db.cursor()
        self.rowcount = -1
        self.lastrowid = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.cursor.close()

    def execute(self, sql, params=()):
        self.f.statements.append((sql, params))
        command = sql.strip().split()[0].upper()
        if self.f.failure == command:
            raise RuntimeError('private-sql-connection')
        if self.f.integrity and command in ('INSERT', 'UPDATE'):
            raise IntegrityError(self.f.integrity, 'private constraint SQL')
        if sql in ('START TRANSACTION', 'START TRANSACTION READ ONLY'):
            self.f.db.execute('BEGIN')
            return
        if command not in ('SELECT', 'INSERT', 'UPDATE'):
            raise AssertionError('Unexpected SQL')
        self.cursor.execute(sql.replace('%s', '?').replace(' FOR UPDATE', ''), params)
        self.rowcount = 0 if self.f.bad_rowcount and command in ('INSERT', 'UPDATE') else self.cursor.rowcount
        self.lastrowid = self.cursor.lastrowid

    def fetchall(self):
        return [dict(row) for row in self.cursor.fetchall()]

    def fetchone(self):
        row = self.cursor.fetchone()
        return dict(row) if row else None


class Connection:
    def __init__(self, fixture):
        self.f = fixture

    def cursor(self):
        return Cursor(self.f)

    def commit(self):
        if self.f.commit_failure:
            raise RuntimeError('private commit error')
        self.f.db.commit()
        self.f.commits += 1

    def rollback(self):
        self.f.db.rollback()
        self.f.rollbacks += 1

    def close(self):
        self.f.closes += 1


class StoreWriteTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:', check_same_thread=False)
        self.addCleanup(self.db.close)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.executescript("""
            CREATE TABLE admin (admin_id INTEGER PRIMARY KEY, admin_nm TEXT NOT NULL, admin_pw TEXT);
            CREATE TABLE owner (owner_id INTEGER PRIMARY KEY, own_login_id TEXT NOT NULL, own_pw TEXT);
            CREATE TABLE store (
                store_id INTEGER PRIMARY KEY AUTOINCREMENT,
                store_nm VARCHAR(100) NOT NULL, store_add1 VARCHAR(200) NOT NULL,
                store_add2 VARCHAR(200), store_code CHAR(5) NOT NULL,
                store_phone VARCHAR(50) NOT NULL, business_no CHAR(10) NOT NULL,
                store_owner_nm VARCHAR(50) NOT NULL, store_type VARCHAR(200) NOT NULL,
                admin_id INTEGER NOT NULL REFERENCES admin(admin_id),
                owner_id INTEGER REFERENCES owner(owner_id));
            INSERT INTO admin VALUES (1, '담당자', NULL), (2, '기존 담당', NULL);
            INSERT INTO owner VALUES (7, '기존 점주', NULL);
            INSERT INTO store VALUES (10, '기존 매장', '서울', '2층', '00123', '02-123',
                '0000000001', '대표', '카페', 2, 7);
            CREATE TABLE orders (order_id INTEGER PRIMARY KEY, store_id INTEGER REFERENCES store(store_id));
            INSERT INTO orders VALUES (3,10);
        """)
        self.statements = []
        self.commits = self.rollbacks = self.closes = 0
        self.failure = self.integrity = None
        self.commit_failure = self.bad_rowcount = False
        guard = patch('database.connect', side_effect=AssertionError('Live DB forbidden'))
        guard.start(); self.addCleanup(guard.stop)
        factory = patch('store_service.connection_factory', side_effect=lambda: Connection(self))
        factory.start(); self.addCleanup(factory.stop)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        context = authenticated_client(self.client)
        context.__enter__(); self.addCleanup(context.__exit__, None, None, None)
        self.input = dict(store_name="새 매장", address="부산", address_detail=None,
                          store_code="00123", phone="051-123-4567", business_no="0000000001",
                          representative="새 대표", store_type="음식점")

    def create(self, body=None):
        return self.client.post('/admin/stores', json=self.input if body is None else body)

    def modify(self, body=None, store_id=10):
        return self.client.patch('/admin/stores/' + str(store_id),
                                 json={'store_name': '수정 매장'} if body is None else body)

    def count(self):
        return self.db.execute('SELECT COUNT(*) FROM store').fetchone()[0]

    def test_create_uses_auto_id_session_admin_and_null_owner(self):
        response = self.create()
        self.assertEqual(response.status_code, 201, response.text)
        row = response.json()
        self.assertGreater(row['store_id'], 10)
        self.assertEqual(row['admin_id'], 1)
        self.assertEqual(row['admin_name'], '담당자')
        self.assertIsNone(row['owner_id'])
        self.assertIsNone(row['address_detail'])
        self.assertEqual((self.commits, self.closes), (1, 1))
        self.assertEqual(self.client.get('/admin/stores').json()['total'], 2)
        self.assertEqual(self.client.get('/admin/stores/' + str(row['store_id'])).json(), row)

    def test_duplicate_postcode_and_business_number_are_allowed(self):
        for _ in range(2):
            self.assertEqual(self.create().status_code, 201)
        self.assertEqual(self.count(), 3)

    def test_patch_preserves_all_relationships_and_orders(self):
        response = self.modify()
        self.assertEqual(response.status_code, 200)
        row = response.json()
        self.assertEqual((row['store_id'], row['admin_id'], row['owner_id']), (10, 2, 7))
        self.assertEqual((row['address_detail'], row['owner_login_id']), ('2층', '기존 점주'))
        self.assertEqual(self.db.execute('SELECT store_id FROM orders').fetchone()[0], 10)
        self.assertTrue(any('FOR UPDATE' in sql for sql, _ in self.statements))

    def test_patch_all_basic_fields_and_explicit_null_detail(self):
        row = self.modify(self.input).json()
        for key, value in self.input.items():
            self.assertEqual(row[key], value)
        self.assertIsNone(row['address_detail'])

    def test_noop_patch_is_success_without_update(self):
        response = self.modify({'store_name': '기존 매장'})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(any(sql.startswith('UPDATE') for sql, _ in self.statements))
        self.assertEqual(self.commits, 1)

    def test_nonexistent_store_is_404_and_rolls_back(self):
        self.assertEqual(self.modify(store_id=999).status_code, 404)
        self.assertEqual((self.commits, self.rollbacks, self.closes), (0, 1, 1))

    def test_missing_empty_and_unknown_fields_rejected_before_db(self):
        bodies = [{}, {'store_name': ''}, {**self.input, 'admin_id': 2},
                  {**self.input, 'owner_id': 7}, {**self.input, 'store_id': 40}]
        for body in bodies:
            with self.subTest(body=tuple(body)):
                self.assertEqual(self.create(body).status_code, 422)
        for body in [{}, {'admin_id': 1}, {'owner_id': None}, {'store_id': 5},
                     {'store_name': None}, {'store_name': 42}, {'store_name': '  '}]:
            self.assertEqual(self.modify(body).status_code, 422)
        self.assertFalse(self.statements)

    def test_field_lengths_formats_and_control_characters(self):
        limits = {'store_name': 100, 'address': 200, 'address_detail': 200,
                  'phone': 50, 'representative': 50, 'store_type': 200}
        for key, length in limits.items():
            self.assertEqual(self.create({**self.input, key: '가' * (length + 1)}).status_code, 422)
        for key, value in [('store_code', '1234'), ('store_code', 'ABCDE'),
                           ('store_code', '１２３４５'), ('business_no', '123-456'),
                           ('business_no', '12345678901'), ('phone', 'hello\nworld')]:
            self.assertEqual(self.create({**self.input, key: value}).status_code, 422)
        self.assertEqual(self.count(), 1)

    def test_exact_boundaries_whitespace_and_leading_zeroes(self):
        body = {**self.input, 'store_name': '  ' + '가' * 100 + '  ',
                'address': '가' * 200, 'address_detail': '', 'phone': '010-1234-5678',
                'representative': '가' * 50, 'store_type': '가' * 200}
        # Raw length is bounded as well; ordinary surrounding whitespace is normalized.
        body['store_name'] = '가' * 100
        response = self.create(body)
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()['store_code'], '00123')
        self.assertIsNone(response.json()['address_detail'])
        self.assertEqual(self.modify({'store_name': '  trim  '}).json()['store_name'], 'trim')

    def test_insert_failure_rolls_back_and_is_sanitized(self):
        self.failure = 'INSERT'
        response = self.create()
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('private', response.text)
        self.assertEqual((self.count(), self.commits, self.rollbacks, self.closes), (1, 0, 1, 1))

    def test_update_failure_rolls_back(self):
        self.failure = 'UPDATE'
        self.assertEqual(self.modify().status_code, 503)
        self.assertEqual(self.db.execute('SELECT store_nm FROM store WHERE store_id=10').fetchone()[0], '기존 매장')
        self.assertEqual((self.commits, self.rollbacks), (0, 1))

    def test_post_write_read_or_commit_failure_rolls_back_insert(self):
        for stage in ('read', 'commit'):
            self.failure = 'SELECT' if stage == 'read' else None
            self.commit_failure = stage == 'commit'
            self.assertEqual(self.create().status_code, 503)
            self.assertEqual(self.count(), 1)
            if stage == 'commit':
                self.assertEqual(self.modify().status_code, 503)
                self.assertEqual(self.db.execute('SELECT store_nm FROM store WHERE store_id=10').fetchone()[0], '기존 매장')
        self.assertEqual(self.commits, 0)

    def test_unexpected_affected_rows_rolls_back(self):
        self.bad_rowcount = True
        for response in (self.create(), self.modify()):
            self.assertEqual(response.status_code, 503)
        self.assertEqual(self.count(), 1)
        self.assertEqual(self.commits, 0)

    def test_mysql_constraint_errors_are_safe_conflicts(self):
        # No fabricated UNIQUE index: inject MySQL codes to verify defensive mapping.
        for code in (1062, 1451, 1452):
            self.integrity = code
            response = self.create()
            self.assertEqual(response.status_code, 409)
            self.assertNotIn('private', response.text)
            self.assertEqual(self.count(), 1)

    def test_unauthenticated_wrong_role_expired_and_remote_cannot_write(self):
        with TestClient(app) as anonymous:
            self.assertEqual(anonymous.post('/admin/stores', json=self.input).status_code, 401)
            self.assertEqual(anonymous.patch('/admin/stores/10', json=self.input).status_code, 401)
        with TestClient(app, client=('203.0.113.1', 1234)) as remote:
            self.assertEqual(remote.post('/admin/stores', json=self.input).status_code, 403)
        cookie = self.client.cookies.get(admin_auth.settings.cookie)
        session = admin_auth.sessions.get(cookie)
        original = session.admin
        session.admin = admin_auth.Admin(1, '다른 역할', role='owner')
        self.assertEqual(self.create().status_code, 403)
        session.admin = original
        admin_auth.sessions.revoke(cookie)
        self.assertEqual(self.modify().status_code, 401)
        self.assertFalse(self.statements)

    def test_csrf_and_origin_required_on_both_methods(self):
        for header in ('X-CSRF-Token', 'Origin'):
            previous = self.client.headers.pop(header)
            self.assertEqual(self.create().status_code, 403)
            self.assertEqual(self.modify().status_code, 403)
            self.client.headers[header] = previous
        for headers in ({'X-CSRF-Token': 'x' * 43}, {'Origin': 'http://untrusted.example'}):
            self.assertEqual(self.client.post('/admin/stores', json=self.input, headers=headers).status_code, 403)
            self.assertEqual(self.client.patch('/admin/stores/10', json=self.input, headers=headers).status_code, 403)
        self.assertFalse(self.statements)

    def test_patch_cors_preflight_credentials_and_no_unsupported_writes(self):
        response = self.client.options('/admin/stores/10', headers={
            'Origin': 'http://localhost:8080', 'Access-Control-Request-Method': 'PATCH',
            'Access-Control-Request-Headers': 'content-type,x-csrf-token'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['access-control-allow-credentials'], 'true')
        self.assertEqual(self.client.delete('/admin/stores/10').status_code, 405)
        self.assertEqual(self.client.put('/admin/stores/10', json={}).status_code, 405)

    def test_sql_values_are_bound_and_connection_failure_is_sanitized(self):
        name = "가게'; DROP TABLE store; --"
        self.assertEqual(self.create({**self.input, 'store_name': name}).status_code, 201)
        self.assertFalse(any(name in sql for sql, _ in self.statements))
        self.assertTrue(any(name in params for _, params in self.statements))
        with patch('store_service.connection_factory', side_effect=RuntimeError('private host')):
            response = self.modify()
            self.assertEqual(response.status_code, 503)
            self.assertNotIn('private', response.text)


if __name__ == '__main__':
    unittest.main()
