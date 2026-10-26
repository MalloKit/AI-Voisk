"""표준 라이브러리 SQLite 테스트. 실제 DB 연결·변경은 금지합니다."""
import sqlite3
import unittest
from unittest.mock import patch

import store_service


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
        else:
            if not sql.lstrip().upper().startswith('SELECT '):
                raise AssertionError('Only read queries are allowed')
            self.cursor.execute(sql.replace('%s', '?'), params)

    def fetchall(self):
        return [dict(row) for row in self.cursor.fetchall()]

    def fetchone(self):
        row = self.cursor.fetchone()
        return dict(row) if row else None


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


class StoreServiceTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:', check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
            CREATE TABLE admin (admin_id INTEGER PRIMARY KEY, admin_nm TEXT, admin_pw TEXT);
            CREATE TABLE owner (owner_id INTEGER PRIMARY KEY, own_login_id TEXT, own_pw TEXT);
            CREATE TABLE store (
                store_id INTEGER PRIMARY KEY, store_nm TEXT, store_add1 TEXT, store_add2 TEXT,
                store_code TEXT, store_phone TEXT, business_no TEXT, store_owner_nm TEXT,
                store_type TEXT, admin_id INTEGER, owner_id INTEGER);
            INSERT INTO admin VALUES (1, '담당자', 'admin-secret');
            INSERT INTO owner VALUES (7, 'owner-login', 'owner-secret');
            INSERT INTO store VALUES
                (2,'미연결 매장','부산',NULL,'A0002','051-002','0000000002','김대표','음식점',1,NULL),
                (1,'연결 매장','서울','2층','00123','02-001','0000000001','이대표','카페',1,7),
                (3,'같은 점주','부산','1층','A0003','051-003','0000000003','박대표','카페',1,7);
        """)
        self.statements = []
        self.rollbacks = self.closes = 0
        self.factory = patch('store_service.connection_factory', side_effect=lambda: Connection(self))
        self.factory.start()

    def tearDown(self):
        self.factory.stop()
        self.db.close()

    def test_list_joins_preserve_unlinked_and_multiple_stores_per_owner(self):
        result = store_service.list_stores()
        self.assertEqual(result['total'], 3)
        self.assertEqual([r['store_id'] for r in result['stores']], [1, 2, 3])
        linked, unlinked, same_owner = result['stores']
        self.assertEqual((linked['admin_name'], linked['owner_login_id']), ('담당자', 'owner-login'))
        self.assertIsNone(unlinked['owner_id'])
        self.assertIsNone(unlinked['owner_login_id'])
        self.assertIsNone(unlinked['address_detail'])
        self.assertEqual(same_owner['owner_id'], linked['owner_id'])

    def test_detail_has_exact_safe_contract_and_preserves_code(self):
        row = store_service.store_detail(1)
        self.assertEqual(set(row), {
            'store_id', 'store_name', 'address', 'address_detail', 'store_code', 'phone',
            'business_no', 'representative', 'store_type', 'admin_id', 'admin_name',
            'owner_id', 'owner_login_id'})
        self.assertEqual(row['store_code'], '00123')
        self.assertNotIn('secret', str(row))
        self.assertEqual(self.statements[-1][1], (1,))
        self.assertEqual((self.rollbacks, self.closes), (1, 1))

    def test_empty_list(self):
        self.db.execute('DELETE FROM store')
        self.db.commit()
        self.assertEqual(store_service.list_stores(), {'stores': [], 'total': 0})

    def test_missing_detail_closes_read_transaction(self):
        with self.assertRaises(store_service.StoreNotFound):
            store_service.store_detail(999)
        self.assertEqual((self.rollbacks, self.closes), (1, 1))

    def test_query_failure_closes_read_transaction(self):
        with patch.object(Cursor, 'execute', side_effect=RuntimeError('private DB error')):
            with self.assertRaises(RuntimeError):
                store_service.list_stores()
        self.assertEqual((self.rollbacks, self.closes), (1, 1))


if __name__ == '__main__':
    unittest.main()
