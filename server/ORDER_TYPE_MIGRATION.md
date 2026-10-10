# 주문 유형 분리 변경안 — Azure 미적용

2026-10-10 읽기 전용 확인: `orders.table_no`는 `INT NOT NULL`, 기본값 없음, COMMENT `테이블NO`이며 `order_type`은 없습니다. 이 문서의 SQL은 검토안이며 실행하지 않았습니다.

## 적용 순서와 영향

1. 팀의 DB 변경 승인을 받습니다. 키오스크 주문 쓰기를 중지하고 기존 주문/품목/옵션 및 테이블 정의를 백업합니다. 기존 클라이언트와 서버는 신규 유형 컬럼을 쓰지 않으므로 동시에 구버전 주문을 받아서는 안 됩니다.
2. 아래 사전 확인에서 음수/NULL 테이블 등 분류할 수 없는 주문이 있으면 중단하고 유형을 결정합니다. 주문 #1, #2의 전체 행과 연결된 품목/옵션을 기록합니다.
3. `order_type`을 우선 NULL 허용으로 추가하고 기존 유형을 이관합니다. 기존 `table_no` 값은 변경하지 않습니다.
4. 유형 이관 결과와 주문·품목·옵션 개수, #1·#2의 내용이 보존됐는지 확인합니다. 누락이 없을 때만 유형을 NOT NULL로 바꾸고 테이블 번호를 NULL 허용으로 바꿉니다.
5. 이번 서버/키오스크/관리자를 함께 재시작합니다. 새 코드의 신규 주문은 유형을 반드시 전송하고 `table_no=NULL`로 저장합니다. 별도 승인 없이 공용 DB에 검증 주문을 추가하지 않습니다.

MySQL DDL은 암묵적 커밋을 발생시키고 테이블 잠금을 수반할 수 있습니다. 일반 트랜잭션 롤백으로 전체 변경을 되돌릴 수 없습니다. 각 단계 결과를 확인하며 적용하고 실패하면 다음 단계/주문 쓰기를 중단합니다. 이미 컬럼이 추가된 부분 적용 상태에서는 ADD COLUMN을 재실행하지 않습니다. 새 NULL 테이블 주문이 생긴 후에는 구버전 서버나 NOT NULL 테이블로 단순 복구하지 않습니다.

## SQL 제안 (실행하지 않음)

```sql
-- 사전 확인과 백업 자료 확보
SHOW CREATE TABLE orders;
SELECT order_id, store_id, device_id, table_no, client_order_id FROM orders ORDER BY order_id;
SELECT COUNT(*) AS unclassifiable FROM orders WHERE table_no IS NULL OR table_no < 0;
SELECT COUNT(*) AS order_count FROM orders;
SELECT COUNT(*) AS item_count FROM order_item;
SELECT COUNT(*) AS option_count FROM order_item_option;

-- 쓰기 중지 및 백업 후, 아직 컬럼이 없을 때만 실행
ALTER TABLE orders ADD COLUMN order_type ENUM('takeaway', 'dine_in') NULL;

UPDATE orders
SET order_type = CASE
  WHEN table_no = 0 THEN 'takeaway'
  WHEN table_no >= 1 THEN 'dine_in'
END
WHERE order_type IS NULL;

-- NULL이 0건이고 #1/#2 및 품목/옵션이 보존된 경우에만 다음 ALTER 실행
SELECT COUNT(*) AS unmigrated FROM orders WHERE order_type IS NULL;
SELECT order_id, order_type, table_no FROM orders WHERE order_id IN (1, 2);

ALTER TABLE orders
  MODIFY COLUMN table_no INT NULL COMMENT '테이블NO',
  MODIFY COLUMN order_type ENUM('takeaway', 'dine_in') NOT NULL;

-- 적용 후 정의 및 기존 내용/개수를 다시 비교
SHOW CREATE TABLE orders;
SELECT order_id, order_type, table_no FROM orders WHERE order_id IN (1, 2);
```

예상 기존 결과: #1은 `takeaway / table_no=0`, #2는 `dine_in / table_no=3`. 주문 번호·UUID·소속 매장/기기·기존 테이블 값·메뉴·수량·옵션을 보존합니다. 주문 유형만 이관하며 주문 당시 가격 스냅샷 등 다른 설계는 변경하지 않습니다.

## 코드 전환 및 호환성

