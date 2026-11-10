"""키오스크용 매장 메뉴·AI 설정 묶음. 키오스크 부트스트랩과 음성 해석이 같은 데이터를 씁니다."""
import threading
import time

import ai_db
import menu_image_service

DEFAULT_SETTINGS = {
    'policy_profit': 30,      # 0 = 고객 적합 우선, 100 = 매장 이익 우선
    'pick_weight': 10,        # 매장 우선 메뉴 가산 정도 0~100
    'fit_threshold': 50,      # 적합도 기준선 0~100
    'upsell_enabled': True,
    'default_mode': 'normal',  # normal | senior
    'speech_rate': 100,       # 안내 음성 속도 % (50~150)
    'voice_enabled': True,
}
SETTING_KEYS = tuple(DEFAULT_SETTINGS)


def menu_version(cursor, store_id):
    cursor.execute('SELECT COALESCE(MAX(current_menu_version), 0) AS version FROM kiosk_device WHERE store_id = %s',
                   (store_id,))
    row = cursor.fetchone()
    return int(row['version'] if row else 0)


def read_settings(cursor, store_id, ai_ready):
    settings = dict(DEFAULT_SETTINGS)
    if not ai_ready:
        return settings
    cursor.execute(f'SELECT {", ".join(SETTING_KEYS)} FROM store_ai_setting WHERE store_id = %s', (store_id,))
    row = cursor.fetchone()
    if row:
        for key in SETTING_KEYS:
            value = row[key]
            settings[key] = bool(value) if isinstance(DEFAULT_SETTINGS[key], bool) else (
                value if isinstance(DEFAULT_SETTINGS[key], str) else int(value))
    return settings


def read_catalog(cursor, store_id):
    ai_ready = ai_db.ai_schema_ready(cursor)
    extra = ', m.cost_rate, m.is_rec_excluded, m.is_store_pick' if ai_ready else ''
    cursor.execute(f'''
        SELECT m.menu_id, m.menu_nm, m.menu_price, m.menu_des, m.is_sold_out, c.category_nm{extra}
        FROM menu m JOIN category c ON c.category_id = m.category_id
        WHERE c.store_id = %s AND m.is_active = TRUE
        ORDER BY c.category_sort, c.category_id, m.menu_sort, m.menu_id
    ''', (store_id,))
    rows = cursor.fetchall()
    cursor.execute('''
        SELECT o.option_id, o.menu_id, o.option_nm, o.extra_price, o.is_sold_out
        FROM menu_option o JOIN menu m ON m.menu_id = o.menu_id
        JOIN category c ON c.category_id = m.category_id
        WHERE c.store_id = %s AND m.is_active = TRUE AND o.is_active = TRUE
        ORDER BY o.menu_option_sort, o.option_id
    ''', (store_id,))
    options = {}
    for option in cursor.fetchall():
        options.setdefault(option['menu_id'], []).append({
            'id': str(option['option_id']), 'name': option['option_nm'],
            'price': int(option['extra_price']), 'isSoldOut': bool(option['is_sold_out'])})
    tags, synonyms = {}, {}
    if ai_ready:
        for table, column, target in (('menu_tag', 'tag_nm', tags), ('menu_synonym', 'synonym_nm', synonyms)):
            cursor.execute(f'''
                SELECT t.menu_id, t.{column} AS value FROM {table} t
                JOIN menu m ON m.menu_id = t.menu_id JOIN category c ON c.category_id = m.category_id
                WHERE c.store_id = %s ORDER BY t.menu_id, t.{column}
            ''', (store_id,))
            for row in cursor.fetchall():
                target.setdefault(row['menu_id'], []).append(row['value'])
    images = menu_image_service.images_for_store(cursor, store_id)
    menus = []
    for row in rows:
        menu_id = row['menu_id']
        menus.append({
            'id': str(menu_id), 'name': row['menu_nm'], 'category': row['category_nm'],
            'price': int(row['menu_price']), 'description': row['menu_des'] or '',
            'isSoldOut': bool(row['is_sold_out']), 'options': options.get(menu_id, []),
            'tags': tags.get(menu_id, []), 'synonyms': synonyms.get(menu_id, []),
            'costRate': None if not ai_ready or row['cost_rate'] is None else int(row['cost_rate']),
            'recExcluded': bool(ai_ready and row['is_rec_excluded']),
            'storePick': bool(ai_ready and row['is_store_pick']),
            'imageUrl': images.get(menu_id),
        })
    return {
        'store_id': store_id,
        'menu_version': menu_version(cursor, store_id),
        'ai_ready': ai_ready,
        'settings': read_settings(cursor, store_id, ai_ready),
        'menus': menus,
    }


class CatalogCache:
    """음성 해석마다 DB를 여러 번 읽지 않도록 매장별로 짧게 보관합니다."""

    def __init__(self, ttl=15.0, clock=time.monotonic):
        self.ttl, self.clock = ttl, clock
        self._lock = threading.Lock()
        self._items = {}

    def get(self, store_id):
        with self._lock:
            hit = self._items.get(store_id)
            if hit and self.clock() - hit[0] < self.ttl:
                return hit[1]
        with ai_db.read_cursor() as cursor:
            catalog = read_catalog(cursor, store_id)
        with self._lock:
            self._items[store_id] = (self.clock(), catalog)
        return catalog

    def invalidate(self, store_id=None):
        with self._lock:
            if store_id is None:
                self._items.clear()
            else:
                self._items.pop(store_id, None)


cache = CatalogCache()
