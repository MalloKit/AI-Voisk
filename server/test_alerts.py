"""실제 DB 연결을 차단한 알림 GET API 계약 검증."""
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from main import app
from auth_test_support import authenticated_client
import alert_service
import test_alert_service as fixtures


class AlertApiTests(fixtures.AlertFixture, unittest.TestCase):
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

    def test_list_and_detail_contract_with_unknown_values(self):
        response = self.client.get('/admin/alerts')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), alert_service.list_alerts())
        detail = self.client.get('/admin/alerts/103')
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()['alert_status'], 'WAITING_REVIEW')
        self.assertIsNone(detail.json()['acknowledged_at'])
        self.assertIsNotNone(detail.json()['resolved_at'])

    def test_empty_missing_and_invalid(self):
        self.assertEqual(self.client.get('/admin/alerts/999').status_code, 404)
        for value in ('0','-1','bad'):
            self.assertEqual(self.client.get('/admin/alerts/'+value).status_code, 422)
        self.db.execute('DELETE FROM device_alert')
        self.db.commit()
        response = self.client.get('/admin/alerts')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'alerts': [], 'total': 0})

    def test_sensitive_fields_and_internal_errors_not_exposed(self):
        response = self.client.get('/admin/alerts')
        for value in ('device_token_hash','admin_pw','fixture-admin-private','fixture-token-private'):
            self.assertNotIn(value, response.text)
        with patch('alert_service.connection_factory', side_effect=RuntimeError('fixture-connection-secret')):
            for path in ('/admin/alerts','/admin/alerts/101'):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 503)
                self.assertNotIn('fixture-connection-secret', response.text)

    def test_local_access_and_no_write_routes(self):
        with TestClient(app, client=('203.0.113.1',1234)) as remote:
            self.assertEqual(remote.get('/admin/alerts').status_code, 403)
            self.assertEqual(remote.get('/admin/alerts/101').status_code, 403)
        for method,path in (('POST','/admin/alerts'),('PATCH','/admin/alerts/101'),('DELETE','/admin/alerts/101')):
            self.assertEqual(self.client.request(method,path).status_code, 405)
        self.assertEqual(self.client.patch('/admin/alerts/101/acknowledge').status_code, 404)


if __name__ == '__main__':
    unittest.main()
