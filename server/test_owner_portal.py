"""점주 API의 권한·입력 검증·저장·롤백을 메모리 SQLite로 검증합니다. MySQL 잠금 동작은 대신하지 않습니다."""
import unittest
from unittest.mock import patch

from owner_test_support import ORIGIN, OwnerFixture

STORE = '/owner/stores/1'
BOARD = STORE + '/menu-board'


def menu_update(menu_id=10, **changes):
    return {'id': menu_id, 'category_id': 1, 'name': '덮밥', 'price': 9000, 'description': '설명',
            'is_active': True, 'sort': 1, **changes}


def option_update(option_id=100, **changes):
    return {'id': option_id, 'name': '곱빼기', 'extra_price': 1000, 'is_active': True, 'sort': 1, **changes}


class OwnerPortalTestCase(unittest.TestCase):
    def setUp(self):
        self.f = OwnerFixture(self)
        self.client = self.f.signed_in()

    def save(self, body, store=1):
        return self.client.patch(f'/owner/stores/{store}/menu-board', json=body)

    def versions(self):
        return dict(self.f.db.execute('SELECT device_id, current_menu_version FROM kiosk_device').fetchall())


class AccessTests(OwnerPortalTestCase):
    ROUTES = [('GET', STORE), ('GET', BOARD), ('PATCH', BOARD), ('GET', STORE + '/orders'), ('GET', STORE + '/orders/1000'),
              ('GET', STORE + '/devices'), ('PATCH', '/owner/menus/10/sold-out'), ('PATCH', '/owner/options/100/sold-out')]

    def test_anonymous_and_remote_are_blocked_before_database(self):
        anonymous, remote = self.f.client(), self.f.client(client=('203.0.113.1', 1234))
        for method, path in self.ROUTES:
            response = anonymous.request(method, path, json={})
            self.assertEqual(response.status_code, 401, path)
            self.assertEqual(response.headers['cache-control'], 'no-store')
            self.assertEqual(remote.request(method, path, json={}).status_code, 403, path)
        self.assertEqual(self.f.statements, [])

    def test_other_owner_gets_404_and_nothing_changes(self):
        other = self.f.signed_in('owner.two')
        before = self.f.snapshot()
        for method, path in self.ROUTES:
            body = {'is_sold_out': True} if 'sold-out' in path else {'menus': {'update': [menu_update()]}} if method == 'PATCH' else None
            response = other.request(method, path, json=body)
            self.assertEqual(response.status_code, 404, path)
            self.assertEqual(response.json(), {'detail': '항목을 찾을 수 없습니다.'})
        self.assertEqual(self.f.snapshot(), before)
        self.assertEqual(self.f.commits, 0)

    def test_missing_and_unlinked_stores_look_the_same_as_foreign(self):
        for store in (2, 4, 999):
            self.assertEqual(self.client.get(f'/owner/stores/{store}').status_code, 404)
            self.assertEqual(self.client.get(f'/owner/stores/{store}/menu-board').status_code, 404)
            self.assertEqual(self.save({'categories': {'remove': [3]}}, store).status_code, 404)

    def test_relink_applies_on_next_request_without_new_login(self):
        self.assertEqual(self.client.get(STORE).status_code, 200)
        self.f.db.execute('UPDATE store SET owner_id = 8 WHERE store_id = 1')
        self.f.db.commit()
        self.assertEqual(self.client.get(STORE).status_code, 404)
        self.assertEqual(self.client.patch('/owner/menus/10/sold-out', json={'is_sold_out': True}).status_code, 404)

    def test_every_write_requires_csrf_and_allowed_origin(self):
        calls = [(BOARD, {'categories': {'remove': [3]}}), ('/owner/menus/10/sold-out', {'is_sold_out': True}),
                 ('/owner/options/100/sold-out', {'is_sold_out': True})]
        token = self.client.headers['X-CSRF-Token']
        before = self.f.snapshot()
        for path, body in calls:
            for headers in ({'Origin': 'http://evil.example', 'X-CSRF-Token': token}, {'Origin': ORIGIN, 'X-CSRF-Token': 'x' * 43}):
                self.assertEqual(self.client.patch(path, json=body, headers=headers).status_code, 403)
        del self.client.headers['X-CSRF-Token']
        self.assertEqual(self.client.patch(BOARD, json={}).status_code, 403)
        self.assertEqual(self.f.statements, [])
        self.assertEqual(self.f.snapshot(), before)

    def test_preflight_allows_save_method_and_csrf_header(self):
        response = self.f.client().options(BOARD, headers={'Origin': ORIGIN, 'Access-Control-Request-Method': 'PATCH',
                                                           'Access-Control-Request-Headers': 'content-type,x-csrf-token'})
        self.assertEqual(response.status_code, 200)
        self.assertIn('PATCH', response.headers['access-control-allow-methods'])
        self.assertEqual(response.headers['access-control-allow-origin'], ORIGIN)


