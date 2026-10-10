"""외부 DB 연결을 금지하고 메모리 SQLite에서 전체 API 트랜잭션을 검증합니다."""
import sqlite3
import unittest
from datetime import datetime
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from main import app


class Cursor:
    def __init__(self, fixture):
        self.fixture = fixture
        self.cursor = fixture.db.cursor()
    def __enter__(self): return self
    def __exit__(self, *_): self.cursor.close()
    @property
    def lastrowid(self): return self.cursor.lastrowid
    def execute(self, sql, params=()):
        self.schema_rows = None
        if sql.startswith('SET '): return
        if 'information_schema.COLUMNS' in sql:
            rows = self.fixture.db.execute('PRAGMA table_info(orders)').fetchall()
            self.schema_rows = [{'name': r['name'], 'nullable': 'NO' if r['notnull'] else 'YES'}
                                for r in rows if r['name'] in ('order_type','table_no')]
            return
        if sql == 'START TRANSACTION READ ONLY':
            self.fixture.db.execute('BEGIN')
            return
        if (self.fixture.fail_options and sql.startswith('INSERT INTO order_item_option')
                and self.fixture.db.execute('SELECT COUNT(*) FROM order_item_option').fetchone()[0] > 0):
            raise RuntimeError('Simulated write failure')
        self.cursor.execute(sql.replace('%s', '?').replace(' FOR UPDATE', ''), params)
    def _row(self, row):
        if row is None: return None
        result = dict(row)
        if 'ordered_at' in result:
            result['ordered_at'] = datetime.fromisoformat(result['ordered_at'])
        return result
    def fetchone(self): return self._row(self.cursor.fetchone())
    def fetchall(self): return self.schema_rows if self.schema_rows is not None else [self._row(r) for r in self.cursor.fetchall()]


class Connection:
    def __init__(self, fixture): self.fixture = fixture
    def cursor(self): return Cursor(self.fixture)
    def begin(self): self.fixture.db.execute('BEGIN')
    def commit(self): self.fixture.db.commit()
    def rollback(self): self.fixture.db.rollback()
    def close(self): pass


class OrderApiTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:', check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
            PRAGMA foreign_keys=ON;
            CREATE TABLE store (store_id INTEGER PRIMARY KEY,store_nm TEXT);
            CREATE TABLE kiosk_device (device_id INTEGER PRIMARY KEY,store_id INT,is_active INT);
            CREATE TABLE category (category_id INTEGER PRIMARY KEY,store_id INT);
            CREATE TABLE menu (menu_id INTEGER PRIMARY KEY,category_id INT,menu_nm TEXT,menu_price INT,is_active INT,is_sold_out INT);
            CREATE TABLE menu_option (option_id INTEGER PRIMARY KEY,menu_id INT,option_nm TEXT,extra_price INT,is_active INT,is_sold_out INT);
            CREATE TABLE orders (order_id INTEGER PRIMARY KEY AUTOINCREMENT,store_id INT,table_no INT,order_type TEXT,device_id INT,
                client_order_id TEXT,ordered_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(device_id,client_order_id));
            CREATE TABLE order_item (item_id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INT REFERENCES orders(order_id),
                menu_id INT,item_quantity INT,option_id INT);
            CREATE TABLE order_item_option (item_id INT REFERENCES order_item(item_id),option_id INT REFERENCES menu_option(option_id),PRIMARY KEY(item_id,option_id));
            INSERT INTO store VALUES (1,'시연 매장');
            INSERT INTO kiosk_device VALUES (7,1,1);
            INSERT INTO category VALUES (1,1),(2,2);
            INSERT INTO menu VALUES (10,1,'메뉴',9000,1,0),(20,2,'다른 매장',5000,1,0),(30,1,'품절',1000,1,1);
            INSERT INTO menu_option VALUES (101,10,'밥 추가',1000,1,0),(102,10,'고기 추가',2000,1,0),
                (103,20,'다른 메뉴 옵션',500,1,0),(104,10,'품절 옵션',100,1,1),(105,10,'비활성',100,0,0);
        ''')
        self.fail_options = False
        self.factory = patch('order_service.connection_factory', side_effect=lambda: Connection(self))
        self.factory.start()
        # A regression reaching the shared DB fails rather than connecting.
        self.no_network = patch('database.connect', side_effect=AssertionError('Live DB access forbidden'))
        self.no_network.start()
        self.client = TestClient(app)
        self.payload = dict(store_id=1,device_id=7,client_order_id=str(uuid4()),order_type='takeaway',table_no=None,
                            items=[dict(menu_id=10,quantity=2,option_ids=[101,102])])
    def tearDown(self):
        self.client.close(); self.factory.stop(); self.no_network.stop(); self.db.close()
    def post(self): return self.client.post('/orders', json=self.payload)
    def count(self, table): return self.db.execute('SELECT COUNT(*) FROM '+table).fetchone()[0]

    def test_multiple_options_save_and_admin_read(self):
        response = self.post()
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['total_at_submission'],24000)
        order_id = response.json()['order_id']
        self.assertEqual(self.count('order_item_option'),2)
        detail = self.client.get(f'/admin/orders/{order_id}').json()
        self.assertIsNone(detail['table_no'])
        self.assertEqual(detail['order_type'],'takeaway')
        self.assertEqual(detail['items'][0]['quantity'],2)
        self.assertEqual([o['name'] for o in detail['items'][0]['options']],['밥 추가','고기 추가'])
        self.assertTrue(detail['ordered_at'].endswith('+00:00'))
        page = self.client.get('/admin/orders?limit=1').json()
        self.assertEqual(page['total'],1)
        self.assertEqual(page['orders'][0]['quantity'],2)
        self.assertEqual(self.client.get('/admin/orders?offset=1').json()['orders'],[])

    def test_single_no_option_and_dine_in(self):
        for options in ([101],[]):
            self.payload['client_order_id'] = str(uuid4())
            self.payload.update(order_type='dine_in',table_no=None)
            self.payload['items'][0]['option_ids'] = options
            response = self.post()
            self.assertEqual(response.status_code,200)
            detail = self.client.get(f"/admin/orders/{response.json()['order_id']}").json()
            self.assertEqual(detail['order_type'],'dine_in')
            self.assertEqual(len(detail['items'][0]['options']),len(options))

    def test_repeated_order_and_conflicting_uuid(self):
        first = self.post().json()
        self.payload['items'][0]['option_ids'].reverse()
        # Replay remains successful after a menu becomes unavailable.
        self.db.execute('UPDATE menu SET is_active=0 WHERE menu_id=10'); self.db.commit()
        repeated = self.post()
        self.assertEqual(repeated.json(),{'order_id':first['order_id'],'replayed':True})
        self.assertEqual(self.count('orders'),1)
        self.payload['items'][0]['quantity'] = 3
        self.assertEqual(self.post().status_code,409)
        self.assertEqual(self.count('orders'),1)

    def test_option_failure_rolls_back_every_table_and_retry(self):
        self.fail_options = True
        self.assertEqual(self.post().status_code,503)
        for table in ('orders','order_item','order_item_option'):
            self.assertEqual(self.count(table),0)
        self.fail_options = False
        self.assertEqual(self.post().status_code,200)
        self.assertEqual(self.count('orders'),1)

    def test_table_quantity_uuid_and_price_rules(self):
        original = dict(self.payload)
        for changes in (dict(table_no=2),dict(order_type='invalid'),dict(table_no=-1),
                        dict(client_order_id='bad'),dict(table_no=True),dict(price=1)):
            self.payload = original | changes
            self.assertEqual(self.post().status_code,422)
        self.payload = original
        for item in (dict(menu_id=10,quantity=0,option_ids=[]),dict(menu_id=10,quantity=100),
                     dict(menu_id=10,quantity=1,option_ids=[101,101]),dict(menu_id=10,quantity=1,price=1)):
            self.payload['items']=[item]
            self.assertEqual(self.post().status_code,422)
        self.assertEqual(self.count('orders'),0)

    def test_store_menu_options_and_device_validation(self):
        original = dict(self.payload)
        for changes in (dict(store_id=2),dict(device_id=99),
                        dict(items=[dict(menu_id=20,quantity=1)]),dict(items=[dict(menu_id=30,quantity=1)])):
            self.payload = original | changes
            self.assertEqual(self.post().status_code,422)
        for option in (103,104,105,999):
            self.payload = original | dict(items=[dict(menu_id=10,quantity=1,option_ids=[option])])
            self.assertEqual(self.post().status_code,422)
        self.payload = original
        self.db.execute('UPDATE kiosk_device SET is_active=0'); self.db.commit()
        self.assertEqual(self.post().status_code,422)
        self.assertEqual(self.count('orders'),0)

    def test_legacy_single_option_and_union_deduplication(self):
        order_id = self.post().json()['order_id']
        self.db.execute('UPDATE order_item SET option_id=101'); self.db.commit()
        detail = self.client.get(f'/admin/orders/{order_id}').json()
        self.assertEqual(len(detail['items'][0]['options']),2)
        self.db.execute('DELETE FROM order_item_option'); self.db.commit()
        detail = self.client.get(f'/admin/orders/{order_id}').json()
        self.assertEqual([o['option_id'] for o in detail['items'][0]['options']],[101])

    def test_explicit_type_and_legacy_orders_before_and_after_migration(self):
        for table, mode in ((0,'takeaway'),(3,'dine_in')):
            self.db.execute('INSERT INTO orders (store_id,device_id,table_no,order_type,client_order_id) VALUES (1,7,?,NULL,?)',
                            (table,str(uuid4())))
        self.db.commit()
        for order_id, table, mode in ((1,0,'takeaway'),(2,3,'dine_in')):
            detail = self.client.get(f'/admin/orders/{order_id}').json()
            self.assertEqual((detail['table_no'],detail['order_type']), (table,mode))
        self.db.execute('ALTER TABLE orders DROP COLUMN order_type'); self.db.commit()
        page = self.client.get('/admin/orders').json()
        self.assertEqual({r['order_type'] for r in page['orders']},{'takeaway','dine_in'})
        for order_id in (1,2):
            self.assertEqual(self.client.get(f'/admin/orders/{order_id}').status_code,200)
        rejected = self.post()
        self.assertEqual(rejected.status_code,503)
        self.assertIn('저장하지 않았습니다',rejected.json()['detail'])
        self.assertEqual(self.count('orders'),2)

    def test_type_conflict_uuid_and_missing_type(self):
        order_id = self.post().json()['order_id']
        self.payload['order_type']='dine_in'
        self.assertEqual(self.post().status_code,409)
        self.assertEqual(self.count('orders'),1)
        self.payload.pop('order_type')
        self.assertEqual(self.post().status_code,422)
        self.db.execute('UPDATE orders SET order_type=NULL,table_no=0 WHERE order_id=?',(order_id,)); self.db.commit()
        self.payload['order_type']='takeaway'
        self.assertEqual(self.post().json(),{'order_id':order_id,'replayed':True})

    def test_local_access_limits_and_missing_order(self):
        remote = TestClient(app, client=('203.0.113.1',1234))
        for path in ('/orders','/admin/orders'):
            result = remote.post(path,json=self.payload) if path == '/orders' else remote.get(path)
            self.assertEqual(result.status_code,403)
        remote.close()
        self.assertEqual(self.client.get('/admin/orders/999').status_code,404)
        self.assertEqual(self.client.get('/admin/orders?limit=201').status_code,422)


if __name__ == '__main__': unittest.main()
