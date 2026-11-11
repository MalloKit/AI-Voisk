"""점주 웹 조회. 모든 조회는 store.owner_id로 소유를 확인하며 읽기 전용 트랜잭션에서 수행합니다."""
from contextlib import contextmanager
from datetime import datetime, timezone

from order_service import _header


class OwnerResourceNotFound(LookupError):
    """없는 항목과 다른 점주의 항목을 구분하지 않습니다."""


def connection_factory():
    from database import connect
    return connect()


@contextmanager
def read_cursor():
    connection = connection_factory()
    try:
        with connection.cursor() as cursor:
            # 세션에만 적용됩니다. TIMESTAMP를 UTC로 읽습니다.
            cursor.execute("SET time_zone = '+00:00'")
            cursor.execute('START TRANSACTION READ ONLY')
            yield cursor
    finally:
        try:
            connection.rollback()
        finally:
            connection.close()


def require_store(cursor, store_id, owner_id, lock=False):
    cursor.execute('SELECT store_id FROM store WHERE store_id = %s AND owner_id = %s' + (' FOR UPDATE' if lock else ''),
                   (store_id, owner_id))
    if cursor.fetchone() is None:
        raise OwnerResourceNotFound()


def _utc(value):
    if value is None:
        return None
    if not isinstance(value, datetime):
        raise ValueError('시각 형식이 올바르지 않습니다.')
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def store_detail(store_id, owner_id):
    with read_cursor() as cursor:
        cursor.execute("""
            SELECT s.store_id, s.store_nm AS store_name,
                   s.store_add1 AS address, s.store_add2 AS address_detail,
                   s.store_code, s.store_phone AS phone, s.business_no,
                   s.store_owner_nm AS representative, s.store_type,
                   s.admin_id, s.owner_id, o.own_login_id AS owner_login_id
            FROM store s JOIN owner o ON o.owner_id = s.owner_id
            WHERE s.store_id = %s AND s.owner_id = %s
        """, (store_id, owner_id))
        row = cursor.fetchone()
        if row is None:
            raise OwnerResourceNotFound()
        return row


def read_board(cursor, store_id):
    """판매 중지 항목까지 전체를 돌려줍니다. 쓰기 트랜잭션의 저장 후 응답에도 씁니다."""
    cursor.execute("""
        SELECT category_id, store_id, category_nm AS category_name, category_sort
        FROM category WHERE store_id = %s ORDER BY category_sort, category_id
    """, (store_id,))
    categories = cursor.fetchall()
    cursor.execute("""
        SELECT m.menu_id, m.category_id, m.menu_nm AS menu_name, m.menu_price,
               m.menu_des AS menu_description, m.is_active, m.is_sold_out, m.menu_sort
        FROM menu m JOIN category c ON c.category_id = m.category_id
        WHERE c.store_id = %s
        ORDER BY c.category_sort, c.category_id, m.menu_sort, m.menu_id
    """, (store_id,))
    menus = cursor.fetchall()
    group = ', o.option_group' if _has_option_group(cursor) else ''
    cursor.execute(f"""
        SELECT o.option_id, o.menu_id, o.option_nm AS option_name, o.extra_price,
               o.is_active, o.is_sold_out, o.menu_option_sort{group}
        FROM menu_option o JOIN menu m ON m.menu_id = o.menu_id
        JOIN category c ON c.category_id = m.category_id
        WHERE c.store_id = %s
        ORDER BY o.menu_id, o.menu_option_sort, o.option_id
    """, (store_id,))
    options = cursor.fetchall()
    for row in options:
        row['option_group'] = row.get('option_group') or None
    for row in menus + options:
        row['is_active'] = bool(row['is_active'])
        row['is_sold_out'] = bool(row['is_sold_out'])
    # 메뉴 관리 미리보기·편집에 대표 사진을 보여 줍니다. 사진 서비스가 이 모듈을 쓰므로 여기서 불러옵니다.
    import menu_image_service
    images = menu_image_service.images_for_store(cursor, store_id)
    for row in menus:
        row['image_url'] = images.get(row['menu_id'])
    return {'categories': categories, 'menus': menus, 'options': options}


def _has_option_group(cursor):
    # 옵션 그룹 열은 AI_MIGRATION 마지막 단계에서 추가합니다. 없으면 모든 옵션을 자유 추가로 봅니다.
    try:
        cursor.execute('SELECT option_group FROM menu_option WHERE 1 = 0')
        cursor.fetchall()
        return True
    except Exception:
        return False


def menu_board(store_id, owner_id):
    with read_cursor() as cursor:
        require_store(cursor, store_id, owner_id)
        return read_board(cursor, store_id)


