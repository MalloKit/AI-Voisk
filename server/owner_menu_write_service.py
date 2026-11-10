"""점주 메뉴판 쓰기. category·menu·menu_option과 kiosk_device.current_menu_version만 변경합니다."""
from typing import Annotated

from fastapi import HTTPException
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StrictBool, StrictInt, StrictStr, model_validator
from pymysql.err import IntegrityError

import owner_portal_service as portal
import sync_hub
from owner_portal_service import OwnerResourceNotFound

INT_MAX = 2147483647
PRICE_MAX = 1_000_000
LIST_MAX = 2000


def _no_control(value, allowed=''):
    if any((ord(c) < 32 or ord(c) == 127) and c not in allowed for c in value):
        raise ValueError('제어 문자는 사용할 수 없습니다.')
    return value


def _name(limit):
    def check(value):
        value = _no_control(value).strip()
        if not value or len(value) > limit:
            raise ValueError('이름 길이를 확인해 주세요.')
        return value
    return AfterValidator(check)


def _description(value):
    if value is None:
        return None
    value = _no_control(value, '\t\r\n').strip()
    if len(value) > 500:
        raise ValueError('설명 길이를 확인해 주세요.')
    return value or None


def _reference(value):
    if value == 0:
        raise ValueError('id를 확인해 주세요.')
    return value


Identifier = Annotated[StrictInt, Field(ge=1, le=INT_MAX)]
TempId = Annotated[StrictInt, Field(ge=-INT_MAX, le=-1)]
# 양수는 저장된 행, 음수는 같은 묶음에서 새로 만드는 행의 임시 id입니다.
Reference = Annotated[StrictInt, Field(ge=-INT_MAX, le=INT_MAX), AfterValidator(_reference)]
Sort = Annotated[StrictInt, Field(ge=1, le=INT_MAX)]
Price = Annotated[StrictInt, Field(ge=1, le=PRICE_MAX)]
ExtraPrice = Annotated[StrictInt, Field(ge=0, le=PRICE_MAX)]
CategoryName = Annotated[StrictStr, _name(100)]
ItemName = Annotated[StrictStr, _name(50)]


def _group(value):
    if value is None:
        return None
    value = _no_control(value).strip()
    if len(value) > 20:
        raise ValueError('옵션 그룹 이름은 20자 이하로 입력해 주세요.')
    return value or None


# 같은 그룹 옵션은 하나를 꼭 고릅니다(맵기·사이즈). 비우면 자유롭게 더하는 옵션입니다.
OptionGroup = Annotated[StrictStr | None, AfterValidator(_group)]
Description = Annotated[StrictStr | None, AfterValidator(_description)]


class _Input(BaseModel):
    model_config = ConfigDict(extra='forbid')


class CategoryCreate(_Input):
    temp_id: TempId
    name: CategoryName
    sort: Sort


class CategoryUpdate(_Input):
    id: Identifier
    name: CategoryName
    sort: Sort


class CategoryChanges(_Input):
    create: list[CategoryCreate] = Field(default_factory=list, max_length=LIST_MAX)
    update: list[CategoryUpdate] = Field(default_factory=list, max_length=LIST_MAX)
    remove: list[Identifier] = Field(default_factory=list, max_length=LIST_MAX)


class MenuCreate(_Input):
    temp_id: TempId
    category_id: Reference
    name: ItemName
    price: Price
    description: Description = None
    is_active: StrictBool = True
    is_sold_out: StrictBool = False
    sort: Sort


class MenuUpdate(_Input):
    # 품절은 PATCH /owner/menus/{id}/sold-out으로만 바꿉니다.
    id: Identifier
    category_id: Reference
    name: ItemName
    price: Price
    description: Description = None
    is_active: StrictBool
    sort: Sort


class MenuChanges(_Input):
    create: list[MenuCreate] = Field(default_factory=list, max_length=LIST_MAX)
    update: list[MenuUpdate] = Field(default_factory=list, max_length=LIST_MAX)


class OptionCreate(_Input):
    temp_id: TempId
    menu_id: Reference
    name: ItemName
    extra_price: ExtraPrice
    is_sold_out: StrictBool = False
    sort: Sort
    group: OptionGroup = None


class OptionUpdate(_Input):
    id: Identifier
    name: ItemName
    extra_price: ExtraPrice
    is_active: StrictBool
    sort: Sort
    # 보내지 않으면 기존 그룹을 유지합니다(이전 점주 웹 호환).
    group: OptionGroup = None


