"""점주 AI 설정·메뉴 추천 정보·통계. 소유 확인은 owner_portal_service와 같은 방식을 씁니다."""
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import HTTPException
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StrictBool, StrictInt, StrictStr

import ai_db
import kiosk_catalog
import menu_image_service
import owner_portal_service as portal
import sync_hub

KST = timezone(timedelta(hours=9))
Percent = Annotated[StrictInt, Field(ge=0, le=100)]
Identifier = Annotated[StrictInt, Field(ge=1, le=2147483647)]


def _label(limit):
    def check(value):
        value = ' '.join(value.split())
        if not value or len(value) > limit or any(not ch.isprintable() for ch in value):
            raise ValueError('길이와 문자를 확인해 주세요.')
        return value
    return AfterValidator(check)


Tag = Annotated[StrictStr, _label(20)]
Synonym = Annotated[StrictStr, _label(30)]


class AiSettingsInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    policy_profit: Percent
    pick_weight: Percent
    fit_threshold: Percent
    upsell_enabled: StrictBool
    default_mode: Literal['normal', 'senior']
    speech_rate: Annotated[StrictInt, Field(ge=50, le=150)]
    voice_enabled: StrictBool


class MenuAiInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    menu_id: Identifier
    cost_rate: Percent | None
    is_rec_excluded: StrictBool
    is_store_pick: StrictBool
    tags: list[Tag] = Field(default_factory=list, max_length=10)
    synonyms: list[Synonym] = Field(default_factory=list, max_length=10)


class MenuAiChanges(BaseModel):
    model_config = ConfigDict(extra='forbid')
    menus: list[MenuAiInput] = Field(min_length=1, max_length=2000)


def _schema_missing():
    return HTTPException(503, {'code': 'ai_schema_missing',
                               'message': 'AI 기능 DB 변경이 아직 적용되지 않았습니다. 관리자에게 문의해 주세요.'})


def _bump_version(cursor, store_id):
    cursor.execute('UPDATE kiosk_device SET current_menu_version = current_menu_version + 1 WHERE store_id = %s',
                   (store_id,))


def _write(store_id, owner_id, work):
    """잠금 순서는 메뉴판 저장·주문과 같이 기기 → 매장 → 메뉴입니다."""
    connection = portal.connection_factory()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SET time_zone = '+00:00'")
            cursor.execute('START TRANSACTION READ ONLY')
            portal.require_store(cursor, store_id, owner_id)
            ready = ai_db.ai_schema_ready(cursor)
            connection.rollback()
            if not ready:
                raise _schema_missing()
            cursor.execute('START TRANSACTION')
            cursor.execute('SELECT device_id FROM kiosk_device WHERE store_id = %s ORDER BY device_id FOR UPDATE',
                           (store_id,))
            cursor.fetchall()
            portal.require_store(cursor, store_id, owner_id, lock=True)
            result = work(cursor)
            _bump_version(cursor, store_id)
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
    sync_hub.menu_changed(store_id)
    return result


# ---------- 설정 ----------

def get_settings(store_id, owner_id):
    with portal.read_cursor() as cursor:
        portal.require_store(cursor, store_id, owner_id)
        ready = ai_db.ai_schema_ready(cursor)
        return {'ai_ready': ready, 'settings': kiosk_catalog.read_settings(cursor, store_id, ready)}


def save_settings(store_id, owner_id, payload: AiSettingsInput):
    values = payload.model_dump()

    def work(cursor):
        keys = kiosk_catalog.SETTING_KEYS
        cursor.execute('SELECT store_id FROM store_ai_setting WHERE store_id = %s FOR UPDATE', (store_id,))
        if cursor.fetchone():
            cursor.execute(f'UPDATE store_ai_setting SET {", ".join(k + " = %s" for k in keys)}, '
                           'updated_at = CURRENT_TIMESTAMP WHERE store_id = %s',
                           (*(values[k] for k in keys), store_id))
        else:
            cursor.execute(f'INSERT INTO store_ai_setting (store_id, {", ".join(keys)}) '
                           f'VALUES (%s, {", ".join(["%s"] * len(keys))})', (store_id, *(values[k] for k in keys)))
        return {'ai_ready': True, 'settings': kiosk_catalog.read_settings(cursor, store_id, True)}
    return _write(store_id, owner_id, work)


# ---------- 메뉴 추천 정보 ----------

