"""First administrator acknowledgement only; resolution and devices are untouched."""
from typing import Literal
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict
import alert_service


class AlertAcknowledge(BaseModel):
    model_config = ConfigDict(extra='forbid')
    expected_status: Literal['UNREAD']


def acknowledge_alert(alert_id: int, payload: AlertAcknowledge, admin_id: int):
    connection = alert_service.connection_factory()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SET time_zone = '+00:00'")
            cursor.execute('START TRANSACTION')
            # Lock only this alert, not joined device/store rows used by other services.
            cursor.execute('SELECT alert_id, alert_status, acknowledged_at, acknowledged_by FROM device_alert WHERE alert_id = %s FOR UPDATE', (alert_id,))
            current = cursor.fetchone()
            if current is None:
                raise alert_service.AlertNotFound()
            complete = current['acknowledged_at'] is not None and current['acknowledged_by'] is not None
            if current['alert_status'] == 'ACKNOWLEDGED' and complete and current['acknowledged_by'] == admin_id:
                pass  # Idempotent retry keeps the first administrator and timestamp.
            elif current['alert_status'] == payload.expected_status and current['acknowledged_at'] is None and current['acknowledged_by'] is None:
                cursor.execute("UPDATE device_alert SET alert_status = %s, acknowledged_at = CURRENT_TIMESTAMP, acknowledged_by = %s WHERE alert_id = %s",
                               ('ACKNOWLEDGED', admin_id, alert_id))
                if cursor.rowcount != 1:
                    raise RuntimeError('Unexpected acknowledgement update result')
            else:
                raise HTTPException(409, '알림 상태 또는 확인 기록이 변경되었습니다. 상세를 새로 조회해 주세요.')
            cursor.execute(alert_service._SELECT + ' WHERE a.alert_id = %s', (alert_id,))
            row = cursor.fetchone()
            if row is None or row['alert_status'] != 'ACKNOWLEDGED' or row['acknowledged_by'] != admin_id or row['acknowledged_at'] is None:
                raise RuntimeError('Unexpected saved acknowledgement')
            if complete and row['acknowledged_at'] != current['acknowledged_at']:
                raise RuntimeError('First acknowledgement timestamp changed')
            result = alert_service._view(row)
        connection.commit()
        return result
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
