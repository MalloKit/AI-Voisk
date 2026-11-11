"""점주 테스트 공용 격리 환경. 외부 DB 없이 메모리 SQLite에서 실제 SQL을 실행합니다."""
import secrets
import sqlite3
from datetime import datetime
from unittest.mock import patch

from fastapi.testclient import TestClient
from pymysql.err import IntegrityError

import admin_auth
import owner_auth
from main import app

ORIGIN = 'http://localhost:8080'
PASSWORD = secrets.token_urlsafe(24)
HASH = admin_auth.hasher.hash(PASSWORD)

SCHEMA = """
    PRAGMA foreign_keys=ON;
    CREATE TABLE owner (owner_id INTEGER PRIMARY KEY, own_login_id TEXT NOT NULL UNIQUE, own_pw TEXT NOT NULL);
    CREATE TABLE store (store_id INTEGER PRIMARY KEY, store_nm TEXT NOT NULL, store_add1 TEXT NOT NULL, store_add2 TEXT,
        store_code TEXT NOT NULL, store_phone TEXT NOT NULL, business_no TEXT NOT NULL, store_owner_nm TEXT NOT NULL,
        store_type TEXT NOT NULL, admin_id INTEGER NOT NULL, owner_id INTEGER REFERENCES owner(owner_id));
    CREATE TABLE category (category_id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL REFERENCES store(store_id),
        category_nm TEXT NOT NULL, category_sort INTEGER NOT NULL);
    CREATE TABLE menu (menu_id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER NOT NULL REFERENCES category(category_id),
        menu_nm TEXT NOT NULL, menu_price INTEGER NOT NULL, menu_des TEXT, is_active INTEGER NOT NULL DEFAULT 1,
        is_sold_out INTEGER NOT NULL DEFAULT 0, menu_sort INTEGER NOT NULL);
    CREATE TABLE menu_option (option_id INTEGER PRIMARY KEY AUTOINCREMENT, menu_id INTEGER NOT NULL REFERENCES menu(menu_id),
        option_nm TEXT NOT NULL, menu_option_sort INTEGER NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
        is_sold_out INTEGER NOT NULL DEFAULT 0, extra_price INTEGER NOT NULL DEFAULT 0 CHECK (extra_price >= 0));
    CREATE TABLE menu_img (img_id INTEGER PRIMARY KEY AUTOINCREMENT, menu_id INTEGER NOT NULL REFERENCES menu(menu_id),
        img_nm TEXT NOT NULL, is_main INTEGER NOT NULL);
    CREATE TABLE kiosk_device (device_id INTEGER PRIMARY KEY, device_code TEXT NOT NULL, store_id INTEGER NOT NULL REFERENCES store(store_id),
        device_token_hash TEXT, is_active INTEGER NOT NULL, last_seen_at TEXT, current_menu_version INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE orders (order_id INTEGER PRIMARY KEY, store_id INTEGER NOT NULL REFERENCES store(store_id),
        ordered_at TEXT NOT NULL, table_no INTEGER, order_type TEXT, device_id INTEGER, client_order_id TEXT);
    CREATE TABLE order_item (item_id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(order_id),
        menu_id INTEGER NOT NULL REFERENCES menu(menu_id), item_quantity INTEGER NOT NULL, option_id INTEGER REFERENCES menu_option(option_id));
    CREATE TABLE order_item_option (item_id INTEGER NOT NULL REFERENCES order_item(item_id),
        option_id INTEGER NOT NULL REFERENCES menu_option(option_id), PRIMARY KEY (item_id, option_id));

    INSERT INTO owner VALUES (7,'owner.one','__HASH__'),(8,'owner.two','__HASH__');
    INSERT INTO store VALUES (1,'점주1 매장','부산','1층','T0001','051','1234567890','대표1','분식',1,7),
        (2,'점주2 매장','서울',NULL,'T0002','02','1234567891','대표2','카페',1,8),
        (3,'점주1 2호점','대구',NULL,'T0003','053','1234567892','대표1','분식',1,7),
        (4,'미연결 매장','인천',NULL,'T0004','032','1234567893','대표4','카페',1,NULL);
    INSERT INTO category VALUES (1,1,'식사',5),(2,1,'음료',9),(3,1,'빈 카테고리',12),(4,2,'다른 매장',1);
    INSERT INTO menu VALUES (10,1,'덮밥',9000,'설명',1,0,3),(11,1,'국밥',8000,NULL,0,0,7),
        (12,2,'콜라',2000,NULL,1,1,14),(20,4,'다른 매장 메뉴',5000,NULL,1,0,1);
    INSERT INTO menu_option VALUES (100,10,'곱빼기',4,1,0,1000),(101,10,'계란',9,0,0,500),(102,10,'고기',11,1,1,2000),
        (200,20,'다른 매장 옵션',1,1,0,100);
    INSERT INTO kiosk_device VALUES (70,'K-70',1,'token-hash-secret',1,'2026-10-29 01:02:03',3),
        (71,'K-71',1,NULL,0,NULL,5),(80,'K-80',2,'other-token-secret',1,NULL,9);
    INSERT INTO orders VALUES (1000,1,'2026-10-29 01:00:00',NULL,'takeaway',70,'uuid-1'),
        (1001,1,'2026-10-29 02:00:00',3,NULL,70,NULL),(2000,2,'2026-10-29 03:00:00',NULL,'dine_in',80,'uuid-2');
    INSERT INTO order_item VALUES (5000,1000,10,2,NULL),(5001,1001,12,1,101),(6000,2000,20,1,NULL);
    INSERT INTO order_item_option VALUES (5000,100),(5000,102),(6000,200);
"""
TABLES = ('owner', 'store', 'category', 'menu', 'menu_option', 'kiosk_device', 'orders', 'order_item', 'order_item_option')


