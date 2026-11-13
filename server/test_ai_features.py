"""AI 음성 주문·키오스크 API·점주 AI 설정 테스트. 외부 DB와 Claude API에 접속하지 않습니다."""
import json
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import device_auth
import kiosk_catalog
import voice_service
from ai_test_support import OTHER_TOKEN, TOKEN, AiFixture
from auth_test_support import authenticated_client


def order_body(**overrides):
    body = {'store_id': 1, 'device_id': 70, 'client_order_id': str(uuid4()), 'order_type': 'takeaway',
            'items': [{'menu_id': 10, 'quantity': 2, 'option_ids': [100]}]}
    body.update(overrides)
    return body


class DeviceTokenTests(unittest.TestCase):
    def setUp(self):
        self.f = AiFixture(self)

    def test_admin_issues_token_once_and_only_hash_is_stored(self):
        client = self.f.client()
        with authenticated_client(client):
            response = client.post('/admin/devices/81/token')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        token = response.json()['token']
        self.assertEqual(response.json()['store_id'], 1)
        stored = self.f.value('SELECT device_token_hash FROM kiosk_device WHERE device_id = 81')
        self.assertEqual(stored, device_auth.hash_token(token))
        self.assertNotIn(token, json.dumps(self.f.rows('SELECT * FROM kiosk_device')))
        self.assertEqual(self.f.kiosk(81, token).get('/kiosk/menu-version').status_code, 200)

    def test_reissue_invalidates_previous_token(self):
        client = self.f.client()
        with authenticated_client(client):
            first = client.post('/admin/devices/81/token').json()['token']
            second = client.post('/admin/devices/81/token').json()['token']
        self.assertEqual(self.f.kiosk(81, first).get('/kiosk/menu-version').status_code, 401)
        self.assertEqual(self.f.kiosk(81, second).get('/kiosk/menu-version').status_code, 200)

    def test_token_issue_requires_admin_session(self):
        response = self.f.client().post('/admin/devices/81/token')
        self.assertIn(response.status_code, (401, 403))
        self.assertIsNone(self.f.value('SELECT device_token_hash FROM kiosk_device WHERE device_id = 81'))

    def test_unknown_device_is_404(self):
        client = self.f.client()
        with authenticated_client(client):
            self.assertEqual(client.post('/admin/devices/999/token').status_code, 404)


class DeviceAuthTests(unittest.TestCase):
    def setUp(self):
        self.f = AiFixture(self)

    def test_rejections_are_uniform(self):
        cases = [
            self.f.client(),                                   # 헤더 없음
            self.f.kiosk(70, 'x' * 43),                        # 틀린 토큰
            self.f.kiosk(71, TOKEN),                           # 비활성 기기
            self.f.kiosk(80, TOKEN),                           # 다른 기기의 토큰
            self.f.kiosk(81, TOKEN),                           # 토큰 미발급 기기
            self.f.kiosk(999, TOKEN),                          # 없는 기기
        ]
        bodies = set()
        for client in cases:
            response = client.get('/kiosk/bootstrap')
            self.assertEqual(response.status_code, 401)
            bodies.add(response.text)
        self.assertEqual(len(bodies), 1)

    def test_failures_are_rate_limited_per_host(self):
        bad = self.f.kiosk(70, 'y' * 43)
        for _ in range(10):
            self.assertEqual(bad.get('/kiosk/menu-version').status_code, 401)
        self.assertEqual(bad.get('/kiosk/menu-version').status_code, 429)
        # 같은 주소에서는 올바른 토큰도 잠시 막힙니다.
        self.assertEqual(self.f.kiosk().get('/kiosk/menu-version').status_code, 429)

    def test_database_failure_is_503_without_details(self):
        self.f.fail_on = 'FROM kiosk_device'
        response = self.f.kiosk().get('/kiosk/menu-version')
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('private', response.text)


class BootstrapTests(unittest.TestCase):
    def setUp(self):
        self.f = AiFixture(self)
        self.client = self.f.kiosk()

    def test_bootstrap_contains_ai_fields_settings_and_only_own_active_menus(self):
        data = self.client.get('/kiosk/bootstrap').json()
        self.assertTrue(data['ai_ready'])
        self.assertEqual(data['menu_version'], 3)
        self.assertEqual(data['device_id'], 70)
        ids = [menu['id'] for menu in data['menus']]
        self.assertEqual(ids, ['10', '11', '12', '13', '14', '20'])
        soondubu = next(m for m in data['menus'] if m['id'] == '11')
        self.assertEqual(soondubu['tags'], ['매운', '해장'])
        self.assertEqual(soondubu['costRate'], 30)
        self.assertTrue(soondubu['storePick'])
        self.assertTrue(next(m for m in data['menus'] if m['id'] == '14')['recExcluded'])
        self.assertEqual(data['settings'], kiosk_catalog.DEFAULT_SETTINGS)
        self.assertEqual(self.client.get('/kiosk/bootstrap').headers['cache-control'], 'no-store')

    def test_bootstrap_without_ai_migration_keeps_menu(self):
        with patch('ai_db.ai_schema_ready', return_value=False):
            data = self.client.get('/kiosk/bootstrap').json()
        self.assertFalse(data['ai_ready'])
        self.assertEqual(len(data['menus']), 6)
        self.assertEqual(data['menus'][0]['tags'], [])

    def test_heartbeat_records_seen_synced_and_applied_version(self):
        response = self.client.post('/kiosk/heartbeat', json={'applied_menu_version': 3, 'app_version': '1.1.0+2'})
        self.assertEqual(response.json(), {'menu_version': 3, 'synced': True})
        row = self.f.db.execute('SELECT last_seen_at, last_synced_at, applied_menu_version, app_version FROM kiosk_device WHERE device_id = 70').fetchone()
        self.assertIsNotNone(row['last_seen_at'])
        self.assertIsNotNone(row['last_synced_at'])
        self.assertEqual((row['applied_menu_version'], row['app_version']), (3, '1.1.0+2'))
        stale = self.client.post('/kiosk/heartbeat', json={'applied_menu_version': 1}).json()
        self.assertFalse(stale['synced'])


