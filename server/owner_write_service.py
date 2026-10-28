"""회사 관리자 전용 점주 생성·매장 연결. 기존 스키마만 사용합니다."""
import re
from typing import Annotated
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, SecretStr, StrictInt, StrictStr, field_validator
from pymysql.err import IntegrityError
import admin_auth
import owner_service
import store_service

LOGIN_ID_MIN = 4
LOGIN_ID_MAX = 100
PASSWORD_MIN = 15
PASSWORD_MAX = 128
LOGIN_ID = re.compile(r"[a-z0-9._-]{4,100}")
Identifier = Annotated[StrictInt, Field(ge=1, le=2147483647)]


class OwnerCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    login_id: StrictStr = Field(min_length=LOGIN_ID_MIN, max_length=LOGIN_ID_MAX)
    password: SecretStr = Field(min_length=PASSWORD_MIN, max_length=PASSWORD_MAX)

    @field_validator('login_id')
    @classmethod
    def valid_login(cls, value):
        if not LOGIN_ID.fullmatch(value):
            raise ValueError('로그인 ID 형식을 확인해 주세요.')
        return value

    @field_validator('password')
    @classmethod
    def valid_password(cls, value):
        if re.fullmatch(r'[\s\ufeff]*', value.get_secret_value()) is not None or any(ord(c) < 32 or ord(c) == 127 or 0xD800 <= ord(c) <= 0xDFFF for c in value.get_secret_value()):
            raise ValueError('비밀번호 입력 형식을 확인해 주세요.')
        return value


class StoreOwnerPatch(BaseModel):
    model_config = ConfigDict(extra='forbid')
    owner_id: Identifier | None
    expected_owner_id: Identifier | None


def create_owner(payload: OwnerCreate):
    # Reuse exactly the administrator's Argon2id policy; no owner sessions are created.
    encoded = admin_auth.hasher.hash(payload.password.get_secret_value())
    if not isinstance(encoded, str) or len(encoded) > 255 or not admin_auth.verify_password(encoded, payload.password.get_secret_value()):
        raise RuntimeError('Password encoding failed')
    connection = owner_service.connection_factory()
    try:
        with connection.cursor() as cursor:
            cursor.execute('START TRANSACTION')
            cursor.execute('INSERT INTO owner (own_login_id, own_pw) VALUES (%s, %s)', (payload.login_id, encoded))
            if cursor.rowcount != 1 or type(cursor.lastrowid) is not int or not 1 <= cursor.lastrowid <= 2147483647:
                raise RuntimeError('Unexpected account insert result')
            owner_id = cursor.lastrowid
            cursor.execute('SELECT owner_id, own_login_id AS login_id FROM owner WHERE owner_id = %s', (owner_id,))
            row = cursor.fetchone()
            if row is None or row['owner_id'] != owner_id or row['login_id'] != payload.login_id:
                raise RuntimeError('Missing saved account')
        connection.commit()
        return {**row, 'store_count': 0}
    except IntegrityError as error:
        connection.rollback()
        if error.args and error.args[0] == 1062:
            raise HTTPException(409, '이미 사용 중인 로그인 ID입니다.') from None
        raise
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def update_store_owner(store_id: int, payload: StoreOwnerPatch):
    connection = store_service.connection_factory()
    try:
        with connection.cursor() as cursor:
            cursor.execute('START TRANSACTION')
            # Lock store first, then the target owner. Do not lock an entire joined result.
            cursor.execute('SELECT store_id, owner_id FROM store WHERE store_id = %s FOR UPDATE', (store_id,))
            current = cursor.fetchone()
            if current is None:
                raise store_service.StoreNotFound()
            if current['owner_id'] != payload.expected_owner_id:
                raise HTTPException(409, '점주 연결 정보가 변경되었습니다. 매장 상세를 새로 조회해 주세요.')
            if payload.owner_id is not None:
                cursor.execute('SELECT owner_id FROM owner WHERE owner_id = %s FOR UPDATE', (payload.owner_id,))
                if cursor.fetchone() is None:
                    raise HTTPException(404, '점주 계정이 없습니다.')
            if current['owner_id'] != payload.owner_id:
                cursor.execute('UPDATE store SET owner_id = %s WHERE store_id = %s', (payload.owner_id, store_id))
                if cursor.rowcount != 1:
                    raise RuntimeError('Unexpected relationship update result')
            cursor.execute(store_service._SELECT + ' WHERE s.store_id = %s', (store_id,))
            row = cursor.fetchone()
            if row is None or row['owner_id'] != payload.owner_id:
                raise RuntimeError('Missing saved relationship')
        connection.commit()
        return row
    except IntegrityError as error:
        connection.rollback()
        if error.args and error.args[0] in (1062, 1451, 1452):
            raise HTTPException(409, '매장 또는 점주 정보가 변경되었습니다. 새로고침 후 확인해 주세요.') from None
        raise
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
