# 회사 관리자 인증 (2026-10-27)

기준: 61caebe535c94b07b6aee03140c652956bf62d3e 이후 인증 연결.
회사 관리자 전용입니다. 점주 로그인·기기 인증·등록/수정 API는 추가하지 않습니다.
실제 Azure DB의 데이터·비밀번호·스키마를 변경하지 않았습니다.

## API 계약

| 메서드 | 경로 | 동작 |
| --- | --- | --- |
| GET | /auth/admin/csrf | 5분짜리 익명 세션 또는 현재 세션에 바인딩된 CSRF 토큰 |
| POST | /auth/admin/login | 정수 admin_id와 password 검증, 성공 시 세션·CSRF 교체 |
| GET | /auth/admin/me | 서버 세션의 관리자 ID·이름·company_admin 역할 확인 |
| POST | /auth/admin/logout | 현재 세션 폐기, 쿠키 삭제, 204 반환 |

로그인 요청은 admin_id(1~2147483647 정수), password(1~1024자)만 허용합니다.
클라이언트가 보낸 역할은 받지 않으며 다른 필드는 422입니다.
로그인·me 성공 응답: admin 객체의 admin_id, admin_name, role.
세션 ID와 비밀번호 해시는 JSON에 포함하지 않습니다.

- 로그인·로그아웃은 허용된 Origin과 현재 쿠키에 바인딩된 X-CSRF-Token을 모두 요구합니다.
- GET csrf를 먼저 호출한 뒤 받은 토큰을 POST 헤더에 넣습니다. 로그인 성공 시 이전 토큰은 무효입니다.
- 로그아웃 전에는 GET csrf로 현재 세션의 토큰을 다시 받습니다.
- 모든 인증·관리자 응답은 Cache-Control: no-store로 처리합니다.
- 누락·잘못된·만료 쿠키는 401, 잘못된 역할·Origin·CSRF는 403입니다.
- 잘못된 ID·비밀번호·비활성 저장값은 동일한 401 메시지를 반환합니다.
- 로그인 시도는 접속 주소별 60초당 최대 5회, 초과 시 429와 Retry-After: 60입니다.
- DB/용량 오류는 내부 SQL·접속 설정을 포함하지 않는 503입니다.
- 인증 입력 검증은 원래 요청 본문을 반사하지 않는 일반 422 응답입니다. 인증 POST 본문 크기도 제한합니다.

## 기존 admin 테이블과 해시

추가 테이블·컬럼·마이그레이션은 없습니다.
인증 전용 함수만 읽기 전용 트랜잭션에서 다음 필드를 명시적으로 조회합니다.

SELECT admin_id, admin_nm, admin_pw FROM admin WHERE admin_id = %s

admin_pw는 인증 함수 안에서만 검증하고 일반 조회 응답·세션·로그에 넣지 않습니다.
own_pw나 device_token_hash는 조회하지 않습니다.

새 직접 의존성은 argon2-cffi==25.1.0 하나이며 Argon2id 검증에 필요합니다.
평문 비교·비활성 테스트값 로그인·기본 비밀번호·실패 시 우회는 없습니다.
현재 검증 정책은 Argon2id v19, 메모리 19456~262144KiB, time_cost 2~10,
parallelism 1~8, salt 16바이트 이상, hash 32바이트 이상입니다.
권장 초기 설정은 라이브러리 PasswordHasher 기본값(Argon2id, 65536KiB, time_cost 3, parallelism 4)입니다.
잘못된 형식·알 수 없는 ID에도 임의 생성한 더미 해시를 검증해 빠른 실패 차이를 줄입니다.
로그인 과정에서 자동 재해시나 DB UPDATE를 수행하지 않습니다.

실제 비활성 값의 내용은 읽거나 출력하지 않았습니다.
현재 운영 계정에 안전한 해시를 적용하기 전의 로그인 성공을 보장하지 않습니다.

## 세션 저장과 수명

- 서버 프로세스 메모리에만 저장합니다. Redis나 DB 세션 테이블을 만들지 않습니다.
- 32바이트 난수 세션 ID를 HttpOnly 쿠키에 넣고, 서버 인덱스에는 그 ID의 SHA-256 검증값을 보관합니다.
- 서버 레코드는 관리자 ID·이름·역할, CSRF, 생성·마지막 활동 시각만 보관합니다.
- 인증 세션은 비활동 30분, 절대 수명 8시간입니다.
- 실제 관리자 API 요청은 활동 시각을 갱신합니다. me의 주기적 확인만으로는 비활동 만료가 연장되지 않습니다.
- 익명 CSRF 세션은 5분이며 전체 세션은 최대 256개로 제한합니다.
- 만료 시 제거하며 로그인 성공 시 이전 세션을 폐기합니다. 로그아웃한 쿠키를 재사용할 수 없습니다.
- 재시작·개발 reload 시 모든 세션이 사라집니다.
- 반드시 worker 1개 / 서버 프로세스 1개로 실행해야 합니다.
- 로그인 제한도 프로세스 메모리 기준입니다. 다중 worker 또는 외부 공개 서비스 구성은 지원 범위가 아닙니다.
- 동일 계정의 다른 브라우저 세션까지 한 번의 로그아웃으로 모두 폐기하지는 않습니다.
- 수동 비밀번호 변경 시에는 서버를 중지·재시작하여 기존 세션을 모두 폐기해야 합니다.