class KioskOrderTests(unittest.TestCase):
    def setUp(self):
        self.f = AiFixture(self)
        self.client = self.f.kiosk()

    def test_voice_order_records_channel_and_recommended_items(self):
        body = order_body(order_channel='voice', items=[
            {'menu_id': 10, 'quantity': 1, 'option_ids': [100]},
            {'menu_id': 12, 'quantity': 1, 'option_ids': [110, 113], 'is_recommended': True}])
        response = self.client.post('/kiosk/orders', json=body)
        self.assertEqual(response.status_code, 200, response.text)
        order_id = response.json()['order_id']
        self.assertEqual(response.json()['total_at_submission'], 10000 + 7500)
        self.assertEqual(self.f.value('SELECT order_channel FROM orders WHERE order_id = ?', order_id), 'voice')
        self.assertEqual(self.f.rows('SELECT menu_id, is_recommended FROM order_item WHERE order_id = ? ORDER BY menu_id', order_id),
                         [(10, 0), (12, 1)])
        # 같은 UUID 재전송은 한 번만 저장합니다.
        self.assertTrue(self.client.post('/kiosk/orders', json=body).json()['replayed'])
        self.assertEqual(self.f.value('SELECT COUNT(*) FROM orders'), 1)

    def test_order_must_match_authenticated_device_and_store(self):
        for body in (order_body(device_id=81), order_body(store_id=2), order_body(device_id=80, store_id=2)):
            self.assertEqual(self.client.post('/kiosk/orders', json=body).status_code, 403)
        self.assertEqual(self.f.value('SELECT COUNT(*) FROM orders'), 0)

    def test_price_fields_and_unknown_channel_are_rejected(self):
        self.assertEqual(self.client.post('/kiosk/orders', json=order_body(total=1)).status_code, 422)
        self.assertEqual(self.client.post('/kiosk/orders', json=order_body(order_channel='robot')).status_code, 422)

    def test_demo_payment_needs_server_switch(self):
        body = {'order': order_body(), 'expected_amount': 20000}
        with patch.dict('os.environ', {'KIOSK_SAVE_DEMO_PAYMENTS': ''}):
            self.assertEqual(self.client.post('/kiosk/payments/demo/card', json=body).status_code, 403)
        self.assertEqual(self.f.value('SELECT COUNT(*) FROM orders'), 0)

    def test_legacy_order_endpoint_stays_local_only(self):
        # 기기 토큰이 있어도 /orders는 PC 로컬 시연용으로만 남습니다.
        client = self.f.client(client=('192.168.0.20', 5000))
        client.headers.update({'X-Device-Id': '70', 'Authorization': f'Bearer {TOKEN}'})
        self.assertEqual(client.post('/orders', json=order_body()).status_code, 403)
        lan = self.f.kiosk()
        lan_client = self.f.client(client=('192.168.0.20', 5000))
        lan_client.headers.update(lan.headers)
        self.assertEqual(lan_client.post('/kiosk/orders', json=order_body()).status_code, 200)


class VoiceSanitizeTests(unittest.TestCase):
    def setUp(self):
        self.catalog = {'menus': [
            {'id': '10', 'name': '제육덮밥', 'isSoldOut': False, 'recExcluded': False,
             'options': [{'id': '100', 'isSoldOut': False}, {'id': '101', 'isSoldOut': True}]},
            {'id': '11', 'name': '순두부찌개', 'isSoldOut': False, 'recExcluded': False, 'options': [], 'tags': ['해장']},
            {'id': '13', 'name': '품절메뉴', 'isSoldOut': True, 'recExcluded': False, 'options': []},
            {'id': '14', 'name': '추천제외', 'isSoldOut': False, 'recExcluded': True, 'options': []},
        ], 'settings': {'voice_enabled': True}}

    def request(self, **values):
        return voice_service.InterpretInput(text='주문', **values)

    def test_unknown_ids_sold_out_and_invalid_options_are_dropped(self):
        raw = {'intent': 'order', 'items': [
            {'menu_id': 10, 'quantity': 2, 'option_ids': [100, 101, 999], 'entry_id': None},
            {'menu_id': 999, 'quantity': 1, 'option_ids': [], 'entry_id': None},
            {'menu_id': 13, 'quantity': 1, 'option_ids': [], 'entry_id': None},
            {'menu_id': 11, 'quantity': 0, 'option_ids': [], 'entry_id': None},
            {'menu_id': 11, 'quantity': True, 'option_ids': [], 'entry_id': None}]}
        result = voice_service.sanitize(raw, self.catalog, self.request())
        self.assertEqual(result['items'], [{'menu_id': 10, 'quantity': 2, 'option_ids': [100], 'entry_id': None},
                                           {'menu_id': 11, 'quantity': 1, 'option_ids': [], 'entry_id': None}])

    def test_order_without_valid_items_becomes_clarify(self):
        raw = {'intent': 'order', 'items': [{'menu_id': 999, 'quantity': 1, 'option_ids': [], 'entry_id': None}],
               'question': '어떤 메뉴를 말씀하셨나요?'}
        result = voice_service.sanitize(raw, self.catalog, self.request())
        self.assertEqual(result['intent'], 'clarify')
        self.assertEqual(result['question'], '어떤 메뉴를 말씀하셨나요?')

    def test_order_of_only_sold_out_menu_names_it_in_question(self):
        # 모델 문장 대신 서버가 품절 메뉴 이름으로 안내 문장을 만듭니다.
        raw = {'intent': 'order', 'items': [{'menu_id': 13, 'quantity': 2, 'option_ids': [], 'entry_id': None}],
               'question': None}
        result = voice_service.sanitize(raw, self.catalog, self.request())
        self.assertEqual((result['intent'], result['items']), ('clarify', []))
        self.assertEqual(result['question'], '품절메뉴는 지금 품절이에요. 다른 메뉴를 말씀해 주세요.')
        self.assertEqual(result['sold_out_menu_ids'], [13])

    def test_partial_sold_out_order_keeps_rest_and_reports_sold_out(self):
        # "콜라랑 사이다 하나씩"에서 사이다만 품절: 콜라는 담고 사이다는 알려야 합니다.
        raw = {'intent': 'order', 'items': [
            {'menu_id': 10, 'quantity': 1, 'option_ids': [], 'entry_id': None},
            {'menu_id': 13, 'quantity': 1, 'option_ids': [], 'entry_id': None}]}
        result = voice_service.sanitize(raw, self.catalog, self.request())
        self.assertEqual(result['intent'], 'order')
        self.assertEqual([item['menu_id'] for item in result['items']], [10])
        self.assertEqual(result['sold_out_menu_ids'], [13])
        self.assertIsNone(result['question'])

    def test_unknown_with_sold_out_menu_in_text_becomes_sold_out_clarify(self):
        # 실제 Haiku 응답: "사이다 하나 주세요" → intent unknown, items 없음, 품절 문장은 question에만.
        catalog = {'menus': self.catalog['menus'] + [
            {'id': '7', 'name': '사이다', 'isSoldOut': True, 'recExcluded': False, 'options': [],
             'synonyms': ['칠성사이다']}]}
        raw = {'intent': 'unknown', 'items': [], 'question': '사이다는 현재 품절입니다. 다른 음료를 선택해 주세요.'}
        for text in ('사이다 하나 주세요', '칠성 사이다 두 개요'):
            result = voice_service.sanitize(raw, catalog, voice_service.InterpretInput(text=text))
            self.assertEqual(result['intent'], 'clarify', text)
            self.assertEqual(result['question'], '사이다는 지금 품절이에요. 다른 메뉴를 말씀해 주세요.')
            self.assertEqual(result['sold_out_menu_ids'], [7])

    def test_sold_out_name_inside_selling_menu_name_is_not_reported(self):
        catalog = {'menus': [
            {'id': '6', 'name': '콜라', 'isSoldOut': True, 'recExcluded': False, 'options': []},
            {'id': '51', 'name': '제로콜라', 'isSoldOut': False, 'recExcluded': False, 'options': []}]}
        raw = {'intent': 'unknown', 'items': [], 'question': None}
        result = voice_service.sanitize(raw, catalog, voice_service.InterpretInput(text='오늘 제로 콜라 맛있나요'))
        self.assertEqual((result['intent'], result['sold_out_menu_ids']), ('unknown', []))
        result = voice_service.sanitize(raw, catalog, voice_service.InterpretInput(text='콜라 주세요'))
        self.assertEqual((result['intent'], result['sold_out_menu_ids']), ('clarify', [6]))

    def test_sold_out_notice_joins_two_names_with_josa(self):
        menus = {1: {'name': '콜라'}, 2: {'name': '사이다'}, 3: {'name': '만두'}, 4: {'name': '떡볶이'}}
        self.assertEqual(voice_service._sold_out_notice([1, 2], menus),
                         '콜라와 사이다는 지금 품절이에요. 다른 메뉴를 말씀해 주세요.')
        self.assertEqual(voice_service._sold_out_notice([2, 4, 3], menus),
                         '사이다, 떡볶이, 만두는 지금 품절이에요. 다른 메뉴를 말씀해 주세요.')
        self.assertTrue(voice_service._sold_out_notice([3], {3: {'name': '불고기덮밥'}}).startswith('불고기덮밥은'))

    def test_modify_uses_cart_menu_and_rejects_unknown_entries(self):
        cart = [voice_service.CartLine(entry_id='10:100', menu_id=10, quantity=1, option_ids=[100])]
        raw = {'intent': 'modify', 'items': [
            {'menu_id': 11, 'quantity': 3, 'option_ids': [100], 'entry_id': '10:100'},
            {'menu_id': 10, 'quantity': 1, 'option_ids': [], 'entry_id': 'missing'}]}
        result = voice_service.sanitize(raw, self.catalog, self.request(cart=cart))
        self.assertEqual(result['items'], [{'menu_id': 10, 'quantity': 3, 'option_ids': [100], 'entry_id': '10:100'}])
        raw['items'] = raw['items'][1:]
        self.assertEqual(voice_service.sanitize(raw, self.catalog, self.request(cart=cart))['intent'], 'clarify')

    def test_recommendations_filter_excluded_sold_out_duplicates_and_clamp_fit(self):
        raw = {'intent': 'recommend', 'situation': ['해장', '  ', 'x' * 50], 'recommendations': [
            {'menu_id': 11, 'fit': 140, 'reason': '국물이 있어 속 풀기 좋아요'},
            {'menu_id': 11, 'fit': 10, 'reason': '중복'},
            {'menu_id': 13, 'fit': 90, 'reason': '품절'},
            {'menu_id': 14, 'fit': 90, 'reason': '추천 제외'},
            {'menu_id': 10, 'fit': -5, 'reason': None}]}
        result = voice_service.sanitize(raw, self.catalog, self.request())
        self.assertEqual(result['recommendations'], [{'menu_id': 11, 'fit': 100, 'reason': '국물이 있어 속 풀기 좋아요'},
                                                     {'menu_id': 10, 'fit': 0, 'reason': ''}])
        # 매장 메뉴 태그에 없는 값은 버립니다(발화 일부가 추천 로그에 남지 않게).
        self.assertEqual(result['situation'], ['해장'])

    def test_select_index_must_point_to_shown_recommendation(self):
        raw = {'intent': 'select', 'select_index': 5}
        result = voice_service.sanitize(raw, self.catalog, self.request(recommended_menu_ids=[10, 11]))
        self.assertEqual(result['intent'], 'clarify')
        raw['select_index'] = 1
        result = voice_service.sanitize(raw, self.catalog, self.request(recommended_menu_ids=[10, 11]))
        self.assertEqual((result['intent'], result['select_index']), ('select', 1))

    def test_unknown_intent_and_question_outside_clarify_are_dropped(self):
        result = voice_service.sanitize({'intent': 'hack', 'question': 'x'}, self.catalog, self.request())
        self.assertEqual((result['intent'], result['question']), ('unknown', None))


