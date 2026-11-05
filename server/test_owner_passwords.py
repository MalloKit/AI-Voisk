"""Password resets use only the isolated owner fixture; no Azure connections."""
import secrets
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from fastapi.testclient import TestClient
from argon2 import Type, extract_parameters
import admin_auth
from main import app
import test_owner_writes as owner_tests


class OwnerPasswordTests(unittest.TestCase):
    setUp = owner_tests.OwnerWriteTests.setUp

    def reset(self, password=None, owner=7):
        return self.client.patch(f'/admin/owners/{owner}/password', json={'password': password or secrets.token_urlsafe(24)})

    def test_reset_hash_old_password_rejected_public_contract_and_relationships_preserved(self):
        new = secrets.token_urlsafe(24)
        previous = self.db.execute('SELECT * FROM owner WHERE owner_id=8').fetchone()
        before = self.client.get('/admin/owners/7').json()
        relations = [tuple(r) for r in self.db.execute('SELECT * FROM store')]
        with self.assertLogs('httpx', level='INFO') as logs:
            response = self.reset(new)
        self.assertEqual(response.status_code, 204)
        self.assertEqual(response.content, b'')
        self.assertEqual(response.headers['cache-control'], 'no-store')
        encoded = self.db.execute('SELECT own_pw FROM owner WHERE owner_id=7').fetchone()[0]
        self.assertTrue(admin_auth.verify_password(encoded, new))
        self.assertFalse(admin_auth.verify_password(encoded, owner_tests._PASSWORD))
        self.assertEqual(extract_parameters(encoded).type, Type.ID)
        self.assertTrue(len(encoded) <= 255)
        self.assertFalse(any(v in response.text or v in '\n'.join(logs.output) for v in [new,encoded]))
        self.assertEqual(self.client.get('/admin/owners/7').json(), before)
        self.assertTrue(tuple(self.db.execute('SELECT * FROM owner WHERE owner_id=8').fetchone()) == tuple(previous))
        self.assertTrue([tuple(r) for r in self.db.execute('SELECT * FROM store')] == relations)
        updates = [sql for sql,_ in self.statements if sql.startswith('UPDATE')]
        self.assertEqual(updates, ['UPDATE owner SET own_pw = %s WHERE owner_id = %s'])
        self.assertTrue(any('FOR UPDATE' in sql for sql,_ in self.statements))
        self.assertFalse(any('own_pw' in sql for sql,_ in self.statements if sql.startswith('SELECT')))

    def test_password_boundaries_whitespace_and_fresh_salt(self):
        for length in [8,128]:
            new = ' ' + secrets.token_urlsafe(100)[:length-2] + ' '
            self.assertEqual(self.reset(new).status_code,204)
            encoded = self.db.execute('SELECT own_pw FROM owner WHERE owner_id=7').fetchone()[0]
            self.assertTrue(admin_auth.verify_password(encoded,new))
            self.assertFalse(admin_auth.verify_password(encoded,new.strip()))
            self.assertEqual(self.reset(new).status_code,204)
            second = self.db.execute('SELECT own_pw FROM owner WHERE owner_id=7').fetchone()[0]
            self.assertTrue(encoded != second)

    def test_validation_errors_do_not_echo_secret_inputs(self):
        secret = secrets.token_urlsafe(24)
        for body in [{}, {'password':secret[:7]}, {'password':secret*6}, {'password':42},
                     {'password':None}, {'password':secret+'\n'}, {'password':' '*8},
                     {'password':'\ufeff'*8}, {'password':secret,'login_id':secret},
                     {'password':secret,'password_confirm':secret}]:
            response=self.client.patch('/admin/owners/7/password',json=body)
            self.assertEqual(response.status_code,422)
            self.assertNotIn(secret,response.text)
            self.assertNotIn('input',response.text)
        for owner in ['bad',0,2147483648]:
            response=self.client.patch(f'/admin/owners/{owner}/password',json={'password':secret})
            self.assertEqual(response.status_code,422)
            self.assertNotIn(secret,response.text)
        self.assertEqual(self.client.patch('/admin/owners/7/password',content=b'x'*8193,headers={'Content-Type':'application/json'}).status_code,413)
        self.assertFalse(self.statements)

    def test_missing_owner_rolls_back_and_does_not_modify_other_accounts(self):
        before=[tuple(r) for r in self.db.execute('SELECT * FROM owner')]
        self.assertEqual(self.reset(owner=999).status_code,404)
        self.assertTrue(before == [tuple(r) for r in self.db.execute('SELECT * FROM owner')])
        self.assertEqual(self.rollbacks,1)

    def test_failures_roll_back_and_never_disclose_secrets(self):
        before=self.db.execute('SELECT own_pw FROM owner WHERE owner_id=7').fetchone()[0]
        new=secrets.token_urlsafe(24)
        for mode in ['SELECT','UPDATE','commit','rowcount']:
            self.failure=mode if mode in ['SELECT','UPDATE'] else None
            self.commit_failure=mode=='commit';self.bad_rowcount=mode=='rowcount'
            response=self.reset(new)
            self.assertEqual(response.status_code,503)
            self.assertFalse(any(v in response.text for v in [new,before,'private']))
            self.assertTrue(self.db.execute('SELECT own_pw FROM owner WHERE owner_id=7').fetchone()[0] == before)
        self.assertEqual(self.commits,0)
        self.assertEqual(self.rollbacks,4)

    def test_encoder_failure_never_reaches_storage(self):
        with patch.object(admin_auth,'hasher',SimpleNamespace(hash=lambda value:'invalid',verify=admin_auth.hasher.verify)):
            self.assertEqual(self.reset().status_code,503)
        self.assertFalse(self.statements)

    def test_authentication_role_origin_csrf_and_expiry_block_before_db(self):
        body={'password':secrets.token_urlsafe(24)};path='/admin/owners/7/password'
        with TestClient(app) as anonymous, TestClient(app,client=('203.0.113.1',1234)) as remote:
            self.assertEqual(anonymous.patch(path,json=body).status_code,401)
            self.assertEqual(remote.patch(path,json=body).status_code,403)
        session=admin_auth.sessions.get(self.client.cookies.get(admin_auth.settings.cookie));original=session.admin
        session.admin=admin_auth.Admin(1,'role',role='owner')
        self.assertEqual(self.reset().status_code,403);session.admin=original
        for name in ['Origin','X-CSRF-Token']:
            old=self.client.headers.pop(name)
            self.assertEqual(self.reset().status_code,403);self.client.headers[name]=old
        for headers in [{'Origin':'http://unapproved.invalid'},{'X-CSRF-Token':'x'*43}]:
            self.assertEqual(self.client.patch(path,json=body,headers=headers).status_code,403)
        admin_auth.sessions.revoke(self.client.cookies.get(admin_auth.settings.cookie))
        self.assertEqual(self.reset().status_code,401)
        self.assertFalse(self.statements)
