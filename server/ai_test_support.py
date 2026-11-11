"""AI·키오스크 기능 테스트 공용 격리 환경. 외부 DB와 Claude API 없이 메모리 SQLite에서 실제 SQL을 실행합니다."""
import secrets
import sqlite3
from datetime import datetime
from unittest.mock import patch

from fastapi.testclient import TestClient
from pymysql.err import IntegrityError

import admin_auth
import device_auth
import kiosk_catalog
import owner_auth
import voice_service
from main import app

ORIGIN = 'http://localhost:8080'
PASSWORD = secrets.token_urlsafe(24)
HASH = admin_auth.hasher.hash(PASSWORD)
TOKEN = secrets.token_urlsafe(32)
OTHER_TOKEN = secrets.token_urlsafe(32)

SCHEMA = """
    PRAGMA foreign_keys=ON;
    CREATE TABLE owner (owner_id INTEGER PRIMARY KEY, own_login_id TEXT NOT NULL UNIQUE, own_pw TEXT NOT NULL);
    CREATE TABLE store (store_id INTEGER PRIMARY KEY, store_nm TEXT NOT NULL, owner_id INTEGER REFERENCES owner(owner_id));
    CREATE TABLE category (category_id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL REFERENCES store(store_id),
        category_nm TEXT NOT NULL, category_sort INTEGER NOT NULL);
    CREATE TABLE menu (menu_id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER NOT NULL REFERENCES category(category_id),
        menu_nm TEXT NOT NULL, menu_price INTEGER NOT NULL, menu_des TEXT, is_active INTEGER NOT NULL DEFAULT 1,
        is_sold_out INTEGER NOT NULL DEFAULT 0, menu_sort INTEGER NOT NULL,
        cost_rate INTEGER, is_rec_excluded INTEGER NOT NULL DEFAULT 0, is_store_pick INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE menu_option (option_id INTEGER PRIMARY KEY AUTOINCREMENT, menu_id INTEGER NOT NULL REFERENCES menu(menu_id),
        option_nm TEXT NOT NULL, menu_option_sort INTEGER NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
        is_sold_out INTEGER NOT NULL DEFAULT 0, extra_price INTEGER NOT NULL DEFAULT 0, option_group TEXT NULL);
    CREATE TABLE menu_tag (menu_id INTEGER NOT NULL REFERENCES menu(menu_id), tag_nm TEXT NOT NULL, PRIMARY KEY (menu_id, tag_nm));
    CREATE TABLE menu_synonym (menu_id INTEGER NOT NULL REFERENCES menu(menu_id), synonym_nm TEXT NOT NULL,
        PRIMARY KEY (menu_id, synonym_nm));
    CREATE TABLE store_ai_setting (store_id INTEGER PRIMARY KEY REFERENCES store(store_id),
        policy_profit INTEGER NOT NULL DEFAULT 30, pick_weight INTEGER NOT NULL DEFAULT 10, fit_threshold INTEGER NOT NULL DEFAULT 50,
        upsell_enabled INTEGER NOT NULL DEFAULT 1, default_mode TEXT NOT NULL DEFAULT 'normal',
        speech_rate INTEGER NOT NULL DEFAULT 100, voice_enabled INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE kiosk_device (device_id INTEGER PRIMARY KEY, device_code TEXT NOT NULL, store_id INTEGER NOT NULL REFERENCES store(store_id),
        device_token_hash TEXT, is_active INTEGER NOT NULL, last_seen_at TEXT, last_synced_at TEXT, app_version TEXT,
        current_menu_version INTEGER NOT NULL DEFAULT 0, applied_menu_version INTEGER);
    CREATE TABLE recommendation_log (rec_log_id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL REFERENCES store(store_id),
        device_id INTEGER NOT NULL REFERENCES kiosk_device(device_id), client_log_id TEXT NOT NULL, situation TEXT,
        shown_menu_ids TEXT NOT NULL, selected_menu_id INTEGER REFERENCES menu(menu_id), policy_profit INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE (device_id, client_log_id));
    CREATE TABLE orders (order_id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL REFERENCES store(store_id),
        ordered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, table_no INTEGER, order_type TEXT NOT NULL,
        device_id INTEGER REFERENCES kiosk_device(device_id), client_order_id TEXT, order_channel TEXT,
        UNIQUE (device_id, client_order_id));
    CREATE TABLE order_item (item_id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(order_id),
        menu_id INTEGER NOT NULL REFERENCES menu(menu_id), item_quantity INTEGER NOT NULL,
        option_id INTEGER REFERENCES menu_option(option_id), is_recommended INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE order_item_option (item_id INTEGER NOT NULL REFERENCES order_item(item_id),
        option_id INTEGER NOT NULL REFERENCES menu_option(option_id), PRIMARY KEY (item_id, option_id));
    CREATE TABLE menu_img (img_id INTEGER PRIMARY KEY AUTOINCREMENT, menu_id INTEGER NOT NULL REFERENCES menu(menu_id),
        img_nm TEXT NOT NULL, is_main INTEGER NOT NULL);
    CREATE TABLE device_alert (alert_id INTEGER PRIMARY KEY AUTOINCREMENT, device_id INTEGER NOT NULL REFERENCES kiosk_device(device_id),
        alert_type TEXT NOT NULL, severity TEXT NOT NULL, message TEXT NOT NULL, alert_status TEXT NOT NULL DEFAULT 'UNREAD',
        occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, acknowledged_at TEXT, acknowledged_by INTEGER, resolved_at TEXT);

    INSERT INTO owner VALUES (7, 'owner.one', '__HASH__'), (8, 'owner.two', '__HASH__');
    INSERT INTO store VALUES (1, '시연 매장', 7), (2, '다른 매장', 8);
    INSERT INTO category VALUES (1, 1, '식사', 1), (2, 1, '음료', 2), (3, 2, '다른 매장', 1);
    INSERT INTO menu VALUES
        (10, 1, '제육덮밥', 9000, '매콤한 제육볶음 덮밥', 1, 0, 1, 35, 0, 0),
        (11, 1, '순두부찌개', 8500, '부드러운 순두부와 얼큰한 국물', 1, 0, 2, 30, 0, 1),
        (12, 1, '콩나물국밥', 7500, '시원한 콩나물 국물', 1, 0, 3, 25, 0, 0),
        (13, 1, '품절메뉴', 5000, NULL, 1, 1, 4, NULL, 0, 0),
        (14, 1, '추천제외', 6000, NULL, 1, 0, 5, 20, 1, 0),
        (15, 1, '판매중지', 6000, NULL, 0, 0, 6, NULL, 0, 0),
        (20, 2, '콜라', 2000, '시원한 콜라', 1, 0, 1, 40, 0, 0),
        (30, 3, '다른 매장 메뉴', 5000, NULL, 1, 0, 1, NULL, 0, 0);
    INSERT INTO menu_option VALUES (100, 10, '곱빼기', 1, 1, 0, 1000, NULL), (101, 10, '품절옵션', 2, 1, 1, 500, NULL),
        (102, 11, '공깃밥', 1, 1, 0, 1000, NULL), (300, 30, '다른 매장 옵션', 1, 1, 0, 100, NULL),
        (110, 12, '순한맛', 1, 1, 0, 0, '맵기'), (111, 12, '매운맛', 2, 1, 0, 0, '맵기'),
        (112, 12, '라지', 3, 1, 0, 500, '사이즈'), (113, 12, '레귤러', 4, 1, 0, 0, '사이즈');
    INSERT INTO menu_tag VALUES (11, '해장'), (11, '매운'), (12, '해장'), (12, '국물');
    INSERT INTO menu_synonym VALUES (10, '제육'), (20, '코크');
    INSERT INTO kiosk_device VALUES (70, 'K-70', 1, '__TOKEN__', 1, NULL, NULL, NULL, 3, NULL),
        (71, 'K-71', 1, '__TOKEN__', 0, NULL, NULL, NULL, 3, NULL),
        (80, 'K-80', 2, '__OTHER__', 1, NULL, NULL, NULL, 9, NULL),
        (81, 'K-81', 1, NULL, 1, NULL, NULL, NULL, 3, NULL);
"""


