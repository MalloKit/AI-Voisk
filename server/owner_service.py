"""회사 관리자 점주 조회 전용. 인증 필드는 조회하지 않습니다."""


class OwnerNotFound(LookupError):
    pass


def connection_factory():
    from database import connect
    return connect()


def _read(owner_id=None):
    connection = connection_factory()
    try:
        with connection.cursor() as cursor:
            cursor.execute('START TRANSACTION READ ONLY')
            if owner_id is None:
                cursor.execute("""
                    SELECT o.owner_id, o.own_login_id AS login_id,
                           COUNT(s.store_id) AS store_count
                    FROM owner o
                    LEFT JOIN store s ON s.owner_id = o.owner_id
                    GROUP BY o.owner_id, o.own_login_id
                    ORDER BY o.owner_id
                """)
                owners = cursor.fetchall()
                return {'owners': owners, 'total': len(owners)}
            cursor.execute(
                'SELECT owner_id, own_login_id AS login_id FROM owner WHERE owner_id = %s',
                (owner_id,),
            )
            owner = cursor.fetchone()
            if owner is None:
                raise OwnerNotFound()
            cursor.execute("""
                SELECT s.store_id, s.store_nm AS store_name,
                       s.store_add1 AS address, s.store_add2 AS address_detail,
                       s.admin_id, a.admin_nm AS admin_name
                FROM store s
                LEFT JOIN admin a ON a.admin_id = s.admin_id
                WHERE s.owner_id = %s
                ORDER BY s.store_id
            """, (owner_id,))
            stores = cursor.fetchall()
            return {**owner, 'store_count': len(stores), 'stores': stores}
    finally:
        try:
            connection.rollback()
        finally:
            connection.close()


def list_owners():
    return _read()


def owner_detail(owner_id):
    return _read(owner_id)
