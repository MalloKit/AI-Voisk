"""메모리 SQLite 기기 조회 검증. 운영 DB에 접속하지 않습니다."""
import sqlite3
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
import device_service


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
        if sql == "SET time_zone = '+00:00'":
            return
        if sql == 'START TRANSACTION READ ONLY':
            self.fixture.db.execute('BEGIN')
            return
        if not sql.lstrip().upper().startswith('SELECT ') or '*' in sql:
            raise AssertionError('명시적 읽기 조회만 허용합니다.')
        if 'device_token_hash' in sql.lower():
            raise AssertionError('인증 컬럼은 조회할 수 없습니다.')
        self.cursor.execute(sql.replace('%s', '?'), params)

    def row(self, row):
        if row is None:
            return None
        result = dict(row)
        for name in ('registered_at', 'last_seen_at', 'last_synced_at'):
            if result.get(name) is not None:
                result[name] = datetime.fromisoformat(result[name])
        return result

    def fetchone(self):
        return self.row(self.cursor.fetchone())

    def fetchall(self):
        return [self.row(row) for row in self.cursor.fetchall()]


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


class DeviceFixture:
    def setUp(self):
        self.db = sqlite3.connect(':memory:', check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
            CREATE TABLE store (store_id INTEGER PRIMARY KEY, store_nm TEXT, store_add1 TEXT, store_add2 TEXT);
            CREATE TABLE kiosk_device (
                device_id INTEGER PRIMARY KEY, device_code TEXT UNIQUE NOT NULL,
                store_id INTEGER NOT NULL, device_token_hash TEXT,
                last_seen_at TEXT, last_synced_at TEXT, app_version TEXT,
                registered_at TEXT NOT NULL, is_active INTEGER NOT NULL);
            INSERT INTO store VALUES (1,'실제 매장','부산','2층'), (2,'다른 실제 매장','서울',NULL);
            INSERT INTO kiosk_device VALUES
                (1,'REAL-001',1,'fixture-secret',NULL,NULL,NULL,'2026-10-27 00:00:00',1),
                (2,'REAL-002',1,'fixture-secret','2026-10-27 01:00:00','2026-10-27 00:30:00','1.2.3','2026-10-26 23:00:00',0),
                (3,'REAL-003',2,'fixture-secret',NULL,NULL,'1.0.0','2026-10-25 00:00:00',1);
        """)
        self.statements = []
        self.rollbacks = self.closes = 0
        self.factory = patch('device_service.connection_factory', side_effect=lambda: Connection(self))
        self.factory.start()

    def tearDown(self):
        self.factory.stop()
        self.db.close()


class DeviceServiceTests(DeviceFixture, unittest.TestCase):
    def test_zero_devices_is_successful(self):
        self.db.execute('DELETE FROM kiosk_device')
        self.db.commit()
        self.assertEqual(device_service.list_devices(), {'devices': [], 'total': 0})

    def test_one_device(self):
        self.db.execute('DELETE FROM kiosk_device WHERE device_id != 1')
        self.db.commit()
        result = device_service.list_devices()
        self.assertEqual(result['total'], 1)
        self.assertEqual(result['devices'][0]['device_id'], 1)

    def test_multiple_devices_per_store_and_multiple_stores(self):
        result = device_service.list_devices()
        self.assertEqual(result['total'], 3)
        self.assertEqual([r['device_id'] for r in result['devices']], [1, 2, 3])
        self.assertEqual([r['store_id'] for r in result['devices']], [1, 1, 2])
        self.assertEqual([r['is_active'] for r in result['devices']], [True, False, True])
        self.assertEqual(result['devices'][2]['store_name'], '다른 실제 매장')

    def test_detail_preserves_nulls_and_actual_store(self):
        row = device_service.device_detail(1)
        self.assertEqual((row['store_name'], row['store_address']), ('실제 매장', '부산'))
        self.assertIsNone(row['app_version'])
        self.assertIsNone(row['last_seen_at'])
        self.assertIsNone(row['last_synced_at'])
        self.assertEqual(self.statements[-1][1], (1,))

    def test_timestamp_session_and_explicit_offset(self):
        row = device_service.device_detail(2)
        self.assertEqual(self.statements[0][0], "SET time_zone = '+00:00'")
        self.assertEqual(self.statements[1][0], 'START TRANSACTION READ ONLY')
        self.assertEqual(row['registered_at'], '2026-10-26T23:00:00+00:00')
        self.assertEqual(row['last_seen_at'], '2026-10-27T01:00:00+00:00')
        aware = datetime(2026, 10, 27, 9, tzinfo=timezone(timedelta(hours=9)))
        self.assertEqual(device_service._timestamp(aware), '2026-10-27T00:00:00+00:00')

    def test_no_auth_field_in_sql_or_response(self):
        result = device_service.list_devices()
        self.assertNotIn('device_token_hash', str(result))
        self.assertNotIn('fixture-secret', str(result))
        expected = {'device_id','device_code','store_id','store_name','store_address',
                    'store_address_detail','is_active','registered_at','app_version',
                    'last_seen_at','last_synced_at'}
        self.assertEqual(set(result['devices'][0]), expected)
        self.assertTrue(all('device_token_hash' not in sql.lower() for sql, _ in self.statements))

    def test_missing_detail_closes_transaction(self):
        with self.assertRaises(device_service.DeviceNotFound):
            device_service.device_detail(999)
        self.assertEqual((self.rollbacks, self.closes), (1, 1))

    def test_query_failure_closes_transaction(self):
        with patch.object(Cursor, 'execute', side_effect=RuntimeError('simulated')):
            with self.assertRaises(RuntimeError):
                device_service.list_devices()
        self.assertEqual((self.rollbacks, self.closes), (1, 1))

    def test_invalid_database_values_are_not_fabricated(self):
        with self.assertRaises(ValueError):
            device_service._timestamp(None, nullable=False)
        with self.assertRaises(ValueError):
            device_service._timestamp('not a timestamp')
        self.db.execute('UPDATE kiosk_device SET is_active=2 WHERE device_id=1')
        self.db.commit()
        with self.assertRaises(ValueError):
            device_service.device_detail(1)
        self.assertEqual((self.rollbacks, self.closes), (1, 1))


if __name__ == '__main__':
    unittest.main()