def _menu_ai(cursor, store_id):
    cursor.execute('''
        SELECT m.menu_id, m.menu_nm, m.menu_price, m.is_active, m.is_sold_out, c.category_nm,
               m.cost_rate, m.is_rec_excluded, m.is_store_pick
        FROM menu m JOIN category c ON c.category_id = m.category_id
        WHERE c.store_id = %s ORDER BY c.category_sort, c.category_id, m.menu_sort, m.menu_id
    ''', (store_id,))
    menus = cursor.fetchall()
    labels = {}
    for table, column, key in (('menu_tag', 'tag_nm', 'tags'), ('menu_synonym', 'synonym_nm', 'synonyms')):
        cursor.execute(f'''SELECT t.menu_id, t.{column} AS value FROM {table} t
            JOIN menu m ON m.menu_id = t.menu_id JOIN category c ON c.category_id = m.category_id
            WHERE c.store_id = %s ORDER BY t.menu_id, t.{column}''', (store_id,))
        for row in cursor.fetchall():
            labels.setdefault((row['menu_id'], key), []).append(row['value'])
    images = menu_image_service.images_for_store(cursor, store_id)
    return {'menus': [{
        'menu_id': row['menu_id'], 'menu_name': row['menu_nm'], 'category_name': row['category_nm'],
        'menu_price': int(row['menu_price']), 'is_active': bool(row['is_active']),
        'is_sold_out': bool(row['is_sold_out']),
        'cost_rate': None if row['cost_rate'] is None else int(row['cost_rate']),
        'is_rec_excluded': bool(row['is_rec_excluded']), 'is_store_pick': bool(row['is_store_pick']),
        'tags': labels.get((row['menu_id'], 'tags'), []),
        'synonyms': labels.get((row['menu_id'], 'synonyms'), []),
        'image_url': images.get(row['menu_id']),
    } for row in menus]}


def get_menu_ai(store_id, owner_id):
    with portal.read_cursor() as cursor:
        portal.require_store(cursor, store_id, owner_id)
        if not ai_db.ai_schema_ready(cursor):
            raise _schema_missing()
        return _menu_ai(cursor, store_id)


def save_menu_ai(store_id, owner_id, changes: MenuAiChanges):
    ids = [item.menu_id for item in changes.menus]
    if len(set(ids)) != len(ids):
        raise HTTPException(422, '같은 메뉴가 두 번 들어 있습니다.')

    def work(cursor):
        marks = ', '.join(['%s'] * len(ids))
        cursor.execute(f'''SELECT m.menu_id FROM menu m JOIN category c ON c.category_id = m.category_id
            WHERE c.store_id = %s AND m.menu_id IN ({marks}) FOR UPDATE''', (store_id, *ids))
        if len(cursor.fetchall()) != len(ids):
            raise portal.OwnerResourceNotFound()
        for item in changes.menus:
            cursor.execute('UPDATE menu SET cost_rate = %s, is_rec_excluded = %s, is_store_pick = %s WHERE menu_id = %s',
                           (item.cost_rate, item.is_rec_excluded, item.is_store_pick, item.menu_id))
            for table, column, values in (('menu_tag', 'tag_nm', item.tags), ('menu_synonym', 'synonym_nm', item.synonyms)):
                cursor.execute(f'DELETE FROM {table} WHERE menu_id = %s', (item.menu_id,))
                # MySQL 비교 규칙(utf8mb4_0900_ai_ci)은 대소문자를 구분하지 않으므로 같은 값으로 봅니다.
                for value in {v.casefold(): v for v in reversed(values)}.values():
                    cursor.execute(f'INSERT INTO {table} (menu_id, {column}) VALUES (%s, %s)', (item.menu_id, value))
        return _menu_ai(cursor, store_id)
    return _write(store_id, owner_id, work)


# ---------- 통계 ----------

