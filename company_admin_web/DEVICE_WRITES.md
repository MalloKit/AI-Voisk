# 기기 등록·활성화 관리

회사 관리자 A안만 구현합니다. 기기 코드 수정·소속 매장 변경·삭제·기기 인증·하트비트·원격 제어는 제공하지 않습니다.
실제 Azure 데이터·스키마·ERD·엑셀과 키오스크 앱은 변경하지 않았습니다.

## 스키마 근거

사용자가 Workbench에서 확인한 kiosk_device InnoDB 정의를 사용합니다.
device_id INT PK AUTO_INCREMENT, device_code VARCHAR(50) NOT NULL UNIQUE(utf8mb4_0900_ai_ci),
store_id INT NOT NULL FK. store_id는 비고유이므로 한 매장에 여러 기기를 등록할 수 있습니다.
is_active DEFAULT 1이지만 이번 등록 API는 반드시 명시적으로 0을 INSERT합니다.
current_menu_version은 NOT NULL DEFAULT 0이며 사용자가 입력하지 않습니다.
registered_at은 DB CURRENT_TIMESTAMP 기본값을 사용합니다.
앱 버전·마지막 확인·동기화·인증 해시는 DB의 NULL 기본값을 사용하며 생성·입력·노출하지 않습니다.
이 구현에서 Azure에 직접 접속해 DDL을 재확인한 것은 아닙니다.

## API

- POST /admin/devices
  - 요청: device_code, store_id 두 필드만 허용.
  - 코드: ASCII 영문 대·소문자·숫자·하이픈·밑줄 1~50자. 공백과 기타 문자 거부. 입력 대소문자를 보존합니다.
  - 매장 ID: Boolean·문자열이 아닌 양의 INT(최대 2147483647), 실제 존재 확인.
  - INSERT(device_code, store_id, is_active) VALUES(..., ..., 0).
  - 생성 ID·영향 행 수·공개 상세를 확인하고 COMMIT. 실패 시 ROLLBACK.
  - 성공 201 + 기존 AdminDeviceView. 중복 코드는 DB UNIQUE가 최종 검사하며 409.
  - 없는 매장 404, FK 충돌 409, 입력 오류 422, DB 오류·결과 불명확 503.
- PATCH /admin/devices/{device_id}/status
  - 요청: is_active, expected_is_active 필수 Strict Boolean. 숫자·문자열·추가 필드 금지.
  - 기기 행 FOR UPDATE → 존재 검사 → 기대 상태 비교(불일치 409) → 같은 목표면 UPDATE 생략.
  - 바뀔 때 is_active만 갱신하고 영향 행 수·공개 상세 확인 후 COMMIT.
  - 성공 200 + 기존 AdminDeviceView. 없는 기기 404, 잘못된 입력 422, DB 오류 503.
  - 기기 코드·매장·등록/관측 시각·메뉴 버전·앱 버전·인증 정보는 수정하지 않습니다.

두 API는 기존 로컬 IP 제한·관리자 서버 세션·company_admin 역할·Origin·CSRF 검사를 그대로 사용합니다.
기존 CORS가 POST/PATCH와 credentials를 허용하므로 변경하지 않았습니다.
검증 응답은 원본 입력을 반사하지 않고 DB 오류·SQL·인증정보를 숨깁니다. 쓰기 요청은 자동 재시도하지 않습니다.
모든 값은 파라미터 바인딩합니다. 공개 상세 SELECT와 응답에서 device_token_hash는 제외합니다.
새 쓰기 연결도 UTC 세션을 명시하여 기존 오프셋 포함 시각 계약을 유지합니다.

## 주문 호환성

order_service.py는 변경하지 않습니다. 상태 변경은 주문 처리와 같은 기기 행을 먼저 잠급니다.
주문이 먼저 잠금을 얻었다면 이미 진행 중인 주문이 완료된 뒤 비활성화될 수 있습니다.
비활성화는 주문 취소가 아닙니다. 신규 주문은 422지만, 이미 저장된 동일 UUID·동일 내용 재시도는 허용합니다.
UUID 내용 충돌은 409, 기기 소속 매장 불일치는 UUID 검사 전 422라는 기존 순서를 유지합니다.
상태 변경은 온라인·오프라인 판정이나 실제 기기 인증이 아닙니다.
expected_is_active는 현재 값 비교이며 상태가 변경됐다 원래 값으로 돌아온 이력까지 감지하는 버전 번호가 아닙니다.

## 관리자 UI

- 실제 storesResult를 사용하는 등록 모달. 기기가 없는 매장도 선택할 수 있습니다.
- 실제 매장 조회 오류는 오류·재시도를 표시하며 Mock 매장으로 대체하지 않습니다.
- Mock 기기 모드 또는 실제 기기+Mock 매장 모드에서는 실제 등록 버튼을 제공하지 않습니다.
- 상세 GET의 실제 상태로 활성화/비활성화 확인 폼을 엽니다. 확인 전 요청하지 않습니다.
- 저장 중 중복 제출·취소·Escape·배경 닫기를 차단합니다.
- 충돌 후 오래된 상태로 재저장하지 않습니다. 취소하면 상세를 새로 조회합니다.
- 성공 후 devicesResult만 새로 조회하고 상세도 갱신합니다. 대시보드는 공유 결과를 사용합니다.
- 주문·매장·점주·알림을 불필요하게 재조회하지 않습니다. 기존 검색·필터·새로고침을 유지합니다.
- 연결 상태는 미확인이며 last_seen_at이나 is_active로 온라인 여부를 추정하지 않습니다.

## 검증 범위와 후속 확인

서버는 실제 Azure 연결을 차단한 SQLite 메모리 DB, 프론트는 Mock HTTP와 실제 Repository를 사용합니다.
테스트의 SQLite NOCASE는 ASCII 대소문자 중복만 재현하며 실제 MySQL utf8mb4_0900_ai_ci 전체 동등성이나
FOR UPDATE·교착·동시 트랜잭션을 검증한 결과가 아닙니다.

별도 격리 MySQL에서 코드 동시 INSERT·Collation·FK·기본값·잠금 대기와 롤백을 검증해야 합니다.
주문과 상태 변경이 동시에 같은 기기 행을 잡는 경우, 두 관리자 상태 변경의 직렬화도 확인해야 합니다.
실제 Azure 등록·상태 변경은 별도 승인 후 사용자가 검증합니다.
생성된 device_id와 선택한 store_id는 키오스크 실행 설정에 별도 반영해야 합니다. 기기 코드만으로 인증하지 않습니다.

## 이번 검증 결과

- FastAPI 전체 136개 통과: 기존 125개와 신규 기기 쓰기 11개.
- Vitest 전체 298개 통과: 기존 284개와 신규 기기 쓰기 14개.
- Node 계약 테스트 22개 통과. TypeScript 검사·Vite 빌드 성공.
- Chrome 1440/1024/768/390px에서 실제 관리자 세션·CSRF·HTTP·메모리 SQLite로
  등록·대소문자 중복 409·활성화·비활성화·목록/상세/대시보드 갱신·로그아웃 확인.
- 네 화면 폭 모두 모달 및 하단 버튼이 뷰포트 안에 있고 페이지 가로 넘침 없음.
- 기기 저장 후 매장·점주·주문·알림 목록 추가 조회 없음. 브라우저 runtime 오류 0건.
- SQLite가 제거한 FOR UPDATE와 실제 MySQL 동시성은 별도 미검증입니다.
