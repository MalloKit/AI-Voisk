"""주문 유형 이관 후 신규 저장. 기존 스키마의 주문 조회도 유지합니다."""
from datetime import timezone
from typing import Literal
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictInt, model_validator


class OrderItemInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    menu_id: StrictInt = Field(ge=1)
    quantity: StrictInt = Field(ge=1, le=99)
    option_ids: list[StrictInt] = Field(default_factory=list, max_length=50)

    @model_validator(mode='after')
    def options_unique(self):
        if len(set(self.option_ids)) != len(self.option_ids) or any(i < 1 for i in self.option_ids):
            raise ValueError('옵션 ID는 중복 없이 양수여야 합니다.')
        return self


class OrderInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    store_id: StrictInt = Field(ge=1)
    device_id: StrictInt = Field(ge=1)
    client_order_id: UUID
    order_type: Literal['takeaway', 'dine_in']
    table_no: None = None
    items: list[OrderItemInput] = Field(min_length=1, max_length=100)

def connection_factory():
    from database import connect
    return connect()


def _order_schema(cursor):
    cursor.execute('''SELECT COLUMN_NAME AS name, IS_NULLABLE AS nullable
        FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
        AND TABLE_NAME='orders' AND COLUMN_NAME IN ('order_type','table_no')''')
    return {row['name']: row['nullable'] for row in cursor.fetchall()}


def _type(row):
    if row.get('order_type') in ('takeaway', 'dine_in'):
        return row['order_type']
    table = row.get('table_no')
    return 'takeaway' if table == 0 else ('dine_in' if table is not None and table > 0 else None)


def _header(row):
    result = dict(row)
    moment = result['ordered_at']
    result['ordered_at'] = moment.replace(tzinfo=timezone.utc).isoformat()
    result['order_type'] = _type(row)
    return result


def _items(cursor, order_id):
    cursor.execute('''SELECT i.item_id, i.menu_id, i.item_quantity AS quantity,
        i.option_id, m.menu_nm AS menu_name
        FROM order_item i JOIN menu m ON m.menu_id=i.menu_id
        WHERE i.order_id=%s ORDER BY i.item_id''', (order_id,))
    items = cursor.fetchall()
    # UNION includes legacy option_id and removes duplicates in migrated records.
    cursor.execute('''SELECT x.item_id, o.option_id, o.option_nm AS name
        FROM (SELECT io.item_id, io.option_id FROM order_item_option io
              JOIN order_item i ON i.item_id=io.item_id WHERE i.order_id=%s
              UNION SELECT item_id, option_id FROM order_item
              WHERE order_id=%s AND option_id IS NOT NULL) x
        JOIN menu_option o ON o.option_id=x.option_id ORDER BY x.item_id,o.option_id''',
        (order_id, order_id))
    options = cursor.fetchall()
    for item in items:
        item.pop('option_id', None)
        item['options'] = [dict(o) for o in options if o['item_id'] == item['item_id']]
        for option in item['options']:
            option.pop('item_id', None)
    return items


def _canonical(items):
    # Item order is immaterial; repeated menu/option combinations are aggregated.
    result = {}
    for menu, quantity, options in items:
        key = (menu, tuple(sorted(options)))
        result[key] = result.get(key, 0) + quantity
    return result


