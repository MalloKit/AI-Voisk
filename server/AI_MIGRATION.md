# AI 음성 주문 DB 변경 — 2026-11-11 공용 Azure DB에 적용함

오너 승인(2026-11-11 "DB도 너가 자유롭게 변경해라")에 따라 적용했습니다.
**추가형 변경만** 했고, 기존 행의 값은 바꾸지 않았습니다. 적용 스크립트는 `ai_migration.py`입니다.

## 적용 기록

1. 적용 전 전체 13개 테이블의 정의(`SHOW CREATE TABLE`)와 모든 행을 `server/backups/voisk_backup_20261110T150743Z.json`에 백업했습니다(커밋 금지, 비밀번호 해시 포함). 행 수: admin 1, category 11, device_alert 0, kiosk_device 2, menu 14, menu_img 0, menu_option 11, order_item 26, order_item_option 17, orders 19, owner 2, payments 11, store 1.
2. 아래 12단계를 순서대로 적용하고 단계마다 information_schema로 적용 여부를 확인했습니다.
3. 호출어 기능을 빼기로 결정한 뒤, 방금 만든 빈 테이블 `store_ai_setting`에서 `wake_mode`, `wake_sensitivity` 열을 지웠습니다(행 0건 확인 후).
4. `seed_demo_ai.py`로 시연 매장(store 1) 메뉴를 14개에서 40개로 보강하고 태그·동의어·원가율을 채웠습니다. 기존 14개 메뉴의 이름·가격·설명·품절·판매 상태는 그대로입니다.
5. 2026-11-11 08:30 KST: 다시 전체 백업(`voisk_backup_20261110T233023Z.json`) 뒤 13단계 `menu_option.option_group`을 추가하고, `seed_demo_ai.py`로 필수 옵션 10개(떡볶이·라면 맵기 순한맛/보통맛/매운맛, 아이스·따뜻한 아메리카노 사이즈 레귤러/라지 +500원)를 넣었습니다. 기존 옵션은 그룹 없음(자유 추가)으로 그대로입니다.

## 변경 내용

| 대상 | 변경 | 용도 |
|---|---|---|
| `menu` | `cost_rate TINYINT UNSIGNED NULL` + CHECK(≤100) | 원가율(%). 이익 우선 정책의 순서 계산 |
| `menu` | `is_rec_excluded TINYINT(1) DEFAULT 0` | 추천·추가 제안에서 제외 |
| `menu` | `is_store_pick TINYINT(1) DEFAULT 0` | 매장 우선 메뉴(신메뉴·재고 소진) |
| `menu_tag(menu_id, tag_nm)` | 새 테이블 | 상황 태그(해장·든든한 …) |
| `menu_synonym(menu_id, synonym_nm)` | 새 테이블 | 동의어(아아·제육 …) |
| `store_ai_setting(store_id …)` | 새 테이블 | 추천 정책·음성 설정. 행이 없으면 기본값 |
| `recommendation_log` | 새 테이블, `UNIQUE(device_id, client_log_id)` | 추천 노출·선택. 발화 원문은 저장하지 않음 |
| `kiosk_device` | `applied_menu_version INT NULL` | 키오스크가 적용한 메뉴 버전 |
| `orders` | `order_channel ENUM('touch','voice') NULL` | 주문 방식 |
| `order_item` | `is_recommended TINYINT(1) DEFAULT 0` | 추천 경유 품목 |
| `orders` | 인덱스 `idx_orders_store_ordered(store_id, ordered_at)` | 기간별 통계 |
| `menu_option` | `option_group VARCHAR(20) NULL` | 필수 옵션 그룹(맵기·사이즈). 같은 그룹에서 하나를 꼭 고름. NULL이면 자유 추가 옵션 |

## 다시 실행·다른 DB에 적용

```powershell
cd server
.\.venv\Scripts\python.exe ai_migration.py            # 적용 여부만 확인(읽기 전용)
.\.venv\Scripts\python.exe ai_migration.py --backup   # 전체 백업만
.\.venv\Scripts\python.exe ai_migration.py --apply    # 백업 후 빠진 단계만 적용
.\.venv\Scripts\python.exe seed_demo_ai.py --dry-run  # 시연 메뉴 보강 미리보기
```

- 이미 적용된 단계는 건너뛰므로 여러 번 실행해도 됩니다. MySQL DDL은 자동 커밋이라, 중간에 실패하면 그 단계에서 멈추고 다시 실행하면 남은 단계부터 이어 갑니다.
- 서버 코드는 열·테이블이 있는지 실행 중에 확인합니다. 적용 전 DB에서는 AI 기능만 503(`ai_schema_missing`)으로 끄고, 기존 메뉴 조회·주문·관리자 화면은 그대로 동작합니다.

## 되돌리기 (필요할 때만, 팀 승인 후)

새 테이블과 열만 지우면 되고 기존 데이터에는 영향이 없습니다. 지우기 전에 `--backup`을 먼저 실행합니다.

```sql
DROP TABLE recommendation_log, store_ai_setting, menu_synonym, menu_tag;
ALTER TABLE order_item DROP COLUMN is_recommended;
ALTER TABLE orders DROP INDEX idx_orders_store_ordered, DROP COLUMN order_channel;
ALTER TABLE kiosk_device DROP COLUMN applied_menu_version;
ALTER TABLE menu_option DROP COLUMN option_group;
ALTER TABLE menu DROP CHECK ck_menu_cost_rate, DROP COLUMN cost_rate, DROP COLUMN is_rec_excluded, DROP COLUMN is_store_pick;
```

시연용으로 추가한 메뉴 26개는 주문 기록(`order_item`)이 생기면 FK 때문에 지울 수 없습니다. 판매 중지(`is_active = FALSE`)로 처리합니다.
