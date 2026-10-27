# 기기 목록·상세 실데이터 조회 (2026-10-27)

기준 커밋: 04e1e02. 실제 스키마는 사용자가 MySQL Workbench에서 확인해 제공한 컬럼을 근거로 합니다.
기존 kiosk_device·store만 조회하며 신규 테이블·마이그레이션·운영 데이터 변경은 없습니다.
정확한 이름과 기능이 미확인인 메뉴 버전 컬럼은 사용하지 않습니다.

## API
- GET /admin/devices → {devices: AdminDeviceView[], total: number}. 전체 목록을 device_id 순으로 반환합니다.
- GET /admin/devices/{device_id} → AdminDeviceView. 없는 기기 404, 잘못된 ID 422, DB 오류는 비밀이 없는 503.
- 기존 /admin/ 로컬 접근 제한을 그대로 적용하며 정식 관리자 인증을 대신하지 않습니다.
- SELECT는 명시적 컬럼만 사용합니다. device_token_hash는 SELECT·응답·프론트 모델·로그에 포함하지 않습니다.
- SQL과 응답 모두 명시적으로 필드를 선택합니다. 인증 필드나 임의 추가 컬럼을 전달하지 않습니다.
- 저장된 값의 형식이 맞지 않으면 오류를 표시하며 임의 값으로 보정하지 않습니다.

응답 필드:
device_id(정수), device_code, store_id(정수), store_name,
store_address, store_address_detail(nullable), is_active(boolean),
registered_at, app_version(nullable), last_seen_at(nullable), last_synced_at(nullable).

기기와 실제 매장을 JOIN합니다. 매장 주소는 store_add1/store_add2이며 실제 기기 설치 위치를 새로 가정하지 않습니다.
기기 0건은 정상적인 devices=[], total=0입니다. 한 매장의 여러 기기도 별개 ID로 유지합니다.

## 읽기 전용 및 시각 처리
각 조회 연결에서 SET time_zone = '+00:00' 후 START TRANSACTION READ ONLY로 조회합니다.
사용자가 확인한 시각 컬럼은 TIMESTAMP이므로 MySQL이 조회 세션 시간대에 맞게 반환합니다.
조회 결과가 이미 UTC라고 가정하는 대신 조회 세션을 명시적으로 UTC로 설정합니다.
그 뒤 Python datetime을 오프셋이 있는 ISO 8601 문자열(+00:00)로 반환합니다.
이는 연결 세션 설정이며 글로벌 시간대·스키마·저장 데이터는 변경하지 않습니다.
성공·실패 모두 rollback/close로 정리합니다.

브라우저는 오프셋을 해석해 현지 시간으로 표시합니다. 오프셋 없는 시각 문자열은 파서가 거부합니다.
마지막 확인·동기화의 NULL과 앱 버전 NULL은 API에서 그대로 유지하고 화면에서 미수집으로 표시합니다.
registered_at은 필수 시각이며 누락을 현재 시각 등으로 채우지 않습니다.

MySQL TIMESTAMP의 세션 시간대 변환 근거:
https://docs.oracle.com/cd/E17952_01/mysql-8.4-en/time-zone-support.html

## 화면·상태·공유
- ApiDevice는 기존 문자열 ID의 Mock Device와 분리된 정수 device_id 모델입니다.
- 실제 기기 ID·코드 검색, 실제 매장 필터, 활성/비활성 필터, 새로고침·초기화를 제공합니다.
- 상세는 별도 GET을 사용하고 실제 JOIN 매장 정보만 받습니다. Mock AdminSnapshot을 받지 않습니다.
- 상세 로딩·실패·재시도도 목록과 별개입니다. 조회 실패는 정상 0건이나 Mock 목록으로 대체하지 않습니다.
- App의 독립된 useAsync 상태를 사용하므로 화면 이동만으로 목록을 재조회하지 않습니다.
- is_active는 활성/비활성이며 온라인 여부가 아닙니다. 연결 상태는 항상 미확인입니다.
- last_seen_at은 마지막 확인 시각(DB 기록)으로 표시합니다. 갱신 주체가 미확인이라 온라인 판정에 쓰지 않습니다.
- 실제 상세에는 알림 조회 미연동을 표시하며 device_alert나 Mock 알림을 조회·연결하지 않습니다.
- 대시보드는 같은 기기 목록으로 등록·활성·비활성 수를 표시합니다. 실제 온라인·오프라인은 판정하지 않습니다. 알림 요약도 실제 알림 목록을 공유합니다. 출처별 명시적 Mock 설정은 유지합니다. 자세한 동작은 [DASHBOARD_DATA.md](DASHBOARD_DATA.md)를 참조합니다.
- VITE_DEVICE_SOURCE=mock을 명시하면 기존 문자열 기기·온라인/오프라인 필터·Mock 알림 상세를 유지합니다.
- VITE_DEVICE_API_BASE_URL은 공개 주소이며 생략 시 주문 API 주소, 이후 http://127.0.0.1:8001을 사용합니다.
- API 실패에 따른 자동 Mock 전환은 없습니다. 환경변수에 인증 비밀을 넣지 않습니다.

