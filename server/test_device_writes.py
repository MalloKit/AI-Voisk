"""Device writes and orders share an isolated SQLite fixture; no live DB access."""
import sqlite3
import unittest
from datetime import datetime
from unittest.mock import patch
from uuid import uuid4
from fastapi.testclient import TestClient
from pymysql.err import IntegrityError
import admin_auth
import test_orders
from main import app


class Cursor(test_orders.Cursor):
    @property
    def rowcount(self):
        return 0 if self.fixture.bad_rowcount else self.cursor.rowcount
    @property
    def lastrowid(self):
        return None if self.fixture.bad_id else self.cursor.lastrowid
    def execute(self, sql, params=()):
        self.fixture.statements.append((sql, params))
        command = sql.strip().split()[0]
        if self.fixture.failure == command or (self.fixture.postread_failure and 's.store_nm AS store_name' in sql):
            raise RuntimeError('private database error')
        if self.fixture.integrity and command in ('INSERT', 'UPDATE'):
            raise IntegrityError(self.fixture.integrity, 'private constraint')
        if sql == 'START TRANSACTION':
            self.schema_rows = None
            self.fixture.db.execute('BEGIN')
            return
        try:
            super().execute(sql, params)
        except sqlite3.IntegrityError as error:
            raise IntegrityError(1062 if 'UNIQUE' in str(error) else 1452, 'private constraint') from None
    def _row(self, row):
        result = super()._row(row)
        if result:
            for name in ('registered_at', 'last_seen_at', 'last_synced_at'):
                if result.get(name) is not None:
                    result[name] = datetime.fromisoformat(result[name])
        return result


class Connection(test_orders.Connection):
    def cursor(self): return Cursor(self.fixture)
    def commit(self):
        if self.fixture.commit_failure: raise RuntimeError('private commit')
        super().commit()
    def rollback(self):
        self.fixture.rollbacks += 1
        super().rollback()