class SoundAlikeTests(unittest.TestCase):
    """음성 인식이 실제 낱말로 잘못 받아 적은 메뉴를 자모 발음으로 찾습니다(실측 오인식 사례)."""

    def setUp(self):
        def menu(menu_id, name, synonyms=(), sold_out=False):
            return {'id': str(menu_id), 'name': name, 'synonyms': list(synonyms), 'isSoldOut': sold_out}
        self.menus = [menu(54, '식혜'), menu(6, '콜라', ['코카콜라']), menu(49, '계란말이'), menu(64, '호떡'),
                      menu(45, '북엇국', ['북어국']), menu(44, '카레라이스', ['카레']), menu(61, '라면'),
                      menu(7, '사이다', sold_out=True)]

    def found(self, text):
        return [(item['heard'], item['menu_id']) for item in voice_service.sound_alike(text, self.menus)]

    def test_real_word_misrecognitions_point_to_menus(self):
        self.assertEqual(self.found('시계 하나 주세요'), [('시계', 54)])
        self.assertEqual(self.found('골라 하나 주세요'), [('골라', 6)])
        self.assertEqual(self.found('계란 마리 하나'), [('계란마리', 49)])
        self.assertEqual(self.found('오떡 하나 주세요'), [('오떡', 64)])
        self.assertEqual(self.found('가래 라이스 하나'), [('가래라이스', 44)])
        self.assertEqual(self.found('부엌 국 하나 주세요'), [('부엌국', 45)])

    def test_exact_names_sold_out_and_unrelated_talk_are_not_candidates(self):
        self.assertEqual(self.found('콜라 하나랑 라면 주세요'), [])
        # 품절 메뉴는 소리가 같아도 후보가 아닙니다(품절 안내는 sanitize가 따로 합니다).
        self.assertEqual(self.found('싸이다 하나'), [])
        for text in ('오늘 날씨 어때요', '지금 몇 시예요', '양자역학이 뭐예요', '파이썬 알려줘'):
            self.assertEqual(self.found(text), [], text)

    def test_two_syllable_names_need_identical_sound(self):
        # '시켜'는 '식혜'와 자모 하나만 달라도 두 글자라 후보가 아닙니다(주문하다는 뜻일 수 있음).
        self.assertEqual(self.found('시켜 두 개 주세요'), [])

    def test_long_input_is_bounded(self):
        self.assertLessEqual(len(voice_service.sound_alike('가나다라마바사' * 30, self.menus)), 5)


class FakeAnthropic:
    def __init__(self, response=None, error=None):
        self.calls, self.response, self.error = [], response, error
        self.messages = self

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return self.response


def model_response(data, stop='end_turn'):
    return SimpleNamespace(stop_reason=stop, content=[SimpleNamespace(type='text', text=json.dumps(data))])


