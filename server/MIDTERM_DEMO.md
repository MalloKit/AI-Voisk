# 중간 시연 주문 연동

> 2026-10-10 흐름 개선: 아래 실제 시연 결과는 이전 `table_no=0/양수` 방식의 기록입니다. 현재 코드는 최초 선택한 주문 유형을 명시적으로 저장하고 신규 테이블 번호는 NULL을 사용하도록 변경했습니다. 실제 Azure 변경은 미적용이며, 적용안·현재 동작 제한은 [ORDER_TYPE_MIGRATION.md](ORDER_TYPE_MIGRATION.md)를 기준으로 확인하세요.

작업 브랜치: `integration/midterm-demo`. main에는 병합하지 않습니다. 실제 DB 주문 저장은 아래 승인된 시연 검증 범위에서만 수행했습니다.

## 동작

- `POST /orders`: 매장·기기·메뉴·옵션·수량 검증 후 한 트랜잭션으로 `orders`, `order_item`, `order_item_option` 저장.
- 가격은 DB에서 계산합니다. 요청은 ID·수량·옵션 목록만 받으며 가격 필드는 거절합니다.
- 요청의 `order_type=takeaway`이면 `table_no=0`, `dine_in`이면 테이블 번호 1 이상. 매장 식사는 직접 입력합니다.
- UUID `client_order_id`와 `device_id`로 중복 방지. 기기 행 잠금으로 동시에 온 재시도를 직렬화합니다.
- 같은 UUID의 같은 주문은 기존 주문 번호를 반환합니다. UUID는 같고 내용이 다른 요청은 409입니다.
- 키오스크는 첫 전송 내용을 고정하며 실패 재시도에도 같은 UUID를 사용합니다. 저장 중 추가 클릭과 장바구니 변경을 차단합니다.
- 서버가 저장하지 않았음을 확인한 검증 오류(403/422)는 주문 수정으로 돌아갈 수 있습니다. 통신 실패·503 등 저장 여부가 불확실한 경우에는 같은 UUID로 재시도합니다.
- `GET /admin/orders?limit=100&offset=0`: 주문 목록, 매장명·일시·테이블·수량. 페이지 크기는 최대 200입니다.
- `GET /admin/orders/{order_id}`: 메뉴·수량·복수 옵션. 기존 `order_item.option_id`와 새 옵션 테이블을 합쳐 중복 없이 조회합니다.
- 관리자 주문 화면만 API를 사용합니다. 다른 화면과 대시보드 주문 요약은 Mock이며 데이터 출처를 표시합니다.
- 관리자 API 실패 시 Mock으로 대체하지 않습니다. 목록은 새로고침 또는 화면 재진입으로 갱신합니다.
- 실제 결제·STT/TTS·AI 추천은 포함하지 않습니다.

## 실행 설정

서버 requirements 설치 후 환경 변수 또는 개인 `server/.env`에 DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD를 설정합니다.
선택 DB_SSL_CA는 TLS 인증서 경로입니다. `.env`와 값은 출력하거나 Git에 추가하지 않습니다.
현재 worktree에는 `.env`가 없습니다. 개인 설정이 준비되어야 실제 DB 연결이 됩니다.
이미 입력된 메뉴/옵션 SQL을 다시 실행할 필요는 없습니다.

서버(`server`에서):

```powershell
.\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8001
```

인증이 없는 중간 시연 서버입니다. 공인 주소·터널·리버스 프록시로 공개하지 않습니다.
주문 저장과 관리자 API는 loopback 요청만 허용합니다. 관리자 Web CORS는 localhost:8080 및 127.0.0.1:8080만 허용합니다.

Android 에뮬레이터 키오스크(`kiosk_app`에서, `<...>`는 실제 등록된 ID로 교체):

```powershell
flutter run -t lib/main_preview.dart --dart-define=MENU_API_BASE_URL=http://10.0.2.2:8001 --dart-define=ORDER_API_BASE_URL=http://10.0.2.2:8001 --dart-define=STORE_ID=<매장ID> --dart-define=DEVICE_ID=<기기ID>
```