## 개발 HTTP와 HTTPS 설정

환경 설정은 server/.env 또는 프로세스 환경에 둡니다. 비밀값을 Git에 올리지 않습니다.

| 설정 | local 기본 모드 | https 모드 |
| --- | --- | --- |
| ADMIN_AUTH_MODE | local | https |
| ADMIN_AUTH_ALLOWED_ORIGINS | http://localhost:8080,http://127.0.0.1:8080 | 명시한 HTTPS 출처 필수 |
| 쿠키 이름 | voisk_admin_local | __Host-voisk_admin |
| HttpOnly / SameSite / Path | true / Strict / / | true / Strict / / |
| Secure | false: 통제된 로컬 개발 HTTP만 | true |
| 쿠키 Domain | 지정하지 않음 | 지정하지 않음 |

local 모드는 HTTP 요청과 HTTP 출처만 허용하며 호스트는 localhost·127.0.0.1·::1로 제한합니다.
HTTPS 요청을 local 모드로 받아 Secure 없는 쿠키를 발급하지 않도록 거부합니다.
https 모드는 HTTPS 출처와 서버가 인식하는 HTTPS 요청을 요구하며 HTTP 요청은 거부합니다.
별표·사용자 정보·경로·쿼리를 포함한 출처는 허용하지 않습니다.
HTTPS 모드를 선택하는 것만으로 인증서나 외부 배포가 구성되지는 않습니다.