class VoiceApiTests(unittest.TestCase):
    def setUp(self):
        self.f = AiFixture(self)
        self.client = self.f.kiosk()

    def interpret(self, **body):
        return self.client.post('/kiosk/voice/interpret', json={'text': '제육 두 개 주세요', **body})

    def test_api_backend_sends_schema_cached_catalog_and_no_thinking(self):
        fake = FakeAnthropic(model_response({'intent': 'order', 'items': [
            {'menu_id': 10, 'quantity': 2, 'option_ids': [], 'entry_id': None}], 'situation': [],
            'recommendations': [], 'select_index': None, 'question': None}))
        with patch('voice_service._anthropic_client', return_value=fake), \
             patch.dict('os.environ', {'VOICE_LLM_BACKEND': 'api', 'VOICE_LLM_MODEL': ''}):
            response = self.interpret()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['items'], [{'menu_id': 10, 'quantity': 2, 'option_ids': [], 'entry_id': None}])
        call = fake.calls[0]
        self.assertEqual(call['model'], 'claude-haiku-5-5')
        self.assertEqual(call['thinking'], {'type': 'disabled'})
        self.assertEqual(call['output_config']['format']['schema'], voice_service.OUTPUT_SCHEMA)
        self.assertEqual(call['system'][1]['cache_control'], {'type': 'ephemeral'})
        self.assertIn('제육덮밥', call['system'][1]['text'])
        self.assertNotIn('다른 매장 메뉴', call['system'][1]['text'])
        self.assertNotIn('판매중지', call['system'][1]['text'])
        self.assertEqual(json.loads(call['messages'][0]['content'])['text'], '제육 두 개 주세요')

    def test_alternatives_and_sound_alike_menus_reach_the_model(self):
        fake = FakeAnthropic(model_response({'intent': 'unknown', 'items': [], 'situation': [],
                                             'recommendations': [], 'select_index': None, 'question': None}))
        with patch('voice_service._anthropic_client', return_value=fake), \
             patch.dict('os.environ', {'VOICE_LLM_BACKEND': 'api'}):
            response = self.interpret(text='순두부 지게 하나', alternatives=['순두부 지게 하나', '순두부찌개 하나', ' '])
        self.assertEqual(response.status_code, 200, response.text)
        sent = json.loads(fake.calls[0]['messages'][0]['content'])
        # 첫 후보와 같은 문장·빈 문장은 빼고 보냅니다.
        self.assertEqual(sent['alternatives'], ['순두부찌개 하나'])
        self.assertEqual(sent['sound_alike'], [{'heard': '순두부지게', 'menu_id': 11}])

    def test_alternatives_are_limited(self):
        self.assertEqual(self.interpret(alternatives=['a'] * 5).status_code, 422)
        self.assertEqual(self.interpret(alternatives=['가' * 201]).status_code, 422)
        self.assertEqual(self.interpret(alternatives=[1]).status_code, 422)

    def test_failures_become_voice_unavailable_without_details(self):
        for fake in (FakeAnthropic(error=RuntimeError('secret prompt text')),
                     FakeAnthropic(model_response({}, stop='refusal')),
                     FakeAnthropic(SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text='not json')]))):
            with patch('voice_service._anthropic_client', return_value=fake), \
                 patch.dict('os.environ', {'VOICE_LLM_BACKEND': 'api'}):
                response = self.interpret()
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json()['detail']['code'], 'voice_unavailable')
            self.assertNotIn('secret', response.text)

    def test_missing_key_is_unavailable(self):
        with patch.dict('os.environ', {'VOICE_LLM_BACKEND': 'api', 'ANTHROPIC_API_KEY': ''}), \
             patch('voice_service.load_dotenv'), patch('voice_service._anthropic_client', wraps=None) as client:
            client.side_effect = voice_service.VoiceUnavailable('no_key')
            self.assertEqual(self.interpret().json()['detail']['code'], 'voice_unavailable')

    def test_validation_error_does_not_echo_utterance(self):
        response = self.client.post('/kiosk/voice/interpret', json={'text': '비밀문장' * 60})
        self.assertEqual(response.status_code, 422)
        self.assertNotIn('비밀문장', response.text)

    def test_rate_limit_per_device(self):
        with patch('voice_service.call_model', return_value={'intent': 'help', 'question': '도와드릴게요'}):
            codes = [self.interpret().status_code for _ in range(31)]
        self.assertEqual(codes[:30], [200] * 30)
        self.assertEqual(codes[30], 429)

    def test_voice_disabled_by_owner(self):
        self.f.db.execute("INSERT INTO store_ai_setting (store_id, voice_enabled) VALUES (1, 0)")
        with patch('voice_service.call_model') as model:
            response = self.interpret()
        self.assertEqual(response.status_code, 503)
        model.assert_not_called()

    def test_cli_backend_runs_without_window_and_reads_structured_output(self):
        output = {'is_error': False, 'structured_output': {'intent': 'help', 'items': [], 'situation': [],
                                                          'recommendations': [], 'select_index': None, 'question': '말씀해 주세요'}}
        completed = SimpleNamespace(stdout=json.dumps(output), returncode=0)
        with patch.dict('os.environ', {'VOICE_LLM_BACKEND': 'claude_cli'}), \
             patch('voice_service._cli_path', return_value='claude.exe'), \
             patch('subprocess.run', return_value=completed) as run:
            response = self.interpret()
        self.assertEqual(response.json()['question'], '말씀해 주세요')
        args, kwargs = run.call_args
        self.assertEqual(args[0][0], 'claude.exe')
        self.assertIn('--json-schema', args[0])
        self.assertEqual(kwargs['input'], json.dumps(json.loads(kwargs['input']), ensure_ascii=False, sort_keys=True))
        import subprocess
        self.assertEqual(kwargs['creationflags'], getattr(subprocess, 'CREATE_NO_WINDOW', 0))


class RecLogTests(unittest.TestCase):
    def setUp(self):
        self.f = AiFixture(self)
        self.client = self.f.kiosk()

    def test_impression_then_selection_with_same_id(self):
        log_id = str(uuid4())
        body = {'client_log_id': log_id, 'situation': ['해장'], 'shown_menu_ids': [11, 12, 10], 'policy_profit': 30}
        first = self.client.post('/kiosk/rec-logs', json=body).json()
        self.assertFalse(first['replayed'])
        second = self.client.post('/kiosk/rec-logs', json={**body, 'selected_menu_id': 12}).json()
        self.assertTrue(second['replayed'])
        self.assertEqual(self.f.rows('SELECT situation, shown_menu_ids, selected_menu_id FROM recommendation_log'),
                         [('해장', '11,12,10', 12)])

    def test_selection_outside_shown_or_foreign_menu_is_rejected(self):
        base = {'client_log_id': str(uuid4()), 'shown_menu_ids': [11], 'policy_profit': 30}
        self.assertEqual(self.client.post('/kiosk/rec-logs', json={**base, 'selected_menu_id': 10}).status_code, 422)
        self.assertEqual(self.client.post('/kiosk/rec-logs', json={**base, 'shown_menu_ids': [30]}).status_code, 422)
        self.assertEqual(self.f.value('SELECT COUNT(*) FROM recommendation_log'), 0)