class Cursor:
    def __init__(self, fixture):
        self.fixture = fixture
        self.cursor = fixture.db.cursor()
        self.lastrowid = None
        self.last_sql = ''

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.cursor.close()

    @property
    def rowcount(self):
        # MySQL은 값이 같은 UPDATE를 0행으로 돌려줍니다. 코드가 이 값에 기대면 여기서 드러납니다.
        return 0 if self.last_sql.lstrip().startswith('UPDATE') else self.cursor.rowcount

    def execute(self, sql, params=()):
        fixture = self.fixture
        self.last_sql = sql
        fixture.statements.append(sql)
        if sql.startswith('SET '):
            return
        if sql == 'START TRANSACTION READ ONLY':
            fixture.db.execute('PRAGMA query_only=ON')
            return
        if sql == 'START TRANSACTION':
            fixture.db.execute('BEGIN')
            return
        if fixture.fail_on and fixture.fail_on in sql:
            raise RuntimeError('private database failure')
        try:
            self.cursor.execute(sql.replace('%s', '?').replace(' FOR UPDATE', ''), params)
        except sqlite3.IntegrityError as error:
            raise IntegrityError(1451, 'private constraint') from error
        self.lastrowid = self.cursor.lastrowid

    def _row(self, row):
        if row is None:
            return None
        result = dict(row)
        for key in ('ordered_at', 'last_seen_at'):
            if result.get(key):
                result[key] = datetime.fromisoformat(result[key])
        return result

    def fetchone(self):
        return self._row(self.cursor.fetchone())

    def fetchall(self):
        return [self._row(row) for row in self.cursor.fetchall()]


class Connection:
    def __init__(self, fixture):
        self.fixture = fixture

    def cursor(self):
        return Cursor(self.fixture)

    def commit(self):
        if self.fixture.commit_failure:
            raise RuntimeError('private commit failure')
        self.fixture.db.commit()
        self.fixture.commits += 1

    def rollback(self):
        self.fixture.db.rollback()
        self.fixture.db.execute('PRAGMA query_only=OFF')

    def close(self):
        pass


class OwnerFixture:
    """각 테스트마다 새 DB·세션 저장소·시도 제한을 만듭니다."""

    def __init__(self, testcase):
        self.statements = []
        self.commits = 0
        self.fail_on = None
        self.commit_failure = False
        self.db = sqlite3.connect(':memory:', check_same_thread=False)
        testcase.addCleanup(self.db.close)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA.replace('__HASH__', HASH))
        self.db.commit()
        for target in (
            patch('database.connect', side_effect=AssertionError('Live DB forbidden')),
            patch('owner_auth.connection_factory', side_effect=lambda: Connection(self)),
            patch('owner_portal_service.connection_factory', side_effect=lambda: Connection(self)),
            patch.object(owner_auth, 'sessions', admin_auth.SessionStore()),
            patch.object(owner_auth, 'attempts', admin_auth.AttemptLimiter()),
        ):
            target.start()
            testcase.addCleanup(target.stop)
        self.testcase = testcase

    def client(self, **kwargs):
        client = TestClient(app, **kwargs)
        self.testcase.addCleanup(client.close)
        return client

    def csrf(self, client):
        return client.get('/auth/owner/csrf', headers={'Origin': ORIGIN}).json()['csrf_token']

    def login(self, client, login_id='owner.one', password=PASSWORD):
        return client.post('/auth/owner/login', json={'login_id': login_id, 'password': password},
                           headers={'Origin': ORIGIN, 'X-CSRF-Token': self.csrf(client)})

    def signed_in(self, login_id='owner.one'):
        client = self.client()
        if self.login(client, login_id).status_code != 200:
            raise AssertionError('격리 점주 로그인 실패')
        client.headers.update({'Origin': ORIGIN, 'X-CSRF-Token': self.csrf(client)})
        self.statements.clear()
        return client

    def snapshot(self):
        return {table: [tuple(row) for row in self.db.execute(f'SELECT * FROM {table} ORDER BY 1, 2')]
                for table in TABLES}

    def value(self, sql, *params):
        return self.db.execute(sql, params).fetchone()[0]
