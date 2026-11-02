# 점주 계정 조회 API

기준 커밋: 40385d6. 이번 변경은 조회만 추가합니다.

## API 및 DB 관계
- GET /admin/owners → {owners: [{owner_id, login_id, store_count}], total}
- GET /admin/owners/{owner_id} → {owner_id, login_id, store_count, stores}
- stores 항목: store_id, store_name, address, address_detail(nullable), admin_id, admin_name(nullable)
- owner_id는 owner.owner_id, login_id는 owner.own_login_id입니다. 의미가 없는 새 컬럼을 가정하지 않습니다.
- 목록은 owner를 기준으로 store.owner_id를 LEFT JOIN하고 매장 수를 집계합니다.
- 상세는 계정 조회 후 연결 매장과 담당 관리자 정보를 조회합니다. 반환 건수는 실제 stores 길이로 계산합니다.
- 미연결 계정은 store_count=0, stores=[]이며 성공 응답입니다. 없는 계정은 404, 잘못된 ID는 422, DB 오류는 원문을 제외한 503입니다.
- 담당 관리자 정보가 누락되어도 매장은 유지하고 관리자 이름은 null로 반환합니다.
- SQL은 필요한 필드를 명시적으로 선택합니다. 비밀번호/인증 컬럼은 SQL 조회·응답·로그에 포함하지 않습니다.
- 각 요청은 START TRANSACTION READ ONLY를 사용하고 성공·실패 모두 rollback/close합니다.
- /admin/의 기존 로컬 접속 제한을 그대로 적용합니다. 이는 로그인 인증을 대신하지 않으며 외부 공개용이 아닙니다.
- 기존 주문·매장·키오스크 API는 변경하지 않습니다. 서버 변경은 점주 조회 서비스 import와 새 모델·라우트 추가입니다.

## 프론트엔드
- 기본은 실제 점주 API이며 검색(ID/로그인 ID), 전체/연결됨/미연결 필터, 매장 수, 상세, 새로고침·초기화를 제공합니다.
- 상세는 별도 API를 호출하며 실패 시 목록 값이나 Mock 상세로 대체하지 않습니다.
- OwnerDetails는 source=api일 때 ApiOwnerDetail만 받으며 AdminSnapshot을 받지 않습니다. 실제 점주 ID가 Mock ID와 같아도 Mock 매장과 결합할 수 없습니다.
- 정상적인 0건과 실패를 구분하며 조회 실패에는 재시도 버튼을 표시합니다.
- API 계약에서 누락 필드·음수 건수·중복 ID·전체 건수 불일치·상세 ID 불일치를 거부합니다.
- VITE_OWNER_API_BASE_URL은 공개 API 주소입니다. 생략 시 주문 API 주소, 그다음 http://127.0.0.1:8001을 사용합니다.
- VITE_OWNER_SOURCE=mock을 명시한 경우만 기존 Mock 시연을 사용합니다. 장애 시 자동 전환은 없습니다.
- 대시보드 점주 수와 점주 관리 목록은 App의 동일한 조회 결과를 공유합니다. 어느 화면에서 새로고침해도 함께 갱신되며 매장·주문 상태와 오류는 독립적입니다.
- 명시적 Mock 점주 모드에서만 대시보드 점주 수도 Mock을 사용합니다.
- 브라우저 환경변수에 DB 설정이나 인증 비밀을 넣지 않습니다.

## 테스트 실행
회사 관리자 폴더:
- npm ci
- npm test
- npm run build
- node --experimental-transform-types --test scripts/store-contract.test.mjs scripts/verify-owner-contract.mjs

server 폴더:
- python -m unittest test_owner_service test_store_service -v
- python -m unittest discover -p "test_*.py" -v

새 Node 검증 파일은 verify-owner-contract.mjs로 이름을 지어 Vitest의 *.test.* 자동 수집에 포함되지 않습니다.
기존 store-contract.test.mjs의 Vitest 제외 설정은 그대로 유지합니다.
서버 테스트는 메모리 SQLite를 사용합니다. FastAPI 테스트는 database.connect를 차단하여 실제 Azure 접속을 금지합니다.

