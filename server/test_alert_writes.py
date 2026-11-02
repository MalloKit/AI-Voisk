"""Isolated acknowledgement tests; SQLite does not verify MySQL row locking."""
import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch
from fastapi.testclient import TestClient
import admin_auth
import test_device_writes as fixtures
from main import app


class Cursor(fixtures.Cursor):
    def execute(self, sql, params=()):
        if self.fixture.alert_postread_failure and 'FROM device_alert a' in sql:
            raise RuntimeError('private postread failure')
        super().execute(sql, params)
    def _row(self, row):
        result = super()._row(row)
        if result:
            for name in ('occurred_at','acknowledged_at','resolved_at'):
                if result.get(name) is not None: result[name]=datetime.fromisoformat(result[name])
        return result


class Connection(fixtures.Connection):
    def cursor(self): return Cursor(self.fixture)


class AlertWriteTests(unittest.TestCase):
    def setUp(self):
        fixtures.DeviceWriteTests.setUp(self)
        self.db.executescript("""
          CREATE TABLE admin (admin_id INTEGER PRIMARY KEY, admin_nm TEXT, admin_pw TEXT);
          INSERT INTO admin VALUES (1,'현재 관리자',NULL),(2,'다른 관리자',NULL);
          CREATE TABLE device_alert (alert_id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id INTEGER NOT NULL REFERENCES kiosk_device(device_id), alert_type TEXT NOT NULL,
            severity TEXT NOT NULL, message TEXT NOT NULL, alert_status TEXT NOT NULL DEFAULT 'UNREAD',
            occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, acknowledged_at TEXT,
            acknowledged_by INTEGER REFERENCES admin(admin_id), resolved_at TEXT);
          INSERT INTO device_alert (alert_id,device_id,alert_type,severity,message) VALUES (101,7,'CUSTOM','HIGH','알림 내용');
        """)
        self.db.commit();self.alert_postread_failure=False
        guard=patch('alert_service.connection_factory',side_effect=lambda:Connection(self));guard.start();self.addCleanup(guard.stop)
    def tearDown(self): fixtures.DeviceWriteTests.tearDown(self)
    def ack(self, alert=101, body=None, **kwargs):
        return self.client.patch(f'/admin/alerts/{alert}/acknowledge',json={'expected_status':'UNREAD'} if body is None else body,**kwargs)
    def row(self): return dict(self.db.execute('SELECT * FROM device_alert WHERE alert_id=101').fetchone())

    def test_acknowledges_with_session_administrator_and_database_timestamp(self):
        response=self.ack();self.assertEqual(response.status_code,200)
        row=response.json();self.assertEqual(row['alert_status'],'ACKNOWLEDGED');self.assertEqual(row['acknowledged_by'],1)
        self.assertEqual(row['acknowledged_by_name'],'현재 관리자');self.assertIsNotNone(row['acknowledged_at'])
        self.assertTrue(row['acknowledged_at'].endswith('+00:00'));self.assertIsNone(row['resolved_at'])
        self.assertEqual(len(row),14);self.assertEqual(self.client.get('/admin/alerts/101').json(),row)
        self.assertEqual(self.client.get('/admin/alerts').json()['alerts'],[row])
        self.assertEqual(self.statements[0][0],"SET time_zone = '+00:00'")
        locked=next(sql for sql,_ in self.statements if 'FOR UPDATE' in sql)
        self.assertIn('FROM device_alert',locked);self.assertNotIn('JOIN',locked)
        update=next(x for x in self.statements if x[0].startswith('UPDATE'))
        self.assertIn('CURRENT_TIMESTAMP',update[0]);self.assertEqual(update[1],('ACKNOWLEDGED',1,101))

    def test_same_admin_retry_preserves_first_record_without_update(self):
        self.assertEqual(self.ack().status_code,200);first=self.row();self.statements.clear()
        self.assertEqual(self.ack().status_code,200);self.assertEqual(self.row(),first)
        self.assertFalse(any(sql.startswith('UPDATE') for sql,_ in self.statements))

    def test_other_admin_first_acknowledgement_is_conflict(self):
        self.db.execute("UPDATE device_alert SET alert_status='ACKNOWLEDGED',acknowledged_by=2,acknowledged_at=CURRENT_TIMESTAMP")
        self.db.commit();before=self.row();self.assertEqual(self.ack().status_code,409);self.assertEqual(self.row(),before)

    def test_unknown_and_inconsistent_records_never_auto_correct(self):
        cases=[('UNREAD',None,1),('UNREAD','2026-10-29 00:00:00',None),('UNREAD','2026-10-29 00:00:00',1),
               ('ACKNOWLEDGED',None,None),('ACKNOWLEDGED',None,1),('ACKNOWLEDGED','2026-10-29 00:00:00',None),
               ('READ',None,None),('RESOLVED',None,None),('NEW_STATUS',None,None),('unread',None,None)]
        for status,at,by in cases:
            self.db.execute('UPDATE device_alert SET alert_status=?,acknowledged_at=?,acknowledged_by=?',(status,at,by));self.db.commit()
            before=self.row();self.assertEqual(self.ack().status_code,409);self.assertEqual(self.row(),before)

    def test_resolved_timestamp_and_unrelated_tables_remain_unchanged(self):
        self.db.execute("UPDATE device_alert SET resolved_at='2026-10-29 01:00:00'");self.db.commit();before=self.row()
        tables=['kiosk_device','orders','menu','store','admin']
        snapshot={name:[tuple(row) for row in self.db.execute('SELECT * FROM '+name)] for name in tables}
        self.assertEqual(self.ack().status_code,200);after=self.row()
        for key in before:
            if key not in ('alert_status','acknowledged_at','acknowledged_by'):self.assertEqual(after[key],before[key])
        self.assertEqual(snapshot,{name:[tuple(row) for row in self.db.execute('SELECT * FROM '+name)] for name in tables})
        self.assertTrue(all('device_token_hash' not in sql and 'admin_pw' not in sql for sql,_ in self.statements))

    def test_missing_alert_and_strict_request_validation(self):
        self.assertEqual(self.ack(alert=999).status_code,404);self.statements.clear()
        for body in [{}, {'expected_status':None},{'expected_status':1},{'expected_status':True},
                     {'expected_status':'ACKNOWLEDGED'},{'expected_status':'UNREAD '},
                     {'expected_status':'UNREAD','acknowledged_by':2}, {'expected_status':'UNREAD','secret':'private-input'}]:
            response=self.ack(body=body);self.assertEqual(response.status_code,422)
            self.assertNotIn('private-input',response.text);self.assertNotIn('input',response.text)
        for value in (0,-1,'bad',2147483648):self.assertEqual(self.ack(alert=value).status_code,422)
        self.assertFalse(self.statements)

    def test_update_read_commit_and_rowcount_failures_rollback_safely(self):
        for flag,value in [('failure','UPDATE'),('failure','SELECT'),('commit_failure',True),('bad_rowcount',True),('alert_postread_failure',True)]:
            before=self.row();setattr(self,flag,value);response=self.ack();setattr(self,flag,None if flag=='failure' else False)
            self.assertEqual(response.status_code,503);self.assertNotIn('private',response.text);self.assertEqual(self.row(),before)
        self.assertGreaterEqual(self.rollbacks,5)

    def test_idempotent_retry_read_or_commit_failure_keeps_original(self):
        self.assertEqual(self.ack().status_code,200);before=self.row()
        for flag in ('commit_failure','alert_postread_failure'):
            setattr(self,flag,True);self.assertEqual(self.ack().status_code,503);setattr(self,flag,False);self.assertEqual(self.row(),before)

    def test_authentication_role_origin_csrf_and_remote_access(self):
        with TestClient(app) as anonymous:
            self.assertEqual(anonymous.patch('/admin/alerts/101/acknowledge',json={'expected_status':'UNREAD'}).status_code,401)
        for headers in ({'X-CSRF-Token':''},{'X-CSRF-Token':'bad'},{'Origin':'http://evil.invalid'}):
            self.assertEqual(self.ack(headers=headers).status_code,403)
        with patch.object(admin_auth.sessions,'get',return_value=SimpleNamespace(admin=SimpleNamespace(role='owner'))):
            self.assertEqual(self.ack().status_code,403)
        with TestClient(app,client=('203.0.113.1',1)) as remote:
            self.assertEqual(remote.patch('/admin/alerts/101/acknowledge',json={'expected_status':'UNREAD'}).status_code,403)
        self.assertFalse(self.statements)

    def test_expired_session_blocks_before_database(self):
        now=admin_auth.sessions.clock()
        with patch.object(admin_auth.sessions,'clock',return_value=now+30000):
            self.assertEqual(self.ack().status_code,401)
        self.assertFalse(self.statements)
