"""관리자 매장 API 계약·로컬 접속 제한 및 키오스크 API 호환성."""
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from main import app
from auth_test_support import authenticated_client
import test_store_service as fixtures
import store_service


class StoreApiTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.StoreServiceTests()
        self.fixture.setUp()
        self.no_live_db = patch('database.connect', side_effect=AssertionError('Live DB access forbidden'))
        self.no_live_db.start()
        self.client = TestClient(app)
        self.auth_context = authenticated_client(self.client)
        self.auth_context.__enter__()
        self.addCleanup(self.auth_context.__exit__, None, None, None)

    def tearDown(self):
        self.client.close()
        self.no_live_db.stop()
        self.fixture.tearDown()

    def test_api_contract(self):
        response = self.client.get('/admin/stores')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), store_service.list_stores())
        detail = self.client.get('/admin/stores/2')
        self.assertEqual(detail.status_code, 200)
        self.assertIsNone(detail.json()['owner_id'])
        self.assertEqual(detail.json()['store_code'], 'A0002')
        self.assertEqual(self.client.get('/admin/stores/999').status_code, 404)
        self.assertEqual(self.client.get('/admin/stores/0').status_code, 422)

    def test_remote_access_unsupported_writes_and_invalid_create_denied(self):
        with TestClient(app, client=('203.0.113.1', 1234)) as remote:
            for path in ('/admin/stores', '/admin/stores/1'):
                self.assertEqual(remote.get(path).status_code, 403)
        self.assertEqual(self.client.post('/admin/stores', json={}).status_code, 422)
        self.assertEqual(self.client.put('/admin/stores/1', json={}).status_code, 405)
        self.assertEqual(self.client.delete('/admin/stores/1').status_code, 405)

    def test_db_failure_is_sanitized(self):
        with patch('store_service.connection_factory', side_effect=RuntimeError('secret-password')):
            response = self.client.get('/admin/stores')
            self.assertEqual(response.status_code, 503)
            self.assertNotIn('secret-password', response.text)

    def test_kiosk_store_list_contract_unchanged(self):
        with patch('main._db_query', return_value=[{'store_id': 1, 'store_nm': '연결 매장'}]) as query:
            response = self.client.get('/stores')
            self.assertEqual(response.json(), [{'store_id': 1, 'store_nm': '연결 매장'}])
            query.assert_called_once_with('SELECT store_id, store_nm FROM store ORDER BY store_id')


if __name__ == '__main__':
    unittest.main()