class DeviceWriteTests(unittest.TestCase):
    def setUp(self):
        test_orders.OrderApiTests.setUp(self)
        self.db.executescript("""
          ALTER TABLE store ADD COLUMN store_add1 TEXT DEFAULT '부산';
          ALTER TABLE store ADD COLUMN store_add2 TEXT;
          INSERT INTO store (store_id,store_nm) VALUES (2,'기기 없는 매장');
          ALTER TABLE kiosk_device ADD COLUMN device_code TEXT COLLATE NOCASE;
          UPDATE kiosk_device SET device_code='Existing-7';
          CREATE UNIQUE INDEX uq_device_code ON kiosk_device(device_code);
          ALTER TABLE kiosk_device ADD COLUMN device_token_hash TEXT;
          ALTER TABLE kiosk_device ADD COLUMN registered_at TEXT NOT NULL DEFAULT '2026-10-29 00:00:00';
          ALTER TABLE kiosk_device ADD COLUMN app_version TEXT;
          ALTER TABLE kiosk_device ADD COLUMN last_seen_at TEXT;
          ALTER TABLE kiosk_device ADD COLUMN last_synced_at TEXT;
          ALTER TABLE kiosk_device ADD COLUMN current_menu_version INTEGER NOT NULL DEFAULT 0;
          CREATE TRIGGER store_fk_insert BEFORE INSERT ON kiosk_device
          WHEN NOT EXISTS (SELECT 1 FROM store WHERE store_id=NEW.store_id)
          BEGIN SELECT RAISE(ABORT,'FOREIGN KEY constraint failed'); END;
        """)
        self.db.commit()
        self.statements = []; self.rollbacks = 0
        self.failure = self.integrity = None
        self.bad_rowcount = self.bad_id = self.commit_failure = self.postread_failure = False
        for name in ('device_service.connection_factory', 'order_service.connection_factory'):
            guard = patch(name, side_effect=lambda: Connection(self)); guard.start(); self.addCleanup(guard.stop)
    def tearDown(self): test_orders.OrderApiTests.tearDown(self)
    def create(self, **changes):
        return self.client.post('/admin/devices', json={'device_code':'KIOSK-002','store_id':2,**changes})
    def status(self, target=False, expected=True, device=7):
        return self.client.patch(f'/admin/devices/{device}/status', json={'is_active':target,'expected_is_active':expected})

    def test_create_inactive_public_contract_and_defaults(self):
        response = self.create(); self.assertEqual(response.status_code,201)
        row=response.json(); self.assertFalse(row['is_active']); self.assertEqual(row['store_id'],2)
        self.assertEqual(row['device_code'],'KIOSK-002'); self.assertTrue(row['registered_at'].endswith('+00:00'))
        self.assertIsNone(row['app_version']); self.assertIsNone(row['last_seen_at']); self.assertIsNone(row['last_synced_at'])
        self.assertNotIn('device_token_hash',row); self.assertNotIn('current_menu_version',row)
        self.assertEqual(self.db.execute('SELECT current_menu_version FROM kiosk_device WHERE device_id=?',(row['device_id'],)).fetchone()[0],0)
        self.assertTrue(all('device_token_hash' not in sql for sql,_ in self.statements))
        insert=next(x for x in self.statements if x[0].startswith('INSERT'))
        self.assertIn('VALUES (%s, %s, 0)',insert[0]); self.assertEqual(insert[1],('KIOSK-002',2))
        self.assertEqual(self.client.get(f"/admin/devices/{row['device_id']}").json(),row)
        self.assertEqual(self.client.get('/admin/devices').json()['total'],2)

    def test_codes_preserve_case_and_support_boundaries_multiple_devices(self):
        for code in ('x','MiXeD_-09','A'*50): self.assertEqual(self.create(device_code=code).status_code,201)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM kiosk_device WHERE store_id=2').fetchone()[0],3)
        self.assertEqual(self.db.execute("SELECT device_code FROM kiosk_device WHERE device_code='mixed_-09'").fetchone()[0],'MiXeD_-09')

    def test_duplicates_missing_store_and_fk_conflicts(self):
        self.assertEqual(self.create(device_code='existing-7').status_code,409)
        self.assertEqual(self.create(store_id=999).status_code,404)
        self.integrity=1452
        response=self.create(); self.assertEqual(response.status_code,409); self.assertNotIn('private',response.text)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM kiosk_device').fetchone()[0],1)

    def test_create_strict_validation_and_no_reflected_input(self):
        for body in [{}, {'device_code':'x'}, *[{'device_code':v,'store_id':2} for v in ('','a'*51,' x','x ','x\n','가','x.y',None,1)],
                     *[{'device_code':'x','store_id':v} for v in (0,-1,True,'2',2.5,2147483648)],
                     {'device_code':'x','store_id':2,'is_active':True}, {'device_code':'x','store_id':2,'device_token_hash':'canary-not-secret'}]:
            response=self.client.post('/admin/devices',json=body); self.assertEqual(response.status_code,422)
            self.assertNotIn('input',response.text); self.assertNotIn('canary-not-secret',response.text)
        self.assertFalse(self.statements)

    def test_activation_deactivation_same_state_and_preserved_columns(self):
        before=dict(self.db.execute('SELECT * FROM kiosk_device WHERE device_id=7').fetchone())
        self.assertEqual(self.status().status_code,200)
        self.assertFalse(self.client.get('/admin/devices/7').json()['is_active'])
        self.statements.clear(); self.assertEqual(self.status(False,False).status_code,200)
        self.assertFalse(any(sql.startswith('UPDATE') for sql,_ in self.statements))
        self.assertEqual(self.status(True,False).status_code,200)
        self.assertEqual(dict(self.db.execute('SELECT * FROM kiosk_device WHERE device_id=7').fetchone()),before)
        self.assertTrue(any('FOR UPDATE' in sql for sql,_ in self.statements))
        self.assertTrue(all('UPDATE kiosk_device SET is_active = %s WHERE device_id = %s' == sql for sql,_ in self.statements if sql.startswith('UPDATE')))

    def test_stale_expected_status_is_409_even_if_target_matches(self):
        self.assertEqual(self.status().status_code,200)
        self.assertEqual(self.status(False,True).status_code,409)
        self.assertEqual(self.status(True,True).status_code,409)
        self.assertFalse(self.client.get('/admin/devices/7').json()['is_active'])
        self.assertEqual(self.status(device=999).status_code,404)

    def test_status_strict_boolean_required_and_unknown_fields(self):
        for body in [{}, {'is_active':False}, {'expected_is_active':True},
                     *[{'is_active':x,'expected_is_active':True} for x in (0,1,'false',None)],
                     *[{'is_active':False,'expected_is_active':x} for x in (1,'true',None)],
                     {'is_active':False,'expected_is_active':True,'store_id':2}]:
            self.assertEqual(self.client.patch('/admin/devices/7/status',json=body).status_code,422)
        for device in ('0','-1','bad','2147483648'):
            self.assertEqual(self.client.patch(f'/admin/devices/{device}/status',json={'is_active':False,'expected_is_active':True}).status_code,422)
        self.assertFalse(self.statements)

    def test_creation_failures_rollback(self):
        for flag,value in [('failure','INSERT'),('failure','SELECT'),('commit_failure',True),('bad_rowcount',True),('bad_id',True),('postread_failure',True)]:
            setattr(self,flag,value); response=self.create(); setattr(self,flag,False if flag!='failure' else None)
            self.assertEqual(response.status_code,503); self.assertNotIn('private',response.text)
            self.assertEqual(self.db.execute('SELECT COUNT(*) FROM kiosk_device').fetchone()[0],1)
        self.assertGreaterEqual(self.rollbacks,6)

    def test_status_failures_rollback(self):
        for flag,value in [('failure','UPDATE'),('commit_failure',True),('bad_rowcount',True),('postread_failure',True)]:
            setattr(self,flag,value); response=self.status(); setattr(self,flag,False if flag!='failure' else None)
            self.assertEqual(response.status_code,503); self.assertNotIn('private',response.text)
            self.assertEqual(self.db.execute('SELECT is_active FROM kiosk_device WHERE device_id=7').fetchone()[0],1)

    def test_auth_origin_csrf_and_remote_rejected_before_database(self):
        for method,path,body in [('POST','/admin/devices',{'device_code':'x','store_id':1}),('PATCH','/admin/devices/7/status',{'is_active':False,'expected_is_active':True})]:
            with TestClient(app) as anonymous:
                self.assertEqual(anonymous.request(method,path,json=body).status_code,401)
            for headers in ({'X-CSRF-Token':''},{'X-CSRF-Token':'bad'},{'Origin':'http://evil.invalid'}):
                self.assertEqual(self.client.request(method,path,json=body,headers=headers).status_code,403)
            with TestClient(app,client=('203.0.113.1',1)) as remote:
                self.assertEqual(remote.request(method,path,json=body).status_code,403)
            with patch('admin_auth.require_admin',side_effect=__import__('fastapi').HTTPException(403,'권한 없음')):
                self.assertEqual(self.client.request(method,path,json=body).status_code,403)
        self.assertFalse(self.statements)

    def test_status_api_preserves_kiosk_retry_order_and_admin_queries(self):
        with TestClient(app) as kiosk:
            first=kiosk.post('/orders',json=self.payload); self.assertEqual(first.status_code,200)
            self.statements.clear(); self.assertEqual(self.status().status_code,200)
            self.assertIn('FOR UPDATE',next(sql for sql,_ in self.statements if 'FROM kiosk_device' in sql))
            retry=kiosk.post('/orders',json=self.payload); self.assertEqual(retry.status_code,200)
            self.assertEqual(retry.json()['order_id'],first.json()['order_id']); self.assertTrue(retry.json()['replayed'])
            conflict={**self.payload,'order_type':'dine_in'}
            self.assertEqual(kiosk.post('/orders',json=conflict).status_code,409)
            self.assertEqual(kiosk.post('/orders',json={**self.payload,'store_id':2}).status_code,422)
            fresh={**self.payload,'client_order_id':str(uuid4())}
            self.assertEqual(kiosk.post('/orders',json=fresh).status_code,422)
            self.assertEqual(self.status(True,False).status_code,200)
            self.assertEqual(kiosk.post('/orders',json=fresh).status_code,200)
        self.assertEqual(self.client.get('/admin/orders').json()['total'],2)
        self.assertEqual(self.client.get('/admin/orders/'+str(first.json()['order_id'])).json()['store_id'],1)
