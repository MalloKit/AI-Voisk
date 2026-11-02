"""회사 관리자 매장 조회 전용. 쓰기나 스키마 변경을 수행하지 않습니다."""


class StoreNotFound(LookupError):
    pass


def connection_factory():
    from database import connect
    return connect()


# Explicit projection: never return admin_pw or own_pw.
_SELECT = """
    SELECT s.store_id, s.store_nm AS store_name,
           s.store_add1 AS address, s.store_add2 AS address_detail,
           s.store_code, s.store_phone AS phone, s.business_no,
           s.store_owner_nm AS representative, s.store_type,
           s.admin_id, a.admin_nm AS admin_name,
           s.owner_id, o.own_login_id AS owner_login_id
    FROM store s
    LEFT JOIN admin a ON a.admin_id = s.admin_id
    LEFT JOIN owner o ON o.owner_id = s.owner_id
"""


def _read(store_id=None):
    connection = connection_factory()
    try:
        with connection.cursor() as cursor:
            cursor.execute('START TRANSACTION READ ONLY')
            if store_id is None:
                cursor.execute(_SELECT + ' ORDER BY s.store_id')
                rows = cursor.fetchall()
                return {'stores': rows, 'total': len(rows)}
            cursor.execute(_SELECT + ' WHERE s.store_id = %s', (store_id,))
            row = cursor.fetchone()
            if row is None:
                raise StoreNotFound()
            return row
    finally:
        try:
            connection.rollback()
        finally:
            connection.close()


def list_stores():
    return _read()


def store_detail(store_id):
    return _read(store_id)