## Work 검증 결과 (2026-10-26)
| 검증 | 결과 |
| --- | --- |
| 점주 서비스 SQLite 테스트 | 9개 통과 |
| 기존 매장 서비스 SQLite 테스트 | 5개 통과 |
| 점주 TypeScript Repository Node 실행 검증 | 6개 통과 |
| 기존 매장 TypeScript Repository Node 실행 검증 | 4개 통과 |
| Python AST 구문 검사 | 13개 파일 통과 |
| npm ci | npm 내부 오류: Exit handler never called |
| npm test | vitest 미설치로 시작 불가 |
| npm run build | tsc 미설치로 시작 불가 |
| Python 의존성 설치 | fastapi==0.143.0 설치 불가 |
| 서버 전체 테스트 | 서비스 14개 통과, 의존성 누락으로 5개 모듈 import 실패 |

추가한 Vitest UI 테스트 6개·Repository 테스트 3개와 FastAPI 점주 API 테스트 5개는 실행하지 못했습니다.
기존 주문·매장 UI 및 HTTP 회귀 테스트도 미검증입니다. Node 실행은 JSX 렌더링·타입 검사·Vite 빌드를 대신하지 않습니다.
실제 Azure DB에 접속하거나 데이터를 변경하지 않았습니다.

## 실제 Azure에서 남은 읽기 전용 검증
1. owner/store/admin의 실제 컬럼명·자료형·NULL 허용·외래키와 문서의 일치 여부.
2. 0건, 미연결, 단일 매장, 여러 매장에 대한 실제 목록·상세 건수와 관계.
3. TLS 인증서·접속 허용·조회 계정 권한 및 READ ONLY 트랜잭션 호환성.
4. HTTP 응답 계약과 화면 표시, 한국어·주소·관리자명 표시.
5. 실제 데이터량에서 전체 목록 조회·집계 성능과 인덱스 확인. 필요 시 페이지네이션 설계를 별도로 결정.
스키마가 다르면 오류로 드러내고 정확한 구조를 확인한 후 대응합니다. 임의로 DDL을 실행하지 않습니다.

## 후속 쓰기 기능 전 설계 조건
- 공통: 관리자 로그인과 서버 권한 검사, 담당 범위, 세션/토큰 만료·폐기, TLS, 인증 방식에 따른 CSRF 방어와 감사 로그.
- 계정 생성: 로그인 ID 중복·대소문자·정규화 규칙을 실제 DB 제약과 함께 확정하고 비밀번호는 검증된 해시 방식으로 저장. 기존 인증 데이터의 저장 형태를 추측하지 말고 마이그레이션 필요 여부를 먼저 확인.
- 비밀번호 초기화: 본인·권한 확인, 일회성 만료 토큰, 재사용 방지, 요청 제한, 기존 세션 폐기와 비밀 비노출.
- 매장 연결: 한 점주-여러 매장 관계를 유지하고 계정·매장 존재/권한 검사, 동시 수정 충돌 처리, 변경 트랜잭션과 이력 설계.
- 필요한 DDL·운영 데이터 변경은 별도 승인 후 실행합니다. 이 변경에는 생성·삭제·비밀번호 변경·연결 변경 API가 없습니다.

## 변경 파일
서버: main.py, owner_service.py, test_owner_service.py, test_owners.py.
프론트: App.tsx, data/models.ts, data/ownerRepository.ts, features/OwnersPage.tsx,
features/details.tsx, features/DashboardPage.tsx, layout/AdminShell.tsx, .env.example.
테스트: src/test/app.test.tsx, dashboard-live.test.tsx, order-filters.test.tsx, stores-live.test.tsx
(기존 시연 테스트의 ownerRepository=null 명시), owners-live.test.tsx, owner-repository.test.ts,
scripts/verify-owner-contract.mjs.
문서: README.md, OWNER_API.md.
