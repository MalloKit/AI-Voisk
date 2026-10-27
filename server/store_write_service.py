"""매장 등록·기본 정보 수정. 관계·스키마 변경은 하지 않습니다."""
import re
from typing import Annotated
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictStr, field_validator, model_validator
from pymysql.err import IntegrityError
import store_service

# Workbench에서 확인한 실제 컬럼. 요청 키를 SQL 식별자로 직접 사용하지 않습니다.
COLUMNS = {
    'store_name': 'store_nm', 'address': 'store_add1',
    'address_detail': 'store_add2', 'store_code': 'store_code',
    'phone': 'store_phone', 'business_no': 'business_no',
    'representative': 'store_owner_nm', 'store_type': 'store_type',
}
LIMITS = {'store_name': 100, 'address': 200, 'address_detail': 200,
          'store_code': 5, 'phone': 50, 'business_no': 10,
          'representative': 50, 'store_type': 200}
Text = Annotated[StrictStr, Field(max_length=200)]


class StorePatch(BaseModel):
    model_config = ConfigDict(extra='forbid')
    store_name: Text | None = None
    address: Text | None = None
    address_detail: Text | None = None
    store_code: Text | None = None
    phone: Text | None = None
    business_no: Text | None = None
    representative: Text | None = None
    store_type: Text | None = None

    @field_validator('*')
    @classmethod
    def validate_text(cls, value, info):
        key = info.field_name
        if value is None:
            if key != 'address_detail':
                raise ValueError('필수 항목입니다.')
            return None
        value = value.strip()
        if not value and key != 'address_detail':
            raise ValueError('필수 항목입니다.')
        if len(value) > LIMITS[key]:
            raise ValueError('허용 길이를 초과했습니다.')
        if any(ord(c) < 32 or ord(c) == 127 or 0xD800 <= ord(c) <= 0xDFFF for c in value):
            raise ValueError('입력 문자를 확인해 주세요.')
        # DB UNIQUE/CHECK가 아닌 입력 정책: 우편번호 5자리, 사업자번호 10자리.
        if key in ('store_code', 'business_no') and not re.fullmatch(
                '[0-9]{' + str(LIMITS[key]) + '}', value):
            raise ValueError('숫자 자리수를 확인해 주세요.')
        return value or None

    @model_validator(mode='after')
    def require_changes(self):
        if not self.model_fields_set:
            raise ValueError('수정할 항목이 없습니다.')
        return self


class StoreCreate(StorePatch):
    store_name: Text
    address: Text
    store_code: Text
    phone: Text
    business_no: Text
    representative: Text
    store_type: Text


def _write(payload, admin_id=None, store_id=None):
    connection = store_service.connection_factory()
    try:
        with connection.cursor() as cursor:
            cursor.execute('START TRANSACTION')
            values = payload.model_dump(exclude_unset=True)
            if store_id is None:
                values.setdefault('address_detail', None)
                columns = [COLUMNS[key] for key in values]
                # 관리자는 서버 세션에서 결정하고 owner_id는 NULL로 등록합니다.
                cursor.execute(
                    'INSERT INTO store (' + ', '.join(columns + ['admin_id', 'owner_id']) +
                    ') VALUES (' + ', '.join(['%s'] * len(columns) + ['%s', 'NULL']) + ')',
                    tuple(values.values()) + (admin_id,))
                if cursor.rowcount != 1 or not isinstance(cursor.lastrowid, int) or cursor.lastrowid < 1:
                    raise RuntimeError('Unexpected insert result')
                store_id = cursor.lastrowid
            else:
                cursor.execute(store_service._SELECT + ' WHERE s.store_id = %s FOR UPDATE', (store_id,))
                current = cursor.fetchone()
                if current is None:
                    raise store_service.StoreNotFound()
                changed = {key: value for key, value in values.items() if current[key] != value}
                if changed:
                    cursor.execute(
                        'UPDATE store SET ' + ', '.join(COLUMNS[key] + ' = %s' for key in changed) +
                        ' WHERE store_id = %s', tuple(changed.values()) + (store_id,))
                    if cursor.rowcount != 1:
                        raise RuntimeError('Unexpected update result')
            cursor.execute(store_service._SELECT + ' WHERE s.store_id = %s', (store_id,))
            row = cursor.fetchone()
            if row is None:
                raise RuntimeError('Missing saved store')
        connection.commit()
        return row
    except IntegrityError as error:
        connection.rollback()
        if error.args and error.args[0] in (1062, 1451, 1452):
            raise HTTPException(409, 'DB 제약 또는 연결 정보가 변경되었습니다. 새로고침 후 확인해 주세요.') from None
        raise
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def create_store(payload: StoreCreate, admin_id: int):
    return _write(payload, admin_id=admin_id)


def update_store(store_id: int, payload: StorePatch):
    return _write(payload, store_id=store_id)