class OptionChanges(_Input):
    create: list[OptionCreate] = Field(default_factory=list, max_length=LIST_MAX)
    update: list[OptionUpdate] = Field(default_factory=list, max_length=LIST_MAX)


def _unique(values):
    values = list(values)
    return len(values) == len(set(values))


class MenuBoardChanges(_Input):
    categories: CategoryChanges = Field(default_factory=CategoryChanges)
    menus: MenuChanges = Field(default_factory=MenuChanges)
    options: OptionChanges = Field(default_factory=OptionChanges)

    @model_validator(mode='after')
    def consistent(self):
        category_temps = [c.temp_id for c in self.categories.create]
        menu_temps = [m.temp_id for m in self.menus.create]
        option_temps = [o.temp_id for o in self.options.create]
        updated = [c.id for c in self.categories.update]
        if not _unique(category_temps + menu_temps + option_temps):
            raise ValueError('임시 id가 중복되었습니다.')
        if not (_unique(updated) and _unique(self.categories.remove)
                and _unique(m.id for m in self.menus.update) and _unique(o.id for o in self.options.update)):
            raise ValueError('같은 항목을 두 번 변경할 수 없습니다.')
        if set(updated) & set(self.categories.remove):
            raise ValueError('삭제하는 카테고리는 수정할 수 없습니다.')
        known_categories, known_menus = set(category_temps), set(menu_temps)
        for menu in [*self.menus.create, *self.menus.update]:
            if menu.category_id < 0 and menu.category_id not in known_categories:
                raise ValueError('임시 카테고리 id를 확인해 주세요.')
        for option in self.options.create:
            if option.menu_id < 0 and option.menu_id not in known_menus:
                raise ValueError('임시 메뉴 id를 확인해 주세요.')
        return self

    @property
    def empty(self):
        groups = (self.categories.create, self.categories.update, self.categories.remove,
                  self.menus.create, self.menus.update, self.options.create, self.options.update)
        return not any(groups)


class SoldOutInput(_Input):
    is_sold_out: StrictBool


def _ids(cursor, sql, store_id, key):
    cursor.execute(sql, (store_id,))
    return {row[key] for row in cursor.fetchall()}


def _inserted(cursor):
    # 수정 행 수는 쓰지 않습니다. MySQL은 값이 같은 UPDATE를 0행으로 돌려줍니다.
    if cursor.rowcount != 1 or type(cursor.lastrowid) is not int or not 1 <= cursor.lastrowid <= INT_MAX:
        raise RuntimeError('Unexpected insert result')
    return cursor.lastrowid


def _resolve(reference, ids, existing):
    if reference < 0:
        return ids[reference]
    if reference not in existing:
        raise OwnerResourceNotFound()
    return reference


def _require_all(values, existing):
    if not set(values) <= existing:
        raise OwnerResourceNotFound()


def _renumber(cursor, table, id_column, sort_column, rows, group=None):
    """rows는 sort, id 순서입니다. 묶음별로 1부터 다시 매기고 달라진 행만 고칩니다."""
    counters = {}
    for row in rows:
        key = row[group] if group else None
        counters[key] = counters.get(key, 0) + 1
        if row[sort_column] != counters[key]:
            cursor.execute(f'UPDATE {table} SET {sort_column} = %s WHERE {id_column} = %s',
                           (counters[key], row[id_column]))


def _renumber_all(cursor, store_id):
    cursor.execute("""
        SELECT category_id, category_nm, category_sort FROM category
        WHERE store_id = %s ORDER BY category_sort, category_id
    """, (store_id,))
    categories = cursor.fetchall()
    # 키오스크는 카테고리를 이름으로 묶으므로 같은 이름이 남으면 저장하지 않습니다.
    if not _unique(row['category_nm'].strip() for row in categories):
        raise HTTPException(422, '같은 이름의 카테고리가 이미 있습니다.')
    _renumber(cursor, 'category', 'category_id', 'category_sort', categories)
    cursor.execute("""
        SELECT m.menu_id, m.category_id, m.menu_sort
        FROM menu m JOIN category c ON c.category_id = m.category_id
        WHERE c.store_id = %s ORDER BY m.category_id, m.menu_sort, m.menu_id
    """, (store_id,))
    _renumber(cursor, 'menu', 'menu_id', 'menu_sort', cursor.fetchall(), 'category_id')
    cursor.execute("""
        SELECT o.option_id, o.menu_id, o.menu_option_sort
        FROM menu_option o JOIN menu m ON m.menu_id = o.menu_id
        JOIN category c ON c.category_id = m.category_id
        WHERE c.store_id = %s ORDER BY o.menu_id, o.menu_option_sort, o.option_id
    """, (store_id,))
    _renumber(cursor, 'menu_option', 'option_id', 'menu_option_sort', cursor.fetchall(), 'menu_id')


