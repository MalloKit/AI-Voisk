"""주문 유형 이관 후 신규 저장. 기존 스키마의 주문 조회도 유지합니다."""
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, model_validator


class OrderItemInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    menu_id: StrictInt = Field(ge=1)
    quantity: StrictInt = Field(ge=1, le=99)
    option_ids: list[StrictInt] = Field(default_factory=list, max_length=10)
    # 추천 카드에서 고른 품목. AI 마이그레이션 전 DB에는 저장하지 않습니다.
    is_recommended: StrictBool = False

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
    # 음성 대화로 완성한 주문은 voice. 생략하면 기록하지 않습니다(구버전 키오스크 호환).
    order_channel: Literal['touch', 'voice'] | None = None

def connection_factory():
    from database import connect
    return connect()


def _order_schema(cursor):
    cursor.execute('''SELECT COLUMN_NAME AS name, IS_NULLABLE AS nullable
        FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
        AND TABLE_NAME='orders' AND COLUMN_NAME IN ('order_type','table_no')''')
    return {row['name']: row['nullable'] for row in cursor.fetchall()}


def _check_option_groups(cursor, menu_id, chosen_groups):
    """그룹이 있는 옵션(맵기·사이즈 등)은 그룹마다 정확히 하나를 골라야 합니다. 그룹 없는 옵션은 자유 추가입니다."""
    if len(set(chosen_groups)) != len(chosen_groups):
        raise HTTPException(422, '같은 옵션 그룹에서는 하나만 고를 수 있습니다.')
    cursor.execute('''SELECT DISTINCT option_group FROM menu_option
        WHERE menu_id=%s AND is_active=TRUE AND option_group IS NOT NULL''', (menu_id,))
    required = {row['option_group'] for row in cursor.fetchall()}
    if required - set(chosen_groups):
        raise HTTPException(422, {'code': 'option_required', 'message': '필수 옵션을 선택해 주세요.'})


def _has_column(cursor, table, column):
    # 실패한 SELECT는 MySQL·SQLite 모두 트랜잭션을 깨지 않습니다.
    try:
        cursor.execute(f'SELECT {column} FROM {table} WHERE 1 = 0')
        cursor.fetchall()
        return True
    except Exception:
        return False


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


@dataclass(frozen=True)
class OrderPayment:
    tid: str | None
    amount: int
    approved_at: datetime | None
    method: Literal['kakaopay', 'card', 'naverpay', 'cash'] = 'kakaopay'


