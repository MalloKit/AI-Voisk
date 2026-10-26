"""메모리 SQLite로 검증합니다. 이 테스트는 Azure DB에 접속하지 않습니다."""
import sqlite3
import unittest
from unittest.mock import patch

import owner_service


class Cursor:
    def __init__(self, fixture):
        self.fixture = fixture
        self.cursor = fixture.db.cursor()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.cursor.close()

    def execute(self, sql, params=()):
        self.fixture.statements.append((sql, params))
        if sql == 'START TRANSACTION READ ONLY':
            self.fixture.db.execute('BEGIN')
            return
        if not sql.lstrip().upper().startswith('SELECT ') or '*' in sql:
            raise AssertionError('Only explicit SELECT projections are allowed')
        lowered = sql.lower()
        if any(field in lowered for field in ('own_pw', 'admin_pw')):
            raise AssertionError('Authentication columns must never be queried')
        self.cursor.execute(sql.replace('%s', '?'), params)

    def fetchall(self):
        return [dict(row) for row in self.cursor.fetchall()]

    def fetchone(self):
        row = self.cursor.fetchone()
        return dict(row) if row is not None else None


class Connection:
    def __init__(self, fixture):
        self.fixture = fixture

    def cursor(self):
        return Cursor(self.fixture)

    def rollback(self):
        self.fixture.rollbacks += 1
        self.fixture.db.rollback()

    def close(self):
        self.fixture.closes += 1


class OwnerFixture:
    def setUp(self):
        self.db = sqlite3.connect(':memory:', check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
            CREATE TABLE owner (owner_id INTEGER PRIMARY KEY, own_login_id TEXT, own_pw TEXT);
            CREATE TABLE admin (admin_id INTEGER PRIMARY KEY, admin_nm TEXT, admin_pw TEXT);
            CREATE TABLE store (
                store_id INTEGER PRIMARY KEY, store_nm TEXT, store_add1 TEXT,
                store_add2 TEXT, admin_id INTEGER, owner_id INTEGER);
            INSERT INTO owner VALUES
                (1,'unlinked','private-owner-1'),
                (2,'single','private-owner-2'),
                (3,'multiple','private-owner-3');
            INSERT INTO admin VALUES (7,'실제 담당자','private-admin');
            INSERT INTO store VALUES
                (10,'한 매장','부산',NULL,7,2),
                (20,'첫 매장','서울','2층',7,3),
                (21,'둘째 매장','부산','1층',7,3),
                (99,'점주 미연결 매장','대구',NULL,7,NULL);
        """)
        self.statements = []
        self.rollbacks = self.closes = 0
        self.factory = patch('owner_service.connection_factory', side_effect=lambda: Connection(self))
        self.factory.start()

    def tearDown(self):
        self.factory.stop()
        self.db.close()


class OwnerServiceTests(OwnerFixture, unittest.TestCase):
    def test_all_owners_include_zero_one_and_many_stores(self):
        result = owner_service.list_owners()
        self.assertEqual(result, {'owners': [
            {'owner_id': 1, 'login_id': 'unlinked', 'store_count': 0},
            {'owner_id': 2, 'login_id': 'single', 'store_count': 1},
            {'owner_id': 3, 'login_id': 'multiple', 'store_count': 2},
        ], 'total': 3})
        self.assertEqual((self.rollbacks, self.closes), (1, 1))

    def test_no_accounts_is_successful_empty_result(self):
        self.db.execute('DELETE FROM store')
        self.db.execute('DELETE FROM owner')
        self.db.commit()
        self.assertEqual(owner_service.list_owners(), {'owners': [], 'total': 0})

    def test_unlinked_account_exists_with_empty_store_list(self):
        self.assertEqual(owner_service.owner_detail(1), {
            'owner_id': 1, 'login_id': 'unlinked', 'store_count': 0, 'stores': []})

    def test_single_store_and_nullable_address_detail(self):
        result = owner_service.owner_detail(2)
        self.assertEqual(result['store_count'], 1)
        self.assertEqual(result['stores'], [{
            'store_id': 10, 'store_name': '한 매장', 'address': '부산',
            'address_detail': None, 'admin_id': 7, 'admin_name': '실제 담당자'}])

    def test_multiple_stores_use_exact_owner_relationship(self):
        result = owner_service.owner_detail(3)
        self.assertEqual(result['store_count'], 2)
        self.assertEqual([s['store_id'] for s in result['stores']], [20, 21])
        self.assertTrue(all(s['admin_name'] == '실제 담당자' for s in result['stores']))
        self.assertTrue(all(params == (3,) for _, params in self.statements[1:]))

    def test_missing_account_is_distinct_from_unlinked(self):
        with self.assertRaises(owner_service.OwnerNotFound):
            owner_service.owner_detail(404)
        self.assertEqual((self.rollbacks, self.closes), (1, 1))

    def test_secrets_not_selected_or_returned(self):
        result = [owner_service.list_owners(), owner_service.owner_detail(3)]
        self.assertNotIn('private-', str(result))
        for sql, _ in self.statements:
            self.assertNotIn('own_pw', sql.lower())
            self.assertNotIn('admin_pw', sql.lower())
        self.assertEqual(set(result[1]), {'owner_id', 'login_id', 'store_count', 'stores'})

    def test_query_error_closes_read_transaction(self):
        with patch.object(Cursor, 'execute', side_effect=RuntimeError('simulated')):
            with self.assertRaises(RuntimeError):
                owner_service.list_owners()
        self.assertEqual((self.rollbacks, self.closes), (1, 1))

    def test_missing_admin_does_not_drop_connected_store(self):
        self.db.execute('UPDATE store SET admin_id=77 WHERE store_id=10')
        self.db.commit()
        result = owner_service.owner_detail(2)
        self.assertEqual(result['store_count'], 1)
        self.assertEqual(result['stores'][0]['admin_id'], 77)
        self.assertIsNone(result['stores'][0]['admin_name'])


if __name__ == '__main__':
    unittest.main()
