"""AI 음성 주문 기능용 DB 변경. 추가형(컬럼·테이블·인덱스 추가)만 하며 기존 데이터를 바꾸지 않습니다.

사용법 (server 폴더에서):
    .venv/Scripts/python.exe ai_migration.py            # 적용 여부만 확인(읽기 전용)
    .venv/Scripts/python.exe ai_migration.py --backup   # 전체 테이블 백업만
    .venv/Scripts/python.exe ai_migration.py --apply    # 백업 후 빠진 항목만 적용

백업은 server/backups/ 아래 JSON으로 남깁니다(커밋 금지, 비밀번호 해시 포함).
각 단계는 이미 적용됐는지 확인한 뒤 실행하므로 여러 번 실행해도 안전합니다.
MySQL DDL은 자동 커밋이라 실패하면 그 단계에서 멈추고, 다시 실행하면 남은 단계부터 이어 갑니다.
"""
import argparse
import json
import sys
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path

STEPS = [
    ('menu.cost_rate', "column", ('menu', 'cost_rate'),
     "ALTER TABLE menu ADD COLUMN cost_rate TINYINT UNSIGNED NULL COMMENT '원가율(%)'"),
    ('menu.is_rec_excluded', "column", ('menu', 'is_rec_excluded'),
     "ALTER TABLE menu ADD COLUMN is_rec_excluded TINYINT(1) NOT NULL DEFAULT 0 COMMENT '추천 제외'"),
    ('menu.is_store_pick', "column", ('menu', 'is_store_pick'),
     "ALTER TABLE menu ADD COLUMN is_store_pick TINYINT(1) NOT NULL DEFAULT 0 COMMENT '매장 우선 추천'"),
    ('menu.ck_menu_cost_rate', "constraint", ('menu', 'ck_menu_cost_rate'),
     'ALTER TABLE menu ADD CONSTRAINT ck_menu_cost_rate CHECK (cost_rate IS NULL OR cost_rate <= 100)'),
    ('menu_tag', "table", ('menu_tag',), """
        CREATE TABLE menu_tag (
          menu_id INT NOT NULL,
          tag_nm VARCHAR(20) NOT NULL COMMENT '상황 태그',
          PRIMARY KEY (menu_id, tag_nm),
          CONSTRAINT fk_menu_tag_menu FOREIGN KEY (menu_id) REFERENCES menu (menu_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='메뉴 상황 태그'"""),
    ('menu_synonym', "table", ('menu_synonym',), """
        CREATE TABLE menu_synonym (
          menu_id INT NOT NULL,
          synonym_nm VARCHAR(30) NOT NULL COMMENT '동의어',
          PRIMARY KEY (menu_id, synonym_nm),
          CONSTRAINT fk_menu_synonym_menu FOREIGN KEY (menu_id) REFERENCES menu (menu_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='메뉴 동의어'"""),
    ('store_ai_setting', "table", ('store_ai_setting',), """
        CREATE TABLE store_ai_setting (
          store_id INT NOT NULL,
          policy_profit TINYINT UNSIGNED NOT NULL DEFAULT 30 COMMENT '0 고객 적합 ~ 100 매장 이익',
          pick_weight TINYINT UNSIGNED NOT NULL DEFAULT 10 COMMENT '매장 우선 가산 0~100',
          fit_threshold TINYINT UNSIGNED NOT NULL DEFAULT 50 COMMENT '적합도 기준선 0~100',
          upsell_enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT '추가 제안 사용',
          default_mode ENUM('normal','senior') NOT NULL DEFAULT 'normal' COMMENT '기본 사용자 모드',
          speech_rate SMALLINT UNSIGNED NOT NULL DEFAULT 100 COMMENT '안내 음성 속도 %',
          voice_enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT '음성 주문 사용',
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (store_id),
          CONSTRAINT fk_store_ai_setting_store FOREIGN KEY (store_id) REFERENCES store (store_id),
          CONSTRAINT ck_store_ai_setting_range CHECK (
            policy_profit <= 100 AND pick_weight <= 100 AND fit_threshold <= 100
            AND speech_rate BETWEEN 50 AND 150)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='매장 추천 정책·음성 설정'"""),
    ('recommendation_log', "table", ('recommendation_log',), """
        CREATE TABLE recommendation_log (
          rec_log_id INT NOT NULL AUTO_INCREMENT,
          store_id INT NOT NULL,
          device_id INT NOT NULL,
          client_log_id CHAR(36) NOT NULL COMMENT '키오스크가 만든 멱등 키',
          situation VARCHAR(100) NULL COMMENT '추출된 상황 태그(발화 원문 아님)',
          shown_menu_ids VARCHAR(100) NOT NULL COMMENT '노출 순서대로 쉼표 구분',
          selected_menu_id INT NULL,
          policy_profit TINYINT UNSIGNED NOT NULL COMMENT '노출 당시 정책',
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (rec_log_id),
          UNIQUE KEY uq_rec_log_device_client (device_id, client_log_id),
          KEY idx_rec_log_store_created (store_id, created_at),
          CONSTRAINT fk_rec_log_store FOREIGN KEY (store_id) REFERENCES store (store_id),
          CONSTRAINT fk_rec_log_device FOREIGN KEY (device_id) REFERENCES kiosk_device (device_id),
          CONSTRAINT fk_rec_log_menu FOREIGN KEY (selected_menu_id) REFERENCES menu (menu_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='추천 노출·선택 기록'"""),
    ('kiosk_device.applied_menu_version', "column", ('kiosk_device', 'applied_menu_version'),
     "ALTER TABLE kiosk_device ADD COLUMN applied_menu_version INT NULL COMMENT '키오스크가 적용한 메뉴 버전'"),
    ('orders.order_channel', "column", ('orders', 'order_channel'),
     "ALTER TABLE orders ADD COLUMN order_channel ENUM('touch','voice') NULL COMMENT '주문 방식'"),
    ('order_item.is_recommended', "column", ('order_item', 'is_recommended'),
     "ALTER TABLE order_item ADD COLUMN is_recommended TINYINT(1) NOT NULL DEFAULT 0 COMMENT '추천 경유'"),
    ('orders.idx_orders_store_ordered', "index", ('orders', 'idx_orders_store_ordered'),
     'ALTER TABLE orders ADD INDEX idx_orders_store_ordered (store_id, ordered_at)'),
]


