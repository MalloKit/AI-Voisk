"""SQLite 메모리로만 알림 조회를 검증합니다."""
import sqlite3
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
import alert_service


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
            raise AssertionError('명시적 조회만 허용합니다.')
        if any(name in sql.lower() for name in ('device_token_hash','admin_pw','own_pw')):
            raise AssertionError('인증 컬럼 조회 금지')
        self.cursor.execute(sql.replace('%s', '?'), params)

    def row(self, row):
        if row is None:
            return None
        result = dict(row)
        for name in ('occurred_at','acknowledged_at','resolved_at'):
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


class AlertFixture:
    def setUp(self):
        self.db = sqlite3.connect(':memory:', check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
            CREATE TABLE store (store_id INTEGER PRIMARY KEY, store_nm TEXT);
            CREATE TABLE admin (admin_id INTEGER PRIMARY KEY, admin_nm TEXT, admin_pw TEXT);
            CREATE TABLE kiosk_device (device_id INTEGER PRIMARY KEY,device_code TEXT,store_id INTEGER,device_token_hash TEXT);
            CREATE TABLE device_alert (
                alert_id INTEGER PRIMARY KEY,device_id INTEGER,alert_type TEXT,
                severity TEXT,message TEXT,alert_status TEXT,occurred_at TEXT,
                acknowledged_at TEXT,acknowledged_by INTEGER,resolved_at TEXT);
            INSERT INTO store VALUES (1,'실제 매장 1'),(2,'실제 매장 2');
            INSERT INTO admin VALUES (7,'실제 확인자','fixture-admin-private');
            INSERT INTO kiosk_device VALUES
                (1,'DB-1',1,'fixture-token-private'),
                (2,'DB-2',1,'fixture-token-private'),
                (3,'DB-3',2,'fixture-token-private');
            INSERT INTO device_alert VALUES
                (101,1,'CUSTOM_ONE','NORMAL','첫 기록','UNREAD','2026-10-27 01:00:00',NULL,NULL,NULL),
                (102,1,'CUSTOM_TWO','HIGH','확인만 기록','READ','2026-10-27 02:00:00','2026-10-27 02:01:00',7,NULL),
                (103,2,'NEW_TYPE','FUTURE_LEVEL','해소만 기록','WAITING_REVIEW','2026-10-27 02:00:00',NULL,NULL,'2026-10-27 02:02:00'),
                (104,3,'전체','*','다른 매장','NEW_STATUS','2026-10-27 00:00:00',NULL,NULL,NULL);
        """)
        self.statements = []
        self.rollbacks = self.closes = 0
        self.factory = patch('alert_service.connection_factory', side_effect=lambda: Connection(self))
        self.factory.start()

    def tearDown(self):
        self.factory.stop()
        self.db.close()


class AlertServiceTests(AlertFixture, unittest.TestCase):
    def test_zero_alerts_is_successful(self):
        self.db.execute('DELETE FROM device_alert')
        self.db.commit()
        self.assertEqual(alert_service.list_alerts(), {'alerts': [], 'total': 0})

    def test_one_alert(self):
        self.db.execute('DELETE FROM device_alert WHERE alert_id != 101')
        self.db.commit()
        result = alert_service.list_alerts()
        self.assertEqual(result['total'], 1)
        self.assertEqual(result['alerts'][0]['alert_id'], 101)

    def test_multiple_devices_stores_and_stable_descending_order(self):
        result = alert_service.list_alerts()
        self.assertEqual(result['total'], 4)
        self.assertEqual([a['alert_id'] for a in result['alerts']], [103,102,101,104])
        self.assertEqual([a['device_id'] for a in result['alerts']], [2,1,1,3])
        self.assertEqual(result['alerts'][-1]['store_name'], '실제 매장 2')

    def test_raw_strings_are_not_limited_to_mock_enums(self):
        result = alert_service.alert_detail(103)
        self.assertEqual((result['alert_type'],result['severity'],result['alert_status']),
                         ('NEW_TYPE','FUTURE_LEVEL','WAITING_REVIEW'))

    def test_null_fields_are_preserved(self):
        row = alert_service.alert_detail(101)
        for name in ('acknowledged_at','acknowledged_by','acknowledged_by_name','resolved_at'):
            self.assertIsNone(row[name])

    def test_acknowledgement_and_resolution_are_independent(self):
        acknowledged = alert_service.alert_detail(102)
        resolved = alert_service.alert_detail(103)
        self.assertEqual(acknowledged['acknowledged_by_name'], '실제 확인자')
        self.assertIsNotNone(acknowledged['acknowledged_at'])
        self.assertIsNone(acknowledged['resolved_at'])
        self.assertIsNone(resolved['acknowledged_at'])
        self.assertIsNotNone(resolved['resolved_at'])

    def test_missing_admin_does_not_remove_alert(self):
        self.db.execute('DELETE FROM admin')
        self.db.commit()
        row = alert_service.alert_detail(102)
        self.assertEqual(row['acknowledged_by'], 7)
        self.assertIsNone(row['acknowledged_by_name'])
        self.assertEqual(alert_service.list_alerts()['total'], 4)

    def test_explicit_utc_session_and_offsets(self):
        row = alert_service.alert_detail(102)
        self.assertEqual(self.statements[0][0], "SET time_zone = '+00:00'")
        self.assertEqual(self.statements[1][0], 'START TRANSACTION READ ONLY')
        self.assertEqual(row['occurred_at'], '2026-10-27T02:00:00+00:00')
        aware = datetime(2026,10,27,11,tzinfo=timezone(timedelta(hours=9)))
        self.assertEqual(alert_service._timestamp(aware), row['occurred_at'])

    def test_safe_projection_and_parameterized_detail(self):
        row = alert_service.alert_detail(102)
        self.assertEqual(len(row), 14)
        self.assertNotIn('private', str(row))
        for sql, _ in self.statements:
            self.assertTrue(all(name not in sql.lower() for name in ('device_token_hash','admin_pw','own_pw')))
        self.assertEqual(self.statements[-1][1], (102,))

    def test_missing_or_failed_query_closes_connection(self):
        with self.assertRaises(alert_service.AlertNotFound):
            alert_service.alert_detail(999)
        self.assertEqual((self.rollbacks,self.closes), (1,1))
        with patch.object(Cursor,'execute',side_effect=RuntimeError('simulated')):
            with self.assertRaises(RuntimeError):
                alert_service.list_alerts()
        self.assertEqual((self.rollbacks,self.closes), (2,2))


if __name__ == '__main__':
    unittest.main()
