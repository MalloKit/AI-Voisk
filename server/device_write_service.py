"""Company-admin device registration and activation; no device credentials or telemetry."""
import re
from typing import Annotated
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StrictStr, field_validator
from pymysql.err import IntegrityError
import device_service

Identifier = Annotated[StrictInt, Field(ge=1, le=2147483647)]


class DeviceCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    device_code: StrictStr = Field(min_length=1, max_length=50)
    store_id: Identifier

    @field_validator('device_code')
    @classmethod
    def valid_code(cls, value):
        if re.fullmatch(r'[A-Za-z0-9_-]{1,50}', value) is None:
            raise ValueError('기기 코드 형식을 확인해 주세요.')
        return value


class DeviceStatusPatch(BaseModel):
    model_config = ConfigDict(extra='forbid')
    is_active: StrictBool
    expected_is_active: StrictBool


def _saved(cursor, device_id):
    cursor.execute(device_service._SELECT + ' WHERE d.device_id = %s', (device_id,))
    row = cursor.fetchone()
    if row is None:
        raise RuntimeError('Missing saved device')
    return device_service._view(row)


def _write(operation):
    connection = device_service.connection_factory()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SET time_zone = '+00:00'")
            cursor.execute('START TRANSACTION')
            result = operation(cursor)
        connection.commit()
        return result
    except IntegrityError as error:
        connection.rollback()
        if error.args and error.args[0] == 1062:
            raise HTTPException(409, '이미 사용 중인 기기 코드입니다.') from None
        if error.args and error.args[0] in (1451, 1452):
            raise HTTPException(409, '매장 또는 기기 정보가 변경되었습니다. 새로 조회해 주세요.') from None
        raise
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def create_device(payload: DeviceCreate):
    def operation(cursor):
        cursor.execute('SELECT store_id FROM store WHERE store_id = %s', (payload.store_id,))
        if cursor.fetchone() is None:
            raise HTTPException(404, '매장이 없습니다.')
        cursor.execute('INSERT INTO kiosk_device (device_code, store_id, is_active) VALUES (%s, %s, 0)',
                       (payload.device_code, payload.store_id))
        if cursor.rowcount != 1 or type(cursor.lastrowid) is not int or not 1 <= cursor.lastrowid <= 2147483647:
            raise RuntimeError('Unexpected device insert result')
        result = _saved(cursor, cursor.lastrowid)
        if result['is_active'] or result['device_code'] != payload.device_code or result['store_id'] != payload.store_id:
            raise RuntimeError('Unexpected saved device')
        return result
    return _write(operation)


def update_device_status(device_id: int, payload: DeviceStatusPatch):
    def operation(cursor):
        # Same first row lock as save_order; do not lock store/menu rows first.
        cursor.execute('SELECT device_id, is_active FROM kiosk_device WHERE device_id = %s FOR UPDATE', (device_id,))
        row = cursor.fetchone()
        if row is None:
            raise device_service.DeviceNotFound()
        if row['is_active'] not in (0, 1):
            raise RuntimeError('Unexpected stored status')
        current = bool(row['is_active'])
        if current != payload.expected_is_active:
            raise HTTPException(409, '활성화 상태가 변경되었습니다. 기기 상세를 새로 조회해 주세요.')
        if current != payload.is_active:
            cursor.execute('UPDATE kiosk_device SET is_active = %s WHERE device_id = %s', (payload.is_active, device_id))
            if cursor.rowcount != 1:
                raise RuntimeError('Unexpected status update result')
        result = _saved(cursor, device_id)
        if result['is_active'] != payload.is_active:
            raise RuntimeError('Unexpected saved status')
        return result
    return _write(operation)
