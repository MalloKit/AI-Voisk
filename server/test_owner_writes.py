"""격리 SQLite 테스트. 실제 MySQL 콜레이션·행 잠금 검증을 대신하지 않습니다."""
import secrets
import sqlite3
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from argon2 import Type, extract_parameters
from fastapi.testclient import TestClient
from pymysql.err import IntegrityError
import admin_auth
import test_store_writes as store_tests
from auth_test_support import authenticated_client
from main import app

_PASSWORD = secrets.token_urlsafe(24)


class Cursor(store_tests.Cursor):
    def execute(self, sql, params=()):
        try:
            super().execute(sql, params)
        except sqlite3.IntegrityError as error:
            raise IntegrityError(1062 if 'UNIQUE' in str(error) else 1452, 'isolated constraint') from None
        if self.f.postread_failure and sql.lstrip().startswith('SELECT s.store_id'):
            raise RuntimeError('private post-write read')
        if self.f.bad_id and sql.startswith('INSERT'):
            self.lastrowid = None


class Connection(store_tests.Connection):
    def cursor(self):
        return Cursor(self.f)


class OwnerWriteTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:', check_same_thread=False)
        self.addCleanup(self.db.close)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.executescript("""
            CREATE TABLE admin (admin_id INTEGER PRIMARY KEY, admin_nm TEXT, admin_pw TEXT);
            CREATE TABLE owner (owner_id INTEGER PRIMARY KEY AUTOINCREMENT,
                own_login_id VARCHAR(100) COLLATE NOCASE NOT NULL UNIQUE, own_pw VARCHAR(255) NOT NULL);
            CREATE TABLE store (store_id INTEGER PRIMARY KEY, store_nm TEXT NOT NULL,
                store_add1 TEXT NOT NULL, store_add2 TEXT, store_code TEXT NOT NULL,
                store_phone TEXT NOT NULL, business_no TEXT NOT NULL, store_owner_nm TEXT NOT NULL,
                store_type TEXT NOT NULL, admin_id INTEGER NOT NULL REFERENCES admin(admin_id),
                owner_id INTEGER REFERENCES owner(owner_id));
            INSERT INTO admin VALUES (1,'인증 관리자',NULL),(2,'담당 관리자',NULL);
            INSERT INTO store VALUES (10,'연결 매장','부산',NULL,'T0001','legacy','legacy','대표','카페',2,NULL);
            INSERT INTO store VALUES (11,'다른 매장','서울',NULL,'00123','legacy','legacy','다른 대표','카페',2,NULL);
            CREATE TABLE orders (order_id INTEGER PRIMARY KEY, store_id INTEGER REFERENCES store(store_id));
            INSERT INTO orders VALUES (1,10);
            CREATE TABLE menu (menu_id INTEGER PRIMARY KEY, store_id INTEGER REFERENCES store(store_id));
            INSERT INTO menu VALUES (1,10);
            CREATE TABLE kiosk_device (device_id INTEGER PRIMARY KEY, store_id INTEGER REFERENCES store(store_id));
            INSERT INTO kiosk_device VALUES (1,10);
        """)
        # Synthetic hashes exist only in this in-memory test fixture.
        encoded = admin_auth.hasher.hash(_PASSWORD)
        self.db.executemany('INSERT INTO owner VALUES (?,?,?)', [(7,'LegacyOwner',encoded),(8,'second-owner',encoded)])
        self.db.commit()
        self.statements = []
        self.commits = self.rollbacks = self.closes = 0
        self.failure = self.integrity = None
        self.commit_failure = self.bad_rowcount = self.bad_id = self.postread_failure = False
        for target, kwargs in [
            ('database.connect', {'side_effect': AssertionError('Live DB forbidden')}),
            ('owner_service.connection_factory', {'side_effect': lambda: Connection(self)}),
            ('store_service.connection_factory', {'side_effect': lambda: Connection(self)}),
        ]:
            guard = patch(target, **kwargs); guard.start(); self.addCleanup(guard.stop)
        self.client = TestClient(app); self.addCleanup(self.client.close)
        context = authenticated_client(self.client)
        context.__enter__(); self.addCleanup(context.__exit__, None, None, None)

    def create(self, login='owner001', **changes):
        return self.client.post('/admin/owners', json={'login_id': login, 'password': _PASSWORD, **changes})

    def link(self, owner=7, expected=None, store=10, **changes):
        return self.client.patch(f'/admin/stores/{store}/owner', json={'owner_id': owner, 'expected_owner_id': expected, **changes})

    def test_create_contract_hash_verification_and_safe_logs(self):
        with self.assertLogs('httpx', level='INFO') as captured:
            response = self.create()
        self.assertEqual(response.status_code, 201)
        row = response.json()
        self.assertEqual(set(row), {'owner_id','login_id','store_count'})
        self.assertEqual((row['login_id'],row['store_count']), ('owner001',0))
        encoded = self.db.execute('SELECT own_pw FROM owner WHERE owner_id=?',(row['owner_id'],)).fetchone()[0]
        self.assertTrue(len(encoded) <= 255)
        self.assertTrue(admin_auth.verify_password(encoded,_PASSWORD))
        self.assertFalse(admin_auth.verify_password(encoded,secrets.token_urlsafe(24)))
        params = extract_parameters(encoded)
        self.assertEqual(params.type, Type.ID)
        self.assertEqual((params.memory_cost,params.time_cost,params.parallelism,params.salt_len,params.hash_len),(65536,3,4,16,32))
        self.assertFalse(any(value in response.text or value in '\n'.join(captured.output) for value in [_PASSWORD,encoded]))
        self.assertEqual(self.client.get(f"/admin/owners/{row['owner_id']}").json()['stores'], [])
        self.assertFalse(any('own_pw' in sql.lower() for sql,_ in self.statements if sql.lstrip().upper().startswith('SELECT')))
        self.assertFalse(any(_PASSWORD in values for _,values in self.statements))

    def test_salts_are_random_for_the_same_password(self):
        first = self.create('first-owner').json()['owner_id']; second = self.create('other-owner').json()['owner_id']
        hashes = [self.db.execute('SELECT own_pw FROM owner WHERE owner_id=?',(i,)).fetchone()[0] for i in [first,second]]
        self.assertTrue(hashes[0] != hashes[1])
        self.assertTrue(all(admin_auth.verify_password(value,_PASSWORD) for value in hashes))

    def test_duplicate_existing_mixed_case_id_is_409_and_preserved(self):
        response = self.create('legacyowner')
        self.assertEqual(response.status_code,409)
        self.assertEqual(self.db.execute('SELECT own_login_id FROM owner WHERE owner_id=7').fetchone()[0],'LegacyOwner')
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM owner').fetchone()[0],2)
        self.assertEqual(self.rollbacks,1)

    def test_input_errors_never_reflect_password_or_unknown_values(self):
        bodies = [{}, {'login_id':'owner001'}, {'login_id':'UPPERCASE','password':_PASSWORD},
            {'login_id':'abc','password':_PASSWORD}, {'login_id':'a'*101,'password':_PASSWORD},
            {'login_id':'owner001\n','password':_PASSWORD}, {'login_id':42,'password':_PASSWORD},
            {'login_id':'owner001','password':_PASSWORD[:7]}, {'login_id':'owner001','password':_PASSWORD[:1]*129},
            {'login_id':'owner001','password':_PASSWORD+'\n'}, {'login_id':'owner001','password':42}, {'login_id':'owner001','password':' '*15},
            {'login_id':'owner001','password':'\u0085'*15}, {'login_id':'owner001','password':'\ufeff '*15},
            {'login_id':'owner001','password':_PASSWORD,'secret':_PASSWORD},
            {'login_id':'owner001','password':_PASSWORD,'password_confirm':_PASSWORD}]
        for body in bodies:
            response = self.client.post('/admin/owners',json=body)
            self.assertEqual(response.status_code,422)
            self.assertNotIn(_PASSWORD,response.text)
            self.assertNotIn('input',response.text)
        self.assertFalse(self.statements)
        response = self.client.post('/admin/owners',content=b'x'*8193,headers={'Content-Type':'application/json'})
        self.assertEqual(response.status_code,413)

    def test_id_and_password_boundaries_and_unchanged_whitespace(self):
        for login,length in [('a._-',8),('a'*100,128)]:
            password = ' ' + secrets.token_urlsafe(100)[:length-2] + ' '
            response = self.create(login,password=password)
            self.assertEqual(response.status_code,201)
            encoded = self.db.execute('SELECT own_pw FROM owner WHERE owner_id=?',(response.json()['owner_id'],)).fetchone()[0]
            self.assertTrue(admin_auth.verify_password(encoded,password))
            self.assertFalse(admin_auth.verify_password(encoded,password.strip()))

    def test_invalid_encoder_output_never_reaches_storage(self):
        for encoded in ['invalid', 'x' * 256]:
            with patch.object(admin_auth, 'hasher', SimpleNamespace(hash=lambda value: encoded, verify=admin_auth.hasher.verify)):
                response = self.create()
            self.assertEqual(response.status_code,503)
            self.assertNotIn(encoded,response.text)
        self.assertFalse(self.statements)

    def test_creation_failures_rollback_and_hide_internal_details(self):
        for failure in ['INSERT','SELECT','commit','rowcount','lastid']:
            self.failure = failure if failure in ['INSERT','SELECT'] else None
            self.commit_failure = failure == 'commit'; self.bad_rowcount = failure == 'rowcount'; self.bad_id = failure == 'lastid'
            response = self.create()
            self.assertEqual(response.status_code,503)
            self.assertNotIn('private',response.text)
            self.assertNotIn(_PASSWORD,response.text)
            self.assertEqual(self.db.execute('SELECT COUNT(*) FROM owner').fetchone()[0],2)
        self.assertEqual(self.commits,0)

    def test_connect_change_disconnect_and_queries_remain_compatible(self):
        for target,expected in [(7,None),(8,7),(None,8)]:
            response = self.link(target,expected)
            self.assertEqual(response.status_code,200)
            row = response.json()
            self.assertEqual((row['owner_id'],row['admin_id'],row['representative'],row['store_code']),(target,2,'대표','T0001'))
            self.assertEqual(self.client.get('/admin/stores/10').json(),row)
            for table in ['orders','menu','kiosk_device']:
                self.assertEqual(self.db.execute(f'SELECT store_id FROM {table}').fetchone()[0],10)
        self.assertIsNone(self.client.get('/admin/stores/10').json()['owner_login_id'])
        self.assertTrue(any('FOR UPDATE' in sql for sql,_ in self.statements))
        self.assertTrue(all(sql == 'UPDATE store SET owner_id = %s WHERE store_id = %s' for sql,_ in self.statements if sql.startswith('UPDATE')))

    def test_one_owner_keeps_multiple_stores_and_noop_does_not_update(self):
        self.assertEqual(self.link().status_code,200)
        self.assertEqual(self.link(store=11).status_code,200)
        detail = self.client.get('/admin/owners/7').json()
        self.assertEqual((detail['store_count'],[s['store_id'] for s in detail['stores']]),(2,[10,11]))
        before = len([sql for sql,_ in self.statements if sql.startswith('UPDATE')])
        self.assertEqual(self.link(7,7).status_code,200)
        self.assertEqual(len([sql for sql,_ in self.statements if sql.startswith('UPDATE')]),before)

    def test_missing_targets_invalid_input_and_stale_expectation(self):
        self.assertEqual(self.link(store=999).status_code,404)
        self.assertEqual(self.link(owner=999).status_code,404)
        self.assertEqual(self.link().status_code,200)
        self.assertEqual(self.link(8,None).status_code,409)
        self.assertEqual(self.link(None,None).status_code,409)
        self.assertEqual(self.client.get('/admin/stores/10').json()['owner_id'],7)
        for body in [{},{'owner_id':7},{'owner_id':'7','expected_owner_id':None},
                     {'owner_id':True,'expected_owner_id':None},{'owner_id':0,'expected_owner_id':None},
                     {'owner_id':None,'expected_owner_id':False}, {'owner_id':None,'expected_owner_id':None,'admin_id':2}]:
            self.assertEqual(self.client.patch('/admin/stores/10/owner',json=body).status_code,422)
        # Basic information PATCH still cannot update relationships.
        self.assertEqual(self.client.patch('/admin/stores/10',json={'owner_id':8}).status_code,422)

    def test_relationship_failure_rolls_back_and_preserves_current_owner(self):
        for failure in ['UPDATE','commit','rowcount','fk','postread']:
            self.failure = failure if failure == 'UPDATE' else None
            self.commit_failure = failure == 'commit'; self.bad_rowcount = failure == 'rowcount'
            self.integrity = 1452 if failure == 'fk' else None
            self.postread_failure = failure == 'postread'
            response = self.link()
            self.assertEqual(response.status_code,409 if failure == 'fk' else 503)
            self.assertNotIn('private',response.text)
            self.assertIsNone(self.db.execute('SELECT owner_id FROM store WHERE store_id=10').fetchone()[0])
        self.assertEqual(self.commits,0)

    def test_unauthenticated_wrong_role_remote_and_csrf_block_before_db(self):
        calls = [('/admin/owners','POST',{'login_id':'owner001','password':_PASSWORD}),
                 ('/admin/stores/10/owner','PATCH',{'owner_id':7,'expected_owner_id':None})]
        with TestClient(app) as anonymous, TestClient(app,client=('203.0.113.1',1234)) as remote:
            for path,method,body in calls:
                self.assertEqual(anonymous.request(method,path,json=body).status_code,401)
                self.assertEqual(remote.request(method,path,json=body).status_code,403)
        session = admin_auth.sessions.get(self.client.cookies.get(admin_auth.settings.cookie)); original = session.admin
        session.admin = admin_auth.Admin(1,'점주 역할',role='owner')
        self.assertEqual(self.create().status_code,403); self.assertEqual(self.link().status_code,403)
        session.admin = original
        for header in ['Origin','X-CSRF-Token']:
            old = self.client.headers.pop(header)
            self.assertEqual(self.create().status_code,403); self.assertEqual(self.link().status_code,403)
            self.client.headers[header] = old
        for headers in [{'Origin':'http://untrusted.example'},{'X-CSRF-Token':'x'*43}]:
            for path,method,body in calls:self.assertEqual(self.client.request(method,path,json=body,headers=headers).status_code,403)
        self.assertFalse(self.statements)
        admin_auth.sessions.revoke(self.client.cookies.get(admin_auth.settings.cookie))
        self.assertEqual(self.create().status_code,401); self.assertEqual(self.link().status_code,401)


if __name__ == '__main__':
    unittest.main()