class Cursor:
    def __init__(self, fixture):
        self.fixture = fixture
        self.cursor = fixture.db.cursor()
        self.lastrowid = None
        self.schema_rows = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.cursor.close()

    @property
    def rowcount(self):
        return self.cursor.rowcount

    def execute(self, sql, params=()):
        fixture = self.fixture
        self.schema_rows = None
        fixture.statements.append(sql)
        fixture.executed.append((sql, tuple(params or ())))
        if sql.startswith('SET '):
            return
        if 'information_schema.COLUMNS' in sql:
            # order_service의 주문 유형 확인을 SQLite PRAGMA로 흉내 냅니다.
            rows = fixture.db.execute('PRAGMA table_info(orders)').fetchall()
            self.schema_rows = [{'name': r['name'], 'nullable': 'NO' if r['notnull'] else 'YES'}
                                for r in rows if r['name'] in ('order_type', 'table_no')]
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
            self.cursor.execute(sql.replace('%s', '?').replace(' FOR UPDATE', '').replace('TRUE', '1'), params)
        except sqlite3.IntegrityError as error:
            raise IntegrityError(1062, 'private constraint') from error
        self.lastrowid = self.cursor.lastrowid

    def _row(self, row):
        if row is None:
            return None
        result = dict(row)
        for key in ('ordered_at', 'last_seen_at', 'created_at'):
            if isinstance(result.get(key), str):
                result[key] = datetime.fromisoformat(result[key])
        return result

    def fetchone(self):
        if self.schema_rows is not None:
            return self.schema_rows[0] if self.schema_rows else None
        return self._row(self.cursor.fetchone())

    def fetchall(self):
        if self.schema_rows is not None:
            return self.schema_rows
        return [self._row(row) for row in self.cursor.fetchall()]