class StaffCallTests(unittest.TestCase):
    def setUp(self):
        self.f = AiFixture(self)

    def test_kiosk_call_reaches_owner_and_owner_resolves(self):
        kiosk = self.f.kiosk()
        first = kiosk.post('/kiosk/staff-call', json={'reason': 'touch'}).json()
        self.assertTrue(kiosk.post('/kiosk/staff-call', json={'reason': 'voice_help'}).json()['replayed'])
        owner = self.f.owner()
        calls = owner.get('/owner/stores/1/staff-calls').json()
        self.assertEqual([call['alert_id'] for call in calls['open']], [first['alert_id']])
        self.assertEqual(calls['open'][0]['device_code'], 'K-70')
        self.assertEqual(owner.patch(f"/owner/stores/1/staff-calls/{first['alert_id']}/resolve").status_code, 200)
        calls = owner.get('/owner/stores/1/staff-calls').json()
        self.assertEqual((calls['open'], calls['recent'][0]['status']), ([], 'RESOLVED'))

    def test_other_owner_cannot_see_or_resolve(self):
        alert = self.f.kiosk().post('/kiosk/staff-call', json={'reason': 'touch'}).json()['alert_id']
        other = self.f.owner('owner.two')
        self.assertEqual(other.get('/owner/stores/1/staff-calls').status_code, 404)
        self.assertEqual(other.patch(f'/owner/stores/2/staff-calls/{alert}/resolve').status_code, 404)
        self.assertEqual(self.f.value('SELECT alert_status FROM device_alert WHERE alert_id = ?', alert), 'UNREAD')


class OwnerAiTests(unittest.TestCase):
    def setUp(self):
        self.f = AiFixture(self)
        self.owner = self.f.owner()

    def settings(self, **overrides):
        values = {'policy_profit': 70, 'pick_weight': 20, 'fit_threshold': 60, 'upsell_enabled': False,
                  'default_mode': 'senior', 'speech_rate': 80, 'voice_enabled': True}
        values.update(overrides)
        return values

    def versions(self):
        return dict(self.f.rows('SELECT device_id, current_menu_version FROM kiosk_device'))

    def test_settings_save_bumps_only_own_store_and_reaches_kiosk(self):
        self.assertEqual(self.owner.get('/owner/stores/1/ai-settings').json()['settings'], kiosk_catalog.DEFAULT_SETTINGS)
        before = self.versions()
        response = self.owner.patch('/owner/stores/1/ai-settings', json=self.settings())
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['settings'], self.settings())
        self.assertEqual(self.versions(), {d: v + (1 if d in (70, 71, 81) else 0) for d, v in before.items()})
        self.assertEqual(self.f.kiosk().get('/kiosk/bootstrap').json()['settings']['policy_profit'], 70)
        # 두 번째 저장은 UPDATE 경로입니다.
        self.owner.patch('/owner/stores/1/ai-settings', json=self.settings(policy_profit=10))
        self.assertEqual(self.f.value('SELECT policy_profit FROM store_ai_setting WHERE store_id = 1'), 10)

    def test_settings_validation_and_ownership(self):
        for bad in (self.settings(policy_profit=101), self.settings(speech_rate=10), self.settings(default_mode='kid'),
                    {**self.settings(), 'extra': 1}, {**self.settings(), 'wake_mode': 'auto'}):
            self.assertEqual(self.owner.patch('/owner/stores/1/ai-settings', json=bad).status_code, 422)
        self.assertEqual(self.owner.patch('/owner/stores/2/ai-settings', json=self.settings()).status_code, 404)
        self.assertEqual(self.f.value('SELECT COUNT(*) FROM store_ai_setting'), 0)

    def test_menu_ai_replaces_tags_and_synonyms(self):
        body = {'menus': [{'menu_id': 11, 'cost_rate': 28, 'is_rec_excluded': False, 'is_store_pick': False,
                           'tags': ['해장', '  얼큰한  ', '해장'], 'synonyms': ['순두부']}]}
        response = self.owner.patch('/owner/stores/1/menu-ai', json=body)
        self.assertEqual(response.status_code, 200, response.text)
        menu = next(m for m in response.json()['menus'] if m['menu_id'] == 11)
        self.assertEqual((menu['cost_rate'], menu['is_store_pick'], menu['tags'], menu['synonyms']),
                         (28, False, ['얼큰한', '해장'], ['순두부']))
        kiosk_menu = next(m for m in self.f.kiosk().get('/kiosk/bootstrap').json()['menus'] if m['id'] == '11')
        self.assertEqual(kiosk_menu['tags'], ['얼큰한', '해장'])

    def test_menu_ai_rejects_foreign_duplicate_and_invalid_values(self):
        def body(**menu):
            return {'menus': [{'menu_id': 11, 'cost_rate': None, 'is_rec_excluded': False, 'is_store_pick': False,
                               'tags': [], 'synonyms': [], **menu}]}
        self.assertEqual(self.owner.patch('/owner/stores/1/menu-ai', json=body(menu_id=30)).status_code, 404)
        self.assertEqual(self.owner.patch('/owner/stores/1/menu-ai', json={'menus': body()['menus'] * 2}).status_code, 422)
        for bad in (body(cost_rate=101), body(tags=['x' * 21]), body(tags=['a\x07b']), body(tags=[str(i) for i in range(11)])):
            self.assertEqual(self.owner.patch('/owner/stores/1/menu-ai', json=bad).status_code, 422)
        self.assertEqual(self.f.rows('SELECT tag_nm FROM menu_tag WHERE menu_id = 11 ORDER BY tag_nm'), [('매운',), ('해장',)])

    def test_schema_missing_is_explicit_503(self):
        with patch('ai_db.ai_schema_ready', return_value=False):
            response = self.owner.patch('/owner/stores/1/ai-settings', json=self.settings())
        self.assertEqual(response.status_code, 503)

    def test_stats_counts_voice_recommendations_and_kst_days(self):
        db = self.f.db
        db.execute("INSERT INTO orders (order_id, store_id, ordered_at, order_type, device_id, client_order_id, order_channel) VALUES "
                   "(1, 1, '2026-11-10 14:59:00', 'takeaway', 70, 'a', 'voice'),"   # KST 11-10 23:59
                   "(2, 1, '2026-11-10 15:00:00', 'takeaway', 70, 'b', 'touch'),"   # KST 11-11 00:00
                   "(3, 2, '2026-11-10 16:00:00', 'takeaway', 80, 'c', 'voice'),"   # 다른 매장
                   "(4, 1, '2026-11-01 00:00:00', 'takeaway', 70, 'd', 'voice')")   # 기간 밖
        db.execute("INSERT INTO order_item (item_id, order_id, menu_id, item_quantity, is_recommended) VALUES "
                   "(1, 1, 10, 2, 0), (2, 1, 12, 1, 1), (3, 2, 20, 3, 0), (4, 3, 30, 1, 0)")
        db.execute("INSERT INTO order_item_option VALUES (1, 100)")
        db.execute("INSERT INTO recommendation_log (store_id, device_id, client_log_id, shown_menu_ids, selected_menu_id, policy_profit, created_at) VALUES "
                   "(1, 70, 'x', '12,11', 12, 30, '2026-11-10 14:00:00'), (1, 70, 'y', '11', NULL, 30, '2026-11-10 14:10:00')")
        now = datetime(2026, 11, 11, 3, 0, tzinfo=timezone.utc)  # KST 11-11 12:00
        with patch('owner_ai_service.datetime') as clock:
            clock.now.return_value = now
            clock.fromisoformat = datetime.fromisoformat
            data = self.owner.get('/owner/stores/1/stats?days=2').json()
        self.assertEqual((data['start_date'], data['end_date']), ('2026-11-10', '2026-11-11'))
        self.assertEqual((data['orders'], data['voice_orders'], data['voice_ratio']), (2, 1, 0.5))
        self.assertEqual(data['revenue_estimate'], (9000 + 1000) * 2 + 7500 + 2000 * 3)
        self.assertEqual(data['rec_revenue_estimate'], 7500)
        self.assertEqual((data['rec_impressions'], data['rec_selections'], data['rec_selection_rate']), (2, 1, 0.5))
        self.assertEqual(data['daily'], [{'date': '2026-11-10', 'orders': 1, 'voice_orders': 1},
                                         {'date': '2026-11-11', 'orders': 1, 'voice_orders': 0}])
        self.assertEqual(data['top_menus'][0], {'menu_id': 20, 'menu_name': '콜라', 'quantity': 3})
        self.assertEqual(self.owner.get('/owner/stores/1/stats?days=0').status_code, 422)