class ReadTests(OwnerPortalTestCase):
    def test_store_detail_contract_has_no_secrets(self):
        response = self.client.get(STORE)
        row = response.json()
        self.assertEqual((row['store_id'], row['store_name'], row['address_detail'], row['owner_id'], row['owner_login_id']),
                         (1, '점주1 매장', '1층', 7, 'owner.one'))
        self.assertNotIn('own_pw', response.text)
        self.assertFalse(any('own_pw' in sql for sql in self.f.statements))

    def test_menu_board_includes_inactive_with_ids_and_sort(self):
        board = self.client.get(BOARD).json()
        self.assertEqual([(c['category_id'], c['category_sort']) for c in board['categories']], [(1, 5), (2, 9), (3, 12)])
        self.assertEqual([(m['menu_id'], m['menu_sort'], m['is_active']) for m in board['menus']],
                         [(10, 3, True), (11, 7, False), (12, 14, True)])
        self.assertIs(board['menus'][2]['is_sold_out'], True)
        self.assertEqual([(o['option_id'], o['menu_option_sort'], o['is_active']) for o in board['options']],
                         [(100, 4, True), (101, 9, False), (102, 11, True)])

    def test_order_list_is_scoped_utc_and_paged(self):
        page = self.client.get(STORE + '/orders').json()
        self.assertEqual((page['total'], [o['order_id'] for o in page['orders']]), (2, [1001, 1000]))
        self.assertTrue(all(o['ordered_at'].endswith('+00:00') for o in page['orders']))
        self.assertEqual(page['orders'][1]['ordered_at'], '2026-10-29T01:00:00+00:00')
        self.assertEqual(page['orders'][1]['quantity'], 2)
        second = self.client.get(STORE + '/orders?limit=1&offset=1').json()
        self.assertEqual([o['order_id'] for o in second['orders']], [1000])
        for query in ('limit=0', 'limit=201', 'offset=-1'):
            self.assertEqual(self.client.get(f'{STORE}/orders?{query}').status_code, 422)

    def test_order_options_come_from_item_option_table(self):
        detail = self.client.get(STORE + '/orders/1000').json()
        self.assertEqual(detail['order_type'], 'takeaway')
        self.assertEqual([(o['option_id'], o['name'], o['extra_price']) for o in detail['items'][0]['options']],
                         [(100, '곱빼기', 1000), (102, '고기', 2000)])
        legacy = self.client.get(STORE + '/orders/1001').json()
        self.assertEqual(legacy['order_type'], 'dine_in')
        self.assertEqual(legacy['items'][0]['options'], [])
        self.assertEqual(legacy['items'][0]['legacy_option_id'], 101)

    def test_order_of_other_store_is_404_through_own_store(self):
        self.assertEqual(self.client.get(STORE + '/orders/2000').status_code, 404)
        self.assertEqual(self.client.get('/owner/stores/3/orders/1000').status_code, 404)

    def test_devices_never_expose_token_hash(self):
        response = self.client.get(STORE + '/devices')
        self.assertEqual(response.json(), {'devices': [
            # 이 픽스처 DB에는 current_menu_version만 있고 나머지 상태 열은 없어 None입니다.
            {'device_id': 70, 'device_code': 'K-70', 'is_active': True, 'last_seen_at': '2026-10-29T01:02:03+00:00',
             'app_version': None, 'last_synced_at': None, 'current_menu_version': 3, 'applied_menu_version': None},
            {'device_id': 71, 'device_code': 'K-71', 'is_active': False, 'last_seen_at': None,
             'app_version': None, 'last_synced_at': None, 'current_menu_version': 5, 'applied_menu_version': None}]})
        self.assertNotIn('token', response.text)
        self.assertFalse(any('device_token_hash' in sql for sql in self.f.statements))

    def test_database_failure_is_generic_503(self):
        self.f.fail_on = 'FROM store'
        for path in (STORE, BOARD, STORE + '/orders', STORE + '/devices'):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 503, path)
            self.assertNotIn('private', response.text)


