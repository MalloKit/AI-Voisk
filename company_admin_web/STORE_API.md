# 매장 조회 실데이터 연동

## 범위 및 API 계약
- `GET /admin/stores`: `{stores: AdminStoreView[], total: number}`. 전체 매장을 store_id 순으로 반환합니다.
- `GET /admin/stores/{store_id}`: 매장 1건. 없는 매장 404, 잘못된 ID 422, DB 오류 503.
- 기존 키오스크 `GET /stores`의 ID·이름 배열 응답은 변경하지 않습니다.
- 관리자 조회는 기존 /admin/ 로컬 접속 제한을 적용합니다. 로그인 인증을 대신하지 않으므로 외부 공개용이 아닙니다.
- 조회는 명시적인 READ ONLY 트랜잭션으로 실행하고 종료 시 rollback/close합니다.
- DB 구조의 매장 필드와 admin_nm, own_login_id만 명시적으로 선택합니다. 비밀번호는 조회하지 않습니다.
- store.admin_id → admin.admin_id, store.owner_id → owner.owner_id. owner_id NULL은 미연결이며 한 점주가 여러 매장을 가질 수 있습니다.
- LEFT JOIN을 사용합니다. 연결 ID는 있지만 계정 표시 정보가 없으면 미연결로 오인하지 않습니다.
- store_code는 의미가 문서화되지 않았습니다. 우편번호로 변환하거나 해석하지 않고 원래 이름과 값으로 표시합니다.

응답 필드: store_id, store_name, address, address_detail(nullable), store_code, phone,
business_no, representative, store_type, admin_id, admin_name(nullable), owner_id(nullable),
owner_login_id(nullable). API와 프론트엔드가 계약을 검증하며 누락·중복 ID·불완전 목록을 오류로 처리합니다.

## 화면과 데이터 출처
- 매장 관리: 기본 실제 GET API, 목록·검색·업종·점주 연결 필터·전체 목록 재조회·별도 상세 조회.
- 상세는 클릭할 때 서버에서 다시 조회하며 실패 시 목록 값으로 상세를 대체하지 않습니다.
- 대시보드와 매장 관리는 App의 동일한 매장 조회 결과·로딩·오류 상태를 공유합니다. 어느 화면에서 새로고침해도 매장 수·미연결 수·목록이 함께 갱신됩니다.
- 대시보드 매장 상세는 실제 상세 API를 사용합니다. 명시적 Mock 매장 모드만 기존 Mock 상세를 표시합니다.
- 대시보드의 미연결 매장 바로가기는 실제 매장 관리 화면의 미연결 필터로 이동합니다.
- 주문 API와 주문 공유 상태는 변경하지 않습니다.
- `VITE_STORE_API_BASE_URL`: 공개 서버 주소. 생략하면 주문 API 주소, 이후 localhost:8001을 사용합니다.
- `VITE_STORE_SOURCE=mock`을 명시한 시연만 Mock입니다. 오류에 따른 자동 전환은 없습니다.
- 웹 환경변수는 공개 값이므로 DB 설정이나 인증 비밀을 넣지 않습니다.

## 등록·수정·점주 연결 전 필요한 조건
현재 로그인/권한 체계가 없으므로 쓰기 라우트와 저장 버튼을 추가하지 않았습니다.
1. 관리자 로그인, 안전한 비밀번호 해시·검증, 세션/토큰 만료 및 폐기, 전송 구간 TLS.
2. 서버에서 회사 관리자 권한과 담당 매장 범위를 검사하고 클라이언트가 보낸 admin_id를 신뢰하지 않을 것.
3. 쿠키 인증이면 CSRF 방어. 배포 시 신뢰 프록시·접속 제한 정책도 별도로 설계.
4. 등록 필수값·길이·사업자번호·중복 정책, store_code의 정확한 의미와 입력 규칙 확정.
5. 점주 존재와 연결 변경 권한 검증. 현재 관계는 한 점주-여러 매장이므로 임의로 1:1 제한을 추가하지 않을 것.
6. 담당 관리자 배정 규칙, 수정 충돌 처리, 변경 이력과 감사 로그의 저장 방식 확정.
7. 등록·수정·연결 변경은 검증 후 DB 트랜잭션으로 처리하고 실패 시 전체 rollback.
8. 필요한 DDL·마이그레이션·운영 데이터 변경은 별도 승인 후 진행.

이 작업은 Azure 스키마 변경, 실제 데이터 생성·수정·삭제를 실행하지 않습니다.

## 검증 명령
- 웹: `npm ci`, `npm test`, `npm run build`
- 서버(server 폴더): `python -m unittest test_store_service -v` (표준 라이브러리만 필요)
- 서버 전체: `python -m unittest discover -p "test_*.py" -v` (requirements 설치 필요)
- 새 API 테스트는 메모리 SQLite를 사용하고 실제 DB 연결은 차단합니다.
- SQLite 검증은 실제 Azure MySQL 호환성 검증을 대신하지 않습니다.

추가 패키지 없는 프론트 Repository 계약 검증(Node 22.12 이상):
`node --experimental-transform-types --test scripts/store-contract.test.mjs`.
이 검증은 JSX 렌더링·TypeScript 타입 검사·Vite 빌드를 대신하지 않습니다.

## 이번 Work 환경 검증 결과 (2026-10-26)
- 조회 서비스 SQLite 단위 테스트: 5개 통과.
- Node 내장 테스트를 사용한 실제 TypeScript Repository 실행: 4개 통과.
- Python 파일 10개의 AST 구문 검사 통과.
- npm ci: npm 내부 오류(Exit handler never called)로 설치 실패.
- npm test: vitest 미설치로 시작 불가.
- npm run build: tsc 미설치로 시작 불가.
- 서버 의존성 설치: fastapi 고정 버전을 설치할 수 없어 실패.
- 서버 전체 테스트: 조회 서비스 5개 통과, 나머지 4개 모듈은 fastapi/uvicorn 미설치로 import 실패.
- 새 React UI 테스트 4개 및 Vitest Repository 테스트 6개는 추가했으나 이 환경에서 실행하지 못했습니다.
- 기존 주문 UI/서버 회귀 테스트도 의존성 문제로 완료하지 못했습니다.
- 실제 Azure DB는 접속하지 않았습니다. 실제 스키마·네트워크·TLS 호환성은 아직 미검증입니다.
- 전체 UI 테스트·타입 검사·빌드·FastAPI 통합 검증의 통과를 의미하지 않습니다.
