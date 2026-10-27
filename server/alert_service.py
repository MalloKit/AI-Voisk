"""장애·알림 읽기 전용 조회. 확인 처리나 장애 해소는 수행하지 않습니다."""
from datetime import datetime, timezone


class AlertNotFound(LookupError):
    pass


def connection_factory():
    from database import connect
    return connect()


_SELECT = """
    SELECT a.alert_id, a.device_id, d.device_code,
           d.store_id, s.store_nm AS store_name,
           a.alert_type, a.severity, a.message, a.alert_status,
           a.occurred_at, a.acknowledged_at, a.acknowledged_by,
           m.admin_nm AS acknowledged_by_name, a.resolved_at
    FROM device_alert a
    JOIN kiosk_device d ON d.device_id = a.device_id
    JOIN store s ON s.store_id = d.store_id
    LEFT JOIN admin m ON m.admin_id = a.acknowledged_by
"""
_FIELDS = (
    'alert_id', 'device_id', 'device_code', 'store_id', 'store_name',
    'alert_type', 'severity', 'message', 'alert_status', 'acknowledged_by',
    'acknowledged_by_name',
)


def _timestamp(value, nullable=True):
    if value is None and nullable:
        return None
    if not isinstance(value, datetime):
        raise ValueError('알림 시각 형식이 올바르지 않습니다.')
    # 조회 세션을 UTC로 명시한 뒤 받은 TIMESTAMP 값만 변환합니다.
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def _view(row):
    result = {name: row[name] for name in _FIELDS}
    result['occurred_at'] = _timestamp(row['occurred_at'], nullable=False)
    result['acknowledged_at'] = _timestamp(row['acknowledged_at'])
    result['resolved_at'] = _timestamp(row['resolved_at'])
    return result


def _read(alert_id=None):
    connection = connection_factory()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SET time_zone = '+00:00'")
            cursor.execute('START TRANSACTION READ ONLY')
            if alert_id is None:
                cursor.execute(_SELECT + ' ORDER BY a.occurred_at DESC, a.alert_id DESC')
                alerts = [_view(row) for row in cursor.fetchall()]
                return {'alerts': alerts, 'total': len(alerts)}
            cursor.execute(_SELECT + ' WHERE a.alert_id = %s', (alert_id,))
            row = cursor.fetchone()
            if row is None:
                raise AlertNotFound()
            return _view(row)
    finally:
        try:
            connection.rollback()
        finally:
            connection.close()


def list_alerts():
    return _read()


def alert_detail(alert_id):
    return _read(alert_id)