class SoldOutTests(OwnerPortalTestCase):
    def test_changes_immediately_and_bumps_only_own_store_menu_version(self):
        # 품절도 키오스크가 바로 반영해야 하므로 해당 매장 기기의 메뉴 버전을 올립니다(AI 음성 작업에서 변경).
        before = self.versions()
        self.assertEqual(self.client.patch('/owner/menus/10/sold-out', json={'is_sold_out': True}).json(),
                         {'menu_id': 10, 'is_sold_out': True})
        self.assertEqual(self.client.patch('/owner/options/100/sold-out', json={'is_sold_out': True}).json(),
                         {'option_id': 100, 'is_sold_out': True})
        self.assertEqual(self.f.value('SELECT is_sold_out FROM menu WHERE menu_id = 10'), 1)
        self.assertEqual(self.f.value('SELECT is_sold_out FROM menu_option WHERE option_id = 100'), 1)
        self.assertEqual(self.versions(), {device: version + (2 if device in (70, 71) else 0)
                                           for device, version in before.items()})

    def test_repeating_same_value_succeeds(self):
        for _ in range(2):
            self.assertEqual(self.client.patch('/owner/menus/12/sold-out', json={'is_sold_out': True}).status_code, 200)

    def test_foreign_ids_and_invalid_body_are_rejected(self):
        self.assertEqual(self.client.patch('/owner/menus/20/sold-out', json={'is_sold_out': True}).status_code, 404)
        self.assertEqual(self.client.patch('/owner/options/200/sold-out', json={'is_sold_out': True}).status_code, 404)
        self.assertEqual(self.f.value('SELECT is_sold_out FROM menu WHERE menu_id = 20'), 0)
        for body in ({}, {'is_sold_out': 1}, {'is_sold_out': 'true'}, {'is_sold_out': True, 'menu_id': 20}):
            self.assertEqual(self.client.patch('/owner/menus/10/sold-out', json=body).status_code, 422)
        self.assertEqual(self.client.patch('/owner/menus/0/sold-out', json={'is_sold_out': True}).status_code, 422)

    def test_failure_rolls_back_and_hides_details(self):
        self.f.commit_failure = True
        response = self.client.patch('/owner/menus/10/sold-out', json={'is_sold_out': True})
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('private', response.text)
        self.assertEqual(self.f.value('SELECT is_sold_out FROM menu WHERE menu_id = 10'), 0)


