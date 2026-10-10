"""Azure MySQL 조회용 연결. 비밀번호와 DB 오류 원문은 출력하지 않습니다."""
import os
import ssl
from pathlib import Path

import pymysql
from dotenv import load_dotenv


def connect():
    load_dotenv(Path(__file__).with_name('.env'))
    required = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']
    if any(not os.getenv(key) for key in required):
        raise ValueError('DB 설정 항목이 비어 있습니다.')
    context = ssl.create_default_context(cafile=os.getenv('DB_SSL_CA') or None)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    return pymysql.connect(
        host=os.environ['DB_HOST'], port=int(os.environ['DB_PORT']),
        database=os.environ['DB_NAME'], user=os.environ['DB_USER'],
        password=os.environ['DB_PASSWORD'], ssl=context,
        charset='utf8mb4', cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=10, read_timeout=10, write_timeout=10,
    )


def query(sql, params=()):
    connection = connect()
    try:
        with connection.cursor() as cursor:
            cursor.execute('START TRANSACTION READ ONLY')
            cursor.execute(sql, params)
            return cursor.fetchall()
    finally:
        connection.close()