`main_preview.dart`는 기존 포장/매장 식사 선택 흐름을 유지합니다. 기본 `main.dart`로 실행하면 주문 확인 창에서 방식을 선택할 수 있습니다.
기존 키오스크는 Android 프로젝트이며 새 플랫폼을 생성하지 않았습니다. 에뮬레이터는 10.0.2.2로 PC loopback 서버에 접근합니다.
실제 태블릿/LAN 시연은 현재 로컬 접근 정책에서 지원하지 않으며 기기 인증·HTTPS 연결이 후속 작업입니다.

회사 관리자(`company_admin_web`에서):

```powershell
flutter run -d chrome --web-hostname=localhost --web-port=8080 --dart-define=ORDER_API_BASE_URL=http://127.0.0.1:8001
```

ORDER_API_BASE_URL을 생략하면 기존 Mock 주문 화면입니다. 주소를 지정하면 실제 API 주문 화면을 사용합니다.
DB에 실제 테스트 주문을 저장하기 전 별도 승인이 필요합니다.
2026-10-10 최종 확인: 팀에서 등록한 활성 기기 `device_id=1` / `store_id=1` / `device_code=MIDTERM-DEMO-01`을 사용했습니다. 초기 준비 당시 주문 0건·활성 기기 0개 상태는 이후 등록 및 시연 검증으로 변경되었습니다.

## 실제 Azure MySQL 시연 결과 (2026-10-10)

사용자가 기존 주문 #1을 포장 시연 주문으로 포함하도록 승인했습니다. 이후 실제 Android 에뮬레이터 키오스크에서 매장 식사 주문 #2 한 건만 추가 저장했습니다. 최종 주문은 총 2건입니다.

| 주문 ID | 주문 유형 | 메뉴 / 수량 | 옵션 | table_no |
|---|---|---|---|---:|
| #1 | 포장 | 제육덮밥 2개 | 밥 추가, 계란 추가 | 0 |
| #2 | 매장 식사 | 제육덮밥 1개 | 밥 추가, 계란 추가 | 3 |

- 두 주문 모두 `store_id=1`, `device_id=1`입니다.
- `order_item`의 item_id 1·2에 각각 수량 2·1이 저장됐고, legacy `option_id`는 NULL입니다.
- `order_item_option`에서 `(1,1)`, `(1,2)`, `(2,1)`, `(2,2)` 연결을 읽기 전용 트랜잭션으로 확인했습니다.
- 키오스크에서 테이블 번호 3을 직접 입력하고 저장 버튼을 한 번 눌러 주문 #2 완료 안내를 확인했습니다.
- 회사 관리자 실제 API 주문 목록에서 2건, 각 상세에서 메뉴·수량·복수 옵션을 확인했습니다. #1의 생성 과정은 이번 에이전트 검증에 포함하지 않았습니다.
- 기존 데이터 수정·삭제 및 DB 스키마 변경은 수행하지 않았습니다. 추가 주문을 만들지 않았습니다.
- 이전 자동 검증은 FastAPI 14개, 키오스크 18개, 회사 관리자 16개 테스트 통과와 두 Flutter analyze 문제 없음입니다. 별도 메모리 서버를 사용하는 HTTP 연동 검증도 실제 DB에 기록하지 않습니다.
- Android 실행 시 APK 설치 후 DDS 디버거 연결 오류가 있었으나 앱은 실행 상태를 유지했고 실제 주문 저장·조회는 성공했습니다.

등록된 시연 기기로 재실행할 때는 위 키오스크 명령의 `STORE_ID=1`, `DEVICE_ID=1`을 사용합니다. 관리자 웹은 `-d web-server`로 실행한 뒤 `http://localhost:8080`에 접속해도 됩니다. 승인된 주문 검증은 완료됐으며 추가 실제 주문 저장에는 다시 승인이 필요합니다.

## DB에 쓰지 않는 검증

```powershell
# server
.\.venv\Scripts\python.exe -m unittest discover -v
# kiosk_app
flutter analyze
flutter test test lib/home/tests lib/service/tests
# company_admin_web
flutter analyze
flutter test
flutter build web --dart-define=ORDER_API_BASE_URL=http://127.0.0.1:8001
```