class SyncTests(unittest.TestCase):
    def setUp(self):
        self.f = AiFixture(self)

    def test_websocket_requires_token_and_receives_menu_change(self):
        client = self.f.client()
        with self.assertRaises(Exception):
            with client.websocket_connect('/kiosk/ws', headers={'X-Device-Id': '70', 'Authorization': 'Bearer ' + 'z' * 43}):
                pass
        owner = self.f.owner()
        with client.websocket_connect('/kiosk/ws', headers={'X-Device-Id': '70', 'Authorization': f'Bearer {TOKEN}'}) as ws:
            response = owner.patch('/owner/menus/10/sold-out', json={'is_sold_out': True})
            self.assertEqual(response.status_code, 200)
            message = ws.receive_json()
        self.assertEqual(message, {'type': 'menu_changed', 'menu_version': 4})

    def test_other_store_is_not_notified(self):
        client = self.f.client()
        owner = self.f.owner()
        with client.websocket_connect('/kiosk/ws', headers={'X-Device-Id': '80', 'Authorization': f'Bearer {OTHER_TOKEN}'}) as ws:
            owner.patch('/owner/menus/10/sold-out', json={'is_sold_out': True})
            ws.send_text('ping')
            # 다른 매장 알림이 없으므로 연결은 살아 있고 받을 메시지가 없습니다.
            from sync_hub import hub
            self.assertEqual(hub.count(2), 1)


if __name__ == '__main__':
    unittest.main()


class MenuImageTests(unittest.TestCase):
    JPEG = b'\xff\xd8\xff\xe0' + b'\x00' * 100
    PNG = b'\x89PNG\r\n\x1a\n' + b'\x01' * 100

    def setUp(self):
        import tempfile
        from pathlib import Path
        self.f = AiFixture(self)
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        media = patch('menu_image_service.MEDIA_ROOT', self.root)
        media.start()
        self.addCleanup(media.stop)
        self.owner = self.f.owner()

    def upload(self, data, menu=10, content_type='image/jpeg', client=None):
        return (client or self.owner).put(f'/owner/menus/{menu}/image', content=data, headers={'Content-Type': content_type})

    def files(self):
        return sorted(path.name for path in (self.root / 'menu').glob('*') if not path.name.startswith('.'))

    def test_upload_replace_and_delete(self):
        before = self.f.value('SELECT current_menu_version FROM kiosk_device WHERE device_id = 70')
        first = self.upload(self.JPEG)
        self.assertEqual(first.status_code, 200, first.text)
        url = first.json()['image_url']
        self.assertRegex(url, r'^/media/menu/10_[0-9a-f]{16}\.jpg$')
        self.assertEqual(self.files(), [url.rsplit('/', 1)[1]])
        kiosk_menu = next(m for m in self.f.kiosk().get('/kiosk/bootstrap').json()['menus'] if m['id'] == '10')
        self.assertEqual(kiosk_menu['imageUrl'], url)
        second = self.upload(self.PNG, content_type='image/png').json()['image_url']
        self.assertTrue(second.endswith('.png'))
        self.assertEqual(self.files(), [second.rsplit('/', 1)[1]])
        self.assertEqual(self.f.value('SELECT COUNT(*) FROM menu_img WHERE menu_id = 10'), 1)
        self.assertEqual(self.owner.delete('/owner/menus/10/image').json(), {'menu_id': 10, 'image_url': None})
        self.assertEqual((self.files(), self.f.value('SELECT COUNT(*) FROM menu_img')), ([], 0))
        self.assertEqual(self.f.value('SELECT current_menu_version FROM kiosk_device WHERE device_id = 70'), before + 3)

    def test_rejects_wrong_signature_type_size_and_foreign_menu(self):
        self.assertEqual(self.upload(b'<svg onload=alert(1)>', content_type='image/jpeg').status_code, 415)
        self.assertEqual(self.upload(self.JPEG, content_type='text/html').status_code, 415)
        self.assertEqual(self.upload(self.JPEG + b'\x00' * (900 * 1024)).status_code, 413)
        self.assertEqual(self.upload(self.JPEG, menu=30).status_code, 404)
        self.assertEqual(self.upload(self.JPEG, client=self.f.client()).status_code, 401)
        self.assertEqual((self.files() if (self.root / 'menu').exists() else []), [])
        self.assertEqual(self.f.value('SELECT COUNT(*) FROM menu_img'), 0)


class OrderChannelTests(unittest.TestCase):
    def test_owner_order_list_shows_voice_channel(self):
        f = AiFixture(self)
        f.db.execute("INSERT INTO orders (order_id, store_id, order_type, device_id, client_order_id, order_channel) "
                     "VALUES (1, 1, 'takeaway', 70, 'a', 'voice'), (2, 1, 'dine_in', 70, 'b', NULL)")
        orders = f.owner().get('/owner/stores/1/orders').json()['orders']
        self.assertEqual({o['order_id']: o['order_channel'] for o in orders}, {1: 'voice', 2: None})