현재 네트워크 제한은 그대로입니다. /admin/*, /auth/admin/*, /orders는 loopback 요청만 허용합니다.
기존 testclient 허용도 유지하지만 관리자 세션 검사는 생략하지 않습니다.
HTTPS 설정 역시 외부 IP의 관리자 접근을 자동 허용하지 않습니다.
프록시·LAN·인터넷 공개는 별도 검토 대상이며 X-Forwarded-For를 임의로 신뢰하도록 변경하지 않았습니다.

CORS는 정확한 허용 출처, credentials=True, GET/POST/PATCH, Content-Type/X-CSRF-Token을 사용합니다.
CORS를 인증이나 CSRF 토큰의 대체로 취급하지 않습니다.
인증 실패 응답에도 CORS가 적용되고 preflight OPTIONS는 세션 없이 처리할 수 있습니다.

브라우저는 credentials: include로 요청합니다.
개발 UI가 localhost일 때는 로컬 API의 127.0.0.1 별칭을 localhost로 맞추고 반대 경우도 맞춥니다.
실제 API와 UI는 SameSite 쿠키가 동작하는 같은 사이트 구성을 사용해야 합니다.
서로 다른 사이트의 프론트·API를 배포하는 설정은 이번 범위에 포함하지 않습니다.

실행:
python -m pip install -r requirements.txt
python -m uvicorn main:app --host 127.0.0.1 --port 8001 --workers 1

## 프론트엔드 연결

- AppEntry가 me를 확인한 뒤에만 기존 App을 마운트합니다. /login 직접 접근도 서버 세션을 확인합니다.
- 로그인 성공은 서버의 정상 관리자 응답으로만 결정합니다.
- 비밀번호·인증 토큰·가짜 로그인 상태를 localStorage/sessionStorage에 저장하지 않습니다.
- 로그아웃 시 즉시 App을 내려 목록·필터·상세·진행 중 조회를 폐기합니다.
- 서버 로그아웃 실패 시 완료라고 표시하지 않고 화면을 숨긴 채 재시도를 제공합니다.
- 관리자 조회 401, 60초 주기 me, 창 포커스/가시성 복귀 확인으로 만료를 처리합니다.
- 403과 데이터 API의 DB 503은 인증 만료와 구분합니다.
- 모든 데이터 출처를 mock으로 설정해도 관리자 서버 인증은 필요합니다. 인증 우회 설정은 없습니다.
- 기본 Mock Repository도 App 진입마다 새로 만들어 이전 로그인에서의 메모리 확인 상태가 남지 않게 합니다.

## 기존 API 호환성

/admin/orders·stores·owners·devices·alerts와 각 상세의 성공 JSON·조회 서비스는 유지합니다.
인증 없는 요청은 조회 전에 401이며 기존 로컬 접근 제한과 함께 적용됩니다.
매장 POST/PATCH를 포함해 현재 미들웨어는 안전하지 않은 HTTP 메서드에 CSRF를 요구합니다. 매장 쓰기 계약은 [STORE_WRITES.md](../company_admin_web/STORE_WRITES.md)를 참고하세요.

GET /stores, GET /stores/{id}/menus, POST /orders의 서비스·요청·응답은 변경하지 않았습니다.
POST /orders의 기존 로컬 제한, 기기·매장 검사, UUID 중복 방지·재시도·활성화 검사 순서도 유지합니다.
점주 웹과 Flutter 코드는 수정하지 않았습니다.

## 검증과 미검증

- Vitest: 전체 134개 통과(기존 110개 유지, 인증 테스트 24개 추가).
- FastAPI unittest: 87개 통과. 기존 66개 + 인증 20개 + 무인증 키오스크 주문 회귀 1개.
- Node 계약: 기존 22개 통과.
- TypeScript 검사·Vite 빌드 성공.
- 실제 계정 대신 실행 중 생성한 합성 비밀번호를 Argon2id로 해시해 메모리 SQLite에 넣었습니다.
- 기존 서버 API 테스트는 검사를 끄는 대신 실제 로그인·CSRF를 거친 테스트 클라이언트를 사용합니다.
- 추가 테스트: 안전한 로그인/실패, 평문·비활성·다른 해시 거부, 10개 관리자 조회 경로 차단,
  쿠키·역할, CSRF/Origin, 회전·로그아웃·만료·재시작, CORS, 오류 비밀 반사 방지, 조회 전용 SQL.
- 키오스크 회귀는 관리자 쿠키 없는 별도 클라이언트로 주문 저장·동일 UUID 재시도,
  비활성화 후 기존 주문 재시도 성공과 신규 주문 거부를 확인합니다.
- Chrome 155에서 격리 FastAPI/SQLite와 실제 HTTP·쿠키를 사용해 127.0.0.1:8181(1440px),
  localhost:8181(390px)의 로그인·6개 화면·새로고침 복원·로그아웃 후 401·쿠키 누락 시 로그인 복귀를 확인했습니다.
- 브라우저 통합 검증의 목록 데이터는 서버 측 격리 응답이며 인증 SQL과 Argon2id 검증은 실제 실행했습니다.
  실제 Azure 조회·로그인 성공을 검증한 결과가 아닙니다.

미검증: Azure의 admin SELECT 권한·실제 관리자 해시 설정·실데이터 조회,
HTTPS 인증서/프록시 실배포·다중 장치·Safari/Firefox.
과거 인증 없는 GET 전용 verify-live-api.mjs는 현재 보호된 API에서 401이 날 수 있습니다.
로그인 우회를 추가하지 않았으며 실제 데이터 계약 확인은 승인된 계정으로 로그인한 브라우저에서 수행해야 합니다.

## 실제 관리자 비밀번호 설정: 별도 승인 후

이번 작업에는 아래 절차를 실행하는 스크립트나 실제 DB UPDATE를 포함하지 않았습니다.

1. 사용자가 기존 관리자 계정에 비밀번호를 적용하는 작업을 별도로 승인합니다.
2. 승인된 로컬 환경에서 getpass 같은 숨김 입력으로 비밀번호를 두 번 받습니다.
   채팅·명령 인자·환경변수·SQL 문자열·콘솔 로그에 원문을 넣지 않습니다.
3. PasswordHasher의 Argon2id 기본값으로 메모리 안에서 해시를 생성하고 즉시 검증합니다.
   원문·해시를 화면이나 파일에 출력하지 않습니다.
4. 대상 admin_id와 영향 행 수를 확인하고, 승인된 도구에서 파라미터 바인딩으로
   기존 행의 admin_pw만 변경하는 트랜잭션을 수행합니다. 행 수가 정확히 1이 아니면 롤백합니다.
   계정 추가나 스키마 변경은 하지 않습니다.
5. 서버를 재시작해 이전 메모리 세션을 폐기한 뒤 새 비밀번호로 로그인·조회·로그아웃을 확인합니다.
6. 보고에는 대상 ID·성공/실패·검증 결과만 남깁니다. 비밀번호와 해시는 남기지 않습니다.

이 절차는 향후 승인된 DB 변경 작업이며 이번 완료 범위와 분리됩니다.

## 변경 파일

- company_admin_web/.env.example
- company_admin_web/LOGIN_UI.md
- company_admin_web/README.md
- company_admin_web/src/App.tsx
- company_admin_web/src/AppEntry.tsx
- company_admin_web/src/data/alertRepository.ts
- company_admin_web/src/data/apiSession.ts
- company_admin_web/src/data/authRepository.ts
- company_admin_web/src/data/deviceRepository.ts
- company_admin_web/src/data/orderRepository.ts
- company_admin_web/src/data/ownerRepository.ts
- company_admin_web/src/data/storeRepository.ts
- company_admin_web/src/features/LoginPage.tsx
- company_admin_web/src/layout/AdminShell.tsx
- company_admin_web/src/test/auth.test.tsx
- company_admin_web/src/test/login.test.tsx
- company_admin_web/src/theme/components.css
- company_admin_web/tsconfig.json
- server/AUTH.md
- server/README.md
- server/admin_auth.py
- server/auth_test_support.py
- server/main.py
- server/requirements.txt
- server/test_admin_auth.py
- server/test_alerts.py
- server/test_devices.py
- server/test_orders.py
- server/test_owners.py
- server/test_stores.py
