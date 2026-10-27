"""기기 GET API 계약 검증. 실제 Azure 접속은 차단합니다."""
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from main import app
from auth_test_support import authenticated_client
import device_service
import test_device_service as fixtures


class DeviceApiTests(fixtures.DeviceFixture, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.no_live_db = patch('database.connect', side_effect=AssertionError('운영 DB 접속 금지'))
        self.no_live_db.start()
        self.client = TestClient(app)
        self.auth_context = authenticated_client(self.client)
        self.auth_context.__enter__()
        self.addCleanup(self.auth_context.__exit__, None, None, None)

    def tearDown(self):
        self.client.close()
        self.no_live_db.stop()
        super().tearDown()

    def test_list_and_detail_contracts_exclude_auth_data(self):
        response = self.client.get('/admin/devices')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), device_service.list_devices())
        self.assertNotIn('device_token_hash', response.text)
        self.assertNotIn('fixture-secret', response.text)
        detail = self.client.get('/admin/devices/1')
        self.assertEqual(detail.status_code, 200)
        self.assertIsNone(detail.json()['last_seen_at'])
        self.assertIsNone(detail.json()['app_version'])
        self.assertIs(detail.json()['is_active'], True)

    def test_zero_missing_and_invalid(self):
        self.assertEqual(self.client.get('/admin/devices/999').status_code, 404)
        for value in ('0', '-1', 'bad'):
            self.assertEqual(self.client.get('/admin/devices/' + value).status_code, 422)
        self.db.execute('DELETE FROM kiosk_device')
        self.db.commit()
        self.assertEqual(self.client.get('/admin/devices').json(), {'devices': [], 'total': 0})

    def test_local_restriction_and_absence_of_write_routes(self):
        with TestClient(app, client=('203.0.113.1', 1234)) as remote:
            for path in ('/admin/devices', '/admin/devices/1'):
                self.assertEqual(remote.get(path).status_code, 403)
        for method, path in (
            ('POST','/admin/devices'), ('PATCH','/admin/devices/1'),
            ('DELETE','/admin/devices/1'),
        ):
            self.assertEqual(self.client.request(method, path).status_code, 405)
        self.assertEqual(self.client.patch('/admin/devices/1/status').status_code, 404)

    def test_db_errors_are_sanitized(self):
        with patch('device_service.connection_factory', side_effect=RuntimeError('fixture-private-error')):
            for path in ('/admin/devices','/admin/devices/1'):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 503)
                self.assertNotIn('fixture-private-error', response.text)


if __name__ == '__main__':
    unittest.main()