## 검증 결과
| 항목 | 결과 |
| --- | --- |
| npm ci | 성공. 패키지 정의와 잠금 파일 변경 없음 |
| npm test | 71개 전체 통과: 기존 63개 + 신규 8개 |
| npm run build | TypeScript 검사·Vite 빌드 성공 |
| 서버 전체 unittest | 52개 전체 통과: 기존 39개 + 신규 13개 |
| Node Repository 계약 검증 | 16개 전체 통과: 기존 10개 + 신규 6개 |
| Python AST 검사 | 16개 파일 통과 |

처음 Python 설치는 기본 임시 폴더 권한 오류로 실패했습니다.
Work 작업 폴더의 격리된 임시/의존성 경로를 사용해 requirements 설치와 전체 검증을 완료했습니다.
기존 주문 저장·매장·점주 API 및 키오스크 계약 회귀 테스트도 서버 전체 검증에 포함됩니다.
서버 테스트는 메모리 SQLite/Mock HTTP를 사용하며 실제 Azure 연결을 차단합니다.
SQLite의 생성·수정 SQL은 테스트 픽스처에만 사용하고 실제 DB에는 실행하지 않습니다.

신규 테스트는 0·1·복수 기기, 동일/다른 매장, 활성/비활성, NULL, 404, 오류·재시도·새로고침,
검색·필터·초기화, Mock 혼합 방지, 인증 필드 비노출, 시각 오프셋·취소·타임아웃을 검증합니다.
Vitest의 기존 Node 전용 파일 제외 설정은 그대로 유지합니다.
새 Node 검증 파일 verify-device-contract.mjs는 *.test.* 이름을 사용하지 않습니다.

명령:
- npm test
- npm run build
- node --experimental-transform-types --test scripts/store-contract.test.mjs scripts/verify-owner-contract.mjs scripts/verify-device-contract.mjs
- server에서 python -m unittest discover -p "test_*.py" -v

## 기존 보안 진단
npm audit에서 높은 심각도 1건은 개발 의존성 jsdom@30.1.2 → undici@8.11.2 경로입니다.
관련 권고는 GHSA-xjj6-f33q-929c 등이며 audit가 제시한 수정 범위는 undici 8.12.2 이상입니다.
npm audit --omit=dev는 취약점 0건입니다. 개발 의존성이므로 영향이 없다고 단정하지는 않습니다.
이번 기기 조회 작업에서 npm audit fix나 패키지 업데이트를 실행하지 않았습니다.

## 실제 Azure에서 추가 확인
이번 Work에서는 운영 DB에 접속하거나 데이터를 변경하지 않았습니다.
1. 로컬 서버 재시작 후 실제 기기 0건/등록 기기의 목록·상세 및 매장 관계를 읽기 전용으로 확인.
2. Workbench 세션 시간대와 API 조회 세션의 +00:00 차이를 감안해 같은 순간인지 대조.
3. 한국 시간 등 브라우저 현지 시간 표시와 NULL의 미수집 표시 확인.
4. 실제 데이터에서 기존 앱 버전·등록 시각·마지막 확인·동기화 기록 확인. 기록을 만들기 위한 쓰기는 하지 않음.
5. last_seen_at/last_synced_at 갱신 주체는 별도로 확인. 값이 최근이어도 온라인으로 표시하지 않음.
6. 실제 응답에 인증 필드가 없고, 상세에 Mock 매장·알림이 섞이지 않는지 확인.

## 후속 단계
기기 등록·삭제·활성화 변경·매장 변경·토큰 발급·하트비트·알림 쓰기는 구현하지 않았습니다.
- 등록/활성화: 관리자 인증·권한, 코드 중복/필수값 검증, 감사 이력.
- 상태/매장 변경: 기존 주문의 기기 행 잠금·UUID 재시도 순서를 유지하는 트랜잭션과 동시성 정책.
- 기기 인증: 실제 장비와 정수 ID를 검증하는 별도 정책. 기기 코드만으로 인증하지 않을 것.
- 알림: 기존 device_alert 스키마 재사용, 상태 수집·발생·해소·확인·중복 방지 정책을 합의한 후 연동.

## 변경 파일
서버: main.py, device_service.py, test_device_service.py, test_devices.py.
프론트: App.tsx, data/models.ts, data/deviceRepository.ts, features/DevicesPage.tsx,
features/details.tsx, layout/AdminShell.tsx, .env.example(공개 설정만).
기존 테스트: app, dashboard-live, dashboard-sources, order-filters, owners-live, stores-live에 deviceRepository=null을 명시해 기존 시연 테스트를 격리.
신규 검증: src/test/devices-live.test.tsx, scripts/verify-device-contract.mjs.
문서: README.md, DEVICE_API.md.
