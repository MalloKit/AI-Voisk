# 대시보드 실데이터 통합 (2026-10-27)

기준 커밋: 764c94a. 기존 GET API, Repository 파싱·검증과 App의 공유 useAsync 상태를 재사용합니다.
서버·DB·인증·패키지·환경변수 계약은 변경하지 않습니다.

## 데이터 출처와 집계

| 표시 | 실제 API 모드 | 명시적 Mock 모드 |
| --- | --- | --- |
| 등록 매장 | 전체 매장 목록 길이 | Mock 매장 수 |
| 점주 계정 | 전체 점주 목록 길이 | Mock 점주 수 |
| 점주 미연결 매장 | ownerId === null 건수 | Mock 미연결 매장 수 |
| 최근 7일 주문 | 기존 실제 주문 목록·기간 계산 | 기존 Mock 주문 |
| 등록 기기 | devices.length | Mock 기기 수 |
| 활성 / 비활성 기기 | is_active === true / false 건수 | 해당 지표 대신 Mock 온라인 / 오프라인 |
| 전체 등록 알림 | alerts.length | Mock 알림 수 |
| 미열람 알림 (UNREAD) | alert_status === "UNREAD" 건수 | 해당 지표 대신 Mock unconfirmed 수 |

주문·매장·점주·기기·알림 각각 실제 API 또는 Mock 출처를 표시합니다.
VITE_DEVICE_SOURCE=mock과 VITE_ALERT_SOURCE=mock은 독립적이며 한쪽만 Mock인 설정도 지원합니다.
실제 집계에 AdminSnapshot의 Mock 기기·알림을 사용하거나 동일 ID로 결합하지 않습니다.
API 실패에 따른 자동 Mock 전환은 없습니다.

활성·비활성은 주문 사용 설정이며 온라인·오프라인이 아닙니다.
last_seen_at이 NULL이거나 오래되어도 접속 상태를 판정하지 않습니다. 실제 연결 상태는 미확인으로 안내합니다.
UNREAD는 대소문자까지 일치하는 원본 상태만 집계합니다. 다른 문자열을 확인 완료나 해소로 간주하지 않습니다.
acknowledged_at과 resolved_at도 UNREAD 집계 조건에 넣지 않습니다. 확인과 장애 해소는 별도 기록입니다.
상태 설명 함수 apiAlertStatusLabel 및 기존 목록·상세 계약은 변경하지 않았습니다.

## 공유·새로고침·오류

- App의 기존 ordersResult / storesResult / ownersResult / devicesResult / alertsResult를 사용합니다.
- 대시보드에는 기존 기기·알림 상태와 실제 모드 여부만 추가 전달합니다. 별도 조회나 전역 상태를 만들지 않습니다.
- 최초 앱 진입 때 출처별 목록을 조회합니다. 화면 이동만으로 목록을 재조회하지 않습니다.
- 대시보드와 해당 관리 화면의 새로고침은 같은 reload를 호출하므로 양방향으로 결과가 반영됩니다.
- 기기 / 알림 각각 새로고침, 오류 시 다시 시도 버튼을 제공합니다. 로딩 중 해당 버튼은 비활성화합니다.
- 조회 중 / 조회 실패 / 성공한 0대·0건 / 정상 집계값을 구분합니다.
- 재조회 중이나 실패 시 이전 성공 건수를 정상값처럼 노출하지 않습니다.
- 한 API의 실패·재시도는 다른 출처의 상태나 조회 횟수에 영향을 주지 않습니다.
- 기기 목록 보기 / 알림 목록 보기 버튼은 기존 관리 화면으로 이동합니다.
- 매장·점주·주문 공유와 미연결 필터·상세 동작은 유지합니다.
- 명시적 Mock 기기의 온라인·오프라인 및 Mock 알림의 메모리 확인 처리도 유지합니다.
  Mock 알림 확인 후 대시보드 미확인 건수만 바뀌며 실제 기기 데이터와 결합하지 않습니다.

현재 목록 API는 전체 결과를 반환하며 Repository에서 total과 배열 길이를 검증합니다.
향후 서버 페이지 처리를 도입하면 전체 집계를 위해 페이지 누적 또는 별도 합계 계약이 필요합니다.
일부 페이지만 조회한 배열 길이를 전체 수로 사용하는 변경은 피해야 합니다.

## 검증 결과

| 검증 | 결과 |
| --- | --- |
| npm test | Vitest 94개 통과 (기존 79 + 새 통합 테스트 15) |
| npm run build | TypeScript 검사·Vite 빌드 성공 |
| 서버 unittest 전체 | 66개 통과 |
| Node Repository 계약 검증 | 22개 통과 |

새 테스트는 0건·활성 혼재·NULL/과거 last_seen, 정확한 UNREAD와 새로운 상태,
출처별 로딩·실패·재시도, 재조회 실패 시 이전 값 감춤, 주문 오류 독립성,
양방향 새로고침, 이동 시 중복 조회 방지, 두 혼합 모드와 Mock 확인 유지를 포함합니다.
Mock HTTP는 기존 실제 Device/Alert Repository와 파서를 통과합니다.
기존 테스트는 삭제하지 않았으며 출처 표시 기대값만 갱신했습니다.
Vitest의 Node 전용 scripts/store-contract.test.mjs 제외 설정도 유지했습니다.
기존 설치 의존성을 사용했고 패키지를 업데이트하지 않았습니다.

실행 명령:
- company_admin_web: npm test
- company_admin_web: npm run build
- company_admin_web: node --experimental-transform-types --test scripts/store-contract.test.mjs scripts/verify-owner-contract.mjs scripts/verify-device-contract.mjs scripts/verify-alert-contract.mjs
- server: python -m unittest discover -p "test_*.py" -v

서버 검증은 기존 격리 테스트와 SQLite 메모리 DB만 사용합니다.
실제 Azure DB에는 접속·쓰기·스키마 변경을 하지 않았습니다.

## 노트북 및 실제 Azure 읽기 검증

1. 로컬 FastAPI를 실행하여 실제 기기 목록과 등록·활성·비활성 합계가 일치하는지 확인합니다.
2. 실제 알림 전체 수와 정확히 UNREAD인 수를 목록 원본 상태와 비교합니다. 예시 숫자를 고정 기대값으로 삼지 않습니다.
3. 대시보드와 두 관리 화면을 오가며 Network에서 최초 한 번 조회, 새로고침 시 해당 API만 호출되는지 확인합니다.
4. 출처별 요청 차단과 재시도로 다른 지표 유지, 오류와 0건 구분을 확인합니다.
5. 기기만 Mock / 알림만 Mock / 모두 Mock / 모두 실제 설정에서 출처와 시연 기능을 확인합니다.
6. 실제 last_seen 기록과 활성 상태가 온라인·오프라인 수로 표시되지 않는지 확인합니다.

## 후속 기능에 필요한 결정

- 실시간 접속 판정: 기기 인증, 하트비트 수집 주체·주기·시간 기준·유예 정책 합의.
- 기기 등록·활성화·매장 변경: 관리자 인증·권한, 기기 인증, 중복·동시성, 주문 재시도와 소속 변경 정책.
- 알림 확인·해소: 원본 상태값과 의미 확정, 별도 전이 규칙·권한·확인자·해소자·감사 이력·중복 요청 처리.
- 자동 장애 생성: 실제 관측 근거, 발생·해소 기록, 중복 방지·재발·보존 정책.
- 이번 단계에는 DB 쓰기, 새 API, 하트비트, 온라인 판정, 실제 알림 확인·해소를 구현하지 않았습니다.
