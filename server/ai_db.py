"""AI·키오스크 기능 공용 DB 도우미. 테스트는 connection_factory를 메모리 DB로 바꿉니다."""
from contextlib import contextmanager


def connection_factory():
    from database import connect
    return connect()


@contextmanager
def read_cursor():
    connection = connection_factory()
    try:
        with connection.cursor() as cursor:
            # TIMESTAMP를 UTC로 읽고 쓰도록 세션 시간대를 고정합니다.
            cursor.execute("SET time_zone = '+00:00'")
            cursor.execute('START TRANSACTION READ ONLY')
            yield cursor
    finally:
        try:
            connection.rollback()
        finally:
            connection.close()


@contextmanager
def write_cursor():
    connection = connection_factory()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SET time_zone = '+00:00'")
            cursor.execute('START TRANSACTION')
            yield cursor
        connection.commit()
    except BaseException:
        connection.rollback()
        raise
    finally:
        connection.close()


def has_columns(cursor, table, columns):
    """컬럼·테이블이 있으면 True. MySQL과 SQLite 모두 실패한 SELECT가 트랜잭션을 깨지 않습니다."""
    try:
        cursor.execute(f'SELECT {", ".join(columns)} FROM {table} WHERE 1 = 0')
        cursor.fetchall()
        return True
    except Exception:
        return False


# AI 마이그레이션(server/AI_MIGRATION.md)이 추가하는 컬럼·테이블입니다.
AI_SCHEMA = (
    ('menu', ('cost_rate', 'is_rec_excluded', 'is_store_pick')),
    ('menu_tag', ('menu_id', 'tag_nm')),
    ('menu_synonym', ('menu_id', 'synonym_nm')),
    ('store_ai_setting', ('store_id', 'policy_profit', 'pick_weight', 'fit_threshold', 'upsell_enabled',
                          'default_mode', 'speech_rate', 'voice_enabled')),
    ('recommendation_log', ('rec_log_id', 'store_id', 'device_id', 'client_log_id', 'situation',
                            'shown_menu_ids', 'selected_menu_id', 'policy_profit', 'created_at')),
    ('kiosk_device', ('applied_menu_version',)),
    ('orders', ('order_channel',)),
    ('order_item', ('is_recommended',)),
)


def ai_schema_ready(cursor):
    return all(has_columns(cursor, table, columns) for table, columns in AI_SCHEMA)


class AiSchemaMissing(RuntimeError):
    """AI 마이그레이션이 적용되지 않아 해당 기능만 끕니다."""