FastAPI 테스트는 외부 DB 접속을 차단하고 메모리 SQLite에서 SQL 실행·저장·롤백·조회 계약을 검증합니다.
MySQL의 실제 동시 잠금·네트워크 중단·쓰기 권한은 공용 DB 쓰기 승인 후 별도 검증 대상입니다.

실제 HTTP 연동 테스트는 별도 터미널에서 아래 순서로 실행합니다. 이 서버는 `.env`를 읽지 않으며 실제 DB 연결을 차단합니다.

```powershell
# server: 이 프로세스가 켜진 동안 메모리에만 테스트 주문이 존재합니다.
.\.venv\Scripts\python.exe test_demo_server.py
# kiosk_app: 포장 단일 옵션 1건, 매장 식사 복수 옵션 1건과 같은 UUID 재전송
flutter test test/local_order_flow_test.dart --dart-define=LOCAL_DEMO_API=http://127.0.0.1:18001
# company_admin_web: 위 두 주문 목록·상세 확인
flutter test test/local_order_flow_test.dart --dart-define=LOCAL_DEMO_API=http://127.0.0.1:18001
```

완료 후 메모리 서버를 Ctrl+C로 종료합니다. 일반 Flutter test에서는 별도 서버가 필요한 테스트 한 개씩만 건너뛰며, 위 명령으로 별도 검증합니다.

## 남은 개선 사항

- 현재 주문 유형은 table_no의 0/양수 규칙으로 해석합니다. 별도 주문 유형 컬럼은 향후 팀 DB 설계에서 결정합니다.
- 주문 당시 가격 스냅샷 컬럼이 없습니다. 첫 저장 응답에서만 DB 계산 금액을 제공하며 관리자에는 과거 매출 금액을 표시하지 않습니다.
- 메뉴/옵션 이름은 현재 등록 정보입니다. 주문 당시 표시 이름도 스냅샷이 없습니다.
- 재시도 주문은 현재 확인 창 메모리에 유지됩니다. 실패 후 앱 종료/새로고침을 하면 UUID를 잃을 수 있으므로 같은 화면에서 재시도합니다. 운영용으로는 내구성 있는 주문 대기함이 필요합니다.
- 기기 인증·회사 관리자 인증/권한·HTTPS·실제 태블릿 확인이 필요합니다. 로컬 접근 제한은 정식 인증을 대신하지 않습니다.
- 관리자 목록은 시연 규모에서 페이지들을 가져와 기존 검색/필터를 적용합니다. 운영에서는 서버 검색·필터와 커서 페이지네이션으로 확장합니다.
- 공용 DB의 기본 저장·조회 검증은 승인 후 완료했습니다. 동시 요청·통신 중단 재시도에 대한 MySQL 실검증은 별도 범위입니다. 생성한 시연 주문을 임의 삭제하지 않습니다.

## 수정·추가 파일 목록

```text
server/
  main.py
  order_service.py (추가)
  test_orders.py (추가)
  test_demo_server.py (추가)
  README.md
  MIDTERM_DEMO.md (추가)
kiosk_app/
  lib/service/data/order_repository.dart (추가)
  lib/service/screens/checkout_dialog.dart (추가)
  lib/service/screens/order_screen.dart
  lib/service/tests/button_feedback_test.dart
  lib/service/tests/cart_actions_test.dart
  lib/service/README.md
  test/checkout_test.dart (추가)
  test/local_order_flow_test.dart (추가)
  pubspec.yaml
  pubspec.lock
company_admin_web/
  lib/app.dart
  lib/data/repositories/order_repository.dart (추가)
  lib/features/orders/live_orders_page.dart (추가)
  lib/features/orders/orders_page.dart
  lib/layout/admin_shell.dart
  lib/layout/sidebar.dart
  lib/layout/top_bar.dart
  test/admin_ui_test.dart
  test/device_alert_test.dart
  test/live_orders_test.dart (추가)
  test/local_order_flow_test.dart (추가)
  README.md
  pubspec.yaml
  pubspec.lock
```

기존 admin_web, docs, ml, packages, SQL 파일과 DB 스키마는 변경하지 않았습니다. 필요한 소스·테스트·시연 문서를 통합 브랜치에서 보존합니다. 개인 환경설정·비밀번호·빌드 산출물은 포함하지 않습니다.