def exists(cursor, kind, target):
    if kind == 'table':
        cursor.execute('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s',
                       target)
    elif kind == 'column':
        cursor.execute('''SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND COLUMN_NAME = %s''', target)
    elif kind == 'index':
        cursor.execute('''SELECT 1 FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND INDEX_NAME = %s''', target)
    else:
        cursor.execute('''SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND CONSTRAINT_NAME = %s''', target)
    return cursor.fetchone() is not None


def _json(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, bytes):
        return value.hex()
    raise TypeError(type(value).__name__)


def backup(connection):
    folder = Path(__file__).with_name('backups')
    folder.mkdir(exist_ok=True)
    data = {'created_at': datetime.now(timezone.utc).isoformat(), 'tables': {}}
    with connection.cursor() as cursor:
        cursor.execute('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY')
        cursor.execute("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME")
        for (name,) in [(row['TABLE_NAME'],) for row in cursor.fetchall()]:
            cursor.execute(f'SHOW CREATE TABLE `{name}`')
            ddl = cursor.fetchone()['Create Table']
            cursor.execute(f'SELECT * FROM `{name}`')
            data['tables'][name] = {'ddl': ddl, 'rows': cursor.fetchall()}
        connection.rollback()
    path = folder / f"voisk_backup_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
    path.write_text(json.dumps(data, ensure_ascii=False, default=_json, indent=1), encoding='utf-8')
    counts = {name: len(table['rows']) for name, table in data['tables'].items()}
    # 다시 읽어 행 수가 같은지 확인한 뒤에만 다음 단계로 갑니다.
    verify = json.loads(path.read_text(encoding='utf-8'))
    if {name: len(table['rows']) for name, table in verify['tables'].items()} != counts:
        raise RuntimeError('백업 파일 검증 실패')
    return path, counts


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--backup', action='store_true')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    from database import connect
    connection = connect()
    try:
        if args.backup or args.apply:
            path, counts = backup(connection)
            print(f'백업 완료: {path.name}')
            print('행 수:', ', '.join(f'{name}={count}' for name, count in counts.items()))
        with connection.cursor() as cursor:
            pending = []
            for name, kind, target, _ in STEPS:
                done = exists(cursor, kind, target)
                print(f"{'적용됨' if done else '미적용'}  {name}")
                if not done:
                    pending.append(name)
            connection.rollback()
            if not args.apply:
                return 0 if not pending else 2
            for name, kind, target, sql in STEPS:
                if exists(cursor, kind, target):
                    continue
                print(f'적용 중: {name}')
                cursor.execute(sql)
                connection.commit()
                if not exists(cursor, kind, target):
                    raise RuntimeError(f'적용 확인 실패: {name}')
            print('모든 단계 적용 완료')
        return 0
    except Exception as error:
        # 접속 정보·SQL 원문 대신 오류 종류와 코드만 출력합니다.
        code = error.args[0] if error.args and isinstance(error.args[0], int) else '-'
        print(f'실패: {type(error).__name__} ({code})', file=sys.stderr)
        return 1
    finally:
        connection.close()


if __name__ == '__main__':
    sys.exit(main())