def save_order(request: OrderInput):
    connection = connection_factory()
    try:
        connection.begin()
        with connection.cursor() as cursor:
            cursor.execute("SET time_zone = '+00:00'")
            schema = _order_schema(cursor)
            if 'order_type' not in schema or schema.get('table_no') != 'YES':
                raise HTTPException(503, '주문 유형 DB 변경이 적용되지 않았습니다. 저장하지 않았습니다.')
            # Serializes retries for this device, including simultaneous workers.
            cursor.execute('SELECT device_id,store_id,is_active FROM kiosk_device WHERE device_id=%s FOR UPDATE',
                           (request.device_id,))
            device = cursor.fetchone()
            if not device or device['store_id'] != request.store_id:
                raise HTTPException(422, '기기의 소속 매장이 일치하지 않습니다.')
            cursor.execute('SELECT order_id,store_id,table_no,order_type FROM orders WHERE device_id=%s AND client_order_id=%s',
                           (request.device_id, str(request.client_order_id)))
            existing = cursor.fetchone()
            if existing:
                saved = _items(cursor, existing['order_id'])
                same_items = _canonical((i['menu_id'], i['quantity'], [o['option_id'] for o in i['options']]) for i in saved)
                incoming = _canonical((i.menu_id, i.quantity, i.option_ids) for i in request.items)
                if existing['store_id'] != request.store_id or _type(existing) != request.order_type or same_items != incoming:
                    raise HTTPException(409, '이미 사용된 주문 UUID의 내용이 다릅니다.')
                connection.commit()
                return {'order_id': existing['order_id'], 'replayed': True}
            if not device['is_active']:
                raise HTTPException(422, '비활성 기기는 주문할 수 없습니다.')
            total = 0
            for item in request.items:
                cursor.execute('''SELECT m.menu_id,m.menu_price,m.is_active,m.is_sold_out,c.store_id
                    FROM menu m JOIN category c ON c.category_id=m.category_id
                    WHERE m.menu_id=%s FOR UPDATE''', (item.menu_id,))
                menu = cursor.fetchone()
                if not menu or menu['store_id'] != request.store_id or not menu['is_active'] or menu['is_sold_out']:
                    raise HTTPException(422, '주문할 수 없는 메뉴입니다.')
                price = menu['menu_price']
                for option_id in sorted(item.option_ids):
                    cursor.execute('SELECT menu_id,extra_price,is_active,is_sold_out FROM menu_option WHERE option_id=%s FOR UPDATE', (option_id,))
                    option = cursor.fetchone()
                    if not option or option['menu_id'] != item.menu_id or not option['is_active'] or option['is_sold_out']:
                        raise HTTPException(422, '메뉴에 사용할 수 없는 옵션입니다.')
                    price += option['extra_price']
                if price < 0:
                    raise HTTPException(422, '메뉴 가격 정보를 확인해 주세요.')
                total += price * item.quantity
            cursor.execute('INSERT INTO orders (store_id,table_no,device_id,client_order_id,order_type) VALUES (%s,NULL,%s,%s,%s)',
                           (request.store_id,request.device_id,str(request.client_order_id),request.order_type))
            order_id = cursor.lastrowid
            for item in request.items:
                cursor.execute('INSERT INTO order_item (order_id,menu_id,item_quantity,option_id) VALUES (%s,%s,%s,NULL)',
                               (order_id,item.menu_id,item.quantity))
                item_id = cursor.lastrowid
                for option_id in sorted(item.option_ids):
                    cursor.execute('INSERT INTO order_item_option (item_id,option_id) VALUES (%s,%s)', (item_id,option_id))
            connection.commit()
            return {'order_id': order_id, 'replayed': False, 'total_at_submission': total}
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def list_orders(limit=100, offset=0):
    connection = connection_factory()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SET time_zone = '+00:00'")
            cursor.execute('START TRANSACTION READ ONLY')
            type_column = ',o.order_type' if 'order_type' in _order_schema(cursor) else ''
            cursor.execute('SELECT COUNT(*) AS total FROM orders')
            total = cursor.fetchone()['total']
            cursor.execute(f'''SELECT o.order_id,o.store_id,s.store_nm AS store_name,o.ordered_at,o.table_no{type_column},
                o.device_id,COALESCE((SELECT SUM(item_quantity) FROM order_item WHERE order_id=o.order_id),0) AS quantity
                FROM orders o JOIN store s ON s.store_id=o.store_id
                ORDER BY o.ordered_at DESC,o.order_id DESC LIMIT %s OFFSET %s''', (limit,offset))
            return {'orders': [_header(row) for row in cursor.fetchall()], 'total': total, 'limit': limit, 'offset': offset}
    finally:
        connection.rollback()
        connection.close()


def order_detail(order_id):
    connection = connection_factory()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SET time_zone = '+00:00'")
            cursor.execute('START TRANSACTION READ ONLY')
            type_column = ',o.order_type' if 'order_type' in _order_schema(cursor) else ''
            cursor.execute(f'''SELECT o.order_id,o.store_id,s.store_nm AS store_name,o.ordered_at,o.table_no,o.device_id{type_column}
                FROM orders o JOIN store s ON s.store_id=o.store_id WHERE o.order_id=%s''', (order_id,))
            row = cursor.fetchone()
            if not row:
                raise HTTPException(404, '주문이 없습니다.')
            result = _header(row)
            result['items'] = _items(cursor, order_id)
            return result
    finally:
        connection.rollback()
        connection.close()