class ReviewRegressionTests(unittest.TestCase):
    """공격자 관점 리뷰(2026-11-11)에서 나온 지적의 회귀 테스트."""

    def setUp(self):
        self.f = AiFixture(self)

    def test_sold_out_locks_devices_before_menu(self):
        # 주문 저장과 같은 잠금 순서(기기 → 메뉴)여야 MySQL에서 교착이 생기지 않습니다.
        owner = self.f.owner()
        self.f.statements.clear()
        self.assertEqual(owner.patch('/owner/menus/10/sold-out', json={'is_sold_out': True}).status_code, 200)
        locks = [sql for sql in self.f.statements if 'FOR UPDATE' in sql]
        self.assertIn('kiosk_device', locks[0])
        self.assertTrue(any('menu m' in sql for sql in locks[1:]))

    def test_staff_call_locks_device_row_first(self):
        self.f.statements.clear()
        self.f.kiosk().post('/kiosk/staff-call', json={'reason': 'touch'})
        locks = [sql for sql in self.f.statements if 'FOR UPDATE' in sql]
        self.assertIn('kiosk_device', locks[0])

    def test_selection_must_be_in_stored_impression(self):
        kiosk = self.f.kiosk()
        log_id = str(uuid4())
        kiosk.post('/kiosk/rec-logs', json={'client_log_id': log_id, 'shown_menu_ids': [11], 'policy_profit': 30})
        # 두 번째 요청이 목록을 바꿔 보내도 처음 저장한 노출 목록과 대조합니다.
        response = kiosk.post('/kiosk/rec-logs', json={'client_log_id': log_id, 'shown_menu_ids': [10, 11],
                                                       'selected_menu_id': 10, 'policy_profit': 30})
        self.assertEqual(response.status_code, 422)
        self.assertIsNone(self.f.value('SELECT selected_menu_id FROM recommendation_log'))

    def test_situation_keeps_only_store_tags(self):
        self.f.kiosk().post('/kiosk/rec-logs', json={'client_log_id': str(uuid4()), 'situation': ['해장', '홍길동', '01012345678'],
                                                     'shown_menu_ids': [11], 'policy_profit': 30})
        self.assertEqual(self.f.value('SELECT situation FROM recommendation_log'), '해장')

    def test_kiosk_post_without_declared_length_is_rejected_before_auth(self):
        def chunks():
            yield b'{"text": "a"}'
        response = self.f.client().post('/kiosk/voice/interpret', content=chunks(),
                                        headers={'Content-Type': 'application/json'})
        self.assertEqual(response.status_code, 413)

    def test_failed_reupload_or_foreign_upload_keeps_existing_photo(self):
        import tempfile
        from pathlib import Path
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        root = Path(folder.name)
        media = patch('menu_image_service.MEDIA_ROOT', root)
        media.start()
        self.addCleanup(media.stop)
        jpeg = b'\xff\xd8\xff\xe0' + b'\x01' * 64
        owner = self.f.owner()
        url = owner.put('/owner/menus/10/image', content=jpeg, headers={'Content-Type': 'image/jpeg'}).json()['image_url']
        stored = root / 'menu' / url.rsplit('/', 1)[1]
        self.assertTrue(stored.exists())
        # 다른 점주가 같은 바이트를 이 메뉴로 올려도 404이고 파일은 남습니다.
        other = self.f.owner('owner.two')
        self.assertEqual(other.put('/owner/menus/10/image', content=jpeg, headers={'Content-Type': 'image/jpeg'}).status_code, 404)
        self.assertTrue(stored.exists())
        # 같은 사진을 다시 올리다 DB 저장이 실패해도 쓰이던 파일은 지우지 않습니다.
        with patch('menu_image_service._replace', side_effect=RuntimeError('db')):
            self.assertEqual(owner.put('/owner/menus/10/image', content=jpeg, headers={'Content-Type': 'image/jpeg'}).status_code, 503)
        self.assertTrue(stored.exists())

    def test_tags_differing_only_in_case_are_saved_once(self):
        body = {'menus': [{'menu_id': 11, 'cost_rate': None, 'is_rec_excluded': False, 'is_store_pick': False,
                           'tags': ['Spicy', 'spicy', '해장'], 'synonyms': []}]}
        response = self.f.owner().patch('/owner/stores/1/menu-ai', json=body)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.f.rows('SELECT tag_nm FROM menu_tag WHERE menu_id = 11 ORDER BY tag_nm'), [('Spicy',), ('해장',)])

    def test_media_serves_only_menu_folder_with_cache_on_success(self):
        missing = self.f.client().get('/media/menu/10_0000000000000000.jpg')
        self.assertEqual(missing.status_code, 404)
        self.assertNotIn('immutable', missing.headers.get('cache-control', ''))
        self.assertEqual(missing.headers['x-content-type-options'], 'nosniff')
        self.assertEqual(self.f.client().get('/media/.env').status_code, 404)

    def test_bad_tokens_from_one_device_do_not_lock_other_devices(self):
        bad = self.f.kiosk(81, 'y' * 43)
        for _ in range(10):
            bad.get('/kiosk/menu-version')
        self.assertEqual(bad.get('/kiosk/menu-version').status_code, 429)
        self.assertEqual(self.f.kiosk().get('/kiosk/menu-version').status_code, 200)


class OptionGroupTests(unittest.TestCase):
    """같은 그룹(맵기·사이즈) 옵션은 하나를 꼭 고르고, 그룹 없는 옵션은 자유 추가입니다."""

    def setUp(self):
        self.f = AiFixture(self)

    def order(self, option_ids):
        return self.f.kiosk().post('/kiosk/orders', json=order_body(items=[
            {'menu_id': 12, 'quantity': 1, 'option_ids': option_ids}]))

    def test_bootstrap_sends_option_groups(self):
        menus = {m['id']: m for m in self.f.kiosk().get('/kiosk/bootstrap').json()['menus']}
        self.assertEqual({o['name']: o['group'] for o in menus['12']['options']},
                         {'순한맛': '맵기', '매운맛': '맵기', '라지': '사이즈', '레귤러': '사이즈'})
        self.assertIsNone(menus['10']['options'][0]['group'])

    def test_order_needs_exactly_one_choice_per_group(self):
        self.assertEqual(self.order([110]).status_code, 422)            # 사이즈 빠짐
        self.assertEqual(self.order([110, 111, 113]).status_code, 422)  # 맵기 둘
        response = self.order([111, 112])
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['total_at_submission'], 7500 + 500)

    def test_owner_sets_and_clears_group_and_kiosk_version_bumps(self):
        owner = self.f.owner()
        board = owner.get('/owner/stores/1/menu-board').json()
        option = next(o for o in board['options'] if o['option_id'] == 100)
        self.assertIsNone(option['option_group'])
        before = self.f.value('SELECT current_menu_version FROM kiosk_device WHERE device_id = 70')
        update = {'id': 100, 'name': '곱빼기', 'extra_price': 1000, 'is_active': True, 'sort': 1, 'group': '  양  '}
        response = owner.patch('/owner/stores/1/menu-board', json={'options': {'update': [update]}})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.f.value('SELECT option_group FROM menu_option WHERE option_id = 100'), '양')
        self.assertGreater(self.f.value('SELECT current_menu_version FROM kiosk_device WHERE device_id = 70'), before)
        # group을 보내지 않으면 유지, 빈 문자열이면 해제합니다.
        del update['group']
        owner.patch('/owner/stores/1/menu-board', json={'options': {'update': [dict(update, name='곱빼기 ')]}})
        self.assertEqual(self.f.value('SELECT option_group FROM menu_option WHERE option_id = 100'), '양')
        owner.patch('/owner/stores/1/menu-board', json={'options': {'update': [dict(update, group='')]}})
        self.assertIsNone(self.f.value('SELECT option_group FROM menu_option WHERE option_id = 100'))
        too_long = dict(update, group='가' * 21)
        self.assertEqual(owner.patch('/owner/stores/1/menu-board', json={'options': {'update': [too_long]}}).status_code, 422)


