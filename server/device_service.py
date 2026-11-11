"""기기 등록 정보 읽기 전용 조회. 접속 상태를 판정하지 않습니다."""
from datetime import datetime, timezone


class DeviceNotFound(LookupError):
    pass


def connection_factory():
    from database import connect
    return connect()


_SELECT = """
    SELECT d.device_id, d.device_code, d.store_id,
           s.store_nm AS store_name, s.store_add1 AS store_address,
           s.store_add2 AS store_address_detail,
           d.is_active, d.registered_at, d.app_version,
           d.last_seen_at, d.last_synced_at{versions}
    FROM kiosk_device d
    JOIN store s ON s.store_id = d.store_id
"""


def _timestamp(value, nullable=True):
    if value is None and nullable:
        return None
    if not isinstance(value, datetime):
        raise ValueError('기기 시각 형식이 올바르지 않습니다.')
    # TIMESTAMP values were read after explicitly setting this session to UTC.
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def _view(row):
    if row['is_active'] not in (0, 1):
        raise ValueError('활성화 상태가 올바르지 않습니다.')
    # Explicit response projection as well as explicit SQL projection.
    return {
        'device_id': row['device_id'],
        'device_code': row['device_code'],
        'store_id': row['store_id'],
        'store_name': row['store_name'],
        'store_address': row['store_address'],
        'store_address_detail': row['store_address_detail'],
        'is_active': bool(row['is_active']),
        'registered_at': _timestamp(row['registered_at'], nullable=False),
        'app_version': row['app_version'],
        'last_seen_at': _timestamp(row['last_seen_at']),
        'last_synced_at': _timestamp(row['last_synced_at']),
        # 서버의 최신 메뉴 버전과 키오스크가 적용했다고 보고한 버전. 열이 없는 DB에서는 None입니다.
        'current_menu_version': row.get('current_menu_version'),
        'applied_menu_version': row.get('applied_menu_version'),
    }


def _versions(cursor):
    columns = []
    for column in ('current_menu_version', 'applied_menu_version'):
        try:
            cursor.execute(f'SELECT {column} FROM kiosk_device WHERE 1 = 0')
            cursor.fetchall()
            columns.append(f', d.{column}')
        except Exception:
            pass
    return ''.join(columns)


def _read(device_id=None):
    connection = connection_factory()
    try:
        with connection.cursor() as cursor:
            # Session setting only; no global setting, schema or data changes.
            cursor.execute("SET time_zone = '+00:00'")
            cursor.execute('START TRANSACTION READ ONLY')
            select = _SELECT.format(versions=_versions(cursor))
            if device_id is None:
                cursor.execute(select + ' ORDER BY d.device_id')
                devices = [_view(row) for row in cursor.fetchall()]
                return {'devices': devices, 'total': len(devices)}
            cursor.execute(select + ' WHERE d.device_id = %s', (device_id,))
            row = cursor.fetchone()
            if row is None:
                raise DeviceNotFound()
            return _view(row)
    finally:
        try:
            connection.rollback()
        finally:
            connection.close()


def list_devices():
    return _read()


def device_detail(device_id):
    return _read(device_id)