- 기본 `main.dart`와 `main_preview.dart` 모두 시작 화면에서 식사 방식을 선택합니다. 선택값을 주문 확인/저장까지 전달하며 재선택 버튼·테이블 입력을 제거합니다. 확인 창에 메뉴/수량/옵션과 최초 주문 방식이 표시됩니다.
- 새 API 요청은 `order_type=takeaway|dine_in`, `table_no=null`(생략도 허용)입니다. 임의의 숫자 테이블·누락/잘못된 유형·가격 입력은 검증 오류입니다. 구버전의 숫자 테이블 주문 요청은 지원하지 않으므로 동시 배포가 필요합니다.
- 서버는 저장 전에 컬럼 존재와 테이블 NULL 허용 여부를 확인합니다. 미적용 상태에는 INSERT 전에 503 `주문 유형 DB 변경이 적용되지 않았습니다. 저장하지 않았습니다.`를 반환합니다. 키오스크는 이 확정 거절에 대해 주문 수정/취소로 돌아갈 수 있습니다. 실제 통신 실패에는 같은 UUID/내용으로 재시도합니다.
- 이관 전 기존 DB 조회는 `table_no`에서 유형을 해석합니다. 컬럼 추가 후에는 명시 유형을 우선하고 아직 이관되지 않은 행만 기존 값으로 해석합니다. 기존 `order_item.option_id`와 복수 옵션 연결 조회도 유지합니다.
- 회사 관리자 신규 주문은 `포장` 또는 `매장 식사`만 표시합니다. 기존 #2의 테이블 3은 기존 정보로 표시하며 #1의 0은 포장으로 표시합니다. 불명확한 유형을 임의로 매장 식사로 표시하지 않습니다.
- UUID 충돌 비교에 명시 유형을 포함합니다. 같은 UUID/유형/품목은 기존 번호 반환, 다른 유형은 409입니다. 메뉴/옵션/매장 검증·DB 가격 계산·전체 롤백을 유지합니다.

## 검증과 실행

자동 테스트는 실제 Azure DB 연결을 차단한 SQLite 메모리 DB 또는 Mock HTTP를 사용합니다. 시작 선택 두 유형, NULL 테이블 신규 저장, 복수 옵션, 중복 클릭/UUID 재시도, 유형 충돌, 기존 #1/#2 조회 모형 및 이관 전 저장 거절을 확인합니다. `test_demo_server.py`는 메모리 스키마만 생성합니다.

이번 검증 결과: FastAPI 16개 통과. 키오스크 일반 테스트 19개, 회사 관리자 일반 테스트 16개 통과. 일반 실행에서 각각 제외한 HTTP 연동 테스트 1개는 메모리 서버를 별도 실행하여 모두 통과했습니다. 두 Flutter analyze에서 문제를 발견하지 않았습니다.

변경한 조회 함수를 실제 Azure에 읽기 전용으로 연결하여 #1(포장·2개·옵션 2개·table_no=0), #2(매장 식사·1개·옵션 2개·table_no=3)의 조회 호환성도 확인했습니다. 이 시점의 전체 주문 수는 3건입니다. 이번 작업에서는 실제 주문 생성/수정/삭제 API를 호출하지 않았습니다. 따라서 이관은 두 시연 주문만이 아니라 적용 시점의 모든 기존 주문을 사전 확인한 뒤 진행해야 합니다.

```powershell
# server: 개인 가상환경 사용, .env는 Git에 포함하지 않음
.\.venv\Scripts\python.exe -m unittest discover -v

# kiosk_app: 기본 엔트리도 시작 화면을 사용
flutter analyze
flutter test test lib/home/tests lib/service/tests
flutter run -d emulator-5554 --dart-define=MENU_API_BASE_URL=http://10.0.2.2:8001 --dart-define=ORDER_API_BASE_URL=http://10.0.2.2:8001 --dart-define=STORE_ID=1 --dart-define=DEVICE_ID=1

# company_admin_web
flutter analyze
flutter test
flutter run -d web-server --web-hostname=localhost --web-port=8080 --dart-define=ORDER_API_BASE_URL=http://127.0.0.1:8001
```

실제 신규 주문 시연은 DB 변경 승인·적용 및 서버 재시작 이후에만 가능합니다. 이전에 켜 둔 서버/앱은 자동 갱신되지 않을 수 있으므로 이번 코드 검증과 혼동하지 않습니다. main 병합·push·공용 DB 주문 추가는 수행하지 않습니다.