def _apply(cursor, store_id, changes):
    category_ids = _ids(cursor, 'SELECT category_id FROM category WHERE store_id = %s', store_id, 'category_id')
    menu_ids = _ids(cursor, """SELECT m.menu_id FROM menu m JOIN category c ON c.category_id = m.category_id
                               WHERE c.store_id = %s""", store_id, 'menu_id')
    option_ids = _ids(cursor, """SELECT o.option_id FROM menu_option o JOIN menu m ON m.menu_id = o.menu_id
                                 JOIN category c ON c.category_id = m.category_id
                                 WHERE c.store_id = %s""", store_id, 'option_id')
    _require_all((c.id for c in changes.categories.update), category_ids)
    _require_all(changes.categories.remove, category_ids)
    _require_all((m.id for m in changes.menus.update), menu_ids)
    _require_all((o.id for o in changes.options.update), option_ids)

    ids = {}
    for c in changes.categories.create:
        cursor.execute('INSERT INTO category (store_id, category_nm, category_sort) VALUES (%s, %s, %s)',
                       (store_id, c.name, c.sort))
        ids[c.temp_id] = _inserted(cursor)
    for c in changes.categories.update:
        cursor.execute('UPDATE category SET category_nm = %s, category_sort = %s WHERE category_id = %s',
                       (c.name, c.sort, c.id))
    for m in changes.menus.create:
        cursor.execute("""INSERT INTO menu (category_id, menu_nm, menu_price, menu_des, is_active, is_sold_out, menu_sort)
                          VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                       (_resolve(m.category_id, ids, category_ids), m.name, m.price, m.description,
                        m.is_active, m.is_sold_out, m.sort))
        ids[m.temp_id] = _inserted(cursor)
    for m in changes.menus.update:
        cursor.execute("""UPDATE menu SET category_id = %s, menu_nm = %s, menu_price = %s, menu_des = %s,
                          is_active = %s, menu_sort = %s WHERE menu_id = %s""",
                       (_resolve(m.category_id, ids, category_ids), m.name, m.price, m.description,
                        m.is_active, m.sort, m.id))
    groups = portal._has_option_group(cursor)
    if not groups and any(o.group for o in [*changes.options.create, *changes.options.update]):
        raise HTTPException(503, '옵션 그룹 DB 변경이 아직 적용되지 않았습니다.')
    for o in changes.options.create:
        cursor.execute("""INSERT INTO menu_option (menu_id, option_nm, extra_price, is_sold_out, menu_option_sort)
                          VALUES (%s, %s, %s, %s, %s)""",
                       (_resolve(o.menu_id, ids, menu_ids), o.name, o.extra_price, o.is_sold_out, o.sort))
        ids[o.temp_id] = _inserted(cursor)
        if groups and o.group:
            cursor.execute('UPDATE menu_option SET option_group = %s WHERE option_id = %s', (o.group, ids[o.temp_id]))
    for o in changes.options.update:
        cursor.execute("""UPDATE menu_option SET option_nm = %s, extra_price = %s, is_active = %s,
                          menu_option_sort = %s WHERE option_id = %s""",
                       (o.name, o.extra_price, o.is_active, o.sort, o.id))
        if groups and 'group' in o.model_fields_set:
            cursor.execute('UPDATE menu_option SET option_group = %s WHERE option_id = %s', (o.group, o.id))
    # 메뉴를 옮긴 뒤에 삭제합니다. 판매 중지 메뉴가 남아 있어도 FK가 거부하므로 삭제하지 않습니다.
    for category_id in changes.categories.remove:
        cursor.execute('SELECT COUNT(*) AS count FROM menu WHERE category_id = %s', (category_id,))
        if cursor.fetchone()['count']:
            raise HTTPException(409, '메뉴가 남아 있는 카테고리는 삭제할 수 없습니다.')
        cursor.execute('DELETE FROM category WHERE category_id = %s', (category_id,))
        if cursor.rowcount != 1:
            raise RuntimeError('Unexpected delete result')
    return ids


def save_menu_board(store_id, owner_id, changes):
    if changes.empty:
        return {'board': portal.menu_board(store_id, owner_id), 'ids': {}, 'devices_updated': 0}
    connection = portal.connection_factory()
    try:
        with connection.cursor() as cursor:
            # 다른 점주의 기기 행을 잠그지 않도록 먼저 별도 트랜잭션에서 소유를 확인합니다.
            cursor.execute('START TRANSACTION READ ONLY')
            portal.require_store(cursor, store_id, owner_id)
            connection.rollback()
            # 잠금 순서는 POST /orders와 같이 기기 → (매장) → 메뉴입니다. 주문과의 교착을 피합니다.
            # 기다린 뒤의 최신 값을 읽도록 잠금이 끝날 때까지 일반 SELECT를 하지 않습니다.
            cursor.execute('START TRANSACTION')
            cursor.execute('SELECT device_id FROM kiosk_device WHERE store_id = %s ORDER BY device_id FOR UPDATE',
                           (store_id,))
            devices = cursor.fetchall()
            portal.require_store(cursor, store_id, owner_id, lock=True)
            ids = _apply(cursor, store_id, changes)
            _renumber_all(cursor, store_id)
            cursor.execute('UPDATE kiosk_device SET current_menu_version = current_menu_version + 1 WHERE store_id = %s',
                           (store_id,))
            board = portal.read_board(cursor, store_id)
        connection.commit()
        sync_hub.menu_changed(store_id)
        return {'board': board, 'ids': ids, 'devices_updated': len(devices)}
    except IntegrityError as error:
        connection.rollback()
        if error.args and error.args[0] in (1062, 1451, 1452):
            raise HTTPException(409, '메뉴판이 변경되었습니다. 새로고침한 뒤 다시 시도해 주세요.') from None
        raise
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _set_sold_out(owner_id, target_id, value, select_sql, update_sql):
    # 품절도 키오스크가 즉시 반영해야 하므로 메뉴 버전을 올리고 알립니다.
    connection = portal.connection_factory()
    try:
        with connection.cursor() as cursor:
            # 소유는 잠그지 않고 먼저 확인합니다. 잠금 순서는 주문·메뉴판 저장과 같은 기기 → 메뉴입니다
            # (반대 순서면 같은 메뉴를 주문하는 키오스크와 교착이 생깁니다).
            cursor.execute('START TRANSACTION READ ONLY')
            cursor.execute(select_sql, (target_id, owner_id))
            row = cursor.fetchone()
            connection.rollback()
            if row is None:
                raise OwnerResourceNotFound()
            cursor.execute('START TRANSACTION')
            cursor.execute('SELECT device_id FROM kiosk_device WHERE store_id = %s ORDER BY device_id FOR UPDATE',
                           (row['store_id'],))
            cursor.fetchall()
            cursor.execute(select_sql + ' FOR UPDATE', (target_id, owner_id))
            if cursor.fetchone() is None:
                raise OwnerResourceNotFound()
            cursor.execute(update_sql, (value, target_id))
            cursor.execute('UPDATE kiosk_device SET current_menu_version = current_menu_version + 1 WHERE store_id = %s',
                           (row['store_id'],))
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
    sync_hub.menu_changed(row['store_id'])


def set_menu_sold_out(menu_id, owner_id, value):
    _set_sold_out(owner_id, menu_id, value, """
        SELECT m.menu_id, s.store_id FROM menu m JOIN category c ON c.category_id = m.category_id
        JOIN store s ON s.store_id = c.store_id WHERE m.menu_id = %s AND s.owner_id = %s
    """, 'UPDATE menu SET is_sold_out = %s WHERE menu_id = %s')
    return {'menu_id': menu_id, 'is_sold_out': value}


def set_option_sold_out(option_id, owner_id, value):
    _set_sold_out(owner_id, option_id, value, """
        SELECT o.option_id, s.store_id FROM menu_option o JOIN menu m ON m.menu_id = o.menu_id
        JOIN category c ON c.category_id = m.category_id
        JOIN store s ON s.store_id = c.store_id WHERE o.option_id = %s AND s.owner_id = %s
    """, 'UPDATE menu_option SET is_sold_out = %s WHERE option_id = %s')
    return {'option_id': option_id, 'is_sold_out': value}