class LegacyRouteTests(unittest.TestCase):
    def setUp(self):
        self.f = AiFixture(self)

    def test_loopback_routes_reject_foreign_host_header(self):
        # DNS 리바인딩: 외부 도메인 이름이 127.0.0.1로 풀려도 Host가 달라 거절합니다.
        client = self.f.client()
        for path in ('/stores', '/db/health', '/admin/orders'):
            self.assertEqual(client.get(path, headers={'Host': 'rebind.example'}).status_code, 403, path)
        self.assertEqual(client.post('/orders', json=order_body(), headers={'Host': 'rebind.example:8001'}).status_code, 403)
        self.assertNotEqual(client.get('/stores', headers={'Host': '127.0.0.1:8001'}).status_code, 403)
        self.assertNotEqual(client.get('/stores', headers={'Host': '10.0.2.2:8001'}).status_code, 403)

    def test_order_locks_menus_in_id_order(self):
        self.f.statements.clear()
        response = self.f.kiosk().post('/kiosk/orders', json=order_body(items=[
            {'menu_id': 12, 'quantity': 1, 'option_ids': [110, 113]}, {'menu_id': 10, 'quantity': 1, 'option_ids': []}]))
        self.assertEqual(response.status_code, 200, response.text)
        locked = [sql for sql in self.f.statements if 'FOR UPDATE' in sql and 'FROM menu m' in sql]
        self.assertEqual(len(locked), 2)
        # 실행 순서에서 메뉴 10이 12보다 먼저 잠깁니다(파라미터는 statements에 없으므로 순서만 확인).
        params = [p for sql, p in self.f.executed if 'FOR UPDATE' in sql and 'FROM menu m' in sql]
        self.assertEqual([p[0] for p in params], [10, 12])


class VoiceOptionGroupTests(unittest.TestCase):
    def test_keeps_first_option_per_required_group_and_shows_groups_in_prompt(self):
        catalog = {'menus': [{'id': '12', 'name': '떡볶이', 'category': '분식', 'price': 5000, 'isSoldOut': False,
                              'recExcluded': False, 'tags': [], 'synonyms': [], 'description': None, 'options': [
                                  {'id': '110', 'name': '순한맛', 'isSoldOut': False, 'group': '맵기'},
                                  {'id': '111', 'name': '매운맛', 'isSoldOut': False, 'group': '맵기'},
                                  {'id': '120', 'name': '치즈 추가', 'isSoldOut': False, 'group': None}]}],
                   'settings': {'voice_enabled': True}}
        raw = {'intent': 'order', 'items': [{'menu_id': 12, 'quantity': 1, 'option_ids': [111, 110, 120], 'entry_id': None}]}
        result = voice_service.sanitize(raw, catalog, voice_service.InterpretInput(text='주문'))
        self.assertEqual(result['items'][0]['option_ids'], [111, 120])
        self.assertIn('110:순한맛[맵기]', voice_service.catalog_text(catalog))
        self.assertIn('120:치즈 추가 |', voice_service.catalog_text(catalog))


class PopularMenuTests(unittest.TestCase):
    def test_bootstrap_lists_recent_best_sellers_that_are_on_sale(self):
        f = AiFixture(self)
        kiosk = f.kiosk()
        for menu_id, quantity in ((11, 1), (10, 3), (11, 4), (14, 9)):
            kiosk.post('/kiosk/orders', json=order_body(items=[{'menu_id': menu_id, 'quantity': quantity, 'option_ids': []}]))
        f.db.execute('UPDATE menu SET is_sold_out = 1 WHERE menu_id = 14')
        f.db.execute("INSERT INTO orders (store_id, ordered_at, order_type, device_id, client_order_id) VALUES (1, '2020-01-01 00:00:00', 'takeaway', 70, 'old')")
        f.db.execute('INSERT INTO order_item (order_id, menu_id, item_quantity) VALUES (last_insert_rowid(), 13, 50)')
        kiosk_catalog.cache.invalidate()
        self.assertEqual(kiosk.get('/kiosk/bootstrap').json()['popular_menu_ids'], ['11', '10'])


class DeviceVersionViewTests(unittest.TestCase):
    def test_owner_sees_applied_and_current_menu_version(self):
        f = AiFixture(self)
        f.kiosk().post('/kiosk/heartbeat', json={'applied_menu_version': 1, 'app_version': '1.2.0+3'})
        device = next(d for d in f.owner().get('/owner/stores/1/devices').json()['devices'] if d['device_id'] == 70)
        current = f.value('SELECT current_menu_version FROM kiosk_device WHERE device_id = 70')
        self.assertEqual((device['applied_menu_version'], device['current_menu_version']), (1, current))
        self.assertEqual(device['app_version'], '1.2.0+3')
        self.assertNotIn('device_token_hash', str(device))


class OrderErrorCodeTests(unittest.TestCase):
    def test_price_change_and_unavailable_menu_return_machine_codes(self):
        f = AiFixture(self)
        kiosk = f.kiosk()
        with patch.dict('os.environ', {'KIOSK_SAVE_DEMO_PAYMENTS': '1'}):
            stale = kiosk.post('/kiosk/payments/demo/card', json={'order': order_body(), 'expected_amount': 1})
        self.assertEqual(stale.status_code, 422)
        self.assertEqual(stale.json()['detail']['code'], 'amount_mismatch')
        f.db.execute('UPDATE menu SET is_sold_out = 1 WHERE menu_id = 10')
        sold_out = kiosk.post('/kiosk/orders', json=order_body())
        self.assertEqual(sold_out.json()['detail']['code'], 'menu_unavailable')
        missing = kiosk.post('/kiosk/orders', json=order_body(items=[{'menu_id': 12, 'quantity': 1, 'option_ids': [110]}]))
        self.assertEqual(missing.json()['detail']['code'], 'option_required')
