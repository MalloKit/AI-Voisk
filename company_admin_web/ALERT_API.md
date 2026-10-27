# 장애·알림 목록·상세 조회 (2026-10-27)

기준 커밋: 50f33bc. 사용자가 확인해 제공한 device_alert 스키마를 사용합니다.
운영 DB에는 접속하거나 데이터를 생성·수정·삭제하지 않았습니다.

## GET API
- /admin/alerts → {alerts: AdminAlertView[], total: number}
- /admin/alerts/{alert_id} → AdminAlertView
- 정렬: occurred_at DESC, alert_id DESC.
- 정상 0건은 alerts=[], total=0. 없는 상세는 404, 잘못된 ID는 422.
- DB 내부 오류는 접속 정보·SQL 원문을 제외한 503으로 반환합니다.
- 기존 /admin/ 로컬 접근 제한을 유지합니다. 정식 인증을 대신하지 않으므로 외부 공개용이 아닙니다.

필드:
alert_id, device_id, device_code, store_id, store_name,
alert_type, severity, message, alert_status,
occurred_at, acknowledged_at, acknowledged_by, acknowledged_by_name, resolved_at.

device_alert → kiosk_device → store를 JOIN하고 확인자 이름만 admin에 LEFT JOIN합니다.
확인자 ID·이름이 없어도 알림을 누락시키지 않습니다. 확인자 ID가 있으나 이름이 없으면 ID를 유지합니다.
연결 매장은 조회 시점의 기기 소속입니다. 발생 당시 매장의 스냅샷 컬럼을 가정하지 않습니다.

SQL과 응답은 모두 명시적 필드 목록을 사용합니다.
device_token_hash·관리자/점주 비밀번호 등 인증 필드는 SELECT·응답·프론트 모델·로그에 포함하지 않습니다.
기존 주문·매장·점주·기기 API 계약과 서비스는 변경하지 않습니다.

## 원본 문자열·확인·해소
alert_type, severity, alert_status는 문자열이며 임의 ENUM으로 제한하지 않습니다.
원본 값을 대소문자 변환 없이 반환하고 새로운 값도 그대로 표시·필터링합니다.
확인된 기본 상태 UNREAD만 읽지 않음 (UNREAD)으로 설명하며 나머지 값의 의미를 추측하지 않습니다.
acknowledged_at/acknowledged_by와 resolved_at은 별개 기록입니다.
NULL은 그대로 전달하고 상세에서 기록 없음으로 표시합니다. 상태 문자열로 날짜를 만들거나 해소 여부를 추론하지 않습니다.
상태 기본값이 UNREAD라는 스키마 정보만으로 현재 운영 데이터의 전체 허용값을 단정하지 않습니다.

## 시간대·읽기 전용
각 조회 연결에 SET time_zone = '+00:00'를 명시한 후 START TRANSACTION READ ONLY로 조회합니다.
사용자가 확인한 TIMESTAMP 값을 해당 세션에서 읽고 오프셋이 있는 ISO 8601(+00:00)로 반환합니다.
기존 데이터가 이미 UTC 문자열이라고 가정하지 않습니다. 글로벌 설정·저장 데이터는 변경하지 않습니다.
브라우저는 오프셋을 해석해 현지 시간으로 표시하며 오프셋 없는 응답은 파서가 거부합니다.
성공·실패 모두 rollback/close로 연결을 정리합니다.

## 화면·상태 공유
실제 ApiAlert는 정수 alert_id 모델로 문자열 ID의 Mock DeviceAlert와 분리합니다.
실제 목록·상세는 API JOIN 결과만 받고 Mock 스냅샷·기기·매장을 참조하지 않습니다.
알림 본문은 React 텍스트로 렌더링하고 HTML로 해석하지 않습니다.

기능:
- ID·기기 ID·코드·매장명 검색
- 실제 값에서 생성한 유형·심각도·원본 상태 필터와 초기화
- 최신 시각·동일 시각 ID 내림차순 정렬, 기존 표 페이지 처리
- 별도 상세 API와 목록/상세 로딩·실패·재시도
- 정상 0건: 등록된 장애·알림이 없습니다
- 필터 결과 0건과 조회 실패를 정상 빈 목록과 구분
- 목록 새로고침, App의 독립 useAsync 상태로 페이지 이동 시 중복 목록 호출 방지

실제 모드에는 확인 완료로 표시 버튼, 알림 쓰기 요청, 자동 감지가 없습니다.
Mock 시연은 VITE_ALERT_SOURCE=mock으로 명시하며 기존 메모리 확인 처리를 그 모드에만 유지합니다.
VITE_ALERT_API_BASE_URL은 공개 서버 주소이고, 생략 시 주문 API 주소, 이후 localhost:8001을 사용합니다.
실제 API 실패에 따른 Mock 자동 전환은 없습니다.