def save_order(request: OrderInput, *, payment: OrderPayment | None = None):
    connection = connection_factory()
    try:
        connection.begin()
        with connection.cursor() as cursor:
            cursor.execute("SET time_zone = '+00:00'")
            # 잠금을 오래 기다리지 않고 503으로 돌려 키오스크가 같은 UUID로 다시 보내게 합니다.
            cursor.execute('SET SESSION innodb_lock_wait_timeout = 5')
            # Serializes retries for this device, including simultaneous workers.
            # 잠금을 먼저 잡아야 아래 조회가 잠금 전 스냅샷이 아닌 최신 주문을 봅니다(REPEATABLE READ).
            cursor.execute('SELECT device_id,store_id,is_active FROM kiosk_device WHERE device_id=%s FOR UPDATE',
                           (request.device_id,))
            device = cursor.fetchone()
            schema = _order_schema(cursor)
            if 'order_type' not in schema or schema.get('table_no') != 'YES':
                raise HTTPException(503, '주문 유형 DB 변경이 적용되지 않았습니다. 저장하지 않았습니다.')
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
                if payment is not None:
                    cursor.execute('''SELECT provider_transaction_id, amount FROM payments
                        WHERE order_id=%s AND payment_method=%s AND is_test=%s''',
                        (existing['order_id'], payment.method, payment.method != 'cash'))
                    recorded = cursor.fetchone()
                    if (not recorded or recorded['provider_transaction_id'] != payment.tid
                        or recorded['amount'] != payment.amount):
                        raise HTTPException(409, '기존 주문의 결제 기록이 일치하지 않습니다.')
                connection.commit()
                return {'order_id': existing['order_id'], 'replayed': True}
            if not device['is_active']:
                raise HTTPException(422, '비활성 기기는 주문할 수 없습니다.')
            total = 0
            groups = _has_column(cursor, 'menu_option', 'option_group')
            # 메뉴 번호 순으로 잠가 두 주문이 서로 반대 순서로 잠그는 교착을 막습니다.
            for item in sorted(request.items, key=lambda i: i.menu_id):
                cursor.execute('''SELECT m.menu_id,m.menu_price,m.is_active,m.is_sold_out,c.store_id
                    FROM menu m JOIN category c ON c.category_id=m.category_id
                    WHERE m.menu_id=%s FOR UPDATE''', (item.menu_id,))
                menu = cursor.fetchone()
                if not menu or menu['store_id'] != request.store_id or not menu['is_active'] or menu['is_sold_out']:
                    raise HTTPException(422, {'code': 'menu_unavailable', 'message': '주문할 수 없는 메뉴입니다.'})
                price = menu['menu_price']
                chosen_groups = []
                for option_id in sorted(item.option_ids):
                    cursor.execute(f'''SELECT menu_id,extra_price,is_active,is_sold_out{',option_group' if groups else ''}
                        FROM menu_option WHERE option_id=%s FOR UPDATE''', (option_id,))
                    option = cursor.fetchone()
                    if not option or option['menu_id'] != item.menu_id or not option['is_active'] or option['is_sold_out']:
                        raise HTTPException(422, {'code': 'option_unavailable', 'message': '메뉴에 사용할 수 없는 옵션입니다.'})
                    price += option['extra_price']
                    if groups and option['option_group']:
                        chosen_groups.append(option['option_group'])
                if groups:
                    _check_option_groups(cursor, item.menu_id, chosen_groups)
                if price < 0:
                    raise HTTPException(422, '메뉴 가격 정보를 확인해 주세요.')
                total += price * item.quantity
            if payment is not None:
                if total <= 0:
                    raise HTTPException(422, '결제 금액은 0원보다 커야 합니다.')
                if total != payment.amount:
                    # 키오스크는 code로 구분해 새 가격으로 장바구니를 다시 계산합니다. 카카오페이 테스트 화면은 문자열을 씁니다.
                    if payment.method == 'kakaopay':
                        raise HTTPException(409, '결제 금액과 현재 주문 금액이 일치하지 않습니다.')
                    raise HTTPException(422, {'code': 'amount_mismatch',
                                              'message': '결제 금액과 현재 주문 금액이 일치하지 않습니다.'})
            channel = request.order_channel is not None and _has_column(cursor, 'orders', 'order_channel')
            recommended = any(i.is_recommended for i in request.items) and _has_column(cursor, 'order_item', 'is_recommended')
            if channel:
                cursor.execute('''INSERT INTO orders (store_id,table_no,device_id,client_order_id,order_type,order_channel)
                    VALUES (%s,NULL,%s,%s,%s,%s)''',
                    (request.store_id,request.device_id,str(request.client_order_id),request.order_type,request.order_channel))
            else:
                cursor.execute('INSERT INTO orders (store_id,table_no,device_id,client_order_id,order_type) VALUES (%s,NULL,%s,%s,%s)',
                               (request.store_id,request.device_id,str(request.client_order_id),request.order_type))
            order_id = cursor.lastrowid
            for item in request.items:
                if recommended:
                    cursor.execute('''INSERT INTO order_item (order_id,menu_id,item_quantity,option_id,is_recommended)
                        VALUES (%s,%s,%s,NULL,%s)''', (order_id,item.menu_id,item.quantity,item.is_recommended))
                else:
                    cursor.execute('INSERT INTO order_item (order_id,menu_id,item_quantity,option_id) VALUES (%s,%s,%s,NULL)',
                                   (order_id,item.menu_id,item.quantity))
                item_id = cursor.lastrowid
                for option_id in sorted(item.option_ids):
                    cursor.execute('INSERT INTO order_item_option (item_id,option_id) VALUES (%s,%s)', (item_id,option_id))
            if payment is not None:
                cursor.execute('''INSERT INTO payments
                    (order_id,payment_method,amount,provider_transaction_id,is_test,approved_at)
                    VALUES (%s,%s,%s,%s,%s,%s)''',
                    (order_id, payment.method, total, payment.tid, payment.method != 'cash', payment.approved_at))
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
            if _has_column(cursor, 'orders', 'order_channel'):
                type_column += ',o.order_channel'
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


def order_detail(order_id, *, include_cash=False):
    connection = connection_factory()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SET time_zone = '+00:00'")
            cursor.execute('START TRANSACTION READ ONLY')
            type_column = ',o.order_type' if 'order_type' in _order_schema(cursor) else ''
            if _has_column(cursor, 'orders', 'order_channel'):
                type_column += ',o.order_channel'
            cursor.execute(f'''SELECT o.order_id,o.store_id,s.store_nm AS store_name,o.ordered_at,o.table_no,o.device_id{type_column}
                FROM orders o JOIN store s ON s.store_id=o.store_id WHERE o.order_id=%s''', (order_id,))
            row = cursor.fetchone()
            if not row:
                raise HTTPException(404, '주문이 없습니다.')
            result = _header(row)
            result['items'] = _items(cursor, order_id)
            if include_cash:
                cursor.execute('''SELECT amount, approved_at FROM payments
                    WHERE order_id=%s AND payment_method='cash' AND is_test=FALSE''', (order_id,))
                cash = cursor.fetchone()
                if cash:
                    result['cash_payment'] = {'amount': cash['amount'], 'received': cash['approved_at'] is not None}
            return result
    finally:
        connection.rollback()
        connection.close()


def confirm_cash(order_id):
    connection = connection_factory()
    try:
        connection.begin()
        with connection.cursor() as cursor:
            cursor.execute("SET time_zone = '+00:00'")
            cursor.execute('''SELECT payment_id FROM payments
                WHERE order_id=%s AND payment_method='cash' AND is_test=FALSE FOR UPDATE''', (order_id,))
            payment = cursor.fetchone()
            if not payment:
                raise HTTPException(404, '현금 결제 주문이 없습니다.')
            cursor.execute('''UPDATE payments SET approved_at=CURRENT_TIMESTAMP
                WHERE payment_id=%s AND approved_at IS NULL''', (payment['payment_id'],))
        connection.commit()
        return {'order_id': order_id, 'received': True}
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