def _db_time(moment):
    return moment.astimezone(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')


def stats(store_id, owner_id, days, now=None):
    now = (now or datetime.now(timezone.utc)).astimezone(KST)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days - 1)
    end = now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
    with portal.read_cursor() as cursor:
        portal.require_store(cursor, store_id, owner_id)
        ready = ai_db.ai_schema_ready(cursor)
        channel = ', order_channel' if ready else ''
        cursor.execute(f'''SELECT order_id, ordered_at{channel} FROM orders
            WHERE store_id = %s AND ordered_at >= %s AND ordered_at < %s''', (store_id, _db_time(start), _db_time(end)))
        orders = cursor.fetchall()
        items = []
        if orders:
            marks = ', '.join(['%s'] * len(orders))
            ids = tuple(order['order_id'] for order in orders)
            recommended = ', i.is_recommended' if ready else ''
            cursor.execute(f'''SELECT i.item_id, i.order_id, i.menu_id, i.item_quantity, m.menu_nm, m.menu_price{recommended}
                FROM order_item i JOIN menu m ON m.menu_id = i.menu_id WHERE i.order_id IN ({marks})''', ids)
            items = cursor.fetchall()
            cursor.execute(f'''SELECT io.item_id, o.extra_price FROM order_item_option io
                JOIN order_item i ON i.item_id = io.item_id JOIN menu_option o ON o.option_id = io.option_id
                WHERE i.order_id IN ({marks})''', ids)
            extras = {}
            for row in cursor.fetchall():
                extras[row['item_id']] = extras.get(row['item_id'], 0) + int(row['extra_price'])
        impressions = selections = 0
        if ready:
            cursor.execute('''SELECT COUNT(*) AS shown, COUNT(selected_menu_id) AS selected FROM recommendation_log
                WHERE store_id = %s AND created_at >= %s AND created_at < %s''', (store_id, _db_time(start), _db_time(end)))
            row = cursor.fetchone()
            impressions, selections = int(row['shown'] or 0), int(row['selected'] or 0)

    daily = {(start + timedelta(days=offset)).date().isoformat(): {'orders': 0, 'voice_orders': 0}
             for offset in range(days)}
    voice = 0
    for order in orders:
        moment = order['ordered_at']
        if isinstance(moment, str):
            moment = datetime.fromisoformat(moment)
        key = moment.replace(tzinfo=timezone.utc).astimezone(KST).date().isoformat()
        is_voice = order.get('order_channel') == 'voice'
        voice += is_voice
        if key in daily:
            daily[key]['orders'] += 1
            daily[key]['voice_orders'] += is_voice
    revenue = rec_revenue = 0
    menus = {}
    for item in items:
        amount = (int(item['menu_price']) + extras.get(item['item_id'], 0)) * int(item['item_quantity'])
        revenue += amount
        if item.get('is_recommended'):
            rec_revenue += amount
        entry = menus.setdefault(item['menu_id'], {'menu_id': item['menu_id'], 'menu_name': item['menu_nm'], 'quantity': 0})
        entry['quantity'] += int(item['item_quantity'])
    total = len(orders)
    return {
        'ai_ready': ready,
        'days': days,
        'start_date': start.date().isoformat(),
        'end_date': (end - timedelta(days=1)).date().isoformat(),
        'orders': total,
        'voice_orders': voice,
        'voice_ratio': round(voice / total, 4) if total else 0.0,
        # 주문 당시 가격을 저장하지 않으므로 현재 메뉴·옵션 가격 기준의 추정치입니다.
        'revenue_estimate': revenue,
        'rec_revenue_estimate': rec_revenue,
        'rec_impressions': impressions,
        'rec_selections': selections,
        'rec_selection_rate': round(selections / impressions, 4) if impressions else 0.0,
        'top_menus': sorted(menus.values(), key=lambda m: (-m['quantity'], m['menu_id']))[:5],
        'daily': [{'date': date, **values} for date, values in daily.items()],
    }


# ---------- 직원 호출 ----------

def staff_calls(store_id, owner_id):
    """처리하지 않은 직원 호출과 최근 처리한 호출 10건입니다. 점주 웹이 5초마다 조회합니다."""
    with portal.read_cursor() as cursor:
        portal.require_store(cursor, store_id, owner_id)
        result = {}
        for key, condition, limit in (('open', "a.alert_status = 'UNREAD'", 50),
                                      ('recent', "a.alert_status <> 'UNREAD'", 10)):
            cursor.execute(f'''SELECT a.alert_id, a.device_id, d.device_code, a.message, a.alert_status,
                    a.occurred_at, a.resolved_at
                FROM device_alert a JOIN kiosk_device d ON d.device_id = a.device_id
                WHERE d.store_id = %s AND a.alert_type = 'STAFF_CALL' AND {condition}
                ORDER BY a.occurred_at DESC, a.alert_id DESC LIMIT %s''', (store_id, limit))
            result[key] = [{
                'alert_id': row['alert_id'], 'device_id': row['device_id'], 'device_code': row['device_code'],
                'message': row['message'], 'status': row['alert_status'],
                'occurred_at': portal._utc(_as_datetime(row['occurred_at'])),
                'resolved_at': portal._utc(_as_datetime(row['resolved_at'])),
            } for row in cursor.fetchall()]
        return result


def _as_datetime(value):
    return datetime.fromisoformat(value) if isinstance(value, str) else value


def resolve_staff_call(store_id, owner_id, alert_id):
    connection = portal.connection_factory()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SET time_zone = '+00:00'")
            cursor.execute('START TRANSACTION')
            cursor.execute('''SELECT a.alert_id, a.alert_status FROM device_alert a
                JOIN kiosk_device d ON d.device_id = a.device_id JOIN store s ON s.store_id = d.store_id
                WHERE a.alert_id = %s AND a.alert_type = 'STAFF_CALL' AND d.store_id = %s AND s.owner_id = %s FOR UPDATE''',
                           (alert_id, store_id, owner_id))
            row = cursor.fetchone()
            if row is None:
                raise portal.OwnerResourceNotFound()
            if row['alert_status'] == 'UNREAD':
                cursor.execute("UPDATE device_alert SET alert_status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP WHERE alert_id = %s",
                               (alert_id,))
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
    return {'alert_id': alert_id, 'status': 'RESOLVED'}