class Connection:
    def __init__(self, fixture):
        self.fixture = fixture

    def cursor(self):
        return Cursor(self.fixture)

    def begin(self):
        self.fixture.db.execute('BEGIN')

    def commit(self):
        self.fixture.db.commit()
        self.fixture.commits += 1

    def rollback(self):
        if self.fixture.db.in_transaction:
            self.fixture.db.rollback()
        self.fixture.db.execute('PRAGMA query_only=OFF')

    def close(self):
        pass


class AiFixture:
    """각 테스트마다 새 DB·세션·시도 제한·카탈로그 캐시를 만듭니다. Claude 호출은 기본으로 막습니다."""

    def __init__(self, testcase, schema=SCHEMA):
        self.statements = []
        self.executed = []
        self.commits = 0
        self.fail_on = None
        self.db = sqlite3.connect(':memory:', check_same_thread=False, isolation_level=None)
        testcase.addCleanup(self.db.close)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(schema.replace('__HASH__', HASH)
                              .replace('__TOKEN__', device_auth.hash_token(TOKEN))
                              .replace('__OTHER__', device_auth.hash_token(OTHER_TOKEN)))
        factory = lambda: Connection(self)  # noqa: E731
        for target in (
            patch('database.connect', side_effect=AssertionError('Live DB forbidden')),
            patch('ai_db.connection_factory', side_effect=factory),
            patch('owner_auth.connection_factory', side_effect=factory),
            patch('owner_portal_service.connection_factory', side_effect=factory),
            patch('order_service.connection_factory', side_effect=factory),
            patch.object(owner_auth, 'sessions', admin_auth.SessionStore()),
            patch.object(owner_auth, 'attempts', admin_auth.AttemptLimiter()),
            patch.object(device_auth, 'failures', device_auth.FailureLimiter()),
            patch.object(voice_service, 'limiter', voice_service.RateLimiter()),
            patch.object(kiosk_catalog, 'cache', kiosk_catalog.CatalogCache()),
            patch('voice_service._anthropic_client', side_effect=AssertionError('Claude API forbidden in tests')),
            patch('voice_service._cli_path', side_effect=AssertionError('Claude CLI forbidden in tests')),
        ):
            target.start()
            testcase.addCleanup(target.stop)
        self.testcase = testcase

    def client(self, **kwargs):
        client = TestClient(app, **kwargs)
        self.testcase.addCleanup(client.close)
        return client

    def kiosk(self, device_id=70, token=TOKEN):
        client = self.client()
        client.headers.update({'X-Device-Id': str(device_id), 'Authorization': f'Bearer {token}'})
        return client

    def owner(self, login_id='owner.one'):
        client = self.client()
        csrf = client.get('/auth/owner/csrf', headers={'Origin': ORIGIN}).json()['csrf_token']
        response = client.post('/auth/owner/login', json={'login_id': login_id, 'password': PASSWORD},
                               headers={'Origin': ORIGIN, 'X-CSRF-Token': csrf})
        if response.status_code != 200:
            raise AssertionError('격리 점주 로그인 실패')
        csrf = client.get('/auth/owner/csrf', headers={'Origin': ORIGIN}).json()['csrf_token']
        client.headers.update({'Origin': ORIGIN, 'X-CSRF-Token': csrf})
        return client

    def value(self, sql, *params):
        return self.db.execute(sql, params).fetchone()[0]

    def rows(self, sql, *params):
        return [tuple(row) for row in self.db.execute(sql, params).fetchall()]
