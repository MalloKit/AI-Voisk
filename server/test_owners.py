"""FastAPI 점주 조회 계약 검증. 모든 DB 조회는 메모리 SQLite로 격리합니다."""
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from main import app
from auth_test_support import authenticated_client
import owner_service
import test_owner_service as fixtures


class OwnerApiTests(fixtures.OwnerFixture, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.no_live_db = patch('database.connect', side_effect=AssertionError('Live DB access forbidden'))
        self.no_live_db.start()
        self.client = TestClient(app)
        self.auth_context = authenticated_client(self.client)
        self.auth_context.__enter__()
        self.addCleanup(self.auth_context.__exit__, None, None, None)

    def tearDown(self):
        self.client.close()
        self.no_live_db.stop()
        super().tearDown()

    def test_list_and_detail_contracts(self):
        response = self.client.get('/admin/owners')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), owner_service.list_owners())
        for owner_id, count in ((1, 0), (2, 1), (3, 2)):
            response = self.client.get(f'/admin/owners/{owner_id}')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), owner_service.owner_detail(owner_id))
            self.assertEqual(len(response.json()['stores']), count)
            self.assertNotIn('private-', response.text)

    def test_zero_accounts_is_not_an_error(self):
        self.db.execute('DELETE FROM store')
        self.db.execute('DELETE FROM owner')
        self.db.commit()
        response = self.client.get('/admin/owners')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'owners': [], 'total': 0})

    def test_missing_and_invalid_accounts(self):
        self.assertEqual(self.client.get('/admin/owners/404').status_code, 404)
        for path in ('/admin/owners/0', '/admin/owners/-1', '/admin/owners/invalid'):
            self.assertEqual(self.client.get(path).status_code, 422)

    def test_remote_access_is_blocked_and_unsupported_writes_stay_unavailable(self):
        with TestClient(app, client=('203.0.113.1', 1234)) as remote:
            for path in ('/admin/owners', '/admin/owners/1'):
                self.assertEqual(remote.get(path).status_code, 403)
        for method, path in (
            ('PUT', '/admin/owners/1'),
            ('PATCH', '/admin/owners/1'), ('DELETE', '/admin/owners/1'),
        ):
            self.assertEqual(self.client.request(method, path).status_code, 405)

    def test_db_failure_is_sanitized_for_list_and_detail(self):
        with patch('owner_service.connection_factory', side_effect=RuntimeError('private-connection-secret')):
            for path in ('/admin/owners', '/admin/owners/1'):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 503)
                self.assertNotIn('private-connection-secret', response.text)


if __name__ == '__main__':
    unittest.main()