class SaveTests(OwnerPortalTestCase):
    def full_batch(self):
        return {
            'categories': {'create': [{'temp_id': -1, 'name': ' 새 카테고리 ', 'sort': 1}],
                           'update': [{'id': 2, 'name': '마실 것', 'sort': 2}], 'remove': [3]},
            'menus': {'create': [{'temp_id': -2, 'category_id': -1, 'name': '새 메뉴', 'price': 1000, 'description': None,
                                  'is_active': True, 'is_sold_out': False, 'sort': 1}],
                      'update': [menu_update(11, name='국밥', price=8500, description=None, category_id=-1, sort=2)]},
            'options': {'create': [{'temp_id': -3, 'menu_id': -2, 'name': '새 옵션', 'extra_price': 0,
                                    'is_sold_out': False, 'sort': 1}],
                        'update': [option_update(102, is_active=False, sort=1)]},
        }

    def test_full_batch_saves_together_and_returns_board_and_ids(self):
        response = self.save(self.full_batch())
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(set(result['ids']), {'-1', '-2', '-3'})
        category, menu, option = result['ids']['-1'], result['ids']['-2'], result['ids']['-3']
        self.assertEqual(self.f.value('SELECT category_nm FROM category WHERE category_id = ?', category), '새 카테고리')
        self.assertEqual(self.f.value('SELECT category_id FROM menu WHERE menu_id = ?', menu), category)
        self.assertEqual(self.f.value('SELECT menu_id FROM menu_option WHERE option_id = ?', option), menu)
        self.assertEqual(self.f.value('SELECT category_id FROM menu WHERE menu_id = 11'), category)
        self.assertEqual(self.f.value('SELECT COUNT(*) FROM category WHERE category_id = 3'), 0)
        self.assertEqual(self.f.value('SELECT is_active FROM menu_option WHERE option_id = 102'), 0)
        self.assertEqual(result['devices_updated'], 2)
        self.assertEqual(self.f.commits, 1)
        self.assertEqual(result['board'], self.client.get(BOARD).json())

    def test_sort_is_renumbered_from_one_regardless_of_client_values(self):
        body = {'categories': {'update': [{'id': 1, 'name': '식사', 'sort': 100}]},
                'menus': {'update': [menu_update(11, name='국밥', description=None, sort=50)]},
                'options': {'update': [option_update(100, sort=70)]}}
        self.assertEqual(self.save(body).status_code, 200)
        rows = lambda sql: [tuple(r) for r in self.f.db.execute(sql)]
        self.assertEqual(rows('SELECT category_id, category_sort FROM category WHERE store_id = 1 ORDER BY category_sort'),
                         [(2, 1), (3, 2), (1, 3)])
        self.assertEqual(rows('SELECT menu_id, menu_sort FROM menu WHERE category_id = 1 ORDER BY menu_sort'), [(10, 1), (11, 2)])
        self.assertEqual(rows('SELECT menu_id, menu_sort FROM menu WHERE category_id = 2'), [(12, 1)])
        self.assertEqual(rows('SELECT option_id, menu_option_sort FROM menu_option WHERE menu_id = 10 ORDER BY menu_option_sort'),
                         [(101, 1), (102, 2), (100, 3)])
        # 다른 매장은 번호가 바뀌지 않습니다.
        self.assertEqual(self.f.value('SELECT category_sort FROM category WHERE category_id = 4'), 1)

    def test_success_bumps_only_this_stores_devices_by_one(self):
        self.assertEqual(self.save({'categories': {'remove': [3]}}).status_code, 200)
        self.assertEqual(self.versions(), {70: 4, 71: 6, 80: 9})

    def test_empty_batch_writes_nothing(self):
        before = self.f.snapshot()
        response = self.save({})
        self.assertEqual((response.status_code, response.json()['ids'], response.json()['devices_updated']), (200, {}, 0))
        self.assertEqual(self.f.snapshot(), before)

    def test_values_identical_to_saved_still_succeed(self):
        # 테스트 커서는 MySQL처럼 UPDATE 영향 행을 0으로 돌려줍니다. 그래도 성공해야 합니다.
        self.assertEqual(self.save({'menus': {'update': [menu_update(sort=3)]}}).status_code, 200)

    def test_sold_out_field_cannot_be_changed_through_save(self):
        body = {'menus': {'update': [menu_update(12, category_id=2, name='콜라', price=2000, description=None, is_sold_out=False)]}}
        self.assertEqual(self.save(body).status_code, 422)
        self.assertEqual(self.f.value('SELECT is_sold_out FROM menu WHERE menu_id = 12'), 1)

    def test_menu_and_option_are_deactivated_not_deleted(self):
        body = {'menus': {'update': [menu_update(is_active=False)]}, 'options': {'update': [option_update(is_active=False)]}}
        self.assertEqual(self.save(body).status_code, 200)
        self.assertEqual(self.f.value('SELECT is_active FROM menu WHERE menu_id = 10'), 0)
        self.assertEqual(self.f.value('SELECT is_active FROM menu_option WHERE option_id = 100'), 0)
        writes = [sql for sql in self.f.statements if sql.lstrip().upper().startswith('DELETE')]
        self.assertEqual(writes, [])

    def test_inactive_option_can_be_sold_again_and_returns_to_kiosk(self):
        def kiosk_options():
            # 키오스크 조회의 실제 SQL을 메모리 DB에서 실행합니다.
            def query(sql, params=()):
                return [dict(row) for row in self.f.db.execute(sql.replace('%s', '?'), params)]
            with patch('main._db_query', side_effect=query):
                menus = self.client.get('/stores/1/menus').json()
            return next(m for m in menus if m['id'] == '10')['options']

        self.assertNotIn('101', [o['id'] for o in kiosk_options()])
        before = self.f.value('SELECT is_sold_out FROM menu_option WHERE option_id = 101')
        response = self.save({'options': {'update': [option_update(101, name='계란', extra_price=500, sort=2)]}})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.f.value('SELECT is_active FROM menu_option WHERE option_id = 101'), 1)
        self.assertEqual(self.f.value('SELECT is_sold_out FROM menu_option WHERE option_id = 101'), before)
        self.assertEqual(self.f.value('SELECT COUNT(*) FROM menu_option WHERE menu_id = 10'), 3)
        self.assertTrue(next(o for o in response.json()['board']['options'] if o['option_id'] == 101)['is_active'])
        self.assertEqual(self.versions(), {70: 4, 71: 6, 80: 9})
        self.assertIn('101', [o['id'] for o in kiosk_options()])

    def test_only_allowed_tables_are_written_and_orders_stay_intact(self):
        before = self.f.snapshot()
        self.assertEqual(self.save(self.full_batch()).status_code, 200)
        after = self.f.snapshot()
        for table in ('owner', 'store', 'orders', 'order_item', 'order_item_option'):
            self.assertEqual(after[table], before[table], table)
        targets = {sql.split()[2 if sql.lstrip().upper().startswith(('INSERT', 'DELETE')) else 1]
                   for sql in self.f.statements if sql.lstrip().upper().startswith(('INSERT', 'UPDATE', 'DELETE'))}
        self.assertLessEqual(targets, {'category', 'menu', 'menu_option', 'kiosk_device'})

    def test_category_removal_after_moving_all_menus_succeeds(self):
        body = {'menus': {'update': [menu_update(12, category_id=3, name='콜라', price=2000, description=None)]},
                'categories': {'remove': [2]}}
        self.assertEqual(self.save(body).status_code, 200)
        self.assertEqual(self.f.value('SELECT category_id FROM menu WHERE menu_id = 12'), 3)
        self.assertEqual(self.f.value('SELECT COUNT(*) FROM category WHERE category_id = 2'), 0)

    def test_category_with_menu_including_inactive_is_409_and_whole_batch_rolls_back(self):
        before = self.f.snapshot()
        for category in (1, 2):  # 카테고리 1에는 판매 중지 메뉴도 있습니다.
            response = self.save({'menus': {'create': [{'temp_id': -1, 'category_id': 3, 'name': '남으면 안 됨', 'price': 1,
                                                        'description': None, 'is_active': True, 'is_sold_out': False, 'sort': 1}]},
                                  'categories': {'remove': [category]}})
            self.assertEqual(response.status_code, 409)
            self.assertEqual(self.f.snapshot(), before)
        self.assertEqual(self.f.commits, 0)

    def test_foreign_references_are_404_and_roll_back(self):
        before = self.f.snapshot()
        bodies = [
            {'categories': {'update': [{'id': 4, 'name': '침범', 'sort': 1}]}},
            {'categories': {'remove': [4]}},
            {'menus': {'update': [menu_update(20)]}},
            {'menus': {'update': [menu_update(10, category_id=4)]}},
            {'menus': {'create': [{'temp_id': -1, 'category_id': 4, 'name': '침범', 'price': 1, 'description': None,
                                   'is_active': True, 'is_sold_out': False, 'sort': 1}]}},
            {'options': {'update': [option_update(200)]}},
            {'options': {'create': [{'temp_id': -1, 'menu_id': 20, 'name': '침범', 'extra_price': 0,
                                     'is_sold_out': False, 'sort': 1}]}},
            {'options': {'update': [option_update(999)]}},
        ]
        for body in bodies:
            self.assertEqual(self.save(body).status_code, 404, body)
            self.assertEqual(self.f.snapshot(), before, body)
        self.assertEqual(self.f.commits, 0)

    def test_failure_at_any_step_rolls_back_everything(self):
        before = self.f.snapshot()
        for failure in ('INSERT INTO category', 'UPDATE category', 'INSERT INTO menu ', 'UPDATE menu SET category_id',
                        'INSERT INTO menu_option', 'UPDATE menu_option', 'DELETE FROM category',
                        'UPDATE kiosk_device', 'SELECT m.menu_id, m.category_id, m.menu_nm'):
            self.f.fail_on = failure
            response = self.save(self.full_batch())
            self.assertEqual(response.status_code, 503, failure)
            self.assertNotIn('private', response.text)
            self.assertEqual(self.f.snapshot(), before, failure)
        self.f.fail_on = None
        self.f.commit_failure = True
        self.assertEqual(self.save(self.full_batch()).status_code, 503)
        self.assertEqual(self.f.snapshot(), before)
        self.assertEqual(self.f.commits, 0)

    def test_duplicate_category_name_is_rejected_and_rolled_back(self):
        before = self.f.snapshot()
        for body in ({'categories': {'update': [{'id': 2, 'name': '식사', 'sort': 1}]}},
                     {'categories': {'create': [{'temp_id': -1, 'name': '  식사', 'sort': 1}]}}):
            self.assertEqual(self.save(body).status_code, 422)
            self.assertEqual(self.f.snapshot(), before)

    def test_invalid_input_is_422_before_database_and_not_reflected(self):
        secret = 'reflect-me-not'
        category = lambda **c: {'categories': {'update': [{'id': 1, 'name': '식사', 'sort': 1, **c}]}}
        menu = lambda **c: {'menus': {'update': [menu_update(**c)]}}
        option = lambda **c: {'options': {'update': [option_update(**c)]}}
        created = lambda **c: {'temp_id': -1, 'category_id': 1, 'name': '새', 'price': 1, 'description': None,
                               'is_active': True, 'is_sold_out': False, 'sort': 1, **c}
        created_option = lambda **c: {'temp_id': -1, 'menu_id': 10, 'name': '새', 'extra_price': 0,
                                      'is_sold_out': False, 'sort': 1, **c}
        bodies = [
            {'unknown': secret}, {'menus': {'delete': [10]}}, {'categories': []},
            category(name=''), category(name='   '), category(name='가' * 101), category(name=secret + '\x00'), category(sort=0),
            category(sort=True), category(id='1'), category(id=0), category(store_id=2),
            menu(name='가' * 51), menu(price=0), menu(price=1_000_001), menu(price='9000'), menu(price=1.5),
            menu(description='가' * 501), menu(is_active=1), menu(category_id=0), menu(category_id=-9), menu(sort=-1),
            option(name=''), option(extra_price=-1), option(extra_price=1_000_001), option(is_active='true'), option(menu_id=11),
            option(id=2147483648),
            {'menus': {'create': [created(temp_id=1)]}}, {'menus': {'create': [created(category_id=-5)]}},
            {'menus': {'create': [created(), created()]}},
            {'menus': {'create': [created()]}, 'options': {'create': [created_option()]}},
            {'options': {'create': [created_option(menu_id=-5)]}},
            {'menus': {'update': [menu_update(), menu_update()]}},
            {'options': {'update': [option_update(), option_update()]}},
            {'categories': {'remove': [3, 3]}},
            {'categories': {'update': [{'id': 3, 'name': '빈', 'sort': 1}], 'remove': [3]}},
        ]
        for body in bodies:
            response = self.save(body)
            self.assertEqual(response.status_code, 422, body)
            self.assertNotIn(secret, response.text)
            self.assertNotIn('input', response.text)
        self.assertEqual(self.f.statements, [])

    def test_oversized_body_is_413(self):
        response = self.client.patch(BOARD, content=b'x' * (1024 * 1024 + 1), headers={'Content-Type': 'application/json'})
        self.assertEqual(response.status_code, 413)
        self.assertEqual(self.f.statements, [])

    def test_lock_order_matches_order_api_and_no_plain_read_precedes_locks(self):
        self.save({'categories': {'remove': [3]}})
        write_start = self.f.statements.index('START TRANSACTION')
        statements = self.f.statements[write_start + 1:]
        self.assertTrue(statements[0].startswith('SELECT device_id FROM kiosk_device'))
        self.assertTrue(statements[0].endswith('FOR UPDATE'))
        self.assertTrue(statements[1].startswith('SELECT store_id FROM store'))
        self.assertTrue(statements[1].endswith('FOR UPDATE'))


if __name__ == '__main__':
    unittest.main()