대시보드는 같은 실제 알림 목록으로 전체 수와 정확히 alert_status === "UNREAD"인 수를 집계합니다. 다른 상태에서 확인·해소 여부를 추론하지 않습니다. 출처별 명시적 Mock 설정은 유지합니다. 자세한 동작은 [DASHBOARD_DATA.md](DASHBOARD_DATA.md)를 참조합니다.
실제 기기 상세의 알림 조회 미연동 안내도 유지합니다. 기기별 실제 관련 알림 연결은 후속 범위입니다.
알림 실패는 주문·매장·점주·기기 조회 상태를 실패시키지 않습니다.

## 현재 목록 규모와 향후 페이지 처리
이번 전시 규모에서는 전체 목록을 한 번 조회하며 total은 반환 배열 길이입니다. 결과를 임의로 잘라 반환하지 않습니다.
브라우저 표의 페이지 처리는 UI 표시용이며 DB 페이지 조회와 다릅니다.
데이터 증가 시 검색·필터를 서버로 이동하고 (occurred_at, alert_id) 복합 정렬 기준의 커서 페이지 처리를 권장합니다.
후속 응답에는 next_cursor/has_more 등의 계약을 정의하고 Repository의 현재 전체 건수 검증·누적 방식도 함께 변경해야 합니다.
새 알림 삽입 중에도 중복·누락 없는지 검증하고 필요한 인덱스는 실제 기존 정의 확인 후 별도 승인받습니다.
전체 데이터의 유형·상태 필터 선택지 제공 방식도 함께 결정합니다. 이번에는 페이지 API·인덱스·DDL을 추가하지 않았습니다.

## 자동 검증
| 항목 | 결과 |
| --- | --- |
| Vitest | 전체 79개 통과: 기존 71 + 신규 8 |
| FastAPI 전체 unittest | 66개 통과: 기존 52 + 신규 14 |
| Node Repository 계약 검증 | 22개 통과: 기존 16 + 신규 6 |
| TypeScript 검사·Vite 빌드 | 성공 |

설치된 기존 잠금 의존성과 작업 폴더의 격리 Python 의존성을 재사용했습니다. 패키지 업데이트·잠금 파일 변경은 없습니다.
서버 검증은 메모리 SQLite와 Mock HTTP를 사용하고 운영 DB 연결을 차단합니다.
Fixture 생성·수정 SQL은 메모리 DB에만 적용합니다.
검증 범위: 0·1·복수 알림, 여러 기기·매장, 새 문자열값, 원본 보존, NULL, 확인/해소 분리,
정렬, 404, 오류·재시도·새로고침, 검색/필터/초기화, Mock 혼합 방지, HTML 텍스트 처리,
UTC/오프셋, 비밀 비노출, 쓰기 경로·확인 버튼 부재, 기존 기능 회귀.

실행:
- npm test
- npm run build
- node --experimental-transform-types --test scripts/store-contract.test.mjs scripts/verify-owner-contract.mjs scripts/verify-device-contract.mjs scripts/verify-alert-contract.mjs
- server: python -m unittest discover -p "test_*.py" -v

Node 전용 verify-alert-contract.mjs는 Vitest 자동 수집 이름을 사용하지 않습니다.
기존 store-contract.test.mjs의 Vitest 제외 설정은 유지합니다.

## Azure에서 남은 읽기 전용 확인
1. 서버 재시작 후 실제 목록/상세, 연결 기기·매장·확인자 정보 대조.
2. 실제 원본 유형·심각도·상태값 전체와 표시 확인. 새 값 때문에 조회가 실패하지 않는지 점검.
3. 실제 0건은 그대로 확인하며 화면 검증용 가짜 알림을 만들지 않음.
4. Workbench 세션 시간대와 API의 UTC 조회 세션을 구분해 같은 순간인지 비교.
5. NULL 확인/해소 기록과 양쪽 기록이 모두 있는 사례, 확인자 이름 누락 사례 표시 점검.
6. 실제 응답의 인증 필드 부재와 조회 권한·성능 확인.
7. 기존 알림을 생성·갱신하는 주체는 별도로 확인. 이번 작업은 이벤트를 생성하지 않음.

## 후속 쓰기 정책
관리자 인증·권한, 확인의 의미·허용 상태·반복 요청의 멱등성, 확인 관리자 감사 이력을 먼저 정합니다.
장애 해소는 수동/자동 주체와 판정 근거, 재발·중복·동시 수정 정책을 별도로 결정합니다.
확인과 해소를 단일 상태로 덮어쓰지 않도록 상태 전환 규칙과 각 기록의 관계를 합의합니다.
하트비트·자동 장애 감지·알림 생성·확인·해소·삭제 API와 DB 변경은 이번 범위에 없습니다.

## 변경 파일
서버: main.py, alert_service.py, test_alert_service.py, test_alerts.py.
프론트: App.tsx, data/models.ts, data/alertRepository.ts, features/AlertsPage.tsx,
layout/AdminShell.tsx, .env.example(공개 설정만).
기존 테스트: app, dashboard-live, dashboard-sources, order-filters, owners-live, stores-live, devices-live에 alertRepository=null을 명시.
신규: src/test/alerts-live.test.tsx, scripts/verify-alert-contract.mjs.
문서: README.md, ALERT_API.md.
