import unittest
from unittest.mock import patch, MagicMock
from uuid import uuid4

from fastapi.testclient import TestClient
from main import app
import kakaopay_test as pay


class KakaoTest(unittest.TestCase):
    def setUp(self):
        pay.sessions.clear()
        self.client = TestClient(app)
        self.payload = dict(store_id=1, device_id=1, client_order_id=str(uuid4()), order_type='takeaway',
                            items=[dict(menu_id=1, quantity=2, option_ids=[1])])
        self.quote = patch.object(pay, 'quote', return_value=20000).start()
        self.credentials = patch.object(pay, 'credentials', return_value='fake-test-key').start()
        self.provider = patch.object(pay, 'provider', return_value={
            'tid': 'test-tid', 'next_redirect_pc_url': 'https://online-payment.kakaopay.com/test'}).start()
        self.no_db = patch('database.connect', side_effect=AssertionError('Live DB forbidden')).start()

    def tearDown(self):
        self.client.close()
        patch.stopall()
        pay.sessions.clear()

    def prepare(self):
        response = self.client.post('/payments/kakaopay/ready', json=self.payload)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()['payment_id']

    def approval_response(self):
        return dict(tid='test-tid', cid=pay.CID, partner_order_id=self.payload['client_order_id'],
                    partner_user_id='ai-voisk-test', amount=dict(total=20000))

    def test_ready_uses_server_total_and_same_uuid_is_idempotent(self):
        token = self.prepare()
        self.assertEqual(self.prepare(), token)
        self.assertEqual(self.client.get(f'/payments/kakaopay/status/{token}').json()['checkout_url'],
                         'https://online-payment.kakaopay.com/test')
        self.provider.assert_called_once()
        sent = self.provider.call_args.args[1]
        self.assertEqual(sent['total_amount'], 20000)
        self.assertEqual(sent['approval_url'], f'http://localhost:8001/payments/kakaopay/approval/{token}')
        self.assertNotIn('fake-test-key', str(self.client.get(f'/payments/kakaopay/status/{token}').json()))
        self.assertIn('20,000', self.client.get(f'/payments/kakaopay/browser/{token}').text)

    def test_approval_matches_server_amount_and_cannot_repeat(self):
        token = self.prepare()
        self.provider.return_value = self.approval_response()
        url = f'/payments/kakaopay/approval/{token}?pg_token=fake-token'
        self.assertIn('승인 완료', self.client.get(url).text)
        count = self.provider.call_count
        self.client.get(url)
        self.assertEqual(self.provider.call_count, count)
        self.client.get(f'/payments/kakaopay/cancel/{token}')
        result = self.client.get(f'/payments/kakaopay/status/{token}').json()
        self.assertEqual(result['status'], 'approved')
        self.assertFalse(result['order_saved'])
        self.no_db.assert_not_called()

    def test_amount_mismatch_is_unknown_not_success(self):
        token = self.prepare()
        self.provider.return_value = self.approval_response() | {'amount': {'total': 1}}
        self.client.get(f'/payments/kakaopay/approval/{token}?pg_token=fake-token')
        self.assertEqual(pay.sessions[token].status, 'unknown')
        self.assertEqual(self.client.post(f'/payments/kakaopay/abandon/{token}', json={}).status_code, 409)

    def test_cancel_before_approval_and_missing_token(self):
        token = self.prepare()
        self.assertEqual(self.client.get(f'/payments/kakaopay/approval/{token}').status_code, 422)
        self.client.post(f'/payments/kakaopay/abandon/{token}', json={})
        count = self.provider.call_count
        self.client.get(f'/payments/kakaopay/approval/{token}?pg_token=fake-token')
        self.assertEqual(self.provider.call_count, count)
        self.assertEqual(pay.sessions[token].status, 'cancelled')

    def test_rejects_remote_origin_expired_session_and_client_price(self):
        remote = TestClient(app, client=('203.0.113.1', 1234))
        self.assertEqual(remote.post('/payments/kakaopay/ready', json=self.payload).status_code, 403)
        remote.close()
        self.assertEqual(self.client.post('/payments/kakaopay/ready', json=self.payload,
            headers={'Origin': 'https://evil.example'}).status_code, 403)
        self.assertEqual(self.client.post('/payments/kakaopay/ready', json=self.payload | {'price': 1}).status_code, 422)
        token = self.prepare()
        initial = self.client.get(f'/payments/kakaopay/status/{token}').json()['expires_in']
        self.assertGreater(initial, 0)
        self.assertLessEqual(initial, 900)
        pay.sessions[token].created -= 901
        expired = self.client.get(f'/payments/kakaopay/status/{token}').json()
        self.assertEqual(expired['status'], 'expired')
        self.assertEqual(expired['expires_in'], 0)
        count = self.provider.call_count
        self.client.get(f'/payments/kakaopay/approval/{token}?pg_token=fake-token')
        self.assertEqual(self.provider.call_count, count)

    def test_timeout_preserves_unknown_and_approved_results(self):
        token = self.prepare()
        for state in ('unknown', 'approved'):
            pay.sessions[token].status = state
            pay.sessions[token].created -= 901
            result = self.client.get(f'/payments/kakaopay/status/{token}').json()
            self.assertEqual(result['status'], state)
            self.assertEqual(self.client.post(f'/payments/kakaopay/abandon/{token}', json={}).status_code, 409)

class ConfigurationTest(unittest.TestCase):
    def test_production_cid_is_blocked(self):
        from fastapi import HTTPException
        with patch('kakaopay_test.load_dotenv'), patch.dict('os.environ', {'KAKAOPAY_CID': 'REALCID'}):
            with self.assertRaises(HTTPException):
                pay.credentials()

    def test_quote_reads_db_prices_and_options_without_writes(self):
        order = pay.OrderInput(store_id=1, device_id=1, client_order_id=uuid4(), order_type='takeaway',
                              items=[dict(menu_id=1, quantity=2, option_ids=[4])])
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.side_effect = [dict(store_id=1, is_active=True),
            dict(store_id=1, is_active=True, is_sold_out=False, menu_price=9000),
            dict(menu_id=1, is_active=True, is_sold_out=False, extra_price=1000)]
        with patch('database.connect', return_value=connection):
            self.assertEqual(pay.quote(order), 20000)
        sql = [call.args[0].strip().upper() for call in cursor.execute.call_args_list]
        self.assertTrue(all(s.startswith(('SELECT', 'START TRANSACTION READ ONLY')) for s in sql))
        connection.commit.assert_not_called()
        connection.rollback.assert_called_once()