_ORDER_COLUMNS = 'SELECT order_id, store_id, ordered_at, table_no, order_type, device_id, client_order_id FROM orders'


def _order_columns(cursor):
    # 주문 방식(음성/터치)은 AI 마이그레이션 뒤에만 있습니다. 없으면 기존 열만 읽습니다.
    from ai_db import has_columns
    if has_columns(cursor, 'orders', ('order_channel',)):
        return _ORDER_COLUMNS.replace(', client_order_id FROM', ', client_order_id, order_channel FROM')
    return _ORDER_COLUMNS


def _with_items(cursor, rows):
    """옵션은 order_item_option에서 읽습니다. 이전 단일 옵션 열은 legacy_option_id로 따로 전달합니다."""
    orders = [_header(row) for row in rows]
    if not orders:
        return orders
    marks = ','.join(['%s'] * len(orders))
    ids = tuple(order['order_id'] for order in orders)
    cursor.execute(f"""
        SELECT i.item_id, i.order_id, i.menu_id, m.menu_nm AS menu_name,
               i.item_quantity AS quantity, i.option_id AS legacy_option_id
        FROM order_item i JOIN menu m ON m.menu_id = i.menu_id
        WHERE i.order_id IN ({marks}) ORDER BY i.item_id
    """, ids)
    items = cursor.fetchall()
    cursor.execute(f"""
        SELECT io.item_id, io.option_id, o.option_nm AS name, o.extra_price
        FROM order_item_option io
        JOIN order_item i ON i.item_id = io.item_id
        JOIN menu_option o ON o.option_id = io.option_id
        WHERE i.order_id IN ({marks}) ORDER BY io.item_id, io.option_id
    """, ids)
    options = {}
    for row in cursor.fetchall():
        item_id = row.pop('item_id')
        options.setdefault(item_id, []).append(row)
    by_order = {}
    for item in items:
        order_id = item.pop('order_id')
        item['options'] = options.get(item['item_id'], [])
        by_order.setdefault(order_id, []).append(item)
    for order in orders:
        order['items'] = by_order.get(order['order_id'], [])
        order['quantity'] = sum(item['quantity'] for item in order['items'])
    return orders


def list_orders(store_id, owner_id, limit, offset):
    with read_cursor() as cursor:
        require_store(cursor, store_id, owner_id)
        cursor.execute('SELECT COUNT(*) AS total FROM orders WHERE store_id = %s', (store_id,))
        total = cursor.fetchone()['total']
        cursor.execute(_order_columns(cursor) + ' WHERE store_id = %s ORDER BY ordered_at DESC, order_id DESC LIMIT %s OFFSET %s',
                       (store_id, limit, offset))
        return {'orders': _with_items(cursor, cursor.fetchall()), 'total': total, 'limit': limit, 'offset': offset}


def order_detail(store_id, owner_id, order_id):
    with read_cursor() as cursor:
        require_store(cursor, store_id, owner_id)
        cursor.execute(_order_columns(cursor) + ' WHERE order_id = %s AND store_id = %s', (order_id, store_id))
        row = cursor.fetchone()
        if row is None:
            raise OwnerResourceNotFound()
        return _with_items(cursor, [row])[0]


def list_devices(store_id, owner_id):
    with read_cursor() as cursor:
        require_store(cursor, store_id, owner_id)
        # 인증 값이 섞이지 않도록 열과 응답을 모두 명시합니다.
        extra = ''
        for column in ('app_version', 'last_synced_at', 'current_menu_version', 'applied_menu_version'):
            try:
                cursor.execute(f'SELECT {column} FROM kiosk_device WHERE 1 = 0')
                cursor.fetchall()
                extra += f', {column}'
            except Exception:
                pass
        cursor.execute(f"""
            SELECT device_id, device_code, is_active, last_seen_at{extra}
            FROM kiosk_device WHERE store_id = %s ORDER BY device_id
        """, (store_id,))
        return {'devices': [{'device_id': row['device_id'], 'device_code': row['device_code'],
                             'is_active': bool(row['is_active']), 'last_seen_at': _utc(row['last_seen_at']),
                             'app_version': row.get('app_version'),
                             'last_synced_at': _utc(_parse_time(row.get('last_synced_at'))),
                             'current_menu_version': row.get('current_menu_version'),
                             'applied_menu_version': row.get('applied_menu_version')}
                            for row in cursor.fetchall()]}


def _parse_time(value):
    # SQLite 테스트 DB는 시각을 문자열로 돌려줍니다.
    if isinstance(value, str):
        return datetime.fromisoformat(value)
    return value
